import React, { useState, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useDeviceStore } from "../store/useDeviceStore";
import { Terminal, Send, Trash2, Download, Play, ChevronRight } from "lucide-react";

export interface ADBTerminalProps {
  layoutMode?: "tab" | "workspace";
}

interface CommandOutput {
  command: string;
  output: string;
  isError: boolean;
  timestamp: string;
}

export const ADBTerminal: React.FC<ADBTerminalProps> = ({ layoutMode = "tab" }) => {
  const { selectedDevice } = useDeviceStore();
  const [commandInput, setCommandInput] = useState("");
  const [history, setHistory] = useState<CommandOutput[]>([]);
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const [isExecuting, setIsExecuting] = useState(false);

  const outputRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [history]);

  const runCommand = async (cmdToRun?: string) => {
    const cmd = cmdToRun !== undefined ? cmdToRun : commandInput;
    if (!cmd.trim() || !selectedDevice || isExecuting) return;

    setIsExecuting(true);
    const timestamp = new Date().toLocaleTimeString();

    // Add to history list for up/down navigation
    setCommandHistory((prev) => [...prev.filter((c) => c !== cmd), cmd]);
    setHistoryIndex(-1);
    if (cmdToRun === undefined) setCommandInput("");

    try {
      const res = await invoke<string>("execute_adb_command", {
        serial: selectedDevice.serial,
        command: cmd,
      });

      setHistory((prev) => [
        ...prev,
        { command: cmd, output: res, isError: false, timestamp },
      ]);
    } catch (err: any) {
      setHistory((prev) => [
        ...prev,
        { command: cmd, output: err.toString(), isError: true, timestamp },
      ]);
    } finally {
      setIsExecuting(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      runCommand();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (commandHistory.length === 0) return;
      const nextIdx = historyIndex < commandHistory.length - 1 ? historyIndex + 1 : historyIndex;
      setHistoryIndex(nextIdx);
      setCommandInput(commandHistory[commandHistory.length - 1 - nextIdx] || "");
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIndex > 0) {
        const nextIdx = historyIndex - 1;
        setHistoryIndex(nextIdx);
        setCommandInput(commandHistory[commandHistory.length - 1 - nextIdx] || "");
      } else if (historyIndex === 0) {
        setHistoryIndex(-1);
        setCommandInput("");
      }
    }
  };

  const exportOutput = () => {
    const text = history
      .map((h) => `[$ ${h.command} - ${h.timestamp}]\n${h.output}`)
      .join("\n\n----------------------------------------\n\n");
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `adb_terminal_${selectedDevice?.serial || "export"}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!selectedDevice) {
    return (
      <div className="flex-center" style={{ flexDirection: "column", height: "100%", color: "var(--color-text-muted)" }}>
        <Terminal size={48} style={{ opacity: 0.3, marginBottom: "16px" }} />
        <h3>No connected device selected</h3>
        <p style={{ fontSize: "12px", marginTop: "4px" }}>Select a device in the Device Manager to launch ADB Terminal Shell</p>
      </div>
    );
  }

  const PRESET_COMMANDS = [
    { label: "List Packages", cmd: "shell pm list packages -3" },
    { label: "Battery Info", cmd: "shell dumpsys battery" },
    { label: "Display Info", cmd: "shell wm size" },
    { label: "OS Build", cmd: "shell getprop ro.build.version.release" },
    { label: "IP Config", cmd: "shell ip addr" },
    { label: "Running Processes", cmd: "shell ps" },
    { label: "Home Screen", cmd: "shell input keyevent 3" },
  ];

  const renderMainTerminal = () => (
    <div className="card-panel" style={{ flexGrow: 1, height: "100%", minHeight: 0 }}>
      <div className="panel-header" style={{ flexShrink: 0 }}>
        <span className="panel-title">
          <Terminal size={18} style={{ color: "var(--color-accent-primary)" }} />
          ADB Terminal Console ({selectedDevice.serial})
        </span>
        <div style={{ display: "flex", gap: "8px" }}>
          <button className="btn-secondary" style={{ padding: "6px 12px" }} onClick={exportOutput}>
            <Download size={14} /> Export Output
          </button>
          <button className="btn-secondary" style={{ padding: "6px 12px" }} onClick={() => setHistory([])}>
            <Trash2 size={14} /> Clear Output
          </button>
        </div>
      </div>

      <div className="panel-body" style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", minHeight: 0, padding: "14px 18px", gap: "12px" }}>
        
        {/* Quick Presets Bar */}
        <div style={{ display: "flex", gap: "8px", overflowX: "auto", flexShrink: 0, paddingBottom: "4px" }}>
          <span style={{ fontSize: "11px", color: "var(--color-text-muted)", alignSelf: "center", fontWeight: 600, flexShrink: 0 }}>PRESETS:</span>
          {PRESET_COMMANDS.map((preset, idx) => (
            <button
              key={idx}
              className="btn-secondary"
              style={{ padding: "4px 10px", fontSize: "11.5px", flexShrink: 0, gap: "4px" }}
              onClick={() => runCommand(preset.cmd)}
            >
              <Play size={11} style={{ color: "var(--color-accent-primary)" }} />
              {preset.label}
            </button>
          ))}
        </div>

        {/* Console Log Terminal Window */}
        <div className="logcat-terminal" style={{ flexGrow: 1, overflowY: "auto", minHeight: 0, gap: "12px" }} ref={outputRef}>
          {history.length === 0 ? (
            <div className="flex-center" style={{ flexGrow: 1, flexDirection: "column", color: "var(--color-text-muted)", gap: "8px" }}>
              <Terminal size={36} style={{ opacity: 0.2 }} />
              <span>Interactive ADB Shell Console Ready</span>
              <span style={{ fontSize: "11px" }}>Type any ADB or shell command below (e.g. <code>shell pm list packages</code>)</span>
            </div>
          ) : (
            history.map((item, i) => (
              <div key={i} style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "var(--color-accent-hover)", fontWeight: 600, fontSize: "12px" }}>
                  <ChevronRight size={14} />
                  <span>$ adb -s {selectedDevice.serial} {item.command}</span>
                  <span style={{ fontSize: "10px", color: "var(--color-text-muted)", marginLeft: "auto" }}>{item.timestamp}</span>
                </div>
                <pre
                  style={{
                    margin: 0,
                    padding: "8px 12px",
                    borderRadius: "var(--border-radius-sm)",
                    backgroundColor: item.isError ? "rgba(239, 68, 68, 0.1)" : "var(--color-surface-card)",
                    border: `1px solid ${item.isError ? "rgba(239, 68, 68, 0.3)" : "var(--color-border)"}`,
                    color: item.isError ? "#f87171" : "var(--color-text-secondary)",
                    fontFamily: "'SF Mono', Consolas, monospace",
                    fontSize: "12px",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-all",
                    lineHeight: "1.5"
                  }}
                >
                  {item.output}
                </pre>
              </div>
            ))
          )}
        </div>

        {/* Input Execution Prompt */}
        <div style={{ display: "flex", gap: "8px", flexShrink: 0, alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", backgroundColor: "var(--color-surface-deep)", border: "1px solid var(--color-border)", borderRadius: "var(--border-radius-sm)", padding: "0 12px", flexGrow: 1 }}>
            <span style={{ color: "var(--color-accent-primary)", fontWeight: 700, fontSize: "13px" }}>$ adb</span>
            <input
              ref={inputRef}
              type="text"
              className="input-field"
              style={{ border: "none", backgroundColor: "transparent", padding: "10px 0" }}
              placeholder="Enter command e.g. shell pm list packages, shell dumpsys, install app.apk..."
              value={commandInput}
              onChange={(e) => setCommandInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isExecuting}
            />
          </div>

          <button
            className="btn-primary"
            style={{ padding: "10px 18px" }}
            onClick={() => runCommand()}
            disabled={isExecuting || !commandInput.trim()}
          >
            <Send size={14} /> Execute
          </button>
        </div>

      </div>
    </div>
  );

  if (layoutMode === "workspace") {
    return renderMainTerminal();
  }

  return (
    <div className="workstation-pane" style={{ flexDirection: "column" }}>
      {renderMainTerminal()}
    </div>
  );
};
