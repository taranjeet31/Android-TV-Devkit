mod adb;
mod debug;
mod input;
mod mouse_capture;
mod network;

use adb::{DeviceInfo, AppInfo};
use std::process::Command;
use std::sync::Arc;

use mouse_capture::state::{
    CaptureConfig, CaptureManagerState, CaptureState, CaptureEvent, push_event,
};
use mouse_capture::ws_server;
use mouse_capture::permissions;

// ─── Existing ADB commands ────────────────────────────────────────────────────

#[tauri::command]
fn check_adb() -> bool {
    adb::is_adb_available()
}

#[tauri::command]
fn scan_devices() -> Result<Vec<DeviceInfo>, String> {
    adb::get_devices().map_err(|e| e.to_string())
}

#[tauri::command]
fn connect_device(ip: String, port: u16) -> Result<String, String> {
    adb::connect_wifi(&ip, port).map_err(|e| e.to_string())
}

#[tauri::command]
fn disconnect_device(serial: String) -> Result<String, String> {
    adb::disconnect_wifi(&serial).map_err(|e| e.to_string())
}

#[tauri::command]
fn reverse_port(serial: String, device_port: u16, host_port: u16) -> Result<String, String> {
    adb::reverse_port(&serial, device_port, host_port).map_err(|e| e.to_string())
}


#[tauri::command]
fn inject_key(serial: String, keycode: u32) -> Result<(), String> {
    adb::send_keyevent(&serial, keycode).map_err(|e| e.to_string())
}

#[tauri::command]
fn inject_text(serial: String, text: String) -> Result<(), String> {
    let mut escaped = String::new();
    for c in text.chars() {
        if c == ' ' {
            escaped.push_str("%s");
        } else if c == '"' || c == '\'' || c == '\\' || c == '`' || c == '$' || c == '&' || c == '|' || c == ';' || c == '<' || c == '>' || c == '(' || c == ')' || c == '#' || c == '*' || c == '?' || c == '!' || c == '~' {
            escaped.push('\\');
            escaped.push(c);
        } else {
            escaped.push(c);
        }
    }
    adb::send_text(&serial, &escaped).map_err(|e| e.to_string())
}

#[tauri::command]
fn inject_click(serial: String, x: u32, y: u32) -> Result<(), String> {
    adb::send_click(&serial, x, y).map_err(|e| e.to_string())
}

#[tauri::command]
fn inject_swipe(serial: String, x1: u32, y1: u32, x2: u32, y2: u32, duration_ms: u32) -> Result<(), String> {
    adb::send_swipe(&serial, x1, y1, x2, y2, duration_ms).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_screenshot(serial: String) -> Result<String, String> {
    adb::capture_screenshot(&serial).map_err(|e| e.to_string())
}

#[tauri::command]
fn execute_adb_command(serial: String, command: String) -> Result<String, String> {
    adb::execute_adb_command(&serial, &command).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_screenshot_raw(serial: String) -> Result<Vec<u8>, String> {
    adb::capture_screenshot_raw(&serial).map_err(|e| e.to_string())
}

#[tauri::command]
fn launch_scrcpy(
    serial: String,
    connection_type: Option<String>,
    max_fps: Option<u32>,
    bit_rate_mb: Option<u32>,
    max_size: Option<u32>,
) -> Result<String, String> {
    adb::launch_scrcpy(
        &serial,
        connection_type.as_deref(),
        max_fps,
        bit_rate_mb,
        max_size,
    )
    .map_err(|e| e.to_string())
}


#[tauri::command]
fn toggle_show_touches(serial: String, enabled: bool) -> Result<(), String> {
    let val_str = if enabled { "1" } else { "0" };
    let adb = adb::get_adb_path().map_err(|e| e.to_string())?;
    let output = Command::new(&adb)
        .args(&["-s", &serial, "shell", "settings", "put", "system", "show_touches", val_str])
        .output()
        .map_err(|e| e.to_string())?;
    
    if output.status.success() {
        Ok(())
    } else {
        let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(format!("Failed to toggle show touches: {}", err))
    }
}

#[tauri::command]
fn toggle_pointer_location(serial: String, enabled: bool) -> Result<(), String> {
    let val_str = if enabled { "1" } else { "0" };
    let adb = adb::get_adb_path().map_err(|e| e.to_string())?;
    let output = Command::new(&adb)
        .args(&["-s", &serial, "shell", "settings", "put", "system", "pointer_location", val_str])
        .output()
        .map_err(|e| e.to_string())?;
    
    if output.status.success() {
        Ok(())
    } else {
        let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(format!("Failed to toggle pointer location: {}", err))
    }
}

// ─── App Launcher commands ────────────────────────────────────────────────────

#[tauri::command]
fn list_applications(serial: String, include_system: Option<bool>) -> Result<Vec<AppInfo>, String> {
    adb::list_applications(&serial, include_system.unwrap_or(false)).map_err(|e| e.to_string())
}

#[tauri::command]
fn launch_app(serial: String, package_name: String) -> Result<String, String> {
    adb::launch_app(&serial, &package_name).map_err(|e| e.to_string())
}

#[tauri::command]
fn force_stop_app(serial: String, package_name: String) -> Result<String, String> {
    adb::force_stop_app(&serial, &package_name).map_err(|e| e.to_string())
}

#[tauri::command]
fn clear_app_data(serial: String, package_name: String) -> Result<String, String> {
    adb::clear_app_data(&serial, &package_name).map_err(|e| e.to_string())
}

#[tauri::command]
fn uninstall_app(serial: String, package_name: String) -> Result<String, String> {
    adb::uninstall_app(&serial, &package_name).map_err(|e| e.to_string())
}

#[tauri::command]
fn install_app_file(serial: String, file_path: String) -> Result<String, String> {
    adb::install_app_file(&serial, &file_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn pick_apk_file() -> Result<Option<String>, String> {
    let file = rfd::FileDialog::new()
        .add_filter("Android App Packages (.apk, .apks, .xapk, .aab)", &["apk", "apks", "xapk", "aab"])
        .pick_file();

    Ok(file.map(|p| p.to_string_lossy().to_string()))
}

// ─── Mouse Capture commands ───────────────────────────────────────────────────

/// Check if this process has Accessibility permission (required for CGEventTap).
#[tauri::command]
fn check_accessibility_permission() -> bool {
    permissions::is_process_trusted()
}

/// Open the Accessibility pane in System Settings.
#[tauri::command]
fn open_accessibility_settings() {
    permissions::open_accessibility_settings();
}

/// Open the Input Monitoring pane in System Settings.
#[tauri::command]
fn open_input_monitoring_settings() {
    permissions::open_input_monitoring_settings();
}

/// Start the WebSocket cursor server and the capture manager.
/// Must be called before toggling capture — idempotent (safe to call multiple times).
#[tauri::command]
async fn start_mouse_capture_session(
    app: tauri::AppHandle,
    managed: tauri::State<'_, Arc<CaptureManagerState>>,
    config: CaptureConfig,
) -> Result<u16, String> {
    // Start WebSocket server
    let ws_port = config.ws_port;
    let token = config.session_token.clone();

    let ws_handle = ws_server::start_ws_server(ws_port, token)
        .await
        .map_err(|e| e.to_string())?;

    {
        let mut lock = managed.ws_handle.lock().unwrap();
        *lock = Some(ws_handle);
    }

    // Start state machine
    mouse_capture::state::start_capture_manager(
        app,
        managed.inner().clone(),
        config,
    );

    Ok(ws_port)
}

/// Toggle capture on/off (same effect as pressing ⌘⇧L).
#[tauri::command]
fn toggle_mouse_capture(managed: tauri::State<'_, Arc<CaptureManagerState>>) -> Result<CaptureState, String> {
    push_event(&managed, CaptureEvent::HotkeyToggle);
    let state = *managed.state.lock().unwrap();
    Ok(state)
}

/// Get the current capture state.
#[tauri::command]
fn get_capture_state(managed: tauri::State<'_, Arc<CaptureManagerState>>) -> CaptureState {
    *managed.state.lock().unwrap()
}

/// Get the current virtual cursor position on the TV screen.
#[tauri::command]
fn get_virtual_cursor_pos(managed: tauri::State<'_, Arc<CaptureManagerState>>) -> (i32, i32) {
    *managed.virtual_cursor.lock().unwrap()
}

/// Stop the capture session entirely (stops WS server, releases capture).
#[tauri::command]
async fn stop_mouse_capture_session(managed: tauri::State<'_, Arc<CaptureManagerState>>) -> Result<(), String> {
    push_event(&managed, CaptureEvent::Shutdown);
    // Stop WebSocket server
    let handle = {
        let mut lock = managed.ws_handle.lock().unwrap();
        lock.take()
    };
    if let Some(ws) = handle {
        ws.stop().await;
    }
    Ok(())
}

/// Get count of currently connected TV WebSocket clients.
#[tauri::command]
fn get_ws_client_count(managed: tauri::State<'_, Arc<CaptureManagerState>>) -> usize {
    let lock = managed.ws_handle.lock().unwrap();
    if let Some(ws) = lock.as_ref() {
        ws_server::client_count(ws)
    } else {
        0
    }
}

/// Auto-installs and grants permission for companion TV cursor overlay service on Android TV
#[tauri::command]
async fn install_cursor_overlay(
    app: tauri::AppHandle,
    device_id: String,
) -> Result<(), String> {
    use tauri::Manager;
    let apk_path = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join("resources/tv-cursor-overlay.apk");
    let apk_str = apk_path.to_str().ok_or("Invalid APK path")?;
    adb::install_cursor_overlay(&device_id, apk_str).map_err(|e| e.to_string())
}


// ─── App entry point ──────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let capture_state = Arc::new(CaptureManagerState::default());

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_shortcut("CmdOrCtrl+Shift+L")
                .unwrap()
                .with_handler({
                    let capture = capture_state.clone();
                    move |_app, _shortcut, _event| {
                        push_event(&capture, CaptureEvent::HotkeyToggle);
                    }
                })
                .build(),
        )
        .manage(debug::LogcatState::default())
        .manage(network::ProxyState::default())
        .manage(capture_state)
        .invoke_handler(tauri::generate_handler![
            // ADB / device
            check_adb,
            scan_devices,
            connect_device,
            disconnect_device,
            reverse_port,
            inject_key,
            inject_click,
            inject_swipe,
            get_screenshot,
            get_screenshot_raw,
            execute_adb_command,
            launch_scrcpy,
            // Debug
            debug::start_logcat,
            debug::stop_logcat,
            // Input
            input::inject_action,
            // Network proxy
            network::get_host_ip,
            network::enable_device_proxy,
            network::disable_device_proxy,
            network::start_proxy,
            network::stop_proxy,
            network::get_active_proxy_port,
            // Text + display
            inject_text,
            toggle_show_touches,
            toggle_pointer_location,
            // App launcher
            list_applications,
            launch_app,
            force_stop_app,
            clear_app_data,
            uninstall_app,
            install_app_file,
            pick_apk_file,
            // Mouse capture
            check_accessibility_permission,
            open_accessibility_settings,
            open_input_monitoring_settings,
            start_mouse_capture_session,
            toggle_mouse_capture,
            get_capture_state,
            get_virtual_cursor_pos,
            stop_mouse_capture_session,
            get_ws_client_count,
            install_cursor_overlay,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
