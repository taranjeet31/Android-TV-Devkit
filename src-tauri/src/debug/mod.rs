use serde::{Serialize, Deserialize};
use std::process::{Command, Stdio, Child};
use std::io::{BufReader, BufRead};
use std::sync::Mutex;
use std::thread;
use tauri::{AppHandle, Emitter, State};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct LogLine {
    pub timestamp: String,
    pub level: String, // "V", "D", "I", "W", "E", "F"
    pub tag: String,
    pub pid: String,
    pub message: String,
    pub raw: String,
}

pub struct LogcatState {
    pub child: Mutex<Option<Child>>,
}

impl Default for LogcatState {
    fn default() -> Self {
        Self {
            child: Mutex::new(None),
        }
    }
}

/// Parses a line from `adb logcat -v time`
/// Example line:
/// 08-20 18:40:01.123 I/ActivityManager( 1200): Start proc ...
fn parse_logcat_line(raw: &str) -> LogLine {
    let raw_trimmed = raw.trim();
    if raw_trimmed.len() < 19 {
        return LogLine {
            timestamp: "".to_string(),
            level: "I".to_string(),
            tag: "".to_string(),
            pid: "".to_string(),
            message: raw.to_string(),
            raw: raw.to_string(),
        };
    }

    // Try parsing: timestamp is first 18 characters (e.g. "08-20 18:40:01.123")
    let timestamp = raw_trimmed[0..18].trim().to_string();
    let rest = &raw_trimmed[18..].trim();

    // Now look for level: e.g. "I/ActivityManager( 1200): Start proc..."
    // Let's find "/"
    if let Some(slash_idx) = rest.find('/') {
        let level = rest[0..slash_idx].trim().to_string();
        let after_level = &rest[slash_idx + 1..];

        // Look for "):" which terminates the PID section
        if let Some(pid_end_idx) = after_level.find("):") {
            let tag_pid_str = &after_level[0..pid_end_idx];
            let message = after_level[pid_end_idx + 2..].trim().to_string();

            // Split tag and pid. tag_pid_str is e.g. "ActivityManager( 1200"
            let (tag, pid) = if let Some(paren_idx) = tag_pid_str.find('(') {
                let tag = tag_pid_str[0..paren_idx].trim().to_string();
                let pid = tag_pid_str[paren_idx + 1..].trim().to_string();
                (tag, pid)
            } else {
                (tag_pid_str.trim().to_string(), "".to_string())
            };

            return LogLine {
                timestamp,
                level,
                tag,
                pid,
                message,
                raw: raw.to_string(),
            };
        }
    }

    LogLine {
        timestamp: "".to_string(),
        level: "I".to_string(),
        tag: "".to_string(),
        pid: "".to_string(),
        message: raw.to_string(),
        raw: raw.to_string(),
    }
}

#[tauri::command]
pub fn start_logcat(app: AppHandle, state: State<'_, LogcatState>, serial: String) -> Result<(), String> {
    // Kill existing process
    {
        let mut lock = state.child.lock().unwrap();
        if let Some(mut old_child) = lock.take() {
            let _ = old_child.kill();
        }
    }

    // Clear logcat buffer first for clean start
    let _ = Command::new("adb")
        .args(&["-s", &serial, "logcat", "-c"])
        .status();

    // Spawn child
    let mut child = Command::new("adb")
        .args(&["-s", &serial, "logcat", "-v", "time"])
        .stdout(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn logcat: {}", e))?;

    let stdout = child.stdout.take().ok_or("Failed to get stdout pipe")?;
    
    // Store child so we can kill it later
    {
        let mut lock = state.child.lock().unwrap();
        *lock = Some(child);
    }

    // Spawn reader thread
    thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            if let Ok(l) = line {
                let parsed = parse_logcat_line(&l);
                let _ = app.emit("logcat-line", parsed);
            } else {
                break;
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub fn stop_logcat(state: State<'_, LogcatState>) -> Result<(), String> {
    let mut lock = state.child.lock().unwrap();
    if let Some(mut child) = lock.take() {
        let _ = child.kill();
    }
    Ok(())
}
