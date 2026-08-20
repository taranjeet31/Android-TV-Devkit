import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Radio, Trash2, Wifi, ShieldCheck, Play, Square, Info } from "lucide-react";
import { useDeviceStore, NetworkRequest } from "../store/useDeviceStore";

export interface NetworkInspectorProps {
  layoutMode?: "tab" | "workspace";
}

export const NetworkInspector: React.FC<NetworkInspectorProps> = ({ layoutMode = "tab" }) => {
  const {
    selectedDevice,
    networkRequests,
    selectedRequest,
    activeProxyPort,
    proxyEnabled,
    localHostIp,
    addNetworkRequest,
    setSelectedRequest,
    clearNetworkRequests,
    setProxyEnabled,
    setProxyPort,
    setHostIp
  } = useDeviceStore();

  const [portInput, setPortInput] = useState(8090);
  const [proxyActionMessage, setProxyActionMessage] = useState<string | null>(null);

  // Initialize and check host IP / active proxy
  const initializeProxyState = async () => {
    try {
      const ip = await invoke<string>("get_host_ip");
      setHostIp(ip);

      const activePort = await invoke<number | null>("get_active_proxy_port");
      if (activePort) {
        setProxyPort(activePort);
        setProxyEnabled(true);
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    initializeProxyState();
  }, []);

  // Listen to incoming network requests from the proxy
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    
    const setupListener = async () => {
      const unsub = await listen<NetworkRequest>("network-request", (event) => {
        addNetworkRequest(event.payload);
      });
      unlisten = unsub;
    };
    
    setupListener();
    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  const handleStartProxy = async () => {
    try {
      await invoke("start_proxy", { port: portInput });
      setProxyPort(portInput);
      setProxyEnabled(true);
      setProxyActionMessage(`HTTP/TCP proxy server started on port ${portInput}`);

      // Auto-route target device if selected
      if (selectedDevice) {
        await invoke("enable_device_proxy", {
          serial: selectedDevice.serial,
          proxyIp: localHostIp,
          proxyPort: portInput
        });
        setProxyActionMessage(`Proxy started on port ${portInput} and configured on device ${selectedDevice.name}`);
      }
    } catch (err: any) {
      setProxyActionMessage(`Failed to start proxy: ${err.toString()}`);
    }
  };

  const handleStopProxy = async () => {
    try {
      await invoke("stop_proxy");
      
      if (selectedDevice) {
        await invoke("disable_device_proxy", { serial: selectedDevice.serial });
      }
      
      setProxyPort(null);
      setProxyEnabled(false);
      setProxyActionMessage("Proxy server stopped. Device proxy settings cleared.");
    } catch (err: any) {
      setProxyActionMessage(`Failed to stop proxy: ${err.toString()}`);
    }
  };

  // Re-route if device changes while proxy is active
  useEffect(() => {
    if (proxyEnabled && activeProxyPort && selectedDevice) {
      invoke("enable_device_proxy", {
        serial: selectedDevice.serial,
        proxyIp: localHostIp,
        proxyPort: activeProxyPort
      }).catch(console.error);
    }
  }, [selectedDevice]);

  const renderDetailsContent = () => {
    if (!selectedRequest) return null;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "14px", fontSize: "12px", height: "100%", overflowY: "auto", borderLeft: "1px solid var(--color-border)", paddingLeft: "16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--color-border)", paddingBottom: "6px" }}>
          <span style={{ fontWeight: "bold", fontSize: "12px", color: "var(--color-text-primary)" }}>Transaction Details</span>
          <button
            className="btn-secondary"
            style={{ padding: "2px 6px", fontSize: "10px" }}
            onClick={() => setSelectedRequest(null)}
          >
            Close
          </button>
        </div>
        <div>
          <span style={{ display: "block", color: "var(--color-text-muted)", fontSize: "10px", textTransform: "uppercase" }}>HTTP Method</span>
          <span style={{ fontWeight: "bold", color: "var(--color-accent-primary)", fontSize: "13px" }}>
            {selectedRequest.method}
          </span>
        </div>
        <div>
          <span style={{ display: "block", color: "var(--color-text-muted)", fontSize: "10px", textTransform: "uppercase" }}>Target Host</span>
          <span style={{ fontWeight: "500", fontFamily: "monospace" }}>
            {selectedRequest.host}:{selectedRequest.port}
          </span>
        </div>
        <div>
          <span style={{ display: "block", color: "var(--color-text-muted)", fontSize: "10px", textTransform: "uppercase" }}>URL Target</span>
          <span style={{ wordBreak: "break-all", fontFamily: "monospace", fontSize: "11px" }}>
            {selectedRequest.url}
          </span>
        </div>
        <div>
          <span style={{ display: "block", color: "var(--color-text-muted)", fontSize: "10px", textTransform: "uppercase" }}>Response Status</span>
          <span style={{ fontWeight: "bold" }}>{selectedRequest.status}</span>
        </div>
        <div>
          <span style={{ display: "block", color: "var(--color-text-muted)", fontSize: "10px", textTransform: "uppercase" }}>Duration</span>
          <span>{selectedRequest.duration_ms} ms</span>
        </div>
        <div>
          <span style={{ display: "block", color: "var(--color-text-muted)", fontSize: "10px", textTransform: "uppercase" }}>Size</span>
          <span>{(selectedRequest.size_bytes / 1024).toFixed(3)} KB</span>
        </div>
        <div>
          <span style={{ display: "block", color: "var(--color-text-muted)", fontSize: "10px", textTransform: "uppercase" }}>Timestamp</span>
          <span>{new Date(selectedRequest.timestamp * 1000).toLocaleTimeString()}</span>
        </div>
      </div>
    );
  };

  const renderMainInspector = () => (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: "16px", flexGrow: 1, minHeight: 0 }}>
      <div className="card-panel" style={{ flexGrow: 1, height: "0" }}>
        <div className="panel-header">
          <span className="panel-title">
            <Radio size={18} className={proxyEnabled ? "logo-icon" : ""} />
            HTTP Proxy Traffic Inspector
          </span>
          <div style={{ display: "flex", gap: "8px" }}>
            <button className="btn-secondary" style={{ padding: "6px 12px" }} onClick={clearNetworkRequests}>
              <Trash2 size={14} />
              Clear Logs
            </button>
          </div>
        </div>

        <div className="panel-body flex-center" style={{ padding: 0, flexDirection: "column", justifyContent: "flex-start", height: "100%" }}>
          {networkRequests.length === 0 ? (
            <div className="flex-center" style={{ flexDirection: "column", height: "100%", color: "var(--color-text-muted)", gap: "12px", padding: "40px" }}>
              <Radio size={48} style={{ opacity: 0.3 }} />
              <h3>No Network Requests Captured</h3>
              <p style={{ fontSize: "12px" }}>Enable the proxy server below to intercept Android TV HTTP call streams.</p>
            </div>
          ) : (
            <div style={{ display: "flex", width: "100%", height: "100%", padding: "16px", gap: "16px", overflow: "hidden" }}>
              <div style={{ flex: (selectedRequest && layoutMode === "workspace") ? 1.4 : 1, height: "100%", overflowY: "auto" }}>
                <div className="network-table-wrapper" style={{ height: "100%" }}>
                  <table className="network-table">
                    <thead>
                      <tr>
                        <th>Method</th>
                        <th>Host</th>
                        <th>Status</th>
                        <th>Duration</th>
                        <th>Size</th>
                      </tr>
                    </thead>
                    <tbody>
                      {networkRequests.map((req) => {
                        const isSelected = selectedRequest?.id === req.id;
                        let badgeClass = "badge-info";
                        if (req.status === "Completed") badgeClass = "badge-success";
                        if (req.status === "Failed") badgeClass = "badge-error";

                        return (
                          <tr
                            key={req.id}
                            className={isSelected ? "selected" : ""}
                            onClick={() => setSelectedRequest(req)}
                            style={{ cursor: "pointer" }}
                          >
                            <td style={{ fontWeight: "bold" }}>{req.method}</td>
                            <td style={{ maxWidth: "200px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {req.url}
                            </td>
                            <td>
                              <span className={`badge ${badgeClass}`}>{req.status}</span>
                            </td>
                            <td>{req.duration_ms} ms</td>
                            <td>{(req.size_bytes / 1024).toFixed(2)} KB</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
              {selectedRequest && layoutMode === "workspace" && (
                <div style={{ flex: 1, height: "100%", overflowY: "auto" }}>
                  {renderDetailsContent()}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Proxy control card */}
      <div className="card-panel" style={{ flexShrink: 0 }}>
        <div className="panel-header">
          <span className="panel-title">
            <Wifi size={18} />
            HTTP Intercept Proxy Server
          </span>
        </div>
        <div className="panel-body" style={{ padding: "14px 20px" }}>
          <div style={{ display: "flex", gap: "16px", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", gap: "24px" }}>
              <div>
                <span style={{ display: "block", fontSize: "11px", color: "var(--color-text-muted)" }}>HOST WORKSTATION IP</span>
                <span style={{ fontWeight: "bold", fontSize: "14px" }}>{localHostIp || "Resolving..."}</span>
              </div>
              
              <div>
                <span style={{ display: "block", fontSize: "11px", color: "var(--color-text-muted)" }}>PROXY STATUS</span>
                <span
                  style={{
                    fontWeight: "bold",
                    fontSize: "14px",
                    color: proxyEnabled ? "var(--color-success)" : "var(--color-text-muted)"
                  }}
                >
                  {proxyEnabled ? `ACTIVE ON PORT ${activeProxyPort}` : "OFFLINE"}
                </span>
              </div>
            </div>

            <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
              {!proxyEnabled && (
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>Port</span>
                  <input
                    type="number"
                    className="input-field"
                    style={{ width: "80px", padding: "6px 10px" }}
                    value={portInput}
                    onChange={(e) => setPortInput(parseInt(e.target.value) || 8090)}
                  />
                </div>
              )}

              {proxyEnabled ? (
                <button className="btn-secondary" style={{ borderColor: "var(--color-accent-primary)", color: "var(--color-accent-primary)", padding: "6px 12px" }} onClick={handleStopProxy}>
                  <Square size={12} /> Stop Intercept
                </button>
              ) : (
                <button className="btn-primary" style={{ padding: "6px 12px" }} onClick={handleStartProxy}>
                  <Play size={12} /> Start Intercept
                </button>
              )}
            </div>
          </div>

          {proxyActionMessage && (
            <div
              style={{
                marginTop: "12px",
                fontSize: "12px",
                color: "var(--color-text-secondary)",
                backgroundColor: "rgba(0,0,0,0.1)",
                padding: "8px 12px",
                borderRadius: "var(--border-radius-sm)",
                borderLeft: "3px solid var(--color-accent-primary)"
              }}
            >
              {proxyActionMessage}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  if (layoutMode === "workspace") {
    return renderMainInspector();
  }

  return (
    <div className="workstation-pane">
      <div className="panel-left">
        {renderMainInspector()}
      </div>

      {/* Details pane on the right */}
      <div className="panel-right">
        <div className="card-panel" style={{ height: "100%" }}>
          <div className="panel-header">
            <span className="panel-title">
              <ShieldCheck size={18} />
              Transaction Inspector
            </span>
          </div>
          <div className="panel-body">
            {selectedRequest ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "16px", fontSize: "13px" }}>
                <div>
                  <span style={{ display: "block", color: "var(--color-text-muted)", fontSize: "11px" }}>HTTP METHOD</span>
                  <span style={{ fontWeight: "bold", color: "var(--color-accent-primary)", fontSize: "16px" }}>
                    {selectedRequest.method}
                  </span>
                </div>
                
                <div>
                  <span style={{ display: "block", color: "var(--color-text-muted)", fontSize: "11px" }}>TARGET HOST</span>
                  <span style={{ fontWeight: "500", fontFamily: "monospace" }}>
                    {selectedRequest.host}:{selectedRequest.port}
                  </span>
                </div>

                <div>
                  <span style={{ display: "block", color: "var(--color-text-muted)", fontSize: "11px" }}>URL TARGET</span>
                  <span style={{ wordBreak: "break-all", fontFamily: "monospace", fontSize: "12px" }}>
                    {selectedRequest.url}
                  </span>
                </div>

                <div>
                  <span style={{ display: "block", color: "var(--color-text-muted)", fontSize: "11px" }}>RESPONSE STATUS</span>
                  <span style={{ fontWeight: "bold" }}>{selectedRequest.status}</span>
                </div>

                <div>
                  <span style={{ display: "block", color: "var(--color-text-muted)", fontSize: "11px" }}>ROUNDTRIP DURATION</span>
                  <span>{selectedRequest.duration_ms} ms</span>
                </div>

                <div>
                  <span style={{ display: "block", color: "var(--color-text-muted)", fontSize: "11px" }}>BANDWIDTH DATA</span>
                  <span>{(selectedRequest.size_bytes / 1024).toFixed(3)} KB ({selectedRequest.size_bytes} bytes)</span>
                </div>

                <div>
                  <span style={{ display: "block", color: "var(--color-text-muted)", fontSize: "11px" }}>TIMESTAMP</span>
                  <span>{new Date(selectedRequest.timestamp * 1000).toLocaleTimeString()}</span>
                </div>
              </div>
            ) : (
              <div className="flex-center" style={{ flexDirection: "column", height: "100%", color: "var(--color-text-muted)", textAlign: "center" }}>
                <Info size={36} style={{ opacity: 0.2, marginBottom: "8px" }} />
                <p>No Request Selected</p>
                <p style={{ fontSize: "12px" }}>Select an intercepted HTTP connection to inspect its complete parameters.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
