import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useDeviceStore, DeviceInfo } from "../store/useDeviceStore";
import { RefreshCw, Tv, Wifi, WifiOff, Cpu, Info, CheckCircle, AlertTriangle } from "lucide-react";

export const DeviceManager: React.FC = () => {
  const { devices, selectedDevice, setDevices, setSelectedDevice } = useDeviceStore();
  const [ipAddress, setIpAddress] = useState("");
  const [port, setPort] = useState(5555);
  const [connecting, setConnecting] = useState(false);
  const [connMessage, setConnMessage] = useState<{ text: string; error: boolean } | null>(null);

  const scan = async () => {
    try {
      const list = await invoke<DeviceInfo[]>("scan_devices");
      setDevices(list);
      
      // Keep selected device updated if it's still attached
      if (selectedDevice) {
        const found = list.find((d) => d.serial === selectedDevice.serial);
        if (found) {
          setSelectedDevice(found);
        } else {
          setSelectedDevice(null);
        }
      } else if (list.length > 0) {
        setSelectedDevice(list[0]);
      }
    } catch (e) {
      console.error("Failed to scan devices", e);
    }
  };

  useEffect(() => {
    scan();
    const interval = setInterval(scan, 8000);
    return () => clearInterval(interval);
  }, [selectedDevice]);

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ipAddress.trim()) return;

    setConnecting(true);
    setConnMessage(null);
    try {
      const res = await invoke<string>("connect_device", { ip: ipAddress, port });
      if (res.includes("connected to")) {
        setConnMessage({ text: `Successfully connected to ${ipAddress}:${port}`, error: false });
        setIpAddress("");
        scan();
      } else {
        setConnMessage({ text: res, error: true });
      }
    } catch (err: any) {
      setConnMessage({ text: err.toString(), error: true });
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async (serial: string) => {
    try {
      await invoke("disconnect_device", { serial });
      if (selectedDevice?.serial === serial) {
        setSelectedDevice(null);
      }
      scan();
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="workstation-pane">
      <div className="panel-left">
        <div className="card-panel" style={{ flexGrow: 1 }}>
          <div className="panel-header">
            <span className="panel-title">
              <Tv size={18} />
              Connected Devices ({devices.length})
            </span>
            <button className="btn-secondary" style={{ padding: "6px 12px" }} onClick={scan}>
              <RefreshCw size={14} />
              Scan
            </button>
          </div>
          
          <div className="panel-body">
            {devices.length === 0 ? (
              <div className="flex-center" style={{ flexDirection: "column", height: "100%", color: "var(--color-text-muted)", gap: "12px" }}>
                <Tv size={48} style={{ opacity: 0.3 }} />
                <p>No Android TV devices detected</p>
                <p style={{ fontSize: "12px" }}>Connect via USB or insert WiFi credentials below</p>
              </div>
            ) : (
              <div className="device-grid">
                {devices.map((device) => {
                  const isSelected = selectedDevice?.serial === device.serial;
                  const isOnline = device.status === "device";
                  
                  return (
                    <div
                      key={device.serial}
                      className={`device-card ${isSelected ? "selected" : ""}`}
                      onClick={() => setSelectedDevice(device)}
                    >
                      <div className="device-card-header">
                        <span style={{ fontWeight: "bold", fontSize: "14px", display: "flex", alignItems: "center", gap: "8px" }}>
                          {device.connection_type === "wifi" ? <Wifi size={14} /> : <Cpu size={14} />}
                          {device.name}
                        </span>
                        <span className={`status-indicator`} style={{ fontSize: "11px" }}>
                          <span className={`status-dot ${isOnline ? "active" : ""}`}></span>
                          {device.status}
                        </span>
                      </div>
                      
                      <div style={{ display: "flex", flexDirection: "column", gap: "4px", marginTop: "8px" }}>
                        <div className="device-info-row">
                          <span className="device-label">Serial:</span>
                          <span style={{ fontFamily: "monospace" }}>{device.serial}</span>
                        </div>
                        <div className="device-info-row">
                          <span className="device-label">API Level:</span>
                          <span>Android {device.os_version} (API {device.api_level})</span>
                        </div>
                      </div>

                      {device.connection_type === "wifi" && (
                        <button
                          className="btn-secondary"
                          style={{
                            marginTop: "12px",
                            padding: "4px 8px",
                            fontSize: "11px",
                            borderColor: "rgba(221, 2, 0, 0.3)",
                            color: "var(--color-text-muted)"
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDisconnect(device.serial);
                          }}
                        >
                          <WifiOff size={11} />
                          Disconnect Wifi
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="card-panel">
          <div className="panel-header">
            <span className="panel-title">
              <Wifi size={18} />
              Connect WiFi ADB Device
            </span>
          </div>
          <div className="panel-body">
            <form onSubmit={handleConnect} style={{ display: "flex", gap: "16px", alignItems: "flex-end" }}>
              <div style={{ flexGrow: 2 }}>
                <label style={{ display: "block", fontSize: "12px", color: "var(--color-text-muted)", marginBottom: "6px" }}>TV IP Address</label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="e.g. 192.168.1.100"
                  value={ipAddress}
                  onChange={(e) => setIpAddress(e.target.value)}
                />
              </div>
              
              <div style={{ width: "100px" }}>
                <label style={{ display: "block", fontSize: "12px", color: "var(--color-text-muted)", marginBottom: "6px" }}>Port</label>
                <input
                  type="number"
                  className="input-field"
                  value={port}
                  onChange={(e) => setPort(parseInt(e.target.value) || 5555)}
                />
              </div>
              
              <button type="submit" className="btn-primary" disabled={connecting} style={{ height: "40px", minWidth: "120px" }}>
                {connecting ? "Connecting..." : "Connect"}
              </button>
            </form>
            
            {connMessage && (
              <div
                style={{
                  marginTop: "16px",
                  padding: "12px",
                  borderRadius: "var(--border-radius-md)",
                  backgroundColor: connMessage.error ? "rgba(239, 68, 68, 0.1)" : "rgba(16, 185, 129, 0.1)",
                  border: `1px solid ${connMessage.error ? "rgba(239, 68, 68, 0.2)" : "rgba(16, 185, 129, 0.2)"}`,
                  color: connMessage.error ? "var(--color-error)" : "var(--color-success)",
                  fontSize: "13px",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px"
                }}
              >
                {connMessage.error ? <AlertTriangle size={16} /> : <CheckCircle size={16} />}
                {connMessage.text}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="panel-right">
        <div className="card-panel" style={{ height: "100%" }}>
          <div className="panel-header">
            <span className="panel-title">
              <Info size={18} />
              Device Specifications
            </span>
          </div>
          <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {selectedDevice ? (
              <>
                <div style={{ textAlign: "center", padding: "16px 0", borderBottom: "1px solid var(--color-border)" }}>
                  <Tv size={48} className="logo-icon" style={{ marginBottom: "8px" }} />
                  <h3 style={{ color: "var(--color-text-primary)" }}>{selectedDevice.name}</h3>
                  <span className="badge badge-info" style={{ marginTop: "6px", display: "inline-block" }}>
                    {selectedDevice.connection_type.toUpperCase()}
                  </span>
                </div>
                
                <div style={{ display: "flex", flexDirection: "column", gap: "12px", fontSize: "13px" }}>
                  <div>
                    <span style={{ display: "block", color: "var(--color-text-muted)", fontSize: "11px" }}>MANUFACTURER</span>
                    <span style={{ fontWeight: "500" }}>{selectedDevice.manufacturer}</span>
                  </div>
                  <div>
                    <span style={{ display: "block", color: "var(--color-text-muted)", fontSize: "11px" }}>MODEL</span>
                    <span style={{ fontWeight: "500" }}>{selectedDevice.model}</span>
                  </div>
                  <div>
                    <span style={{ display: "block", color: "var(--color-text-muted)", fontSize: "11px" }}>ANDROID VERSION</span>
                    <span style={{ fontWeight: "500" }}>{selectedDevice.os_version} (API {selectedDevice.api_level})</span>
                  </div>
                  <div>
                    <span style={{ display: "block", color: "var(--color-text-muted)", fontSize: "11px" }}>RESOLUTION</span>
                    <span style={{ fontWeight: "500" }}>{selectedDevice.resolution} px</span>
                  </div>
                  <div>
                    <span style={{ display: "block", color: "var(--color-text-muted)", fontSize: "11px" }}>ADB SERIAL</span>
                    <span style={{ fontFamily: "monospace", fontSize: "12px" }}>{selectedDevice.serial}</span>
                  </div>
                  <div>
                    <span style={{ display: "block", color: "var(--color-text-muted)", fontSize: "11px" }}>CONNECTION STATUS</span>
                    <span
                      style={{
                        fontWeight: "600",
                        color: selectedDevice.status === "device" ? "var(--color-success)" : "var(--color-error)"
                      }}
                    >
                      {selectedDevice.status === "device" ? "ONLINE" : selectedDevice.status.toUpperCase()}
                    </span>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-center" style={{ flexDirection: "column", height: "100%", color: "var(--color-text-muted)", textAlign: "center" }}>
                <Info size={36} style={{ opacity: 0.2, marginBottom: "8px" }} />
                <p>No device selected</p>
                <p style={{ fontSize: "12px" }}>Select a device from the list to inspect specifications</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
