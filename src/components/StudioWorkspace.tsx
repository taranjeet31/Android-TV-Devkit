import React, { useState, useRef } from "react";
import { useDeviceStore } from "../store/useDeviceStore";
import { ScreenMirror } from "./ScreenMirror";
import { VirtualRemote } from "./VirtualRemote";
import { LogcatViewer } from "./LogcatViewer";
import { NetworkInspector } from "./NetworkInspector";
import { 
  LayoutGrid, 
  Monitor, 
  Keyboard, 
  Radio, 
  Terminal, 
  Maximize2, 
  Minimize2, 
  X,
  RefreshCw,
  Cpu
} from "lucide-react";

interface WindowContainerProps {
  title: string;
  icon: React.ReactNode;
  onClose: () => void;
  onMaximize: () => void;
  isMaximized: boolean;
  children: React.ReactNode;
}

const WindowContainer: React.FC<WindowContainerProps> = ({ title, icon, onClose, onMaximize, isMaximized, children }) => {
  return (
    <div className="workspace-window card-panel" style={{ height: "100%", flexGrow: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
      <div className="panel-header" style={{ padding: "6px 14px", minHeight: "36px" }}>
        <span className="panel-title" style={{ fontSize: "12px", gap: "6px", fontWeight: 600 }}>
          {icon}
          {title}
        </span>
        <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
          <button 
            type="button"
            className="btn-secondary" 
            style={{ padding: "2px 6px", fontSize: "10px", display: "flex", alignItems: "center", gap: "2px" }}
            onClick={onMaximize}
            title={isMaximized ? "Restore Grid" : "Maximize Panel"}
          >
            {isMaximized ? <Minimize2 size={11} /> : <Maximize2 size={11} />}
          </button>
          <button 
            type="button"
            className="btn-secondary" 
            style={{ padding: "2px 6px", fontSize: "10px", color: "var(--color-error)" }}
            onClick={onClose}
            title="Hide Panel"
          >
            <X size={11} />
          </button>
        </div>
      </div>
      <div style={{ flexGrow: 1, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {children}
      </div>
    </div>
  );
};

export const StudioWorkspace: React.FC = () => {
  const { selectedDevice } = useDeviceStore();
  
  // Visibility States
  const [mirrorVisible, setMirrorVisible] = useState(true);
  const [remoteVisible, setRemoteVisible] = useState(true);
  const [networkVisible, setNetworkVisible] = useState(true);
  const [logcatVisible, setLogcatVisible] = useState(true);
  
  // Maximized Window State
  const [maximizedWindow, setMaximizedWindow] = useState<string | null>(null);

  // Layout Resizer States (percentages)
  const [topHeight, setTopHeight] = useState(55);
  const [colWidth2, setColWidth2] = useState(50);
  const [colWidths3, setColWidths3] = useState([35, 25]);

  // Active dragging ref indicator
  const [draggingResizer, setDraggingResizer] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);

  if (!selectedDevice) {
    return (
      <div className="flex-center" style={{ flexDirection: "column", height: "100%", color: "var(--color-text-muted)", gap: "16px" }}>
        <Cpu size={48} style={{ opacity: 0.3 }} />
        <h3>No Connected Device Selected</h3>
        <p style={{ fontSize: "12px" }}>Select a device in the Devices Manager to launch the Studio Workspace Console.</p>
      </div>
    );
  }

  const handlePointerDown = (resizerKey: string, e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setDraggingResizer(resizerKey);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    e.currentTarget.releasePointerCapture(e.pointerId);
    setDraggingResizer(null);
  };

  const handleRowResizeMove = (e: React.PointerEvent) => {
    if (draggingResizer !== "row" || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const relativeY = e.clientY - rect.top;
    const percentY = (relativeY / rect.height) * 100;
    setTopHeight(Math.max(20, Math.min(80, percentY)));
  };

  const handleCol2ResizeMove = (e: React.PointerEvent) => {
    if (draggingResizer !== "col2" || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const relativeX = e.clientX - rect.left;
    const percentX = (relativeX / rect.width) * 100;
    setColWidth2(Math.max(20, Math.min(80, percentX)));
  };

  const handleCol3_1ResizeMove = (e: React.PointerEvent) => {
    if (draggingResizer !== "col3-1" || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const relativeX = e.clientX - rect.left;
    const percentX = (relativeX / rect.width) * 100;

    const sum = colWidths3[0] + colWidths3[1];
    const newMirror = Math.max(15, Math.min(sum - 15, percentX));
    const newRemote = sum - newMirror;
    setColWidths3([newMirror, newRemote]);
  };

  const handleCol3_2ResizeMove = (e: React.PointerEvent) => {
    if (draggingResizer !== "col3-2" || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const relativeX = e.clientX - rect.left;
    const percentX = (relativeX / rect.width) * 100;

    const newRemote = Math.max(15, Math.min(85 - colWidths3[0], percentX - colWidths3[0]));
    setColWidths3([colWidths3[0], newRemote]);
  };

  const handleMaximizeToggle = (windowKey: string) => {
    if (maximizedWindow === windowKey) {
      setMaximizedWindow(null);
    } else {
      setMaximizedWindow(windowKey);
    }
  };

  const handleResetWorkspace = () => {
    setMirrorVisible(true);
    setRemoteVisible(true);
    setNetworkVisible(true);
    setLogcatVisible(true);
    setMaximizedWindow(null);
    setTopHeight(55);
    setColWidth2(50);
    setColWidths3([35, 25]);
  };

  const renderPanel = (key: string) => {
    switch (key) {
      case "mirror":
        return (
          <WindowContainer
            title="Screen Mirroring"
            icon={<Monitor size={14} style={{ color: "var(--color-accent-primary)" }} />}
            isMaximized={maximizedWindow === "mirror"}
            onMaximize={() => handleMaximizeToggle("mirror")}
            onClose={() => setMirrorVisible(false)}
          >
            <ScreenMirror layoutMode="workspace" />
          </WindowContainer>
        );
      case "remote":
        return (
          <WindowContainer
            title="Remote Controls"
            icon={<Keyboard size={14} style={{ color: "var(--color-accent-primary)" }} />}
            isMaximized={maximizedWindow === "remote"}
            onMaximize={() => handleMaximizeToggle("remote")}
            onClose={() => setRemoteVisible(false)}
          >
            <VirtualRemote layoutMode="workspace" />
          </WindowContainer>
        );
      case "network":
        return (
          <WindowContainer
            title="Network Interceptor"
            icon={<Radio size={14} style={{ color: "var(--color-accent-primary)" }} />}
            isMaximized={maximizedWindow === "network"}
            onMaximize={() => handleMaximizeToggle("network")}
            onClose={() => setNetworkVisible(false)}
          >
            <NetworkInspector layoutMode="workspace" />
          </WindowContainer>
        );
      case "logcat":
        return (
          <WindowContainer
            title="Logcat Streamer"
            icon={<Terminal size={14} style={{ color: "var(--color-accent-primary)" }} />}
            isMaximized={maximizedWindow === "logcat"}
            onMaximize={() => handleMaximizeToggle("logcat")}
            onClose={() => setLogcatVisible(false)}
          >
            <LogcatViewer layoutMode="workspace" />
          </WindowContainer>
        );
      default:
        return null;
    }
  };

  // Render Maximized Pane if any
  if (maximizedWindow) {
    return (
      <div className="workspace-main" style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 48px)", padding: "16px", boxSizing: "border-box" }}>
        <div style={{ flexGrow: 1, minHeight: 0 }}>
          {renderPanel(maximizedWindow)}
        </div>
      </div>
    );
  }

  // Count active panels in Top Row
  const topRowActiveCount = [mirrorVisible, remoteVisible, networkVisible].filter(Boolean).length;
  const showTopRow = topRowActiveCount > 0;
  const showBottomRow = logcatVisible;

  const renderTopRowContents = () => {
    const visibleKeys = [];
    if (mirrorVisible) visibleKeys.push("mirror");
    if (remoteVisible) visibleKeys.push("remote");
    if (networkVisible) visibleKeys.push("network");

    if (visibleKeys.length === 1) {
      return (
        <div style={{ width: "100%", height: "100%" }}>
          {renderPanel(visibleKeys[0])}
        </div>
      );
    }

    if (visibleKeys.length === 2) {
      const k1 = visibleKeys[0];
      const k2 = visibleKeys[1];
      return (
        <>
          <div style={{ width: `${colWidth2}%`, height: "100%", minWidth: 0 }}>
            {renderPanel(k1)}
          </div>
          <div
            className="workspace-resizer-v"
            onPointerDown={(e) => handlePointerDown("col2", e)}
            onPointerUp={handlePointerUp}
            onPointerMove={handleCol2ResizeMove}
          />
          <div style={{ width: `calc(${100 - colWidth2}% - 12px)`, height: "100%", minWidth: 0 }}>
            {renderPanel(k2)}
          </div>
        </>
      );
    }

    if (visibleKeys.length === 3) {
      return (
        <>
          <div style={{ width: `${colWidths3[0]}%`, height: "100%", minWidth: 0 }}>
            {renderPanel("mirror")}
          </div>
          <div
            className="workspace-resizer-v"
            onPointerDown={(e) => handlePointerDown("col3-1", e)}
            onPointerUp={handlePointerUp}
            onPointerMove={handleCol3_1ResizeMove}
          />
          <div style={{ width: `${colWidths3[1]}%`, height: "100%", minWidth: 0 }}>
            {renderPanel("remote")}
          </div>
          <div
            className="workspace-resizer-v"
            onPointerDown={(e) => handlePointerDown("col3-2", e)}
            onPointerUp={handlePointerUp}
            onPointerMove={handleCol3_2ResizeMove}
          />
          <div style={{ width: `calc(${100 - colWidths3[0] - colWidths3[1]}% - 24px)`, height: "100%", minWidth: 0 }}>
            {renderPanel("network")}
          </div>
        </>
      );
    }

    return null;
  };

  return (
    <div className="workspace-main" style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 48px)", padding: "16px", boxSizing: "border-box", gap: "12px", overflow: "hidden" }}>
      {/* Workspace Header Toolbar */}
      <header className="workspace-toolbar" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", borderRadius: "var(--border-radius-md)", backgroundColor: "var(--color-surface-deep)", border: "1px solid var(--color-border)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <LayoutGrid size={16} style={{ color: "var(--color-accent-primary)" }} />
          <span style={{ fontWeight: 700, fontSize: "13px" }}>Studio Workspace Grid</span>
        </div>

        {/* Panel Visibility Checkboxes */}
        <div style={{ display: "flex", alignItems: "center", gap: "16px", fontSize: "11px" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", userSelect: "none" }}>
            <input 
              type="checkbox" 
              checked={mirrorVisible} 
              onChange={(e) => setMirrorVisible(e.target.checked)} 
              style={{ accentColor: "var(--color-accent-primary)" }}
            />
            <span>Mirror</span>
          </label>
          
          <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", userSelect: "none" }}>
            <input 
              type="checkbox" 
              checked={remoteVisible} 
              onChange={(e) => setRemoteVisible(e.target.checked)} 
              style={{ accentColor: "var(--color-accent-primary)" }}
            />
            <span>Remote</span>
          </label>

          <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", userSelect: "none" }}>
            <input 
              type="checkbox" 
              checked={networkVisible} 
              onChange={(e) => setNetworkVisible(e.target.checked)} 
              style={{ accentColor: "var(--color-accent-primary)" }}
            />
            <span>Network</span>
          </label>

          <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", userSelect: "none" }}>
            <input 
              type="checkbox" 
              checked={logcatVisible} 
              onChange={(e) => setLogcatVisible(e.target.checked)} 
              style={{ accentColor: "var(--color-accent-primary)" }}
            />
            <span>Logcat</span>
          </label>

          <button 
            type="button"
            className="btn-secondary" 
            style={{ padding: "4px 8px", fontSize: "10px", display: "flex", alignItems: "center", gap: "4px", marginLeft: "8px" }} 
            onClick={handleResetWorkspace}
          >
            <RefreshCw size={10} /> Reset
          </button>
        </div>
      </header>

      {/* Panels Layout Container */}
      <div ref={containerRef} style={{ flexGrow: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
        {/* Top Row Layout */}
        {showTopRow && (
          <div 
            style={{ 
              height: showBottomRow ? `${topHeight}%` : "100%", 
              display: "flex", 
              minHeight: 0
            }}
          >
            {renderTopRowContents()}
          </div>
        )}

        {/* Row Resizer */}
        {showTopRow && showBottomRow && (
          <div
            className="workspace-resizer-h"
            onPointerDown={(e) => handlePointerDown("row", e)}
            onPointerUp={handlePointerUp}
            onPointerMove={handleRowResizeMove}
          />
        )}

        {/* Bottom Row Layout (Logcat) */}
        {showBottomRow && (
          <div 
            style={{ 
              height: showTopRow ? `calc(${100 - topHeight}% - 12px)` : "100%", 
              minHeight: 0
            }}
          >
            {renderPanel("logcat")}
          </div>
        )}

        {!showTopRow && !showBottomRow && (
          <div className="flex-center" style={{ flexDirection: "column", flexGrow: 1, color: "var(--color-text-muted)" }}>
            <p>All Workspace panels are hidden.</p>
            <button 
              type="button" 
              className="btn-secondary" 
              style={{ marginTop: "12px" }} 
              onClick={handleResetWorkspace}
            >
              Restore Panels
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
