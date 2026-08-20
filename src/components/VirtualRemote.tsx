import React, { useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useDeviceStore } from "../store/useDeviceStore";
import {
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  CornerDownLeft,
  Home,
  Menu,
  Volume2,
  Volume1,
  VolumeX,
  Play,
  Pause,
  Power,
  Keyboard,
  Check,
  MousePointer
} from "lucide-react";

export interface VirtualRemoteProps {
  layoutMode?: "tab" | "workspace";
}

export const VirtualRemote: React.FC<VirtualRemoteProps> = ({ layoutMode = "tab" }) => {
  const {
    selectedDevice,
    keyboardEnabled,
    setKeyboardEnabled,
    keyboardMode,
    setKeyboardMode,
    activeKeymapProfile,
    keymapProfiles
  } = useDeviceStore();

  // Navigation tab switcher: "remote" | "touchpad"
  const [remoteSubTab, setRemoteSubTab] = useState<"remote" | "touchpad">("remote");
  
  const [lastAction, setLastAction] = useState<string | null>(null);
  const [textToSend, setTextToSend] = useState("");

  // Touchpad State Variables
  const [cursorCoords, setCursorCoords] = useState({ x: 960, y: 540 });
  const [isLocked, setIsLocked] = useState(false);
  const [sensitivity, setSensitivity] = useState(2);
  const [showTouches, setShowTouches] = useState(false);
  const [pointerLocation, setPointerLocation] = useState(false);
  const [isPressing, setIsPressing] = useState(false);

  // Instantly accessible refs for event listeners and scroll wheel throttling
  const coordsRef = useRef({ x: 960, y: 540 });
  const dragStartCoords = useRef<{ x: number; y: number } | null>(null);
  const lastScrollTime = useRef(0);

  const [resWidth, resHeight] = selectedDevice?.resolution
    ? selectedDevice.resolution.split("x").map((n) => parseInt(n) || 1920)
    : [1920, 1080];

  const updateCoords = (newX: number, newY: number) => {
    coordsRef.current = { x: newX, y: newY };
    setCursorCoords({ x: newX, y: newY });
  };

  const triggerAction = async (action: string) => {
    if (!selectedDevice) return;
    setLastAction(action);
    setTimeout(() => setLastAction((curr) => (curr === action ? null : curr)), 800);
    
    try {
      await invoke("inject_action", {
        serial: selectedDevice.serial,
        action: action,
      });
    } catch (e) {
      console.error("Failed to inject action", e);
    }
  };

  const triggerRawKey = async (keycode: number) => {
    if (!selectedDevice) return;
    try {
      await invoke("inject_key", {
        serial: selectedDevice.serial,
        keycode,
      });
    } catch (e) {
      console.error("Failed to inject raw key", e);
    }
  };

  const triggerText = async (text: string) => {
    if (!selectedDevice || !text) return;
    try {
      await invoke("inject_text", {
        serial: selectedDevice.serial,
        text,
      });
    } catch (e) {
      console.error("Failed to inject text", e);
    }
  };

  const handleSendTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!textToSend) return;
    triggerText(textToSend);
    setTextToSend("");
  };

  // Keyboard capture event listener
  useEffect(() => {
    if (!keyboardEnabled || !selectedDevice) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target as HTMLElement).isContentEditable
      ) {
        return;
      }

      if (keyboardMode === "keymap") {
        const profile = keymapProfiles[activeKeymapProfile];
        if (!profile) return;

        const code = e.code;
        const action = profile[code];

        if (action) {
          e.preventDefault();
          triggerAction(action);
        }
      } else {
        const key = e.key;
        if (key === "Backspace") {
          e.preventDefault();
          triggerRawKey(67);
        } else if (key === "Enter") {
          e.preventDefault();
          triggerRawKey(66);
        } else if (key === "Tab") {
          e.preventDefault();
          triggerRawKey(61);
        } else if (key === "ArrowUp") {
          e.preventDefault();
          triggerAction("DPAD_UP");
        } else if (key === "ArrowDown") {
          e.preventDefault();
          triggerAction("DPAD_DOWN");
        } else if (key === "ArrowLeft") {
          e.preventDefault();
          triggerAction("DPAD_LEFT");
        } else if (key === "ArrowRight") {
          e.preventDefault();
          triggerAction("DPAD_RIGHT");
        } else if (key === "Escape") {
          e.preventDefault();
          triggerAction("BACK");
        } else if (key.length === 1) {
          e.preventDefault();
          triggerText(key);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [keyboardEnabled, keyboardMode, selectedDevice, activeKeymapProfile, keymapProfiles]);

  // Pointer lock change listener
  useEffect(() => {
    const handleLockChange = () => {
      setIsLocked(document.pointerLockElement !== null);
    };
    document.addEventListener("pointerlockchange", handleLockChange);
    return () => {
      document.removeEventListener("pointerlockchange", handleLockChange);
    };
  }, []);

  // Pointer lock mouse capture handlers
  useEffect(() => {
    if (!isLocked || !selectedDevice) return;

    const handleMouseMove = (e: MouseEvent) => {
      const prev = coordsRef.current;
      const nextX = Math.max(0, Math.min(resWidth, Math.round(prev.x + e.movementX * sensitivity)));
      const nextY = Math.max(0, Math.min(resHeight, Math.round(prev.y + e.movementY * sensitivity)));
      updateCoords(nextX, nextY);
    };

    const handleMouseDown = () => {
      setIsPressing(true);
      dragStartCoords.current = { ...coordsRef.current };
    };

    const handleMouseUp = async () => {
      if (!dragStartCoords.current) return;
      setIsPressing(false);
      
      const start = dragStartCoords.current;
      const end = coordsRef.current;
      dragStartCoords.current = null;
      
      const diffX = end.x - start.x;
      const diffY = end.y - start.y;
      const distance = Math.sqrt(diffX * diffX + diffY * diffY);
      
      try {
        if (distance > 15) {
          // Swipe drag gesture
          await invoke("inject_swipe", {
            serial: selectedDevice.serial,
            x1: start.x,
            y1: start.y,
            x2: end.x,
            y2: end.y,
            durationMs: 250
          });
        } else {
          // Single tap click
          await invoke("inject_click", {
            serial: selectedDevice.serial,
            x: end.x,
            y: end.y
          });
        }
      } catch (err) {
        console.error("Touchpad click/swipe failed", err);
      }
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isLocked, sensitivity, resWidth, resHeight, selectedDevice]);

  // Touchpad scroll-to-swipe wheel handler
  const handleWheel = async (e: React.WheelEvent) => {
    if (!selectedDevice) return;
    const now = Date.now();
    if (now - lastScrollTime.current < 350) return;

    const threshold = 15;
    if (Math.abs(e.deltaY) < threshold && Math.abs(e.deltaX) < threshold) return;

    lastScrollTime.current = now;

    const startX = Math.round(resWidth / 2);
    const startY = Math.round(resHeight / 2);
    let endX = startX;
    let endY = startY;

    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      if (e.deltaY > 0) {
        endY = Math.max(0, startY - 250);
      } else {
        endY = Math.min(resHeight, startY + 250);
      }
    } else {
      if (e.deltaX > 0) {
        endX = Math.max(0, startX - 250);
      } else {
        endX = Math.min(resWidth, startX + 250);
      }
    }

    try {
      await invoke("inject_swipe", {
        serial: selectedDevice.serial,
        x1: startX,
        y1: startY,
        x2: endX,
        y2: endY,
        durationMs: 250
      });
    } catch (err) {
      console.error("Touchpad scroll swipe failed", err);
    }
  };

  // Developer settings togglers
  const handleToggleTouches = async (checked: boolean) => {
    if (!selectedDevice) return;
    setShowTouches(checked);
    try {
      await invoke("toggle_show_touches", {
        serial: selectedDevice.serial,
        enabled: checked
      });
    } catch (err) {
      console.error("Failed to toggle show touches", err);
    }
  };

  const handleTogglePointerLocation = async (checked: boolean) => {
    if (!selectedDevice) return;
    setPointerLocation(checked);
    try {
      await invoke("toggle_pointer_location", {
        serial: selectedDevice.serial,
        enabled: checked
      });
    } catch (err) {
      console.error("Failed to toggle pointer location", err);
    }
  };

  if (!selectedDevice) {
    return (
      <div className="flex-center" style={{ flexDirection: "column", height: "100%", color: "var(--color-text-muted)" }}>
        <Keyboard size={48} style={{ opacity: 0.3, marginBottom: "16px" }} />
        <h3>No Connected Device Selected</h3>
        <p style={{ fontSize: "12px", marginTop: "4px" }}>Select an online device in the Device Manager to use the Remote Control.</p>
      </div>
    );
  }

  const renderMainRemote = () => (
    <div className="card-panel" style={{ flexGrow: 1, height: "100%", justifyContent: "flex-start" }}>
      <div className="panel-header">
        <span className="panel-title">
          <Keyboard size={18} />
          Remote Input Center
        </span>
      </div>
      
      <div className="panel-body flex-center" style={{ flexDirection: "column", gap: "14px", overflowY: "auto", padding: "16px 20px" }}>
        {/* Navigation Tabs */}
        <div className="touchpad-tab-container">
          <button
            type="button"
            className={`touchpad-tab-btn ${remoteSubTab === "remote" ? "active" : ""}`}
            onClick={() => setRemoteSubTab("remote")}
          >
            D-Pad Remote
          </button>
          <button
            type="button"
            className={`touchpad-tab-btn ${remoteSubTab === "touchpad" ? "active" : ""}`}
            onClick={() => setRemoteSubTab("touchpad")}
          >
            Virtual Touchpad
          </button>
        </div>

        {remoteSubTab === "touchpad" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "14px", width: "100%", maxWidth: "380px" }}>
            {/* Touchpad Capture Area */}
            <div
              className={`touchpad-area ${isLocked ? "locked" : ""}`}
              onClick={(e) => {
                e.currentTarget.requestPointerLock();
              }}
              onWheel={handleWheel}
            >
              {/* Overlay Text info */}
              <div className="touchpad-area-overlay">
                <MousePointer size={22} style={{ marginBottom: "6px", opacity: 0.6 }} />
                {isLocked ? (
                  <>
                    <span style={{ fontWeight: 700, color: "var(--color-accent-primary)" }}>TOUCHPAD LOCKED & ACTIVE</span>
                    <span style={{ fontSize: "10px", marginTop: "4px", lineHeight: "1.4" }}>
                      Move mouse/finger on Mac trackpad to control cursor. Drag to swipe. Scroll trackpad to scroll content.
                    </span>
                    <span style={{ fontSize: "9px", color: "var(--color-text-muted)", marginTop: "6px" }}>
                      Press ESC to release cursor
                    </span>
                  </>
                ) : (
                  <>
                    <span style={{ fontWeight: 700 }}>CLICK TO LOCK CURSOR</span>
                    <span style={{ fontSize: "10px", marginTop: "4px", lineHeight: "1.4" }}>
                      Captures Mac relative cursor movements to control TV pointer
                    </span>
                  </>
                )}
              </div>

              {/* Cursor dot indicator */}
              <div
                className={`touchpad-cursor-dot ${isPressing ? "pressing" : ""}`}
                style={{
                  left: `${(cursorCoords.x / resWidth) * 100}%`,
                  top: `${(cursorCoords.y / resHeight) * 100}%`
                }}
              />
            </div>

            {/* Coordinates display */}
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "var(--color-text-secondary)" }}>
              <span>TV Coordinates: <b style={{ fontFamily: "monospace" }}>{cursorCoords.x}, {cursorCoords.y}</b></span>
              <span>Resolution: <b style={{ fontFamily: "monospace" }}>{resWidth}x{resHeight}</b></span>
            </div>

            {/* Sensitivity controls */}
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "var(--color-text-muted)" }}>
                <span>Touchpad Sensitivity</span>
                <span>{sensitivity}x</span>
              </div>
              <input
                type="range"
                min="0.5"
                max="5"
                step="0.5"
                className="slider"
                style={{ width: "100%", accentColor: "var(--color-accent-primary)" }}
                value={sensitivity}
                onChange={(e) => setSensitivity(parseFloat(e.target.value))}
              />
            </div>

            {/* Developer overlays setting togglers */}
            <div className="card-panel" style={{ padding: "12px", gap: "10px", backgroundColor: "rgba(0,0,0,0.15)", border: "1px solid var(--color-border)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <h5 style={{ margin: 0, fontSize: "11px" }}>Show touches on TV</h5>
                  <span style={{ fontSize: "9px", color: "var(--color-text-muted)" }}>Visual circle overlay on touches</span>
                </div>
                <div
                  className={`switch-track ${showTouches ? "on" : ""}`}
                  onClick={() => handleToggleTouches(!showTouches)}
                  style={{ width: "30px", height: "16px" }}
                >
                  <div className="switch-thumb" style={{ width: "10px", height: "10px", top: "2px", left: "2px" }} />
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid var(--color-border)", paddingTop: "8px", marginTop: "4px" }}>
                <div>
                  <h5 style={{ margin: 0, fontSize: "11px" }}>Trace pointer location</h5>
                  <span style={{ fontSize: "9px", color: "var(--color-text-muted)" }}>Trace coordinates header and draw touch paths</span>
                </div>
                <div
                  className={`switch-track ${pointerLocation ? "on" : ""}`}
                  onClick={() => handleTogglePointerLocation(!pointerLocation)}
                  style={{ width: "30px", height: "16px" }}
                >
                  <div className="switch-thumb" style={{ width: "10px", height: "10px", top: "2px", left: "2px" }} />
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* Normal Remote Controls panel */
          <div style={{ display: "flex", flexDirection: "column", gap: "16px", width: "100%", alignItems: "center" }}>
            {/* Keyboard Capture Toggle */}
            <div
              className="card-panel"
              style={{
                width: "100%",
                maxWidth: "380px",
                padding: "12px 14px",
                borderColor: keyboardEnabled ? "var(--color-accent-primary)" : "var(--color-border)",
                backgroundColor: "rgba(0,0,0,0.15)"
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <Keyboard size={20} style={{ color: keyboardEnabled ? "var(--color-accent-primary)" : "var(--color-text-muted)" }} />
                  <div>
                    <h4 style={{ margin: 0, fontSize: "13px" }}>Mac Keyboard Capture</h4>
                    <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>
                      Use Mac keyboard as TV inputs
                    </span>
                  </div>
                </div>
                
                <div
                  className={`switch-track ${keyboardEnabled ? "on" : ""}`}
                  onClick={() => setKeyboardEnabled(!keyboardEnabled)}
                >
                  <div className="switch-thumb"></div>
                </div>
              </div>

              {keyboardEnabled && (
                <div style={{ marginTop: "10px", borderTop: "1px solid var(--color-border)", paddingTop: "8px" }}>
                  <div style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
                    <button
                      type="button"
                      className={`btn-secondary ${keyboardMode === "keymap" ? "active" : ""}`}
                      style={{ flex: 1, padding: "4px 8px", fontSize: "11px", backgroundColor: keyboardMode === "keymap" ? "var(--color-surface-panel)" : "transparent" }}
                      onClick={() => setKeyboardMode("keymap")}
                    >
                      Remote Keymap
                    </button>
                    <button
                      type="button"
                      className={`btn-secondary ${keyboardMode === "passthrough" ? "active" : ""}`}
                      style={{ flex: 1, padding: "4px 8px", fontSize: "11px", backgroundColor: keyboardMode === "passthrough" ? "var(--color-surface-panel)" : "transparent" }}
                      onClick={() => setKeyboardMode("passthrough")}
                    >
                      Text Passthrough
                    </button>
                  </div>

                  <div
                    style={{
                      padding: "6px 8px",
                      borderRadius: "4px",
                      backgroundColor: "rgba(244, 63, 94, 0.05)",
                      border: "1px dashed rgba(244, 63, 94, 0.3)",
                      fontSize: "11px",
                      textAlign: "center",
                      color: "var(--color-accent-primary)",
                      fontWeight: 600
                    }}
                  >
                    {keyboardMode === "keymap" 
                      ? "🔴 Keymap active! Arrow keys = D-Pad, Enter = OK, Backspace = Back."
                      : "🔴 Passthrough typing active! Type letters/numbers directly."}
                  </div>
                </div>
              )}
            </div>

            {/* Text Injection Box */}
            <form onSubmit={handleSendTextSubmit} style={{ display: "flex", gap: "8px", width: "100%", maxWidth: "380px" }}>
              <input
                type="text"
                className="input-field"
                style={{ padding: "8px 12px", fontSize: "12px" }}
                placeholder="Type text to send/type on TV..."
                value={textToSend}
                onChange={(e) => setTextToSend(e.target.value)}
              />
              <button type="submit" className="btn-primary" style={{ padding: "8px 14px", fontSize: "12px", whiteSpace: "nowrap" }}>
                Send
              </button>
            </form>

            {/* Visual Remote Controller Design */}
            <div className="remote-layout" style={{ marginTop: "4px" }}>
              <div className="dpad-container">
                <button className="dpad-btn dpad-up" onClick={() => triggerAction("DPAD_UP")} aria-label="Up">
                  <ArrowUp size={28} />
                </button>
                <button className="dpad-btn dpad-left" onClick={() => triggerAction("DPAD_LEFT")} aria-label="Left">
                  <ArrowLeft size={28} />
                </button>
                <button className="dpad-center" onClick={() => triggerAction("CENTER")}>
                  OK
                </button>
                <button className="dpad-btn dpad-right" onClick={() => triggerAction("DPAD_RIGHT")} aria-label="Right">
                  <ArrowRight size={28} />
                </button>
                <button className="dpad-btn dpad-down" onClick={() => triggerAction("DPAD_DOWN")} aria-label="Down">
                  <ArrowDown size={28} />
                </button>
              </div>

              <div className="remote-buttons-grid">
                <button className="remote-btn" onClick={() => triggerAction("BACK")}>
                  <CornerDownLeft size={15} />
                  <span>BACK</span>
                </button>
                <button className="remote-btn" onClick={() => triggerAction("HOME")}>
                  <Home size={15} />
                  <span>HOME</span>
                </button>
                <button className="remote-btn" onClick={() => triggerAction("MENU")}>
                  <Menu size={15} />
                  <span>MENU</span>
                </button>

                <button className="remote-btn" onClick={() => triggerAction("VOLUME_DOWN")}>
                  <Volume1 size={15} />
                  <span>VOL -</span>
                </button>
                <button className="remote-btn" onClick={() => triggerAction("MUTE")}>
                  <VolumeX size={15} />
                  <span>MUTE</span>
                </button>
                <button className="remote-btn" onClick={() => triggerAction("VOLUME_UP")}>
                  <Volume2 size={15} />
                  <span>VOL +</span>
                </button>

                <button className="remote-btn" onClick={() => triggerAction("PLAY_PAUSE")} style={{ gridColumn: "span 2" }}>
                  <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    <Play size={11} />
                    <Pause size={11} />
                  </div>
                  <span>PLAY / PAUSE</span>
                </button>
                <button className="remote-btn" onClick={() => triggerAction("POWER")} style={{ borderColor: "rgba(244, 63, 94, 0.4)" }}>
                  <Power size={15} style={{ color: "var(--color-accent-primary)" }} />
                  <span>POWER</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  if (layoutMode === "workspace") {
    return renderMainRemote();
  }

  return (
    <div className="workstation-pane">
      <div className="panel-left">
        {renderMainRemote()}
      </div>

      {/* Monitor panel on the right */}
      <div className="panel-right">
        <div className="card-panel" style={{ height: "100%" }}>
          <div className="panel-header">
            <span className="panel-title">Action Event Monitor</span>
          </div>
          <div className="panel-body flex-center" style={{ flexDirection: "column", gap: "16px", textAlign: "center" }}>
            {lastAction ? (
              <>
                <div
                  className="flex-center"
                  style={{
                    width: "80px",
                    height: "80px",
                    borderRadius: "50%",
                    backgroundColor: "rgba(244, 63, 94, 0.1)",
                    border: "2px solid var(--color-accent-primary)",
                    color: "var(--color-accent-primary)",
                    boxShadow: "0 0 15px rgba(244, 63, 94, 0.2)",
                    animation: "pulse 1s infinite"
                  }}
                >
                  <Check size={36} />
                </div>
                <div>
                  <h4 style={{ color: "var(--color-text-primary)", fontSize: "16px" }}>{lastAction}</h4>
                  <p style={{ color: "var(--color-text-muted)", fontSize: "12px", marginTop: "4px" }}>
                    Action injected successfully
                  </p>
                </div>
              </>
            ) : (
              <div style={{ color: "var(--color-text-muted)" }}>
                <p>Waiting for remote inputs...</p>
                <p style={{ fontSize: "12px", marginTop: "4px" }}>Inputs are recorded and executed in real-time</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
