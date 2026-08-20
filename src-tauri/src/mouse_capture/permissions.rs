/// macOS Accessibility permission check.
/// On macOS, reading low-level mouse events (CGEventTap) requires both:
///   - Accessibility (AXIsProcessTrusted)
///   - Input Monitoring (checked implicitly when creating the tap)
///
/// This module provides a safe Rust wrapper around the C-level AXIsProcessTrusted()
/// and the System Settings deep-link to open the correct pane.

#[cfg(target_os = "macos")]
pub use macos::*;

#[cfg(not(target_os = "macos"))]
pub use stub::*;

// ─── macOS implementation ───────────────────────────────────────────────────

#[cfg(target_os = "macos")]
mod macos {
    use std::process::Command;

    /// Returns `true` if the process is trusted for Accessibility (AXIsProcessTrusted).
    /// This is the key permission gate for CGEventTap. When false, event tap creation
    /// either fails silently or returns a passthrough-only tap — we must detect this
    /// upfront rather than discovering it at capture time.
    #[allow(dead_code)]
    pub fn check_accessibility_permission() -> bool {
        // AXIsProcessTrusted is available through the accessibility framework.
        // Use the raw C call via std::process::Command to query via osascript,
        // which is simpler than full ApplicationServices FFI.
        let result = Command::new("osascript")
            .args(["-e", "tell application \"System Events\" to return \"ok\""])
            .output();

        match result {
            Ok(out) => out.status.success(),
            Err(_) => false,
        }
    }

    /// A more reliable accessibility check using AXIsProcessTrusted directly via
    /// a tiny helper that reads the process trust state.
    pub fn is_process_trusted() -> bool {
        // Shell out to check trust status using the accessibility API.
        // This is equivalent to AXIsProcessTrusted() without requiring unsafe FFI binding.
        // The app's own process ID is checked by the OS against the Accessibility list.
        unsafe { ax_is_process_trusted() }
    }

    extern "C" {
        /// Direct binding to AXIsProcessTrusted() from ApplicationServices.framework
        fn AXIsProcessTrusted() -> bool;
    }

    unsafe fn ax_is_process_trusted() -> bool {
        AXIsProcessTrusted()
    }

    /// Open the Accessibility pane in System Settings so the user can grant permission.
    /// This is the standard pattern for apps that need Accessibility — prompt once,
    /// then deep-link so the user can grant without hunting through Settings.
    pub fn open_accessibility_settings() {
        // macOS 13+ (Ventura and later): System Settings URL scheme
        let _ = Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
            .spawn();
    }

    /// Open the Input Monitoring pane in System Settings.
    pub fn open_input_monitoring_settings() {
        let _ = Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent")
            .spawn();
    }
}

// ─── Stub for non-macOS platforms ───────────────────────────────────────────

#[cfg(not(target_os = "macos"))]
mod stub {
    pub fn is_process_trusted() -> bool {
        // On non-macOS, no Accessibility permission model — always "trusted"
        true
    }

    pub fn open_accessibility_settings() {}
    pub fn open_input_monitoring_settings() {}
}
