/// macOS CGEventTap — intercepts mouse events system-wide and reads relative deltas.
///
/// When capture is active, we install a CGEventTap in "consume" mode (kCGEventTapOptionDefault)
/// on the HID event stream. For every mouse-moved/dragged event, we read
/// kCGMouseEventDeltaX/Y (the raw hardware delta, unaffected by acceleration) and return
/// NULL from the callback so the event is consumed and the local cursor never moves.

#[cfg(target_os = "macos")]
pub use macos_impl::*;

#[cfg(not(target_os = "macos"))]
pub use stub::*;

// ─── macOS implementation ───────────────────────────────────────────────────

#[cfg(target_os = "macos")]
mod macos_impl {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;
    use std::thread;

    use anyhow::{anyhow, Result};

    use core_graphics::event::{
        CGEventTap, CGEventTapLocation, CGEventTapOptions, CGEventTapPlacement,
        CGEventType, EventField,
    };

    pub type DeltaSender = std::sync::mpsc::Sender<(i32, i32, MouseEventKind)>;

    #[derive(Debug, Clone, Copy)]
    pub enum MouseEventKind {
        Move,
        ButtonDown(u8), // 0 = left, 1 = right, 2 = middle
        ButtonUp(u8),
        Scroll(i32, i32), // dx, dy
    }

    /// A handle to a running CGEventTap session.
    /// Call `stop()` or drop to deactivate.
    pub struct EventTapHandle {
        running: Arc<AtomicBool>,
    }

    impl EventTapHandle {
        pub fn stop(&self) {
            self.running.store(false, Ordering::SeqCst);
        }
    }

    impl Drop for EventTapHandle {
        fn drop(&mut self) {
            self.stop();
        }
    }

    /// Install a CGEventTap that consumes mouse events and forwards deltas to `tx`.
    /// Returns `Ok(handle)` on success, `Err` if the tap could not be created (permissions).
    pub fn install_event_tap(tx: DeltaSender) -> Result<EventTapHandle> {
        let running = Arc::new(AtomicBool::new(true));
        let running_clone = running.clone();

        // Use a channel to signal success/failure back from the tap thread
        let (result_tx, result_rx) = std::sync::mpsc::channel::<Result<()>>();

        thread::spawn(move || {
            let running_inner = running_clone;

            let tap = CGEventTap::new(
                CGEventTapLocation::HID,
                CGEventTapPlacement::HeadInsertEventTap,
                CGEventTapOptions::Default, // consume mode
                vec![
                    CGEventType::MouseMoved,
                    CGEventType::LeftMouseDragged,
                    CGEventType::RightMouseDragged,
                    CGEventType::LeftMouseDown,
                    CGEventType::LeftMouseUp,
                    CGEventType::RightMouseDown,
                    CGEventType::RightMouseUp,
                    CGEventType::ScrollWheel,
                    CGEventType::OtherMouseDown,
                    CGEventType::OtherMouseUp,
                ],
                move |_proxy, event_type, event| {
                    if !running_inner.load(Ordering::SeqCst) {
                        // Deactivating — pass through
                        return Some(event.to_owned());
                    }

                    match event_type {
                        CGEventType::MouseMoved
                        | CGEventType::LeftMouseDragged
                        | CGEventType::RightMouseDragged => {
                            let dx = event.get_integer_value_field(EventField::MOUSE_EVENT_DELTA_X) as i32;
                            let dy = event.get_integer_value_field(EventField::MOUSE_EVENT_DELTA_Y) as i32;
                            let _ = tx.send((dx, dy, MouseEventKind::Move));
                            None // consume: cursor stays put
                        }
                        CGEventType::LeftMouseDown => {
                            let _ = tx.send((0, 0, MouseEventKind::ButtonDown(0)));
                            None
                        }
                        CGEventType::LeftMouseUp => {
                            let _ = tx.send((0, 0, MouseEventKind::ButtonUp(0)));
                            None
                        }
                        CGEventType::RightMouseDown => {
                            let _ = tx.send((0, 0, MouseEventKind::ButtonDown(1)));
                            None
                        }
                        CGEventType::RightMouseUp => {
                            let _ = tx.send((0, 0, MouseEventKind::ButtonUp(1)));
                            None
                        }
                        CGEventType::OtherMouseDown => {
                            let _ = tx.send((0, 0, MouseEventKind::ButtonDown(2)));
                            None
                        }
                        CGEventType::OtherMouseUp => {
                            let _ = tx.send((0, 0, MouseEventKind::ButtonUp(2)));
                            None
                        }
                        CGEventType::ScrollWheel => {
                            let dy = event.get_integer_value_field(
                                EventField::SCROLL_WHEEL_EVENT_POINT_DELTA_AXIS_1,
                            ) as i32;
                            let dx = event.get_integer_value_field(
                                EventField::SCROLL_WHEEL_EVENT_POINT_DELTA_AXIS_2,
                            ) as i32;
                            let _ = tx.send((dx, dy, MouseEventKind::Scroll(dx, dy)));
                            None
                        }
                        _ => Some(event.to_owned()),
                    }
                },
            );

            match tap {
                Ok(tap) => {
                    // Tap created successfully — signal the caller
                    let _ = result_tx.send(Ok(()));
                    unsafe {
                        // Add the tap's mach port source to this thread's RunLoop
                        let loop_source = tap.mach_port
                            .create_runloop_source(0)
                            .expect("failed to create CFRunLoopSource");
                        let run_loop = core_foundation::runloop::CFRunLoop::get_current();
                        run_loop.add_source(&loop_source, core_foundation::runloop::kCFRunLoopCommonModes);
                        tap.enable();
                        core_foundation::runloop::CFRunLoop::run_current();
                    }
                }
                Err(_) => {
                    let _ = result_tx.send(Err(anyhow!(
                        "CGEventTap creation failed. Grant Accessibility + Input Monitoring \
                         permission to TVDev Studio in System Settings → Privacy & Security."
                    )));
                }
            }
        });

        // Wait up to 500ms for the tap thread to report success/failure
        match result_rx.recv_timeout(std::time::Duration::from_millis(500)) {
            Ok(Ok(())) => Ok(EventTapHandle { running }),
            Ok(Err(e)) => Err(e),
            Err(_) => Err(anyhow!("CGEventTap thread did not respond in time")),
        }
    }

    /// Hide the macOS system cursor on all displays.
    const CG_NULL_DIRECT_DISPLAY: u32 = 0;

    pub fn hide_cursor() {
        unsafe { CGDisplayHideCursor(CG_NULL_DIRECT_DISPLAY) }
    }

    /// Show the macOS system cursor again.
    pub fn show_cursor() {
        unsafe { CGDisplayShowCursor(CG_NULL_DIRECT_DISPLAY) }
    }

    // Raw bindings to CoreGraphics cursor functions not exposed by the crate

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGDisplayHideCursor(display: u32);
        fn CGDisplayShowCursor(display: u32);
    }
}

// ─── Non-macOS stub ─────────────────────────────────────────────────────────

#[cfg(not(target_os = "macos"))]
mod stub {
    use anyhow::{anyhow, Result};

    #[derive(Debug, Clone, Copy)]
    pub enum MouseEventKind {
        Move,
        ButtonDown(u8),
        ButtonUp(u8),
        Scroll(i32, i32),
    }

    pub type DeltaSender = std::sync::mpsc::Sender<(i32, i32, MouseEventKind)>;

    pub struct EventTapHandle;

    impl EventTapHandle {
        pub fn stop(&self) {}
    }

    pub fn install_event_tap(_tx: DeltaSender) -> Result<EventTapHandle> {
        Err(anyhow!("CGEventTap is macOS-only"))
    }

    pub fn hide_cursor() {}
    pub fn show_cursor() {}
}
