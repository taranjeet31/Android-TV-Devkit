import React, { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useDeviceStore } from "../store/useDeviceStore";
import { Monitor, Play, Square, Info, ShieldAlert, Cpu } from "lucide-react";

export interface ScreenMirrorProps {
  layoutMode?: "tab" | "workspace";
}

export const ScreenMirror: React.FC<ScreenMirrorProps> = ({ layoutMode = "tab" }) => {
  const {
    selectedDevice,
    screencapActive,
    setScreencapActive
  } = useDeviceStore();

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  
  // Coordinate Tracking for Virtual Cursor
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number; visible: boolean }>({ x: 0, y: 0, visible: false });
  const [isPressing, setIsPressing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [hasFrame, setHasFrame] = useState(false);

  // Drag start state
  const dragStart = useRef<{ x: number; y: number; time: number } | null>(null);

  // Poll screenshot frames using raw binary bytes (Vec<u8>)
  useEffect(() => {
    if (!screencapActive || !selectedDevice) {
      setHasFrame(false);
      return;
    }
    let active = true;
    let objectUrl: string | null = null;
    
    const poll = async () => {
      if (!active) return;
      try {
        const rawBytes = await invoke<number[]>("get_screenshot_raw", { serial: selectedDevice.serial });
        if (active) {
          const bytes = new Uint8Array(rawBytes);
          const blob = new Blob([bytes], { type: "image/png" });
          const newUrl = URL.createObjectURL(blob);
          
          const img = new Image();
          img.src = newUrl;
          img.onload = () => {
            if (!active) {
              URL.revokeObjectURL(newUrl);
              return;
            }
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
            if (objectUrl) {
              URL.revokeObjectURL(objectUrl);
            }
            objectUrl = newUrl;
            setErrorMsg(null);
          };
          
          img.onerror = () => {
            URL.revokeObjectURL(newUrl);
          };
        }
      } catch (err: any) {
        console.error("Failed to capture screenshot", err);
        if (active) {
          setErrorMsg("Screenshot capture failed. Ensure device screen is active and ADB is working.");
        }
      }
      
      // Delay before next frame
      if (active) {
        setTimeout(poll, 200); // 5 FPS fallback (smooth enough and low ADB load)
      }
    };

    poll();
    return () => {
      active = false;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [screencapActive, selectedDevice]);

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

  const launchScrcpy = () => {
    // Command description popup for users
    alert(
      "Native high-framerate scrcpy streaming requires scrcpy to be installed.\n\n" +
      "If you have brew, run:\nbrew install scrcpy\n\n" +
      "To mirror manually from terminal:\nscrcpy -s " + selectedDevice?.serial
    );
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

  const renderMainMirror = () => (
    <div className="card-panel" style={{ flexGrow: 1, height: "100%" }}>
      <div className="panel-header">
        <span className="panel-title">
          <Monitor size={18} />
          Android TV Display Mirror ({resText})
        </span>
        <div style={{ display: "flex", gap: "8px" }}>
          {layoutMode === "workspace" && (
            <button
              className="btn-secondary"
              style={{ padding: "6px 12px" }}
              onClick={launchScrcpy}
              title="Launch native high-framerate scrcpy window"
            >
              Scrcpy
            </button>
          )}
          <button
            className={`btn-primary ${screencapActive ? "btn-secondary" : ""}`}
            style={{
              padding: "6px 12px",
              backgroundColor: screencapActive ? "rgba(221, 2, 0, 0.15)" : "var(--color-accent-primary)"
            }}
            onClick={() => setScreencapActive(!screencapActive)}
          >
            {screencapActive ? (
              <>
                <Square size={14} /> Stop Stream
              </>
            ) : (
              <>
                <Play size={14} /> Start Stream
              </>
            )}
          </button>
        </div>
      </div>

      <div
        className="panel-body flex-center"
        style={{ padding: 0, backgroundColor: "#000", position: "relative" }}
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
              
              {/* Virtual Cursor dot overlay on desktop */}
              {cursorPos.visible && (
                <div
                  style={{
                    position: "absolute",
                    left: cursorPos.x - 6,
                    top: cursorPos.y - 6,
                    width: "12px",
                    height: "12px",
                    borderRadius: "50%",
                    backgroundColor: isPressing ? "var(--color-accent-primary)" : "rgba(221, 2, 0, 0.5)",
                    border: "2px solid #white",
                    pointerEvents: "none",
                    boxShadow: "0 0 6px rgba(0,0,0,0.8)",
                    transition: "transform 0.05s ease",
                    transform: isPressing ? "scale(0.8)" : "scale(1)"
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
          <div className="flex-center" style={{ flexDirection: "column", color: "var(--color-text-muted)", gap: "12px" }}>
            <Monitor size={48} style={{ opacity: 0.3 }} />
            <p>Screen stream is inactive</p>
            <p style={{ fontSize: "12px" }}>Click "Start Stream" above to start base64 image mirroring</p>
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
              borderRadius: "var(--border-radius-md)",
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
              <Cpu size={18} />
              Mirror Settings
            </span>
          </div>
          <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <span style={{ fontSize: "12px", color: "var(--color-text-muted)", fontWeight: 600 }}>NATIVE CONTROL</span>
              <button className="btn-secondary" onClick={launchScrcpy} style={{ width: "100%" }}>
                Launch scrcpy window
              </button>
            </div>
            
            <div
              style={{
                backgroundColor: "rgba(85, 16, 13, 0.15)",
                border: "1px solid var(--color-border)",
                padding: "16px",
                borderRadius: "var(--border-radius-md)",
                fontSize: "12px",
                lineHeight: "1.5",
                color: "var(--color-text-secondary)"
              }}
            >
              <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "8px", fontWeight: "bold", color: "var(--color-text-primary)" }}>
                <Info size={14} />
                <span>Virtual Touchpad Guide</span>
              </div>
              <ul style={{ paddingLeft: "16px", display: "flex", flexDirection: "column", gap: "6px" }}>
                <li><b>Single Click:</b> Triggers raw touch tap at scaled target coordinate.</li>
                <li><b>Drag & Hold:</b> Converts mouse vector swipes to ADB swipe motions.</li>
                <li><b>Red Cursor dot:</b> Tracks pointing location overlays on screen mirroring view.</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
