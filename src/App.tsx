import { useState } from "react";
import { useDeviceStore } from "./store/useDeviceStore";
import { DeviceManager } from "./components/DeviceManager";
import { VirtualRemote } from "./components/VirtualRemote";
import { KeyboardMapper } from "./components/KeyboardMapper";
import { ScreenMirror } from "./components/ScreenMirror";
import { NetworkInspector } from "./components/NetworkInspector";
import { LogcatViewer } from "./components/LogcatViewer";
import { StudioWorkspace } from "./components/StudioWorkspace";
import { MouseCapture } from "./components/MouseCapture";
import {
  Tv,
  Keyboard,
  Settings,
  Monitor,
  Radio,
  Terminal,
  Cpu,
  Wifi,
  CloudLightning,
  LayoutGrid,
  MousePointer,
  Unlock,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import "./App.css";

function App() {
  const { activeTab, setActiveTab, selectedDevice, proxyEnabled, activeProxyPort, captureActive } = useDeviceStore();
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  const renderActivePanel = () => {
    switch (activeTab) {
      case "devices":
        return <DeviceManager />;
      case "workspace":
        return <StudioWorkspace />;
      case "remote":
        return <VirtualRemote />;
      case "profiles":
        return <KeyboardMapper />;
      case "screen":
        return <ScreenMirror />;
      case "network":
        return <NetworkInspector />;
      case "logs":
        return <LogcatViewer />;
      case "mouse":
        return <MouseCapture />;
      default:
        return <DeviceManager />;
    }
  };

  return (
    <div className="app-container">
      {/* Workspace Sidebar */}
      <aside className={`sidebar ${isSidebarCollapsed ? "collapsed" : ""}`}>
        <div className="sidebar-header">
          <div style={{ display: "flex", alignItems: "center", gap: "12px", overflow: "hidden", flexGrow: 1 }}>
            <svg
              className="logo-icon"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect width="20" height="15" x="2" y="7" rx="2" ry="2" />
              <polyline points="17 2 12 7 7 2" />
            </svg>
            {!isSidebarCollapsed && <span className="app-title">TVDev Studio</span>}
          </div>

          <button
            className="sidebar-toggle-btn"
            onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
            title={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {isSidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
        </div>

        <nav className="nav-menu">
          <span className="sidebar-section-title">Device Station</span>
          <div
            className={`nav-item ${activeTab === "devices" ? "active" : ""}`}
            onClick={() => setActiveTab("devices")}
            title="Devices Manager"
          >
            <Tv />
            <span>Devices Manager</span>
          </div>
          <div
            className={`nav-item ${activeTab === "workspace" ? "active" : ""}`}
            onClick={() => setActiveTab("workspace")}
            title="Studio Workspace"
          >
            <LayoutGrid />
            <span>Studio Workspace</span>
          </div>

          <span className="sidebar-section-title">Input Controls</span>
          <div
            className={`nav-item ${activeTab === "remote" ? "active" : ""}`}
            onClick={() => setActiveTab("remote")}
            title="Virtual Remote"
          >
            <Keyboard />
            <span>Virtual Remote</span>
          </div>
          <div
            className={`nav-item ${activeTab === "profiles" ? "active" : ""}`}
            onClick={() => setActiveTab("profiles")}
            title="Keyboard Profiles"
          >
            <Settings />
            <span>Keyboard Profiles</span>
          </div>
          <div
            className={`nav-item ${activeTab === "mouse" ? "active" : ""}`}
            onClick={() => setActiveTab("mouse")}
            title="Mouse Capture"
            style={{ position: "relative" }}
          >
            <MousePointer />
            <span>Mouse Capture</span>
            {captureActive && (
              <span className="nav-capture-dot" title="Capture active" />
            )}
          </div>

          <span className="sidebar-section-title">Display Studio</span>
          <div
            className={`nav-item ${activeTab === "screen" ? "active" : ""}`}
            onClick={() => setActiveTab("screen")}
            title="Screen Mirroring"
          >
            <Monitor />
            <span>Screen Mirroring</span>
          </div>

          <span className="sidebar-section-title">Debug Suite</span>
          <div
            className={`nav-item ${activeTab === "network" ? "active" : ""}`}
            onClick={() => setActiveTab("network")}
            title="Network Inspector"
          >
            <Radio />
            <span>Network Inspector</span>
          </div>
          <div
            className={`nav-item ${activeTab === "logs" ? "active" : ""}`}
            onClick={() => setActiveTab("logs")}
            title="Logcat Streamer"
          >
            <Terminal />
            <span>Logcat Streamer</span>
          </div>
        </nav>

        <div className="sidebar-footer">
          <div style={{ display: "flex", gap: "8px", alignItems: "center", fontSize: "11px", color: "var(--color-text-muted)" }}>
            <CloudLightning size={12} className="logo-icon" />
            {!isSidebarCollapsed && <span>v0.9 — Mouse KVM Ready</span>}
          </div>
        </div>
      </aside>

      {/* Main Workspace Frame */}
      <main className="main-content">
        {/* Top Status Bar */}
        <header className="status-bar">
          <div className="status-group">
            <div className="status-indicator">
              <span className="device-label">Target:</span>
              {selectedDevice ? (
                <span style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: "6px", color: "var(--color-text-primary)" }}>
                  {selectedDevice.connection_type === "wifi" ? <Wifi size={13} style={{ color: "var(--color-success)" }} /> : <Cpu size={13} />}
                  {selectedDevice.name} ({selectedDevice.serial})
                </span>
              ) : (
                <span style={{ color: "var(--color-text-muted)", fontStyle: "italic" }}>No active device connection</span>
              )}
            </div>
          </div>

          <div className="status-group">
            {proxyEnabled && activeProxyPort && (
              <span className="badge badge-success" style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <Radio size={11} />
                Network Proxy Active (:{activeProxyPort})
              </span>
            )}
            
            {selectedDevice && (
              <span className={`badge ${selectedDevice.status === "device" ? "badge-success" : "badge-error"}`}>
                ADB {selectedDevice.status.toUpperCase()}
              </span>
            )}
          </div>
        </header>

        {/* Content View */}
        <div style={{ flexGrow: 1, overflow: "hidden", position: "relative" }}>
          {renderActivePanel()}

          {/* Capture HUD — floats over content when active */}
          {captureActive && (
            <div className="capture-hud">
              <div className="capture-hud-pulse" />
              <Unlock size={12} />
              <span>Controlling TV — Press <kbd>⌘⇧L</kbd> to release mouse</span>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default App;
