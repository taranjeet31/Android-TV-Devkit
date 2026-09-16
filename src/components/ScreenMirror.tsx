import React, { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useDeviceStore } from "../store/useDeviceStore";
import { useCursorPosition } from "../hooks/useCursorPosition";
import { Monitor, Play, Square, Info, ShieldAlert, Cpu, Wifi, Zap, CheckCircle2 } from "lucide-react";

export interface ScreenMirrorProps {
  layoutMode?: "tab" | "workspace";
}

export const ScreenMirror: React.FC<ScreenMirrorProps> = ({ layoutMode = "tab" }) => {
  const {
    selectedDevice,
    screencapActive,
    setScreencapActive,
    captureActive,
    virtualCursorPressed,
  } = useDeviceStore();

  const { cursorX, cursorY, isClicking } = useCursorPosition();

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  
  // Coordinate Tracking for Virtual Cursor
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number; visible: boolean }>({ x: 0, y: 0, visible: false });
  const [isPressing, setIsPressing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [hasFrame, setHasFrame] = useState(false);
  const [scrcpyStatus, setScrcpyStatus] = useState<string | null>(null);
  const [pollInterval, setPollInterval] = useState<number>(200); // ms between frames

  // Drag start state
  const dragStart = useRef<{ x: number; y: number; time: number } | null>(null);

  const handleLaunchScrcpy = async (forceWifiMode?: boolean) => {
    if (!selectedDevice) return;
    setScreencapActive(false); // Stop in-app polling to free ADB connection and TV GPU for scrcpy
    setScrcpyStatus("Launching scrcpy...");
    try {
      const connType = forceWifiMode ? "wifi" : selectedDevice.connection_type;
      const result = await invoke<string>("launch_scrcpy", {
        serial: selectedDevice.serial,
        connectionType: connType,
      });
      setScrcpyStatus(result);
      setTimeout(() => setScrcpyStatus(null), 6000);
    } catch (err: any) {
      console.error("Scrcpy launch failed", err);
      setScrcpyStatus(`Launch error: ${err.toString()}`);
    }
  };

  // Poll screenshot frames using Base64 Data URI (get_screenshot)
  useEffect(() => {
    if (!screencapActive || !selectedDevice) {
      setHasFrame(false);
      return;
    }
    let active = true;
    
    const poll = async () => {
      if (!active) return;
      try {
        const base64Uri = await invoke<string>("get_screenshot", { serial: selectedDevice.serial });
        if (active && base64Uri) {
          const img = new Image();
          img.src = base64Uri;
          img.onload = () => {
            if (!active) return;
            const canvas = canvasRef.current;
            if (canvas) {
              const ctx = canvas.getContext("2d");
              if (ctx) {
                canvas.width = img.width;
                canvas.height = img.height;
                ctx.drawImage(img, 0, 0);
                setHasFrame(true);
              }
            }
            setErrorMsg(null);
          };
          img.onerror = () => {
            if (active) setErrorMsg("Failed to render frame onto canvas.");
          };
        }
      } catch (err: any) {
        console.error("Failed to capture screenshot", err);
        if (active) {
          setErrorMsg("Screenshot capture failed. Ensure device screen is active and ADB is connected.");
        }
      }
      
      // Delay before next frame
      if (active) {
        setTimeout(poll, pollInterval);
      }
    };

    poll();
    return () => {
      active = false;
    };
  }, [screencapActive, selectedDevice, pollInterval]);

  // Convert local coordinates to Android device coordinates
  const getDeviceCoords = (clientX: number, clientY: number) => {
    if (!canvasRef.current || !selectedDevice) return null;
    
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    
    // Scale client mouse pos to canvas actual image dimensions
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    const canvasX = (clientX - rect.left) * scaleX;
    const canvasY = (clientY - rect.top) * scaleY;

    // Boundary checks
    const targetX = Math.max(0, Math.min(canvas.width, Math.round(canvasX)));
    const targetY = Math.max(0, Math.min(canvas.height, Math.round(canvasY)));
    
    return { x: targetX, y: targetY };
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const coords = getDeviceCoords(e.clientX, e.clientY);
    if (!coords) return;
    
    setIsPressing(true);
    dragStart.current = {
      x: coords.x,
      y: coords.y,
      time: Date.now()
    };
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current) return;
    
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    // Update cursor overlay position
    setCursorPos({
      x: mouseX,
      y: mouseY,
      visible: mouseX >= 0 && mouseX <= rect.width && mouseY >= 0 && mouseY <= rect.height
    });
  };

  const handleMouseUp = async (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!selectedDevice || !dragStart.current) return;
    setIsPressing(false);
    
    const start = dragStart.current;
    dragStart.current = null;
    
    const endCoords = getDeviceCoords(e.clientX, e.clientY);
    if (!endCoords) return;

    const diffX = endCoords.x - start.x;
    const diffY = endCoords.y - start.y;
    const distance = Math.sqrt(diffX * diffX + diffY * diffY);
    const duration = Date.now() - start.time;

    try {
      if (distance > 15) {
        // Injection of Swipe action
        await invoke("inject_swipe", {
          serial: selectedDevice.serial,
          x1: start.x,
          y1: start.y,
          x2: endCoords.x,
          y2: endCoords.y,
          durationMs: Math.max(120, duration)
        });
      } else {
        // Injection of click tap
        await invoke("inject_click", {
          serial: selectedDevice.serial,
          x: endCoords.x,
          y: endCoords.y
        });
      }
    } catch (err) {
      console.error("Action injection failed", err);
    }
  };

  if (!selectedDevice) {
    return (
      <div className="flex-center" style={{ flexDirection: "column", height: "100%", color: "var(--color-text-muted)" }}>
        <Monitor size={48} style={{ opacity: 0.3, marginBottom: "16px" }} />
        <h3>No connected device selected</h3>
        <p style={{ fontSize: "12px", marginTop: "4px" }}>Select a device in the Device Manager to launch Screen Mirroring</p>
      </div>
    );
  }

  const resText = selectedDevice.resolution || "1920x1080";
  const isWifiDevice = selectedDevice.connection_type === "wifi" || selectedDevice.serial.includes(":");

  const renderMainMirror = () => (
    <div className="card-panel" style={{ flexGrow: 1, height: "100%" }}>
      <div className="panel-header">
        <span className="panel-title">
          <Monitor size={18} style={{ color: "var(--color-accent-primary)" }} />
          Display Mirror ({resText})
          {isWifiDevice && (
            <span className="badge badge-info" style={{ display: "inline-flex", alignItems: "center", gap: "4px", marginLeft: "6px" }}>
              <Wifi size={10} /> Wi-Fi Device
            </span>
          )}
        </span>
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            className="btn-primary"
            style={{ padding: "6px 14px" }}
            onClick={() => handleLaunchScrcpy()}
            title="Launch high-framerate scrcpy mirror window"
          >
            <Zap size={14} /> Launch Scrcpy Mirror
          </button>
          
          <button
            className={`btn-secondary ${screencapActive ? "active" : ""}`}
            style={{ padding: "6px 12px" }}
            onClick={() => setScreencapActive(!screencapActive)}
          >
            {screencapActive ? (
              <>
                <Square size={14} /> Stop In-App Feed
              </>
            ) : (
              <>
                <Play size={14} /> Canvas Feed
              </>
            )}
          </button>
        </div>
      </div>

      <div
        className="panel-body flex-center"
        style={{ padding: 0, backgroundColor: "#06070a", position: "relative" }}
        ref={containerRef}
      >
        {screencapActive ? (
          hasFrame ? (
            <div style={{ position: "relative", display: "inline-block", maxWidth: "100%", maxHeight: "100%" }}>
              <canvas
                ref={canvasRef}
                className="screen-canvas"
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={() => setCursorPos((c) => ({ ...c, visible: false }))}
              />
              
              {/* Tier 1 Virtual Cursor Overlay */}
              {captureActive ? (
                <div
                  className={`virtual-cursor ${isClicking || virtualCursorPressed ? 'clicking' : ''}`}
                  style={{ left: `${cursorX * 100}%`, top: `${cursorY * 100}%` }}
                />
              ) : cursorPos.visible && (
                <div
                  style={{
                    position: "absolute",
                    left: cursorPos.x - 5,
                    top: cursorPos.y - 5,
                    width: "10px",
                    height: "10px",
                    borderRadius: "50%",
                    backgroundColor: isPressing ? "#3b82f6" : "rgba(255, 255, 255, 0.85)",
                    border: "1.5px solid #1e293b",
                    pointerEvents: "none",
                    transition: "transform 0.05s ease",
                    transform: isPressing ? "scale(0.85)" : "scale(1)"
                  }}
                />
              )}
            </div>
          ) : (
            <div className="flex-center" style={{ flexDirection: "column", color: "var(--color-text-muted)", gap: "12px" }}>
              <div className="status-indicator">
                <span className="status-dot active"></span>
                Initializing screen feed...
              </div>
            </div>
          )
        ) : (
          <div className="flex-center" style={{ flexDirection: "column", color: "var(--color-text-muted)", gap: "14px", padding: "32px", textAlign: "center" }}>
            <Monitor size={44} style={{ opacity: 0.4, color: "var(--color-accent-primary)" }} />
            <div>
              <h4 style={{ color: "var(--color-text-primary)", marginBottom: "4px" }}>Screen Stream Ready</h4>
              <p style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                For high-speed 60FPS fluid mirroring (especially on Wi-Fi), click <b>Launch Scrcpy Mirror</b> above.
              </p>
            </div>
            <div style={{ display: "flex", gap: "10px" }}>
              <button className="btn-primary" onClick={() => handleLaunchScrcpy()}>
                <Zap size={14} /> Launch Scrcpy Mirror
              </button>
              <button className="btn-secondary" onClick={() => setScreencapActive(true)}>
                <Play size={14} /> Start In-App Canvas Stream
              </button>
            </div>
          </div>
        )}

        {scrcpyStatus && (
          <div
            style={{
              position: "absolute",
              top: "14px",
              left: "50%",
              transform: "translateX(-50%)",
              padding: "8px 16px",
              borderRadius: "var(--border-radius-sm)",
              backgroundColor: "var(--color-surface-panel)",
              border: "1px solid var(--color-accent-primary)",
              color: "var(--color-text-primary)",
              fontSize: "12px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              zIndex: 25,
              boxShadow: "var(--box-shadow-elevated)"
            }}
          >
            <CheckCircle2 size={15} style={{ color: "var(--color-success)" }} />
            {scrcpyStatus}
          </div>
        )}

        {errorMsg && (
          <div
            style={{
              position: "absolute",
              bottom: "16px",
              left: "16px",
              right: "16px",
              padding: "12px 16px",
              borderRadius: "var(--border-radius-sm)",
              backgroundColor: "rgba(239, 68, 68, 0.95)",
              color: "white",
              fontSize: "13px",
              display: "flex",
              alignItems: "center",
              gap: "10px",
              zIndex: 20
            }}
          >
            <ShieldAlert size={18} />
            {errorMsg}
          </div>
        )}
      </div>
    </div>
  );

  if (layoutMode === "workspace") {
    return renderMainMirror();
  }

  return (
    <div className="workstation-pane">
      <div className="panel-left">
        {renderMainMirror()}
      </div>

      <div className="panel-right">
        <div className="card-panel" style={{ height: "100%" }}>
          <div className="panel-header">
            <span className="panel-title">
              <Cpu size={16} />
              Mirror Controls & Tuning
            </span>
          </div>
          <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
            
            {/* Scrcpy Native Launch Card */}
            <div
              style={{
                backgroundColor: "var(--color-surface-deep)",
                border: "1px solid var(--color-border)",
                padding: "14px",
                borderRadius: "var(--border-radius-sm)",
                display: "flex",
                flexDirection: "column",
                gap: "10px"
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <Zap size={16} style={{ color: "var(--color-accent-primary)" }} />
                <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--color-text-primary)" }}>Native Scrcpy Window</span>
              </div>
              <p style={{ fontSize: "11.5px", color: "var(--color-text-secondary)", lineHeight: "1.4" }}>
                Hardware-accelerated screen stream with near-zero latency.
                {isWifiDevice && " Tuned automatically for Wi-Fi low latency (720p 30fps)."}
              </p>
              <button
                className="btn-primary"
                onClick={() => handleLaunchScrcpy()}
                style={{ width: "100%", justifyContent: "center" }}
              >
                <Zap size={14} /> Launch Native Mirror
              </button>
            </div>

            {/* In-App Stream Settings */}
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <span style={{ fontSize: "11px", color: "var(--color-text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                In-App Canvas Refresh Rate
              </span>
              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  className={`btn-secondary ${pollInterval === 150 ? "active" : ""}`}
                  style={{ flex: 1, padding: "6px 8px", fontSize: "12px" }}
                  onClick={() => setPollInterval(150)}
                >
                  Fast (150ms)
                </button>
                <button
                  className={`btn-secondary ${pollInterval === 250 ? "active" : ""}`}
                  style={{ flex: 1, padding: "6px 8px", fontSize: "12px" }}
                  onClick={() => setPollInterval(250)}
                >
                  Balanced (250ms)
                </button>
                <button
                  className={`btn-secondary ${pollInterval === 500 ? "active" : ""}`}
                  style={{ flex: 1, padding: "6px 8px", fontSize: "12px" }}
                  onClick={() => setPollInterval(500)}
                >
                  Low Wi-Fi (500ms)
                </button>
              </div>
            </div>
            
            {/* Usage Guide */}
            <div
              style={{
                backgroundColor: "var(--color-surface-deep)",
                border: "1px solid var(--color-border)",
                padding: "14px",
                borderRadius: "var(--border-radius-sm)",
                fontSize: "12px",
                lineHeight: "1.5",
                color: "var(--color-text-secondary)"
              }}
            >
              <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "8px", fontWeight: "600", color: "var(--color-text-primary)" }}>
                <Info size={14} style={{ color: "var(--color-accent-primary)" }} />
                <span>Touchpad & Input Guide</span>
              </div>
              <ul style={{ paddingLeft: "16px", display: "flex", flexDirection: "column", gap: "6px" }}>
                <li><b>Click & Tap:</b> Click anywhere on mirror canvas to send direct touch tap.</li>
                <li><b>Drag Vectors:</b> Click and drag mouse to send smooth swipe gestures.</li>
                <li><b>Wi-Fi Speed Tip:</b> Use native Scrcpy for true 60FPS fluid video streaming over Wi-Fi.</li>
              </ul>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
};
