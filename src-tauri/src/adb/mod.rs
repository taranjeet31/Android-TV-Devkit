use serde::{Serialize, Deserialize};
use std::path::PathBuf;
use std::process::Command;
use std::str;
use anyhow::{Result, anyhow};

/// Resolves the absolute path to the `adb` binary.
/// On macOS, GUI apps don't inherit the shell PATH, so we probe common
/// Android SDK install locations before falling back to `which adb`.
fn find_adb() -> Result<PathBuf> {
    // Common Android SDK locations on macOS / Linux
    let candidates = [
        // Android Studio default
        dirs::home_dir().map(|h| h.join("Library/Android/sdk/platform-tools/adb")),
        // Linux / CI default
        dirs::home_dir().map(|h| h.join("Android/Sdk/platform-tools/adb")),
        // ANDROID_HOME / ANDROID_SDK_ROOT env vars
        std::env::var("ANDROID_HOME").ok().map(|v| PathBuf::from(v).join("platform-tools/adb")),
        std::env::var("ANDROID_SDK_ROOT").ok().map(|v| PathBuf::from(v).join("platform-tools/adb")),
    ];

    for candidate in candidates.into_iter().flatten() {
        if candidate.exists() {
            return Ok(candidate);
        }
    }

    // Fall back to `which adb` (works when launched from terminal)
    let which_output = Command::new("which").arg("adb").output();
    if let Ok(out) = which_output {
        if out.status.success() {
            let path = str::from_utf8(&out.stdout).unwrap_or("").trim().to_string();
            if !path.is_empty() {
                return Ok(PathBuf::from(path));
            }
        }
    }

    Err(anyhow!(
        "adb not found. Install Android platform-tools or set ANDROID_HOME / ANDROID_SDK_ROOT."
    ))
}

/// Public wrapper around find_adb for use in other modules (e.g. lib.rs).
pub fn get_adb_path() -> Result<std::path::PathBuf> {
    find_adb()
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DeviceInfo {
    pub serial: String,
    pub name: String,
    pub manufacturer: String,
    pub model: String,
    pub os_version: String,
    pub api_level: String,
    pub resolution: String,
    pub connection_type: String, // "usb", "wifi", "emulator"
    pub status: String,          // "device", "unauthorized", "offline", etc.
}

/// Runs a command and returns stdout if successful
fn run_adb_cmd(args: &[&str]) -> Result<String> {
    let adb = find_adb()?;
    let output = Command::new(&adb)
        .args(args)
        .output()?;
    
    if output.status.success() {
        Ok(str::from_utf8(&output.stdout)?.trim().to_string())
    } else {
        let err = str::from_utf8(&output.stderr)?.trim().to_string();
        Err(anyhow!("ADB command failed: {}", err))
    }
}

/// Check if ADB is installed and accessible
pub fn is_adb_available() -> bool {
    find_adb()
        .ok()
        .and_then(|adb| Command::new(&adb).arg("--version").output().ok())
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Discovers connected devices and extracts detailed metadata
pub fn get_devices() -> Result<Vec<DeviceInfo>> {
    let raw_devices = run_adb_cmd(&["devices"])?;
    let mut devices = Vec::new();
    
    // adb devices output looks like:
    // List of devices attached
    // emulator-5554	device
    // 192.168.1.100:5555	device
    for line in raw_devices.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with("List of devices") {
            continue;
        }
        
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 2 {
            continue;
        }
        
        let serial = parts[0].to_string();
        let status = parts[1].to_string();
        
        let connection_type = if serial.starts_with("emulator-") {
            "emulator".to_string()
        } else if serial.contains(':') || serial.contains('.') {
            "wifi".to_string()
        } else {
            "usb".to_string()
        };
        
        // Fetch metadata (non-blocking errors)
        let (manufacturer, model, os_version, api_level, resolution) = if status == "device" {
            let manufacturer = run_adb_cmd(&["-s", &serial, "shell", "getprop", "ro.product.manufacturer"])
                .unwrap_or_else(|_| "Unknown".to_string());
            let model = run_adb_cmd(&["-s", &serial, "shell", "getprop", "ro.product.model"])
                .unwrap_or_else(|_| "Unknown".to_string());
            let os_version = run_adb_cmd(&["-s", &serial, "shell", "getprop", "ro.build.version.release"])
                .unwrap_or_else(|_| "Unknown".to_string());
            let api_level = run_adb_cmd(&["-s", &serial, "shell", "getprop", "ro.build.version.sdk"])
                .unwrap_or_else(|_| "Unknown".to_string());
            
            let raw_res = run_adb_cmd(&["-s", &serial, "shell", "wm", "size"])
                .unwrap_or_else(|_| "Physical size: 1920x1080".to_string());
            let resolution = parse_resolution(&raw_res);
            
            (manufacturer, model, os_version, api_level, resolution)
        } else {
            ("Unknown".to_string(), "Unknown".to_string(), "Unknown".to_string(), "Unknown".to_string(), "Unknown".to_string())
        };
        
        let name = format!("{} {}", manufacturer, model);
        let name = if name.trim().is_empty() || name == "Unknown Unknown" {
            serial.clone()
        } else {
            name.trim().to_string()
        };
        
        devices.push(DeviceInfo {
            serial,
            name,
            manufacturer,
            model,
            os_version,
            api_level,
            resolution,
            connection_type,
            status,
        });
    }
    
    Ok(devices)
}

fn parse_resolution(raw: &str) -> String {
    // Expected output format: "Physical size: 1920x1080" or "Physical size: 1920x1080\nOverride size: 1280x720"
    raw.lines()
        .last()
        .and_then(|line| line.split(':').last())
        .map(|res| res.trim().to_string())
        .unwrap_or_else(|| "1920x1080".to_string())
}

/// Connects to a WiFi device via ADB
pub fn connect_wifi(ip: &str, port: u16) -> Result<String> {
    let target = format!("{}:{}", ip, port);
    run_adb_cmd(&["connect", &target])
}

/// Disconnects a device via ADB
pub fn disconnect_wifi(target: &str) -> Result<String> {
    run_adb_cmd(&["disconnect", target])
}

/// Inject key event into the selected device
pub fn send_keyevent(serial: &str, keycode: u32) -> Result<()> {
    let key_str = keycode.to_string();
    let _ = run_adb_cmd(&["-s", serial, "shell", "input", "keyevent", &key_str])?;
    Ok(())
}

/// Inject text into the selected device
pub fn send_text(serial: &str, text: &str) -> Result<()> {
    if text.is_empty() {
        return Ok(());
    }
    let _ = run_adb_cmd(&["-s", serial, "shell", "input", "text", text])?;
    Ok(())
}

/// Inject tap coordinates
pub fn send_click(serial: &str, x: u32, y: u32) -> Result<()> {
    let x_str = x.to_string();
    let y_str = y.to_string();
    let _ = run_adb_cmd(&["-s", serial, "shell", "input", "tap", &x_str, &y_str])?;
    Ok(())
}

/// Inject swipe coordinates
pub fn send_swipe(serial: &str, x1: u32, y1: u32, x2: u32, y2: u32, duration_ms: u32) -> Result<()> {
    let x1_str = x1.to_string();
    let y1_str = y1.to_string();
    let x2_str = x2.to_string();
    let y2_str = y2.to_string();
    let dur_str = duration_ms.to_string();
    let _ = run_adb_cmd(&["-s", serial, "shell", "input", "swipe", &x1_str, &y1_str, &x2_str, &y2_str, &dur_str])?;
    Ok(())
}

/// Captures a screenshot from the device and returns it as a Base64-encoded PNG string
pub fn capture_screenshot(serial: &str) -> Result<String> {
    // adb exec-out bypasses newline translation (ideal for binary files)
    let adb = find_adb()?;
    let output = Command::new(&adb)
        .args(&["-s", serial, "exec-out", "screencap", "-p"])
        .output()?;
        
    if output.status.success() && !output.stdout.is_empty() {
        use base64::prelude::*;
        Ok(BASE64_STANDARD.encode(&output.stdout))
    } else {
        let err = str::from_utf8(&output.stderr).unwrap_or("Failed to execute screencap").trim().to_string();
        Err(anyhow!("Screenshot capture failed: {}", err))
    }
}

/// Captures a screenshot from the device and returns it as raw PNG bytes
pub fn capture_screenshot_raw(serial: &str) -> Result<Vec<u8>> {
    let adb = find_adb()?;
    let output = Command::new(&adb)
        .args(&["-s", serial, "exec-out", "screencap", "-p"])
        .output()?;
        
    if output.status.success() && !output.stdout.is_empty() {
        Ok(output.stdout)
    } else {
        let err = str::from_utf8(&output.stderr).unwrap_or("Failed to execute screencap").trim().to_string();
        Err(anyhow!("Screenshot capture failed: {}", err))
    }
}
