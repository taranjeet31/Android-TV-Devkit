use crate::adb;

/// Translates abstract UI input actions to raw Android KeyCodes
pub fn action_to_keycode(action: &str) -> Option<u32> {
    match action {
        "DPAD_UP" => Some(19),
        "DPAD_DOWN" => Some(20),
        "DPAD_LEFT" => Some(21),
        "DPAD_RIGHT" => Some(22),
        "CENTER" => Some(23), // KEYCODE_DPAD_CENTER
        "BACK" => Some(4),
        "HOME" => Some(3),
        "MENU" => Some(82),
        "PLAY_PAUSE" => Some(85),
        "VOLUME_UP" => Some(24),
        "VOLUME_DOWN" => Some(25),
        "MUTE" => Some(164), // KEYCODE_VOLUME_MUTE
        "POWER" => Some(26),
        _ => None,
    }
}

#[tauri::command]
pub fn inject_action(serial: String, action: String) -> Result<(), String> {
    if let Some(keycode) = action_to_keycode(&action) {
        adb::send_keyevent(&serial, keycode).map_err(|e| e.to_string())
    } else {
        Err(format!("Unknown abstract action: {}", action))
    }
}
