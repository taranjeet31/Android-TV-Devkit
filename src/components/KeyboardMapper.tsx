import React, { useState } from "react";
import { useDeviceStore } from "../store/useDeviceStore";
import { Settings, Plus, Trash2, Edit3, Check } from "lucide-react";

export const KeyboardMapper: React.FC = () => {
  const {
    activeKeymapProfile,
    setKeymapProfile,
    keymapProfiles,
    updateKeymapProfile
  } = useDeviceStore();

  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editingVal, setEditingVal] = useState("");
  const [newKey, setNewKey] = useState("");
  const [newVal, setNewVal] = useState("DPAD_UP");

  const activeBindings = keymapProfiles[activeKeymapProfile] || {};

  const handleEditSave = (keyCode: string) => {
    const updated = { ...activeBindings, [keyCode]: editingVal };
    updateKeymapProfile(activeKeymapProfile, updated);
    setEditingKey(null);
  };

  const handleDelete = (keyCode: string) => {
    const updated = { ...activeBindings };
    delete updated[keyCode];
    updateKeymapProfile(activeKeymapProfile, updated);
  };

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKey.trim()) return;
    const updated = { ...activeBindings, [newKey.trim()]: newVal };
    updateKeymapProfile(activeKeymapProfile, updated);
    setNewKey("");
  };

  const availableActions = [
    "DPAD_UP",
    "DPAD_DOWN",
    "DPAD_LEFT",
    "DPAD_RIGHT",
    "CENTER",
    "BACK",
    "HOME",
    "MENU",
    "PLAY_PAUSE",
    "VOLUME_UP",
    "VOLUME_DOWN",
    "MUTE",
    "POWER"
  ];

  return (
    <div className="workstation-pane">
      <div className="panel-left">
        <div className="card-panel" style={{ height: "100%" }}>
          <div className="panel-header">
            <span className="panel-title">
              <Settings size={18} />
              Keymap Profile Editor: {activeKeymapProfile}
            </span>
          </div>

          <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
              <span style={{ fontWeight: 600 }}>Active Profile:</span>
              <select
                className="input-field"
                style={{ width: "200px", padding: "8px 12px" }}
                value={activeKeymapProfile}
                onChange={(e) => setKeymapProfile(e.target.value)}
              >
                {Object.keys(keymapProfiles).map((prof) => (
                  <option key={prof} value={prof}>
                    {prof}
                  </option>
                ))}
              </select>
            </div>

            <div
              style={{
                border: "1px solid var(--color-border)",
                borderRadius: "var(--border-radius-md)",
                overflow: "hidden",
                maxHeight: "360px",
                overflowY: "auto"
              }}
            >
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                <thead>
                  <tr style={{ backgroundColor: "rgba(0,0,0,0.15)", borderBottom: "1px solid var(--color-border)" }}>
                    <th style={{ padding: "10px 16px", textAlign: "left", color: "var(--color-text-muted)" }}>Mac Keyboard Code</th>
                    <th style={{ padding: "10px 16px", textAlign: "left", color: "var(--color-text-muted)" }}>TV Remote Action</th>
                    <th style={{ padding: "10px 16px", textAlign: "right", color: "var(--color-text-muted)" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(activeBindings).map(([k, v]) => (
                    <tr key={k} style={{ borderBottom: "1px dashed rgba(66, 18, 16, 0.4)" }}>
                      <td style={{ padding: "10px 16px", fontFamily: "monospace", fontWeight: 600 }}>{k}</td>
                      <td style={{ padding: "10px 16px" }}>
                        {editingKey === k ? (
                          <select
                            className="input-field"
                            style={{ padding: "4px 8px", fontSize: "12px" }}
                            value={editingVal}
                            onChange={(e) => setEditingVal(e.target.value)}
                          >
                            {availableActions.map((act) => (
                              <option key={act} value={act}>
                                {act}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="badge badge-info">{v}</span>
                        )}
                      </td>
                      <td style={{ padding: "10px 16px", textAlign: "right" }}>
                        <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
                          {editingKey === k ? (
                            <button
                              className="btn-secondary"
                              style={{ padding: "4px 8px" }}
                              onClick={() => handleEditSave(k)}
                            >
                              <Check size={12} />
                            </button>
                          ) : (
                            <button
                              className="btn-secondary"
                              style={{ padding: "4px 8px" }}
                              onClick={() => {
                                setEditingKey(k);
                                setEditingVal(v);
                              }}
                            >
                              <Edit3 size={12} />
                            </button>
                          )}
                          <button
                            className="btn-secondary"
                            style={{ padding: "4px 8px", borderColor: "rgba(239, 68, 68, 0.3)", color: "var(--color-error)" }}
                            onClick={() => handleDelete(k)}
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <div className="panel-right">
        <div className="card-panel">
          <div className="panel-header">
            <span className="panel-title">
              <Plus size={18} />
              Add Key Binding
            </span>
          </div>
          <div className="panel-body">
            <form onSubmit={handleAdd} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <div>
                <label style={{ display: "block", fontSize: "11px", color: "var(--color-text-muted)", marginBottom: "4px" }}>
                  KEYBOARD CODE (e.g. KeyA, ArrowUp)
                </label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="Press key or type code"
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                  onKeyDown={(e) => {
                    e.preventDefault();
                    setNewKey(e.code);
                  }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "11px", color: "var(--color-text-muted)", marginBottom: "4px" }}>
                  MAP TO ACTION
                </label>
                <select
                  className="input-field"
                  value={newVal}
                  onChange={(e) => setNewVal(e.target.value)}
                >
                  {availableActions.map((act) => (
                    <option key={act} value={act}>
                      {act}
                    </option>
                  ))}
                </select>
              </div>

              <button type="submit" className="btn-primary" style={{ marginTop: "8px" }}>
                Add Binding
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};
