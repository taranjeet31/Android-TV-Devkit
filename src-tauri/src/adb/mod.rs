use serde::{Serialize, Deserialize};
use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Child, ChildStdin, Stdio};
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

/// Setup ADB reverse port forwarding (e.g., adb reverse tcp:8090 tcp:8090)
pub fn reverse_port(serial: &str, device_port: u16, host_port: u16) -> Result<String> {
    let dev_str = format!("tcp:{}", device_port);
    let host_str = format!("tcp:{}", host_port);
    run_adb_cmd(&["-s", serial, "reverse", &dev_str, &host_str])
}


/// Captures a screenshot from the device and returns it as a Base64 data URI string ("data:image/png;base64,...")
pub fn capture_screenshot(serial: &str) -> Result<String> {
    let adb = find_adb()?;
    use base64::prelude::*;

    // Try exec-out first
    if let Ok(output) = Command::new(&adb)
        .args(&["-s", serial, "exec-out", "screencap", "-p"])
        .output() 
    {
        if output.status.success() && !output.stdout.is_empty() {
            let encoded = BASE64_STANDARD.encode(&output.stdout);
            return Ok(format!("data:image/png;base64,{}", encoded));
        }
    }

    // Fallback to shell screencap
    let output = Command::new(&adb)
        .args(&["-s", serial, "shell", "screencap", "-p"])
        .output()?;

    if output.status.success() && !output.stdout.is_empty() {
        let encoded = BASE64_STANDARD.encode(&output.stdout);
        Ok(format!("data:image/png;base64,{}", encoded))
    } else {
        let err = str::from_utf8(&output.stderr).unwrap_or("Failed to execute screencap").trim().to_string();
        Err(anyhow!("Screenshot capture failed: {}", err))
    }
}

/// Executes an arbitrary ADB command or shell command on the specified device
pub fn execute_adb_command(serial: &str, raw_cmd: &str) -> Result<String> {
    let adb = find_adb()?;
    let trimmed = raw_cmd.trim();
    if trimmed.is_empty() {
        return Ok(String::new());
    }

    let clean_cmd = if trimmed.starts_with("adb ") {
        &trimmed[4..]
    } else {
        trimmed
    };

    let mut args = vec!["-s", serial];
    let split_args: Vec<&str> = clean_cmd.split_whitespace().collect();

    let final_args = if split_args.len() >= 2 && split_args[0] == "-s" {
        &split_args[2..]
    } else {
        &split_args[..]
    };

    args.extend_from_slice(final_args);

    let output = Command::new(&adb)
        .args(&args)
        .output()?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if output.status.success() {
        if stdout.is_empty() && !stderr.is_empty() {
            Ok(stderr)
        } else if stdout.is_empty() {
            Ok("[Command executed successfully with no output]".to_string())
        } else {
            Ok(stdout)
        }
    } else {
        let err_msg = if !stderr.is_empty() { stderr } else { stdout };
        Err(anyhow!("Command failed: {}", err_msg.trim()))
    }
}


/// Captures a screenshot from the device and returns it as raw PNG bytes
pub fn capture_screenshot_raw(serial: &str) -> Result<Vec<u8>> {
    let adb = find_adb()?;
    
    // Try exec-out first (fastest, binary safe)
    if let Ok(output) = Command::new(&adb)
        .args(&["-s", serial, "exec-out", "screencap", "-p"])
        .output() 
    {
        if output.status.success() && !output.stdout.is_empty() {
            return Ok(output.stdout);
        }
    }

    // Fallback to shell screencap
    let output = Command::new(&adb)
        .args(&["-s", serial, "shell", "screencap", "-p"])
        .output()?;

    if output.status.success() && !output.stdout.is_empty() {
        Ok(output.stdout)
    } else {
        let err = str::from_utf8(&output.stderr).unwrap_or("Failed to execute screencap").trim().to_string();
        Err(anyhow!("Screenshot capture failed: {}", err))
    }
}

/// Resolves absolute path to scrcpy binary
pub fn find_scrcpy() -> Result<PathBuf> {
    let candidates = [
        PathBuf::from("/opt/homebrew/bin/scrcpy"),
        PathBuf::from("/usr/local/bin/scrcpy"),
        PathBuf::from("/usr/bin/scrcpy"),
    ];

    for candidate in candidates {
        if candidate.exists() {
            return Ok(candidate);
        }
    }

    let which_output = Command::new("which").arg("scrcpy").output();
    if let Ok(out) = which_output {
        if out.status.success() {
            let path = str::from_utf8(&out.stdout).unwrap_or("").trim().to_string();
            if !path.is_empty() {
                return Ok(PathBuf::from(path));
            }
        }
    }

    Err(anyhow!("scrcpy is not installed. Install via `brew install scrcpy`."))
}

/// Launches a native scrcpy streaming process optimized for Wi-Fi or USB connection
pub fn launch_scrcpy(
    serial: &str,
    connection_type: Option<&str>,
    max_fps: Option<u32>,
    bit_rate_mb: Option<u32>,
    max_size: Option<u32>,
) -> Result<String> {
    let scrcpy = find_scrcpy()?;
    let adb = find_adb()?;
    let is_wifi = connection_type == Some("wifi") || serial.contains(':') || serial.contains('.');

    let fps = max_fps.unwrap_or(if is_wifi { 30 } else { 60 });
    let bitrate = format!("{}M", bit_rate_mb.unwrap_or(if is_wifi { 2 } else { 8 }));
    let size = max_size.unwrap_or(if is_wifi { 960 } else { 1920 });
    let title = format!("Android TV Mirror - {}", serial);

    let mut args = vec![
        "-s".to_string(),
        serial.to_string(),
        "--window-title".to_string(),
        title,
        "--max-size".to_string(),
        size.to_string(),
        "--video-bit-rate".to_string(),
        bitrate,
        "--max-fps".to_string(),
        fps.to_string(),
        "--stay-awake".to_string(),
        "--no-audio".to_string(), // Disables audio capture to prevent Android TV permission denied errors
        "--video-codec=h264".to_string(), // Ensures compatibility with TV hardware H264 decoders
    ];

    if is_wifi {
        args.push("--tune-latency".to_string());
    }

    // Set PATH and ADB environment variables so scrcpy can invoke adb without permission/location errors
    let path_env = std::env::var("PATH").unwrap_or_default();
    let default_dir = PathBuf::from("/usr/local/bin");
    let adb_dir = adb.parent().unwrap_or(&default_dir).to_string_lossy();
    let new_path = format!("{}:/opt/homebrew/bin:/usr/local/bin:{}", adb_dir, path_env);

    let child = Command::new(&scrcpy)
        .args(&args)
        .env("ADB", &adb)
        .env("PATH", new_path)
        .spawn();

    match child {
        Ok(_) => Ok(format!(
            "Launched scrcpy for {} ({} Mode: {}px @ {}fps, {}bitrate)",
            serial,
            if is_wifi { "Wi-Fi" } else { "USB/Direct" },
            size,
            fps,
            args.iter().find(|a| a.ends_with('M')).unwrap_or(&"2M".to_string())
        )),
        Err(e) => Err(anyhow!("Failed to spawn scrcpy: {}", e)),
    }
}

/// Enables or disables system visual touches / cursor pointer feedback on Android TV
pub fn enable_on_screen_touches(serial: &str, enable: bool) -> Result<()> {
    let val = if enable { "1" } else { "0" };
    let _ = run_adb_cmd(&["-s", serial, "shell", "settings", "put", "system", "show_touches", val])?;
    Ok(())
}

/// A persistent interactive ADB shell session for ultra-fast, low-latency mouse pointer streaming.
pub struct AdbShellSession {
    child: Child,
    stdin: ChildStdin,
}

impl AdbShellSession {
    /// Spawn a persistent `adb shell` process with piped stdin
    pub fn spawn(serial: &str) -> Result<Self> {
        let adb = find_adb()?;
        let mut child = Command::new(&adb)
            .args(&["-s", serial, "shell"])
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| anyhow!("Failed to open stdin for ADB shell session"))?;

        Ok(Self { child, stdin })
    }

    /// Send a raw shell command string into the running shell process
    pub fn send_command(&mut self, cmd: &str) -> Result<()> {
        writeln!(self.stdin, "{}", cmd)?;
        self.stdin.flush()?;
        Ok(())
    }

    /// Dispatch real-time mouse movement event to Android TV OS
    pub fn move_mouse(&mut self, x: i32, y: i32) -> Result<()> {
        self.send_command(&format!("input mouse motionevent MOVE {} {}", x, y))
    }

    /// Dispatch tap click event to Android TV OS
    pub fn tap_mouse(&mut self, x: i32, y: i32) -> Result<()> {
        self.send_command(&format!("input mouse tap {} {}", x, y))
    }

    /// Dispatch swipe event to Android TV OS
    pub fn swipe_mouse(&mut self, x1: i32, y1: i32, x2: i32, y2: i32, duration_ms: u32) -> Result<()> {
        self.send_command(&format!("input mouse swipe {} {} {} {} {}", x1, y1, x2, y2, duration_ms))
    }
}

impl Drop for AdbShellSession {
    fn drop(&mut self) {
        let _ = writeln!(self.stdin, "exit");
        let _ = self.stdin.flush();
        let _ = self.child.kill();
    }
}

/// Auto-installs and launches the companion TV cursor overlay service on Android TV
pub fn install_cursor_overlay(serial: &str, apk_path: &str) -> Result<()> {
    let pkg_name = "com.tvdevstudio.overlay";
    let _ = run_adb_cmd(&["-s", serial, "install", "-r", apk_path])?;
    let _ = run_adb_cmd(&["-s", serial, "shell", "appops", "set", pkg_name, "SYSTEM_ALERT_WINDOW", "allow"])?;
    let _ = run_adb_cmd(&["-s", serial, "shell", "am", "start-foreground-service", "-n", &format!("{}/.OverlayService", pkg_name)]);
    Ok(())
}

// ─── App Launcher & Manager ───────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AppInfo {
    pub package_name: String,
    pub label: String,
    pub is_system: bool,
    pub installed_path: String,
}

/// Helper function to extract a clean display label from a package name
fn format_package_label(package_name: &str) -> String {
    let known_apps = [
        ("com.netflix.ninja", "Netflix"),
        ("com.google.android.youtube.tv", "YouTube TV"),
        ("com.google.android.youtube.tvunplugged", "YouTube TV (Live)"),
        ("com.google.android.katniss", "Google Assistant"),
        ("com.amazon.amazonvideo.livingroom", "Prime Video"),
        ("com.spotify.tv.web", "Spotify TV"),
        ("com.disney.disneyplus", "Disney+"),
        ("com.hbo.hbonow", "Max"),
        ("com.apple.atve.androidtv.appletv", "Apple TV"),
        ("com.plexapp.android", "Plex"),
        ("org.xbmc.kodi", "Kodi"),
        ("com.vlcforandroid", "VLC"),
        ("com.google.android.tv.homescreen", "Android TV Home"),
        ("com.google.android.apps.tv.launcherx", "Google TV Home"),
        ("com.android.vending", "Google Play Store"),
        ("com.android.settings", "Settings"),
        ("com.google.android.inputmethod.latin", "Gboard"),
    ];

    for (pkg, name) in known_apps {
        if package_name == pkg {
            return name.to_string();
        }
    }

    let last_part = package_name.split('.').last().unwrap_or(package_name);
    let words: Vec<String> = last_part
        .split(|c| c == '_' || c == '-')
        .map(|w| {
            let mut chars = w.chars();
            match chars.next() {
                None => String::new(),
                Some(f) => f.to_uppercase().collect::<String>() + chars.as_str(),
            }
        })
        .collect();

    let formatted = words.join(" ");
    if formatted.trim().is_empty() {
        package_name.to_string()
    } else {
        formatted
    }
}

/// Lists installed applications on the target ADB device
pub fn list_applications(serial: &str, include_system: bool) -> Result<Vec<AppInfo>> {
    let args = if include_system {
        vec!["-s", serial, "shell", "pm", "list", "packages", "-f"]
    } else {
        vec!["-s", serial, "shell", "pm", "list", "packages", "-f", "-3"]
    };

    let raw_output = run_adb_cmd(&args)?;
    let mut apps = Vec::new();

    for line in raw_output.lines() {
        let line = line.trim();
        if line.is_empty() || !line.starts_with("package:") {
            continue;
        }

        let content = &line["package:".len()..];
        if let Some((path, pkg)) = content.rsplit_once('=') {
            let package_name = pkg.trim().to_string();
            let installed_path = path.trim().to_string();
            let is_system = installed_path.starts_with("/system")
                || installed_path.starts_with("/vendor")
                || installed_path.starts_with("/product")
                || installed_path.starts_with("/apex");

            let label = format_package_label(&package_name);

            apps.push(AppInfo {
                package_name,
                label,
                is_system,
                installed_path,
            });
        }
    }

    apps.sort_by(|a, b| a.label.to_lowercase().cmp(&b.label.to_lowercase()));
    Ok(apps)
}

/// Launches an application on the device using monkey / leanback launcher intent
pub fn launch_app(serial: &str, package_name: &str) -> Result<String> {
    let leanback_res = run_adb_cmd(&[
        "-s", serial, "shell", "monkey", "-p", package_name,
        "-c", "android.intent.category.LEANBACK_LAUNCHER", "1"
    ]);

    if let Ok(ref out) = leanback_res {
        if out.contains("Events injected: 1") {
            return Ok(format!("Launched {} via Leanback Launcher", package_name));
        }
    }

    let standard_res = run_adb_cmd(&[
        "-s", serial, "shell", "monkey", "-p", package_name,
        "-c", "android.intent.category.LAUNCHER", "1"
    ]);

    if let Ok(ref out) = standard_res {
        if out.contains("Events injected: 1") {
            return Ok(format!("Launched {} via Standard Launcher", package_name));
        }
    }

    let monkey_fallback = run_adb_cmd(&[
        "-s", serial, "shell", "monkey", "-p", package_name, "1"
    ]);

    match monkey_fallback {
        Ok(out) => Ok(format!("Launched {}: {}", package_name, out)),
        Err(e) => Err(anyhow!("Failed to launch app {}: {}", package_name, e)),
    }
}

/// Force stops an application
pub fn force_stop_app(serial: &str, package_name: &str) -> Result<String> {
    run_adb_cmd(&["-s", serial, "shell", "am", "force-stop", package_name])?;
    Ok(format!("Force stopped {}", package_name))
}

/// Clears user data for an application
pub fn clear_app_data(serial: &str, package_name: &str) -> Result<String> {
    let out = run_adb_cmd(&["-s", serial, "shell", "pm", "clear", package_name])?;
    Ok(format!("Cleared app data for {}: {}", package_name, out))
}

/// Uninstalls an application
pub fn uninstall_app(serial: &str, package_name: &str) -> Result<String> {
    let out = run_adb_cmd(&["-s", serial, "shell", "pm", "uninstall", package_name])?;
    Ok(format!("Uninstalled {}: {}", package_name, out))
}

/// Installs an application file (.apk, .apks, .xapk, .aab) onto the device via ADB
pub fn install_app_file(serial: &str, file_path: &str) -> Result<String> {
    let path = PathBuf::from(file_path);
    if !path.exists() {
        return Err(anyhow!("File does not exist: {}", file_path));
    }

    let file_name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| file_path.to_string());

    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();

    match ext.as_str() {
        "apk" => {
            let out = run_adb_cmd(&["-s", serial, "install", "-r", "-g", file_path])?;
            if out.contains("Failure") {
                Err(anyhow!("ADB install failed: {}", out))
            } else {
                Ok(format!("Successfully installed {}", file_name))
            }
        }
        "xapk" | "apks" | "zip" => {
            let timestamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis();
            let temp_dir = std::env::temp_dir().join(format!("tv_app_bundle_{}", timestamp));
            std::fs::create_dir_all(&temp_dir)?;

            let unzip_res = Command::new("unzip")
                .args(&["-o", "-q", file_path, "-d", &temp_dir.to_string_lossy()])
                .output();

            if unzip_res.is_err() || !unzip_res.as_ref().unwrap().status.success() {
                let _ = std::fs::remove_dir_all(&temp_dir);
                return Err(anyhow!("Failed to unzip split APK bundle {}", file_name));
            }

            let mut apk_paths = Vec::new();
            if let Ok(entries) = std::fs::read_dir(&temp_dir) {
                for entry in entries.flatten() {
                    let entry_path = entry.path();
                    if entry_path.is_file() && entry_path.extension().map_or(false, |e| e.to_ascii_lowercase() == "apk") {
                        apk_paths.push(entry_path.to_string_lossy().to_string());
                    }
                }
            }

            if apk_paths.is_empty() {
                let _ = std::fs::remove_dir_all(&temp_dir);
                return Err(anyhow!("No valid .apk files found inside split bundle {}", file_name));
            }

            let mut args = vec!["-s", serial, "install-multiple", "-r", "-g"];
            for apk in &apk_paths {
                args.push(apk.as_str());
            }

            let res = run_adb_cmd(&args);
            let _ = std::fs::remove_dir_all(&temp_dir);

            match res {
                Ok(out) if !out.contains("Failure") => Ok(format!("Successfully installed split app bundle {}", file_name)),
                Ok(out) => Err(anyhow!("Split APK install failed: {}", out)),
                Err(e) => Err(anyhow!("Failed to install split APK bundle: {}", e)),
            }
        }
        "aab" => {
            let bundletool_check = Command::new("which").arg("bundletool").output();
            let has_bundletool = match bundletool_check {
                Ok(out) => out.status.success() && !out.stdout.is_empty(),
                Err(_) => false,
            };

            if !has_bundletool {
                return Err(anyhow!(
                    "AAB (Android App Bundle) installation requires bundletool. Please convert the AAB to APK, or install bundletool (`brew install bundletool`)."
                ));
            }

            let adb_path = find_adb()?;
            let timestamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis();
            let temp_apks = std::env::temp_dir().join(format!("bundle_{}.apks", timestamp));

            let build_out = Command::new("bundletool")
                .args(&[
                    "build-apks",
                    &format!("--bundle={}", file_path),
                    &format!("--output={}", temp_apks.to_string_lossy()),
                    &format!("--adb={}", adb_path.to_string_lossy()),
                    "--mode=default",
                    "--overwrite",
                ])
                .output()?;

            if !build_out.status.success() {
                let err = String::from_utf8_lossy(&build_out.stderr);
                return Err(anyhow!("bundletool build-apks failed: {}", err.trim()));
            }

            let install_out = Command::new("bundletool")
                .args(&[
                    "install-apks",
                    &format!("--apks={}", temp_apks.to_string_lossy()),
                    &format!("--device-id={}", serial),
                    &format!("--adb={}", adb_path.to_string_lossy()),
                ])
                .output()?;

            let _ = std::fs::remove_file(&temp_apks);

            if install_out.status.success() {
                Ok(format!("Successfully installed Android App Bundle {}", file_name))
            } else {
                let err = String::from_utf8_lossy(&install_out.stderr);
                Err(anyhow!("bundletool install-apks failed: {}", err.trim()))
            }
        }
        _ => {
            let out = run_adb_cmd(&["-s", serial, "install", "-r", "-g", file_path])?;
            if out.contains("Failure") {
                Err(anyhow!("ADB install failed: {}", out))
            } else {
                Ok(format!("Successfully installed {}", file_name))
            }
        }
    }
}





