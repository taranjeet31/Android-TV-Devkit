import React, { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useDeviceStore } from "../store/useDeviceStore";
import {
  MousePointer,
  Wifi,
  Smartphone,
  AlertTriangle,
  CheckCircle,
  Lock,
  Unlock,
  Settings,
  Monitor,
  RefreshCw,
  ExternalLink,
  Crosshair,
  Activity,
} from "lucide-react";

// ── Tauri command wrappers ─────────────────────────────────────────────────

async function checkPermission(): Promise<boolean> {
  return invoke<boolean>("check_accessibility_permission");
}

async function openAccessibilitySettings(): Promise<void> {
  return invoke<void>("open_accessibility_settings");
}

async function startSession(config: CaptureConfig): Promise<number> {
  return invoke<number>("start_mouse_capture_session", { config });
}

async function toggleCapture(): Promise<string> {
  return invoke<string>("toggle_mouse_capture");
}

async function stopSession(): Promise<void> {
  return invoke<void>("stop_mouse_capture_session");
}

async function getWsClientCount(): Promise<number> {
  return invoke<number>("get_ws_client_count");
}

async function getVirtualCursorPos(): Promise<[number, number]> {
  return invoke<[number, number]>("get_virtual_cursor_pos");
}

async function getHostIp(): Promise<string> {
  return invoke<string>("get_host_ip");
}

interface CaptureConfig {
  screen_w: number;
  screen_h: number;
  sensitivity: number;
  drag_threshold: number;
  target_hz: number;
  adb_serial: string | null;
  ws_port: number;
  session_token: string;
  hide_system_cursor: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function generateToken(len = 16): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

function buildReceiverUrl(host: string, port: number, token: string): string {
  return `http://${host}:1420/tizen-receiver/index.html?host=${host}&port=${port}&token=${token}`;
}

// ── Main component ─────────────────────────────────────────────────────────

export const MouseCapture: React.FC = () => {
  const {
    selectedDevice,
    captureActive,
    capturePermissionGranted,
    virtualCursorPos,
    virtualCursorPressed,
    captureHideSystemCursor,
    captureSensitivity,
    captureDragThreshold,
    captureWsClientCount,
    setCaptureActive,
    setCaptureMode,
    setCaptureWsPort,
    setCapturePermissionGranted,
    setVirtualCursorPos,
    setCaptureHideSystemCursor,
    setCaptureSensitivity,
    setCaptureDragThreshold,
    setCaptureWsClientCount,
  } = useDeviceStore();

  const [mode, setMode] = useState<"android" | "tizen">(
    selectedDevice ? "android" : "tizen"
  );
  const [wsPort, setWsPort] = useState(9877);
  const [sessionToken] = useState(() => generateToken());
  const [sessionStarted, setSessionStarted] = useState(false);
  const [hostIp, setHostIp] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [toggling, setToggling] = useState(false);
  const [permChecked, setPermChecked] = useState(false);

  const clientPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cursorPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // TV resolution from selected device
  const [resW, resH] = selectedDevice?.resolution
    ? selectedDevice.resolution.split("x").map((n) => parseInt(n) || 1920)
    : [1920, 1080];

  // ── Permission check ─────────────────────────────────────────────────────

  useEffect(() => {
    checkPermission()
      .then((ok) => {
        setCapturePermissionGranted(ok);
        setPermChecked(true);
      })
      .catch(() => {
        setCapturePermissionGranted(false);
        setPermChecked(true);
      });

    getHostIp().then(setHostIp).catch(() => {});
  }, []);

  // ── Tauri events ─────────────────────────────────────────────────────────

  useEffect(() => {
    let unlisten1: (() => void) | undefined;
    let unlisten2: (() => void) | undefined;

    listen<string>("capture-state-changed", (event) => {
      const active = event.payload === "captured";
      setCaptureActive(active);
      if (!active) {
        stopClientPoll();
        stopCursorPoll();
      } else {
        startClientPoll();
        startCursorPoll();
      }
    }).then((fn) => { unlisten1 = fn; });

    listen<string>("capture-permission-error", (event) => {
      setErrorMsg(event.payload);
      setCapturePermissionGranted(false);
    }).then((fn) => { unlisten2 = fn; });

    return () => {
      unlisten1?.();
      unlisten2?.();
    };
  }, []);

  // ── Polling helpers ──────────────────────────────────────────────────────

  const startClientPoll = useCallback(() => {
    if (clientPollRef.current) return;
    clientPollRef.current = setInterval(async () => {
      try {
        const count = await getWsClientCount();
        setCaptureWsClientCount(count);
      } catch {}
    }, 2000);
  }, []);

  const stopClientPoll = useCallback(() => {
    if (clientPollRef.current) {
      clearInterval(clientPollRef.current);
      clientPollRef.current = null;
    }
  }, []);

  const startCursorPoll = useCallback(() => {
    if (cursorPollRef.current) return;
    cursorPollRef.current = setInterval(async () => {
      try {
        const [x, y] = await getVirtualCursorPos();
        setVirtualCursorPos({ x, y });
      } catch {}
    }, 100);
  }, []);

  const stopCursorPoll = useCallback(() => {
    if (cursorPollRef.current) {
      clearInterval(cursorPollRef.current);
      cursorPollRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      stopClientPoll();
      stopCursorPoll();
    };
  }, []);

  // ── Session management ───────────────────────────────────────────────────

  const handleStartSession = async () => {
    setErrorMsg(null);
    const config: CaptureConfig = {
      screen_w: resW,
      screen_h: resH,
      sensitivity: captureSensitivity,
      drag_threshold: captureDragThreshold,
      target_hz: 60,
      adb_serial: mode === "android" && selectedDevice ? selectedDevice.serial : null,
      ws_port: wsPort,
      session_token: sessionToken,
      hide_system_cursor: captureHideSystemCursor,
    };
    try {
      const port = await startSession(config);
      setCaptureWsPort(port);
      setCaptureMode(mode);
      setSessionStarted(true);
    } catch (e) {
      setErrorMsg(String(e));
    }
  };

  const handleToggleCapture = async () => {
    if (!sessionStarted) {
      await handleStartSession();
      return;
    }
    setToggling(true);
    try {
      await toggleCapture();
    } catch (e) {
      setErrorMsg(String(e));
    }
    setToggling(false);
  };

  const handleStopSession = async () => {
    await stopSession();
    setSessionStarted(false);
    setCaptureActive(false);
    setCaptureWsPort(null);
    setCaptureMode(null);
    stopClientPoll();
    stopCursorPoll();
  };

  // ── Receiver URL ─────────────────────────────────────────────────────────

  const receiverUrl = hostIp
    ? buildReceiverUrl(hostIp, wsPort, sessionToken)
    : "";

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="mc-container">
      {/* Header */}
      <div className="mc-header">
        <div className="mc-header-left">
          <div className="mc-icon-wrap">
            <MousePointer size={22} />
          </div>
          <div>
            <h2 className="mc-title">Mouse Capture</h2>
            <p className="mc-subtitle">Software KVM — control your TV with your Mac mouse</p>
          </div>
        </div>

        {captureActive && (
          <div className="mc-active-badge">
            <div className="mc-pulse-dot" />
            Capturing
          </div>
        )}
      </div>

      <div className="mc-body">
        {/* ── Permission section ── */}
        {permChecked && !capturePermissionGranted && (
          <div className="mc-card mc-card-warning">
            <div className="mc-card-icon">
              <AlertTriangle size={20} />
            </div>
            <div className="mc-card-content">
              <div className="mc-card-title">Accessibility Permission Required</div>
              <p className="mc-card-desc">
                TVDev Studio needs <strong>Accessibility</strong> and{" "}
                <strong>Input Monitoring</strong> permissions to intercept mouse events and
                hide the local cursor while controlling your TV.
              </p>
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button
                  className="mc-btn mc-btn-primary"
                  onClick={openAccessibilitySettings}
                >
                  <ExternalLink size={13} />
                  Open Accessibility Settings
                </button>
                <button
                  className="mc-btn mc-btn-ghost"
                  onClick={() =>
                    checkPermission().then((ok) => setCapturePermissionGranted(ok))
                  }
                >
                  <RefreshCw size={13} />
                  Re-check
                </button>
              </div>
            </div>
          </div>
        )}

        {permChecked && capturePermissionGranted && (
          <div className="mc-card mc-card-success">
            <CheckCircle size={14} />
            <span>Accessibility permission granted</span>
          </div>
        )}

        {/* Error banner */}
        {errorMsg && (
          <div className="mc-card mc-card-error">
            <AlertTriangle size={14} />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* ── Mode selector ── */}
        <div className="mc-section">
          <div className="mc-section-title">
            <Settings size={13} />
            Target Platform
          </div>
          <div className="mc-mode-tabs">
            <button
              className={`mc-mode-tab ${mode === "android" ? "active" : ""}`}
              onClick={() => setMode("android")}
              disabled={sessionStarted}
            >
              <Smartphone size={15} />
              Android TV
              <span className="mc-mode-badge">via ADB</span>
            </button>
            <button
              className={`mc-mode-tab ${mode === "tizen" ? "active" : ""}`}
              onClick={() => setMode("tizen")}
              disabled={sessionStarted}
            >
              <Monitor size={15} />
              Tizen / Other
              <span className="mc-mode-badge">via WebSocket</span>
            </button>
          </div>

          {mode === "android" && !selectedDevice && (
            <p className="mc-hint">
              No device connected. Connect an Android TV device first in{" "}
              <strong>Device Manager</strong>.
            </p>
          )}

          {mode === "android" && selectedDevice && (
            <p className="mc-hint">
              Target: <strong>{selectedDevice.name}</strong> — taps/swipes will be
              injected via ADB ({selectedDevice.resolution})
            </p>
          )}

          {mode === "tizen" && (
            <div className="mc-tizen-section">
              <div className="mc-field-row">
                <label className="mc-label">WebSocket Port</label>
                <input
                  type="number"
                  className="mc-input mc-input-sm"
                  value={wsPort}
                  min={1024}
                  max={65535}
                  disabled={sessionStarted}
                  onChange={(e) => setWsPort(Number(e.target.value))}
                />
              </div>
              {sessionStarted && receiverUrl && (
                <div className="mc-receiver-card">
                  <div className="mc-receiver-header">
                    <Wifi size={14} />
                    Open this URL on your TV browser
                  </div>
                  <div className="mc-receiver-url">{receiverUrl}</div>
                  <div className="mc-receiver-status">
                    <Activity size={12} />
                    {captureWsClientCount > 0
                      ? `${captureWsClientCount} TV client(s) connected`
                      : "Waiting for TV to connect…"}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Sensitivity & drag threshold ── */}
        <div className="mc-section">
          <div className="mc-section-title">
            <Settings size={13} />
            Capture Settings
          </div>
          <div className="mc-settings-grid">
            <div className="mc-setting">
              <label className="mc-label">
                Sensitivity
                <span className="mc-setting-value">{captureSensitivity.toFixed(1)}×</span>
              </label>
              <input
                type="range"
                min={0.5}
                max={6}
                step={0.1}
                value={captureSensitivity}
                onChange={(e) => setCaptureSensitivity(parseFloat(e.target.value))}
                className="mc-slider"
              />
              <div className="mc-slider-labels">
                <span>0.5×</span>
                <span>6×</span>
              </div>
            </div>
            <div className="mc-setting">
              <label className="mc-label">
                Drag Threshold
                <span className="mc-setting-value">{captureDragThreshold}px</span>
              </label>
              <input
                type="range"
                min={2}
                max={24}
                step={1}
                value={captureDragThreshold}
                onChange={(e) => setCaptureDragThreshold(parseInt(e.target.value))}
                className="mc-slider"
              />
              <div className="mc-slider-labels">
                <span>2px</span>
                <span>24px</span>
              </div>
            </div>
            <div className="mc-setting" style={{ justifyContent: "center" }}>
              <label className="mc-label" style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: "8px" }}>
                <input
                  type="checkbox"
                  checked={captureHideSystemCursor}
                  disabled={sessionStarted}
                  onChange={(e) => setCaptureHideSystemCursor(e.target.checked)}
                  style={{ width: "16px", height: "16px", accentColor: "var(--color-accent-primary)" }}
                />
                <span>Hide macOS System Cursor</span>
              </label>
              <p style={{ fontSize: "11px", color: "var(--color-text-muted)", marginTop: "4px" }}>
                Unchecked: leaves your Mac desktop pointer visible while capturing mouse.
              </p>
            </div>
          </div>
        </div>

        {/* ── Virtual cursor display (when captured) ── */}
        {captureActive && (
          <div className="mc-section">
            <div className="mc-section-title">
              <Crosshair size={13} />
              Virtual Cursor Position
            </div>
            <div className="mc-cursor-display">
              <div className="mc-cursor-screen">
                <div
                  className="mc-cursor-pointer-wrap"
                  style={{
                    position: "absolute",
                    left: `${(virtualCursorPos.x / resW) * 100}%`,
                    top: `${(virtualCursorPos.y / resH) * 100}%`,
                    transform: "translate(-2px, -2px)",
                    pointerEvents: "none",
                    zIndex: 10,
                  }}
                >
                  <div
                    style={{
                      transform: virtualCursorPressed ? "scale(0.85)" : "scale(1)",
                      transition: "transform 0.05s ease",
                      filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.6))",
                    }}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                      <path
                        d="M3 2L19 12L11 13.5L7.5 20.5L3 2Z"
                        fill={virtualCursorPressed ? "#3b82f6" : "#ffffff"}
                        stroke="#0f172a"
                        strokeWidth="1.6"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </div>
                </div>
                <div className="mc-screen-label">
                  {resW}×{resH}
                </div>
              </div>
              <div className="mc-cursor-coords">
                <span>X: <strong>{virtualCursorPos.x}</strong></span>
                <span>Y: <strong>{virtualCursorPos.y}</strong></span>
                <span>Status: <strong style={{ color: virtualCursorPressed ? "var(--color-accent-primary)" : "var(--color-text-secondary)" }}>{virtualCursorPressed ? "CLICK / DRAG" : "MOVING"}</strong></span>
              </div>
            </div>
          </div>
        )}

        {/* ── Hotkey hint ── */}
        <div className="mc-hotkey-hint">
          <kbd>⌘</kbd>
          <kbd>⇧</kbd>
          <kbd>L</kbd>
          <span>Toggle capture from anywhere</span>
        </div>

        {/* ── Action buttons ── */}
        <div className="mc-actions">
          {!sessionStarted ? (
            <button
              className="mc-btn mc-btn-primary mc-btn-lg"
              onClick={handleStartSession}
              disabled={mode === "android" && !selectedDevice}
            >
              <Lock size={15} />
              Start Capture Session
            </button>
          ) : (
            <>
              <button
                className={`mc-btn mc-btn-lg ${captureActive ? "mc-btn-danger" : "mc-btn-primary"}`}
                onClick={handleToggleCapture}
                disabled={toggling}
              >
                {captureActive ? (
                  <>
                    <Unlock size={15} />
                    Release Mouse (⌘⇧L)
                  </>
                ) : (
                  <>
                    <Lock size={15} />
                    Capture Mouse (⌘⇧L)
                  </>
                )}
              </button>
              <button
                className="mc-btn mc-btn-ghost"
                onClick={handleStopSession}
                disabled={captureActive}
              >
                Stop Session
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
