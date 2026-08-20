import React, { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useDeviceStore, LogLine } from "../store/useDeviceStore";
import { Terminal, Trash2, Filter, Download, ArrowDown } from "lucide-react";

export interface LogcatViewerProps {
  layoutMode?: "tab" | "workspace";
}

export const LogcatViewer: React.FC<LogcatViewerProps> = ({ layoutMode = "tab" }) => {
  const {
    selectedDevice,
    logs,
    logcatFilter,
    logcatMinLevel,
    addLogLines,
    clearLogs,
    setLogcatFilter,
    setLogcatMinLevel
  } = useDeviceStore();

  const [autoscroll, setAutoscroll] = useState(true);
  const terminalRef = useRef<HTMLDivElement | null>(null);

  // Bind logcat listener and trigger spawn process with batched log updates
  useEffect(() => {
    if (!selectedDevice) return;

    let active = true;
    let buffer: LogLine[] = [];
    
    const start = async () => {
      try {
        await invoke("start_logcat", { serial: selectedDevice.serial });
      } catch (e) {
        console.error("Logcat start failed", e);
      }
    };

    start();

    // Batch updates every 150ms to prevent high-frequency state updates from freezing React
    const batchInterval = setInterval(() => {
      if (buffer.length > 0 && active) {
        addLogLines(buffer);
        buffer = [];
      }
    }, 150);

    const unlistenPromise = listen<LogLine>("logcat-line", (event) => {
      if (active) {
        buffer.push(event.payload);
      }
    });

    return () => {
      active = false;
      clearInterval(batchInterval);
      invoke("stop_logcat").catch(console.error);
      unlistenPromise.then((unsub) => unsub());
    };
  }, [selectedDevice]);

  // Handle Autoscrolling
  useEffect(() => {
    if (autoscroll && terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [logs, autoscroll]);

  // Log level severity ranks
  const getLevelWeight = (lvl: string) => {
    switch (lvl.toUpperCase()) {
      case "V": return 0;
      case "D": return 1;
      case "I": return 2;
      case "W": return 3;
      case "E": return 4;
      case "F": return 5;
      default: return 0;
    }
  };

  const minWeight = getLevelWeight(logcatMinLevel);

  // Client-side filtering
  const filteredLogs = logs.filter((log) => {
    if (getLevelWeight(log.level) < minWeight) {
      return false;
    }
    
    if (logcatFilter.trim()) {
      const q = logcatFilter.toLowerCase();
      return (
        log.message.toLowerCase().includes(q) ||
        log.tag.toLowerCase().includes(q) ||
        log.pid.toLowerCase().includes(q) ||
        log.raw.toLowerCase().includes(q)
      );
    }
    
    return true;
  });

  const exportLogs = () => {
    const text = filteredLogs.map((l) => `${l.timestamp} [${l.level}] ${l.tag}(${l.pid}): ${l.message}`).join("\n");
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `logcat_${selectedDevice?.serial || "export"}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!selectedDevice) {
    return (
      <div className="flex-center" style={{ flexDirection: "column", height: "100%", color: "var(--color-text-muted)" }}>
        <Terminal size={48} style={{ opacity: 0.3, marginBottom: "16px" }} />
        <h3>No Connected Device Selected</h3>
        <p style={{ fontSize: "12px", marginTop: "4px" }}>Select a device in the Device Manager to begin reading Logcat logs.</p>
      </div>
    );
  }

  const renderMainViewer = () => (
    <div className="card-panel" style={{ flexGrow: 1, height: "100%", minHeight: 0 }}>
      <div className="panel-header" style={{ flexShrink: 0 }}>
        <span className="panel-title">
          <Terminal size={18} />
          Android Logcat Terminal Stream
        </span>
        <div style={{ display: "flex", gap: "10px" }}>
          <button className="btn-secondary" style={{ padding: "6px 12px" }} onClick={exportLogs}>
            <Download size={14} /> Export
          </button>
          <button className="btn-secondary" style={{ padding: "6px 12px" }} onClick={clearLogs}>
            <Trash2 size={14} /> Clear Buffer
          </button>
        </div>
      </div>

      <div className="panel-body logcat-container" style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", minHeight: 0, padding: "16px 20px" }}>
        {/* Controls Bar */}
        <div className="logcat-controls" style={{ flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Filter size={16} style={{ color: "var(--color-text-muted)" }} />
            <select
              className="input-field"
              style={{ width: "130px", padding: "6px 10px" }}
              value={logcatMinLevel}
              onChange={(e) => setLogcatMinLevel(e.target.value)}
            >
              <option value="V">Verbose (V)</option>
              <option value="D">Debug (D)</option>
              <option value="I">Info (I)</option>
              <option value="W">Warning (W)</option>
              <option value="E">Error (E)</option>
              <option value="F">Fatal (F)</option>
            </select>
          </div>

          <div style={{ flexGrow: 1 }}>
            <input
              type="text"
              className="input-field"
              style={{ padding: "6px 12px" }}
              placeholder="Filter logs by tag, PID, message content..."
              value={logcatFilter}
              onChange={(e) => setLogcatFilter(e.target.value)}
            />
          </div>

          <div
            className="switch-container"
            onClick={() => setAutoscroll(!autoscroll)}
            style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}
          >
            <ArrowDown size={14} style={{ color: autoscroll ? "var(--color-accent-primary)" : "var(--color-text-muted)" }} />
            <span>Autoscroll</span>
            <div className={`switch-track ${autoscroll ? "on" : ""}`} style={{ width: "30px", height: "16px" }}>
              <div className="switch-thumb" style={{ width: "10px", height: "10px", top: "2px", left: "2px" }} />
            </div>
          </div>
        </div>

        {/* Terminal Screen Output */}
        <div className="logcat-terminal" style={{ flexGrow: 1, overflowY: "auto", minHeight: 0 }} ref={terminalRef}>
          {filteredLogs.length === 0 ? (
            <div className="flex-center" style={{ flexGrow: 1, color: "var(--color-text-muted)" }}>
              No matching logs captured. Streaming...
            </div>
          ) : (
            filteredLogs.map((log, i) => (
              <div key={i} className="logcat-line">
                <span className="logcat-meta">[{log.timestamp}]</span>
                <span className={`logcat-meta level-${log.level}`}>{log.level}</span>
                {log.tag && (
                  <span className="logcat-tag">
                    {log.tag}({log.pid}):
                  </span>
                )}
                <span className={`logcat-text level-${log.level}`}>{log.message}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );

  if (layoutMode === "workspace") {
    return renderMainViewer();
  }

  return (
    <div className="workstation-pane" style={{ flexDirection: "column", paddingBottom: "12px" }}>
      {renderMainViewer()}
    </div>
  );
};
