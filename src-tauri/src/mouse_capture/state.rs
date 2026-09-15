/// Capture state machine — the single authoritative owner of capture lifecycle.
///
/// External inputs (hotkey fired, connection lost, TV disconnected) send `CaptureEvent`
/// messages into the manager's channel. The manager processes them sequentially,
/// transitioning between `CaptureState::Idle` and `CaptureState::Captured`.
///
/// This design avoids races: the hotkey handler and ADB disconnect handler both just
/// push events — they never touch capture state directly.

use std::sync::mpsc as std_mpsc;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use anyhow::Result;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::mouse_capture::event_tap::{self, EventTapHandle, MouseEventKind};
use crate::mouse_capture::ws_server::WsServerHandle;
use crate::mouse_capture::protocol::{CursorMessage, MouseButton};

// ─── State types ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CaptureState {
    Idle,
    Captured,
}

/// Events the state machine accepts.
#[derive(Debug)]
#[allow(dead_code)]
pub enum CaptureEvent {
    /// User pressed ⌘⇧L to toggle capture
    HotkeyToggle,
    /// Mouse delta from CGEventTap (dx, dy, kind)
    MouseDelta(i32, i32, MouseEventKind),
    /// Button down/up events (already carried in MouseDelta but also sent separately)
    ButtonDown(u8),
    ButtonUp(u8),
    /// Scroll event
    Scroll(i32, i32),
    /// Connection to TV was lost (auto-release)
    ConnectionLost,
    /// Shutdown the state machine
    Shutdown,
}

/// Configuration supplied when starting capture.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CaptureConfig {
    /// TV screen width (used to clamp virtual cursor)
    pub screen_w: u32,
    /// TV screen height
    pub screen_h: u32,
    /// Mouse sensitivity multiplier (1.0 = raw hardware, 2.0 = 2× faster on TV)
    pub sensitivity: f32,
    /// Pixel distance between down/up to be considered a tap (not a drag)
    pub drag_threshold: u32,
    /// Target frame rate for sending deltas (Hz)
    pub target_hz: u32,
    /// ADB serial for Android TV path (if set, sends via ADB in addition to WS)
    pub adb_serial: Option<String>,
    /// WebSocket port for Tizen/browser path
    pub ws_port: u16,
    /// Session auth token
    pub session_token: String,
    /// Hide macOS system cursor while capturing (default: false, visible)
    #[serde(default)]
    pub hide_system_cursor: bool,
}

impl Default for CaptureConfig {
    fn default() -> Self {
        Self {
            screen_w: 1920,
            screen_h: 1080,
            sensitivity: 2.0,
            drag_threshold: 8,
            target_hz: 60,
            adb_serial: None,
            ws_port: 9877,
            session_token: String::new(),
            hide_system_cursor: false,
        }
    }
}

/// Shared state exposed to Tauri commands via `State<CaptureManagerState>`.
pub struct CaptureManagerState {
    /// Current capture state
    pub state: Mutex<CaptureState>,
    /// Channel to push events into the state machine
    pub event_tx: Mutex<Option<std_mpsc::Sender<CaptureEvent>>>,
    /// WebSocket server handle (if running)
    pub ws_handle: Mutex<Option<WsServerHandle>>,
    /// Current config
    pub config: Mutex<CaptureConfig>,
    /// Virtual cursor position (updated by state machine, readable from Tauri commands)
    pub virtual_cursor: Mutex<(i32, i32)>,
}

impl Default for CaptureManagerState {
    fn default() -> Self {
        Self {
            state: Mutex::new(CaptureState::Idle),
            event_tx: Mutex::new(None),
            ws_handle: Mutex::new(None),
            config: Mutex::new(CaptureConfig::default()),
            virtual_cursor: Mutex::new((0, 0)),
        }
    }
}

// ─── Capture manager ─────────────────────────────────────────────────────────

/// Start the capture manager and return an event sender.
/// This spawns a background thread that owns the event tap and the state machine loop.
pub fn start_capture_manager(
    app: AppHandle,
    managed: Arc<CaptureManagerState>,
    config: CaptureConfig,
) {
    let (event_tx, event_rx) = std_mpsc::channel::<CaptureEvent>();

    // Store the sender so Tauri commands can push events
    {
        let mut lock = managed.event_tx.lock().unwrap();
        *lock = Some(event_tx);
    }
    {
        let mut lock = managed.config.lock().unwrap();
        *lock = config.clone();
    }

    let app_clone = app.clone();
    let managed_clone = managed.clone();

    std::thread::spawn(move || {
        run_state_machine(app_clone, managed_clone, config, event_rx);
    });
}

fn run_state_machine(
    app: AppHandle,
    managed: Arc<CaptureManagerState>,
    config: CaptureConfig,
    event_rx: std_mpsc::Receiver<CaptureEvent>,
) {
    let tick_duration = Duration::from_millis(1000 / config.target_hz as u64);
    let sensitivity = config.sensitivity;
    let drag_threshold = config.drag_threshold as i32;

    // Accumulated delta for current tick
    let mut acc_dx: i32 = 0;
    let mut acc_dy: i32 = 0;

    // Virtual cursor position on TV
    let mut vx: i32 = (config.screen_w / 2) as i32;
    let mut vy: i32 = (config.screen_h / 2) as i32;
    let screen_w = config.screen_w as i32;
    let screen_h = config.screen_h as i32;

    // Button state tracking for tap vs drag detection
    let mut down_pos: Option<(i32, i32)> = None;
    let mut _btn_down: Option<u8> = None;

    // Event tap handle (installed when captured, dropped when idle)
    let mut tap_handle: Option<EventTapHandle> = None;
    let mut tap_rx: Option<std_mpsc::Receiver<(i32, i32, MouseEventKind)>> = None;

    // WebSocket handle
    let ws_handle = managed.ws_handle.lock().unwrap().clone();

    let adb_serial = config.adb_serial.clone();
    let mut adb_session: Option<crate::adb::AdbShellSession> = None;
    let mut last_sent_vx: i32 = -1;
    let mut last_sent_vy: i32 = -1;

    let mut last_tick = Instant::now();
    let mut current_state = CaptureState::Idle;

    loop {
        // Drain events (non-blocking)
        loop {
            match event_rx.try_recv() {
                Ok(CaptureEvent::Shutdown) => {
                    do_release(&app, &managed, &mut tap_handle, &ws_handle);
                    return;
                }
                Ok(CaptureEvent::HotkeyToggle) => {
                    if current_state == CaptureState::Idle {
                        // → CAPTURED
                        match try_install_tap() {
                            Ok((handle, rx)) => {
                                tap_handle = Some(handle);
                                tap_rx = Some(rx);
                                if config.hide_system_cursor {
                                    event_tap::hide_cursor();
                                }
                                current_state = CaptureState::Captured;
                                // Reset virtual cursor to center
                                vx = screen_w / 2;
                                vy = screen_h / 2;
                                *managed.virtual_cursor.lock().unwrap() = (vx, vy);
                                let _ = app.emit("virtual-cursor-moved", (vx, vy));
                                // Broadcast cursor_start
                                if let Some(ws) = &ws_handle {
                                    let _ = ws.broadcast(&CursorMessage::CursorStart {
                                        screen_w: config.screen_w,
                                        screen_h: config.screen_h,
                                        session_token: config.session_token.clone(),
                                    });
                                }
                                set_state(&managed, CaptureState::Captured);
                                let _ = app.emit("capture-state-changed", CaptureState::Captured);
                                if let Some(ref serial) = adb_serial {
                                    adb_session = crate::adb::AdbShellSession::spawn(serial).ok();
                                    if let Some(ref mut session) = adb_session {
                                        let _ = session.move_mouse(vx, vy);
                                        last_sent_vx = vx;
                                        last_sent_vy = vy;
                                    }
                                    let s = serial.clone();
                                    std::thread::spawn(move || {
                                        let _ = crate::adb::enable_on_screen_touches(&s, true);
                                    });
                                }
                                eprintln!("[capture] → CAPTURED");
                            }
                            Err(e) => {
                                eprintln!("[capture] tap install failed: {}", e);
                                let _ = app.emit("capture-permission-error", e.to_string());
                            }
                        }
                    } else {
                        // → IDLE
                        adb_session = None;
                        do_release(&app, &managed, &mut tap_handle, &ws_handle);
                        current_state = CaptureState::Idle;
                        eprintln!("[capture] → IDLE (hotkey)");
                    }
                }
                Ok(CaptureEvent::ConnectionLost) => {
                    if current_state == CaptureState::Captured {
                        do_release(&app, &managed, &mut tap_handle, &ws_handle);
                        current_state = CaptureState::Idle;
                        eprintln!("[capture] → IDLE (connection lost)");
                    }
                }
                Ok(CaptureEvent::MouseDelta(dx, dy, _kind)) => {
                    if current_state == CaptureState::Captured {
                        let sdx = (dx as f32 * sensitivity) as i32;
                        let sdy = (dy as f32 * sensitivity) as i32;
                        acc_dx += sdx;
                        acc_dy += sdy;
                        vx = (vx + sdx).clamp(0, screen_w - 1);
                        vy = (vy + sdy).clamp(0, screen_h - 1);
                        // Update shared cursor position & emit event
                        *managed.virtual_cursor.lock().unwrap() = (vx, vy);
                        let _ = app.emit("virtual-cursor-moved", (vx, vy));
                    }
                }
                Ok(CaptureEvent::ButtonDown(btn)) => {
                    if current_state == CaptureState::Captured {
                        down_pos = Some((vx, vy));
                        _btn_down = Some(btn);
                        let button = btn_to_enum(btn);
                        let _ = app.emit("virtual-cursor-pressed", true);
                        if let Some(ws) = &ws_handle {
                            let _ = ws.broadcast(&CursorMessage::CursorDown { button });
                        }
                    }
                }
                Ok(CaptureEvent::ButtonUp(btn)) => {
                    if current_state == CaptureState::Captured {
                        let button = btn_to_enum(btn);
                        let _ = app.emit("virtual-cursor-pressed", false);
                        if let Some(ws) = &ws_handle {
                            let _ = ws.broadcast(&CursorMessage::CursorUp { button });
                        }
                        // Tap detection: if movement was small → ADB tap
                        if let (Some((dx_pos, dy_pos)), Some(adb_s)) = (down_pos.take(), &adb_serial) {
                            let moved = ((vx - dx_pos).abs()).max((vy - dy_pos).abs());
                            if moved < drag_threshold {
                                // It's a tap
                                let serial = adb_s.clone();
                                let tap_x = vx as u32;
                                let tap_y = vy as u32;
                                std::thread::spawn(move || {
                                    let _ = crate::adb::send_click(&serial, tap_x, tap_y);
                                });
                            } else {
                                // It's a drag — dispatch swipe from down_pos to current
                                let serial = adb_s.clone();
                                let (sx, sy) = (dx_pos as u32, dy_pos as u32);
                                let (ex, ey) = (vx as u32, vy as u32);
                                std::thread::spawn(move || {
                                    let _ = crate::adb::send_swipe(&serial, sx, sy, ex, ey, 150);
                                });
                            }
                        }
                        _btn_down = None;
                    }
                }
                Ok(CaptureEvent::Scroll(dx, dy)) => {
                    if current_state == CaptureState::Captured {
                        if let Some(ws) = &ws_handle {
                            let _ = ws.broadcast(&CursorMessage::CursorScroll { dx, dy });
                        }
                        // For ADB: scroll maps to swipe gesture
                        if let Some(adb_s) = &adb_serial {
                            let serial = adb_s.clone();
                            let cx = vx as u32;
                            let cy = vy as u32;
                            let scroll_dy = dy * 5; // amplify scroll into swipe pixels
                            std::thread::spawn(move || {
                                let end_y = (cy as i32 - scroll_dy).max(0) as u32;
                                let _ = crate::adb::send_swipe(&serial, cx, cy, cx, end_y, 100);
                            });
                        }
                    }
                }
                Err(std_mpsc::TryRecvError::Empty) => break,
                Err(std_mpsc::TryRecvError::Disconnected) => return,
            }
        }

        // Drain events from the event tap thread
        if current_state == CaptureState::Captured {
            if let Some(rx) = &tap_rx {
                loop {
                    match rx.try_recv() {
                        Ok((dx, dy, kind)) => {
                            match kind {
                                MouseEventKind::Move => {
                                    let sdx = (dx as f32 * sensitivity) as i32;
                                    let sdy = (dy as f32 * sensitivity) as i32;
                                    acc_dx += sdx;
                                    acc_dy += sdy;
                                    vx = (vx + sdx).clamp(0, screen_w - 1);
                                    vy = (vy + sdy).clamp(0, screen_h - 1);
                                    *managed.virtual_cursor.lock().unwrap() = (vx, vy);
                                    let _ = app.emit("virtual-cursor-moved", (vx, vy));
                                }
                                MouseEventKind::ButtonDown(btn) => {
                                    down_pos = Some((vx, vy));
                                    _btn_down = Some(btn);
                                    let button = btn_to_enum(btn);
                                    let _ = app.emit("virtual-cursor-pressed", true);
                                    if let Some(ws) = &ws_handle {
                                        let _ = ws.broadcast(&CursorMessage::CursorDown { button });
                                    }
                                }
                                MouseEventKind::ButtonUp(btn) => {
                                    let button = btn_to_enum(btn);
                                    let _ = app.emit("virtual-cursor-pressed", false);
                                    if let Some(ws) = &ws_handle {
                                        let _ = ws.broadcast(&CursorMessage::CursorUp { button });
                                    }
                                    if let Some((dx_pos, dy_pos)) = down_pos.take() {
                                        let moved = ((vx - dx_pos).abs()).max((vy - dy_pos).abs());
                                        if let Some(ref mut session) = adb_session {
                                            if moved < drag_threshold {
                                                let _ = session.tap_mouse(vx, vy);
                                            } else {
                                                let _ = session.swipe_mouse(dx_pos, dy_pos, vx, vy, 150);
                                            }
                                        } else if let Some(ref serial) = adb_serial {
                                            let s = serial.clone();
                                            let (tx, ty) = (vx as u32, vy as u32);
                                            std::thread::spawn(move || {
                                                let _ = crate::adb::send_click(&s, tx, ty);
                                            });
                                        }
                                    }
                                    _btn_down = None;
                                }
                                MouseEventKind::Scroll(sdx, sdy) => {
                                    if let Some(ws) = &ws_handle {
                                        let _ = ws.broadcast(&CursorMessage::CursorScroll { dx: sdx, dy: sdy });
                                    }
                                }
                            }
                        }
                        Err(_) => break,
                    }
                }
            }

            // Stream continuous mouse movement to Android TV via ADB shell stdin pipe
            if vx != last_sent_vx || vy != last_sent_vy {
                if let Some(ref mut session) = adb_session {
                    let _ = session.move_mouse(vx, vy);
                    last_sent_vx = vx;
                    last_sent_vy = vy;
                }
            }
        }

        // Tick: flush accumulated deltas at ~60Hz
        if last_tick.elapsed() >= tick_duration && (acc_dx != 0 || acc_dy != 0) {
            if current_state == CaptureState::Captured {
                if let Some(ws) = &ws_handle {
                    let _ = ws.broadcast(&CursorMessage::CursorMove { dx: acc_dx, dy: acc_dy });
                }
            }
            acc_dx = 0;
            acc_dy = 0;
            last_tick = Instant::now();
        }

        std::thread::sleep(Duration::from_millis(1));
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

fn try_install_tap() -> Result<(EventTapHandle, std_mpsc::Receiver<(i32, i32, MouseEventKind)>)> {
    let (tx, rx) = std_mpsc::channel();
    let handle = event_tap::install_event_tap(tx)?;
    Ok((handle, rx))
}

fn do_release(
    app: &AppHandle,
    managed: &Arc<CaptureManagerState>,
    tap_handle: &mut Option<EventTapHandle>,
    ws_handle: &Option<WsServerHandle>,
) {
    // Stop event tap
    if let Some(handle) = tap_handle.take() {
        handle.stop();
    }
    // Show cursor
    event_tap::show_cursor();
    // Broadcast cursor_end to TV clients
    if let Some(ws) = ws_handle {
        let _ = ws.broadcast(&CursorMessage::CursorEnd);
    }
    if let Ok(config) = managed.config.lock() {
        if let Some(ref serial) = config.adb_serial {
            let s = serial.clone();
            std::thread::spawn(move || {
                let _ = crate::adb::enable_on_screen_touches(&s, false);
            });
        }
    }
    set_state(managed, CaptureState::Idle);
    let _ = app.emit("capture-state-changed", CaptureState::Idle);
}

fn set_state(managed: &Arc<CaptureManagerState>, state: CaptureState) {
    let mut lock = managed.state.lock().unwrap();
    *lock = state;
}

fn btn_to_enum(btn: u8) -> MouseButton {
    match btn {
        1 => MouseButton::Right,
        2 => MouseButton::Middle,
        _ => MouseButton::Left,
    }
}

/// Push an event into the running state machine.
/// Returns false if the machine is not running.
pub fn push_event(managed: &CaptureManagerState, event: CaptureEvent) -> bool {
    if let Ok(lock) = managed.event_tx.lock() {
        if let Some(tx) = lock.as_ref() {
            return tx.send(event).is_ok();
        }
    }
    false
}
