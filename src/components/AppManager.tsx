import React, { useEffect, useState, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useDeviceStore, AppInfo } from "../store/useDeviceStore";
import {
  Play,
  Square,
  Trash2,
  RefreshCw,
  Search,
  Grid,
  List,
  Copy,
  Check,
  Tv,
  AlertCircle,
  HardDrive,
  ShieldAlert,
  Sparkles,
  UploadCloud,
  Loader2,
  FolderOpen,
} from "lucide-react";

export const AppManager: React.FC = () => {
  const { selectedDevice } = useDeviceStore();
  const [apps, setApps] = useState<AppInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  // Installer State
  const [installing, setInstalling] = useState(false);
  const [installingFileName, setInstallingFileName] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Filters & Views
  const [searchQuery, setSearchQuery] = useState("");
  const [tabFilter, setTabFilter] = useState<"user" | "system" | "all">("user");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [copiedPkg, setCopiedPkg] = useState<string | null>(null);

  // Modal / Action confirmation states
  const [actionTarget, setActionTarget] = useState<{ app: AppInfo; action: "clear" | "uninstall" } | null>(null);

  const fetchApps = async () => {
    if (!selectedDevice) {
      setApps([]);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const includeSystem = tabFilter === "system" || tabFilter === "all";
      const result = await invoke<AppInfo[]>("list_applications", {
        serial: selectedDevice.serial,
        includeSystem,
      });
      setApps(result);
    } catch (err: any) {
      console.error("Failed to fetch applications:", err);
      setError(typeof err === "string" ? err : err.message || "Failed to query applications via ADB.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchApps();
  }, [selectedDevice?.serial, tabFilter]);

  // Listen to native window drag and drop events (Tauri v2 gives absolute file paths!)
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    getCurrentWebviewWindow().onDragDropEvent((event) => {
      if (event.payload.type === "enter" || event.payload.type === "over") {
        setIsDragging(true);
      } else if (event.payload.type === "drop") {
        setIsDragging(false);
        if (event.payload.paths.length > 0) {
          const filePath = event.payload.paths[0];
          const fileName = filePath.split("/").pop() || filePath.split("\\").pop() || filePath;
          if (filePath.match(/\.(apk|apks|xapk|aab)$/i)) {
            handleInstallFile(filePath, fileName);
          } else {
            setError(`Selected file "${fileName}" is not a recognized Android package (.apk, .apks, .xapk, .aab).`);
          }
        }
      } else {
        setIsDragging(false);
      }
    }).then((fn) => {
      unlisten = fn;
    }).catch((err) => {
      console.warn("Failed to attach drag drop event listener:", err);
    });

    return () => {
      unlisten?.();
    };
  }, [selectedDevice?.serial]);

  const handleInstallFile = async (filePath: string, fileName: string) => {
    if (!selectedDevice) return;
    setInstalling(true);
    setInstallingFileName(fileName);
    setStatusMessage(null);
    setError(null);

    try {
      const res = await invoke<string>("install_app_file", {
        serial: selectedDevice.serial,
        filePath,
      });
      setStatusMessage({ text: `🎉 ${res}`, type: "success" });
      fetchApps();
    } catch (err: any) {
      console.error("Installation failed:", err);
      setError(typeof err === "string" ? err : err.message || "Failed to install application package.");
    } finally {
      setInstalling(false);
      setInstallingFileName(null);
    }
  };

  const handleBrowseFile = async () => {
    if (!selectedDevice || installing) return;
    try {
      const selectedPath = await invoke<string | null>("pick_apk_file");
      if (selectedPath) {
        const fileName = selectedPath.split("/").pop() || selectedPath.split("\\").pop() || selectedPath;
        handleInstallFile(selectedPath, fileName);
      }
    } catch (err: any) {
      console.error("Native file picker failed:", err);
      // Fallback to DOM input element if native picker fails
      fileInputRef.current?.click();
    }
  };

  const handleFileSelectFallback = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const file = files[0];
    const filePath = (file as any).path || file.name;
    handleInstallFile(filePath, file.name);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleLaunch = async (pkg: string, label: string) => {
    if (!selectedDevice) return;
    try {
      const res = await invoke<string>("launch_app", {
        serial: selectedDevice.serial,
        packageName: pkg,
      });
      setStatusMessage({ text: `🚀 ${res}`, type: "success" });
      setTimeout(() => setStatusMessage(null), 4000);
    } catch (err: any) {
      setStatusMessage({ text: `Failed to launch ${label}: ${err}`, type: "error" });
      setTimeout(() => setStatusMessage(null), 5000);
    }
  };

  const handleForceStop = async (pkg: string, label: string) => {
    if (!selectedDevice) return;
    try {
      await invoke<string>("force_stop_app", {
        serial: selectedDevice.serial,
        packageName: pkg,
      });
      setStatusMessage({ text: `🛑 Force stopped ${label}`, type: "success" });
      setTimeout(() => setStatusMessage(null), 3000);
    } catch (err: any) {
      setStatusMessage({ text: `Failed to force stop ${label}: ${err}`, type: "error" });
      setTimeout(() => setStatusMessage(null), 5000);
    }
  };

  const handleConfirmAction = async () => {
    if (!selectedDevice || !actionTarget) return;
    const { app, action } = actionTarget;
    setActionTarget(null);

    try {
      if (action === "clear") {
        await invoke("clear_app_data", {
          serial: selectedDevice.serial,
          packageName: app.package_name,
        });
        setStatusMessage({ text: `🧹 Cleared data for ${app.label}`, type: "success" });
      } else if (action === "uninstall") {
        await invoke("uninstall_app", {
          serial: selectedDevice.serial,
          packageName: app.package_name,
        });
        setStatusMessage({ text: `🗑️ Uninstalled ${app.label}`, type: "success" });
        fetchApps();
      }
      setTimeout(() => setStatusMessage(null), 4000);
    } catch (err: any) {
      setStatusMessage({ text: `Action failed for ${app.label}: ${err}`, type: "error" });
      setTimeout(() => setStatusMessage(null), 5000);
    }
  };

  const handleCopyPackage = (pkg: string) => {
    navigator.clipboard.writeText(pkg);
    setCopiedPkg(pkg);
    setTimeout(() => setCopiedPkg(null), 2000);
  };

  const filteredApps = useMemo(() => {
    return apps.filter((app) => {
      if (tabFilter === "user" && app.is_system) return false;
      if (tabFilter === "system" && !app.is_system) return false;

      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        app.label.toLowerCase().includes(q) ||
        app.package_name.toLowerCase().includes(q)
      );
    });
  }, [apps, tabFilter, searchQuery]);

  const getAppGradient = (name: string) => {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const h1 = Math.abs(hash) % 360;
    const h2 = (h1 + 40) % 360;
    return `linear-gradient(135deg, hsl(${h1}, 70%, 45%), hsl(${h2}, 85%, 35%))`;
  };

  if (!selectedDevice) {
    return (
      <div className="panel-container" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "400px" }}>
        <Tv size={48} style={{ color: "var(--color-text-muted)", marginBottom: "16px", opacity: 0.6 }} />
        <h3 style={{ fontSize: "18px", fontWeight: 600, color: "var(--color-text-primary)", marginBottom: "8px" }}>No Target Device Selected</h3>
        <p style={{ color: "var(--color-text-muted)", fontSize: "13px", textAlign: "center", maxWidth: "420px" }}>
          Please select or connect an Android TV device in the <strong>Devices Manager</strong> to view, install, and launch applications.
        </p>
      </div>
    );
  }

  return (
    <div className="panel-container" style={{ display: "flex", flexDirection: "column", gap: "20px", height: "100%", overflowY: "auto" }}>
      {/* Header Bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "16px" }}>
        <div>
          <h2 style={{ fontSize: "20px", fontWeight: 700, display: "flex", alignItems: "center", gap: "10px", margin: 0 }}>
            <Sparkles size={22} style={{ color: "var(--color-accent-primary)" }} />
            Application Manager & Installer
          </h2>
          <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
            Connected to <strong>{selectedDevice.name}</strong> ({selectedDevice.serial})
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <button
            className="btn btn-secondary"
            onClick={fetchApps}
            disabled={loading || installing}
            title="Refresh application list"
            style={{ display: "flex", alignItems: "center", gap: "6px" }}
          >
            <RefreshCw size={14} className={loading ? "spin" : ""} />
            Refresh
          </button>
        </div>
      </div>

      {/* APK / AAB Drag & Drop Installation Dropzone */}
      <div
        style={{
          border: `2px dashed ${isDragging ? "var(--color-accent-primary)" : "var(--color-border)"}`,
          background: isDragging
            ? "rgba(59, 130, 246, 0.15)"
            : "var(--color-bg-tertiary)",
          borderRadius: "12px",
          padding: "22px",
          textAlign: "center",
          transition: "all 0.2s ease",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "10px",
          cursor: installing ? "wait" : "pointer",
          boxShadow: isDragging ? "0 0 16px rgba(59, 130, 246, 0.3)" : "none",
        }}
        onClick={handleBrowseFile}
      >
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileSelectFallback}
          accept=".apk,.apks,.xapk,.aab"
          style={{ display: "none" }}
        />

        {installing ? (
          <div style={{ display: "flex", alignItems: "center", gap: "12px", color: "var(--color-accent-primary)" }}>
            <Loader2 size={26} className="spin" />
            <div style={{ textAlign: "left" }}>
              <span style={{ fontWeight: 600, fontSize: "14px", display: "block" }}>
                Installing application onto {selectedDevice.name}...
              </span>
              <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                {installingFileName || "Processing app package over ADB..."}
              </span>
            </div>
          </div>
        ) : (
          <>
            <div
              style={{
                width: "48px",
                height: "48px",
                borderRadius: "50%",
                background: isDragging ? "var(--color-accent-primary)" : "rgba(59, 130, 246, 0.15)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: isDragging ? "#fff" : "var(--color-accent-primary)",
                transition: "all 0.2s ease",
              }}
            >
              <UploadCloud size={26} />
            </div>

            <div>
              <span style={{ fontSize: "14px", fontWeight: 600, color: "var(--color-text-primary)", display: "block" }}>
                {isDragging ? "Drop application file to install!" : "Drag & Drop application package to install on TV"}
              </span>
              <span style={{ fontSize: "12px", color: "var(--color-text-muted)", marginTop: "2px", display: "block" }}>
                Supports <strong>.apk</strong>, <strong>.apks</strong>, <strong>.xapk</strong>, and <strong>.aab</strong> files
              </span>
            </div>

            <button
              className="btn btn-primary"
              onClick={(e) => {
                e.stopPropagation();
                handleBrowseFile();
              }}
              style={{ fontSize: "12px", padding: "8px 16px", marginTop: "4px", display: "flex", alignItems: "center", gap: "8px" }}
            >
              <FolderOpen size={14} />
              Browse Application File...
            </button>
          </>
        )}
      </div>

      {/* Status Notification Toast */}
      {statusMessage && (
        <div
          className={`badge ${statusMessage.type === "success" ? "badge-success" : "badge-error"}`}
          style={{
            padding: "10px 16px",
            fontSize: "13px",
            borderRadius: "8px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
          }}
        >
          {statusMessage.text}
        </div>
      )}

      {/* Error alert */}
      {error && (
        <div style={{ backgroundColor: "rgba(239, 68, 68, 0.15)", border: "1px solid rgba(239, 68, 68, 0.3)", borderRadius: "8px", padding: "12px 16px", color: "#f87171", fontSize: "13px", display: "flex", alignItems: "center", gap: "10px" }}>
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      {/* Controls Bar: Search, Category Tabs & View Mode */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px", background: "var(--color-bg-tertiary)", padding: "12px", borderRadius: "10px", border: "1px solid var(--color-border)" }}>
        {/* Search Box */}
        <div style={{ position: "relative", minWidth: "260px", flexGrow: 1 }}>
          <Search size={15} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: "var(--color-text-muted)" }} />
          <input
            type="text"
            className="input-field"
            placeholder="Search app name or package id..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ paddingLeft: "36px", width: "100%" }}
          />
        </div>

        {/* Category Tabs */}
        <div style={{ display: "flex", gap: "4px", background: "var(--color-bg-primary)", padding: "3px", borderRadius: "8px", border: "1px solid var(--color-border)" }}>
          <button
            className={`btn-tab ${tabFilter === "user" ? "active" : ""}`}
            onClick={() => setTabFilter("user")}
            style={{ padding: "6px 12px", fontSize: "12px" }}
          >
            User Apps
          </button>
          <button
            className={`btn-tab ${tabFilter === "system" ? "active" : ""}`}
            onClick={() => setTabFilter("system")}
            style={{ padding: "6px 12px", fontSize: "12px" }}
          >
            System Apps
          </button>
          <button
            className={`btn-tab ${tabFilter === "all" ? "active" : ""}`}
            onClick={() => setTabFilter("all")}
            style={{ padding: "6px 12px", fontSize: "12px" }}
          >
            All Apps ({apps.length})
          </button>
        </div>

        {/* View Mode Toggle */}
        <div style={{ display: "flex", gap: "4px", background: "var(--color-bg-primary)", padding: "3px", borderRadius: "8px", border: "1px solid var(--color-border)" }}>
          <button
            className={`btn-icon ${viewMode === "grid" ? "active" : ""}`}
            onClick={() => setViewMode("grid")}
            title="Grid View"
            style={{ padding: "6px", background: viewMode === "grid" ? "var(--color-accent-primary)" : "transparent", borderRadius: "6px" }}
          >
            <Grid size={15} />
          </button>
          <button
            className={`btn-icon ${viewMode === "list" ? "active" : ""}`}
            onClick={() => setViewMode("list")}
            title="List View"
            style={{ padding: "6px", background: viewMode === "list" ? "var(--color-accent-primary)" : "transparent", borderRadius: "6px" }}
          >
            <List size={15} />
          </button>
        </div>
      </div>

      {/* Main Apps View */}
      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "60px 0", color: "var(--color-text-muted)" }}>
          <RefreshCw size={32} className="spin" style={{ marginBottom: "12px", color: "var(--color-accent-primary)" }} />
          <span>Querying installed applications from TV via ADB...</span>
        </div>
      ) : filteredApps.length === 0 ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "60px 0", color: "var(--color-text-muted)" }}>
          <HardDrive size={40} style={{ opacity: 0.5, marginBottom: "12px" }} />
          <span style={{ fontSize: "15px", fontWeight: 500 }}>No applications found</span>
          <span style={{ fontSize: "12px", marginTop: "4px" }}>
            {searchQuery ? `No results match "${searchQuery}"` : "No installed packages detected in this category."}
          </span>
        </div>
      ) : viewMode === "grid" ? (
        /* GRID VIEW */
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
            gap: "14px",
            paddingBottom: "20px",
          }}
        >
          {filteredApps.map((app) => (
            <div
              key={app.package_name}
              style={{
                background: "var(--color-bg-tertiary)",
                border: "1px solid var(--color-border)",
                borderRadius: "12px",
                padding: "14px",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                gap: "12px",
                transition: "transform 0.15s ease, border-color 0.15s ease",
              }}
              className="app-card-hover"
            >
              <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
                {/* App Initial Icon Box */}
                <div
                  style={{
                    width: "44px",
                    height: "44px",
                    borderRadius: "10px",
                    background: getAppGradient(app.package_name),
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#fff",
                    fontWeight: 700,
                    fontSize: "18px",
                    flexShrink: 0,
                    boxShadow: "0 4px 10px rgba(0,0,0,0.25)",
                  }}
                >
                  {app.label.charAt(0).toUpperCase()}
                </div>

                <div style={{ flexGrow: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <h4
                      style={{
                        margin: 0,
                        fontSize: "14px",
                        fontWeight: 600,
                        color: "var(--color-text-primary)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                      title={app.label}
                    >
                      {app.label}
                    </h4>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "4px",
                      fontSize: "11px",
                      color: "var(--color-text-muted)",
                      marginTop: "2px",
                    }}
                  >
                    <span
                      style={{
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        maxWidth: "140px",
                      }}
                      title={app.package_name}
                    >
                      {app.package_name}
                    </span>
                    <button
                      onClick={() => handleCopyPackage(app.package_name)}
                      style={{ background: "none", border: "none", color: "var(--color-text-muted)", cursor: "pointer", padding: 0 }}
                      title="Copy package name"
                    >
                      {copiedPkg === app.package_name ? <Check size={11} style={{ color: "var(--color-success)" }} /> : <Copy size={11} />}
                    </button>
                  </div>

                  <span
                    className={`badge ${app.is_system ? "badge-secondary" : "badge-success"}`}
                    style={{ fontSize: "10px", padding: "1px 6px", marginTop: "6px", display: "inline-block" }}
                  >
                    {app.is_system ? "System App" : "User App"}
                  </span>
                </div>
              </div>

              {/* Action Buttons */}
              <div style={{ display: "flex", gap: "6px", marginTop: "4px" }}>
                <button
                  className="btn btn-primary"
                  onClick={() => handleLaunch(app.package_name, app.label)}
                  style={{ flexGrow: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", fontSize: "12px", padding: "6px 10px" }}
                  title="Launch application on TV"
                >
                  <Play size={13} fill="currentColor" />
                  Open
                </button>

                <button
                  className="btn btn-secondary"
                  onClick={() => handleForceStop(app.package_name, app.label)}
                  style={{ padding: "6px 8px" }}
                  title="Force stop app"
                >
                  <Square size={13} />
                </button>

                <button
                  className="btn btn-secondary"
                  onClick={() => setActionTarget({ app, action: "clear" })}
                  style={{ padding: "6px 8px" }}
                  title="Clear app data"
                >
                  <Trash2 size={13} style={{ color: "#f97316" }} />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* LIST VIEW */
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          {filteredApps.map((app) => (
            <div
              key={app.package_name}
              style={{
                background: "var(--color-bg-tertiary)",
                border: "1px solid var(--color-border)",
                borderRadius: "8px",
                padding: "10px 14px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "12px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "12px", flexGrow: 1, minWidth: 0 }}>
                <div
                  style={{
                    width: "32px",
                    height: "32px",
                    borderRadius: "6px",
                    background: getAppGradient(app.package_name),
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#fff",
                    fontWeight: 700,
                    fontSize: "14px",
                    flexShrink: 0,
                  }}
                >
                  {app.label.charAt(0).toUpperCase()}
                </div>

                <div style={{ minWidth: 0, flexGrow: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{ fontWeight: 600, fontSize: "13px", color: "var(--color-text-primary)" }}>{app.label}</span>
                    <span className={`badge ${app.is_system ? "badge-secondary" : "badge-success"}`} style={{ fontSize: "10px", padding: "1px 6px" }}>
                      {app.is_system ? "System" : "User"}
                    </span>
                  </div>
                  <span style={{ fontSize: "11px", color: "var(--color-text-muted)", fontFamily: "monospace" }}>{app.package_name}</span>
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <button
                  className="btn btn-primary"
                  onClick={() => handleLaunch(app.package_name, app.label)}
                  style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "12px", padding: "5px 12px" }}
                >
                  <Play size={12} fill="currentColor" />
                  Open
                </button>

                <button
                  className="btn btn-secondary"
                  onClick={() => handleForceStop(app.package_name, app.label)}
                  style={{ padding: "5px 8px" }}
                  title="Force stop"
                >
                  <Square size={12} />
                </button>

                <button
                  className="btn btn-secondary"
                  onClick={() => setActionTarget({ app, action: "clear" })}
                  style={{ padding: "5px 8px" }}
                  title="Clear app data"
                >
                  <Trash2 size={12} style={{ color: "#f97316" }} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Confirmation Modal */}
      {actionTarget && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: "var(--color-bg-secondary)", border: "1px solid var(--color-border)", borderRadius: "12px", padding: "24px", maxWidth: "400px", width: "90%", boxShadow: "0 10px 25px rgba(0,0,0,0.5)" }}>
            <h3 style={{ margin: "0 0 12px 0", fontSize: "16px", fontWeight: 700, display: "flex", alignItems: "center", gap: "8px" }}>
              <ShieldAlert size={20} style={{ color: "#f97316" }} />
              Confirm App Action
            </h3>

            <p style={{ fontSize: "13px", color: "var(--color-text-muted)", lineHeight: 1.5, margin: "0 0 20px 0" }}>
              Are you sure you want to {actionTarget.action === "clear" ? "clear all local app data for" : "uninstall"} <strong>{actionTarget.app.label}</strong> ({actionTarget.app.package_name})?
            </p>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
              <button className="btn btn-secondary" onClick={() => setActionTarget(null)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleConfirmAction} style={{ background: actionTarget.action === "uninstall" ? "var(--color-error)" : "#f97316" }}>
                Confirm {actionTarget.action === "clear" ? "Clear Data" : "Uninstall"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
