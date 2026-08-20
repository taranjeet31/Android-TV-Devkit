use serde::{Deserialize, Serialize};

/// A single cursor control message sent from the Mac host to TV receiver clients.
/// Serialized as `{"type": "...", ...fields}` over WebSocket (or carried as an ADB-equivalent
/// command for the Android path).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum CursorMessage {
    /// Sent once when mouse capture starts.
    CursorStart {
        /// TV screen width in logical pixels (from selected device resolution).
        screen_w: u32,
        /// TV screen height in logical pixels.
        screen_h: u32,
        /// Auth session token (must match what was negotiated in the WS handshake).
        session_token: String,
    },

    /// Relative movement delta accumulated over one tick (~16ms / 60Hz).
    /// The receiver adds dx/dy to its virtual cursor position and clamps to screen bounds.
    CursorMove {
        dx: i32,
        dy: i32,
    },

    /// Mouse button pressed down.
    CursorDown {
        button: MouseButton,
    },

    /// Mouse button released.
    CursorUp {
        button: MouseButton,
    },

    /// Scroll wheel event.
    CursorScroll {
        dx: i32,
        dy: i32,
    },

    /// Sent when the user releases capture (hotkey or safety trigger).
    /// TV receiver should hide its cursor overlay.
    CursorEnd,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MouseButton {
    Left,
    Right,
    Middle,
}

impl CursorMessage {
    /// Serialize to JSON string for WebSocket transmission.
    pub fn to_json(&self) -> anyhow::Result<String> {
        Ok(serde_json::to_string(self)?)
    }
}
