import { create } from "zustand";

export interface DeviceInfo {
  serial: string;
  name: string;
  manufacturer: string;
  model: string;
  os_version: string;
  api_level: string;
  resolution: string;
  connection_type: string; // "usb", "wifi", "emulator"
  status: string; // "device", "unauthorized", "offline", etc.
}

export interface LogLine {
  timestamp: string;
  level: string; // "V", "D", "I", "W", "E", "F"
  tag: string;
  pid: string;
  message: string;
  raw: string;
}

export interface NetworkRequest {
  id: string;
  method: string;
  url: string;
  host: string;
  port: number;
  timestamp: number;
  status: string; // "Active", "Completed", "Failed"
  size_bytes: number;
  duration_ms: number;
}

export interface AppInfo {
  package_name: string;
  label: string;
  is_system: boolean;
  installed_path: string;
}

interface DeviceState {
  devices: DeviceInfo[];
  selectedDevice: DeviceInfo | null;
  activeTab: string;
  
  // App Manager
  installedApps: AppInfo[];
  installedAppsLoading: boolean;
  setInstalledApps: (apps: AppInfo[]) => void;
  setInstalledAppsLoading: (loading: boolean) => void;
  
  // Logcat
  logs: LogLine[];
  logcatFilter: string;
  logcatMinLevel: string;
  
  // Network proxy
  networkRequests: NetworkRequest[];
  selectedRequest: NetworkRequest | null;
  activeProxyPort: number | null;
  proxyEnabled: boolean;
  localHostIp: string;
  
  // Screencap Mirror
  screencapActive: boolean;
  screencapFrame: string | null;
  
  // Keyboard Engine
  keyboardEnabled: boolean;
  keyboardMode: "keymap" | "passthrough";
  activeKeymapProfile: string;
  keymapProfiles: Record<string, Record<string, string>>;

  // Mouse Capture (software KVM)
  captureActive: boolean;
  captureMode: "android" | "tizen" | null;
  captureWsPort: number | null;
  capturePermissionGranted: boolean | null;
  virtualCursorPos: { x: number; y: number };
  virtualCursorPressed: boolean;
  captureHideSystemCursor: boolean;
  captureSensitivity: number;
  captureDragThreshold: number;
  captureWsClientCount: number;

  // Actions
  setDevices: (devices: DeviceInfo[]) => void;
  setSelectedDevice: (device: DeviceInfo | null) => void;
  setActiveTab: (tab: string) => void;
  setKeyboardMode: (mode: "keymap" | "passthrough") => void;
  
  addLogLine: (line: LogLine) => void;
  addLogLines: (lines: LogLine[]) => void;
  clearLogs: () => void;
  setLogcatFilter: (filter: string) => void;
  setLogcatMinLevel: (level: string) => void;
  
  addNetworkRequest: (req: NetworkRequest) => void;
  setSelectedRequest: (req: NetworkRequest | null) => void;
  clearNetworkRequests: () => void;
  setProxyEnabled: (enabled: boolean) => void;
  setProxyPort: (port: number | null) => void;
  setHostIp: (ip: string) => void;
  
  setScreencapActive: (active: boolean) => void;
  setScreencapFrame: (frame: string | null) => void;
  
  setKeyboardEnabled: (enabled: boolean) => void;
  setKeymapProfile: (profileName: string) => void;
  updateKeymapProfile: (profileName: string, mapping: Record<string, string>) => void;

  // Mouse capture actions
  setCaptureActive: (active: boolean) => void;
  setCaptureMode: (mode: "android" | "tizen" | null) => void;
  setCaptureWsPort: (port: number | null) => void;
  setCapturePermissionGranted: (granted: boolean | null) => void;
  setVirtualCursorPos: (pos: { x: number; y: number }) => void;
  setVirtualCursorPressed: (pressed: boolean) => void;
  setCaptureHideSystemCursor: (hide: boolean) => void;
  setCaptureSensitivity: (v: number) => void;
  setCaptureDragThreshold: (v: number) => void;
  setCaptureWsClientCount: (n: number) => void;
}

const DEFAULT_KEYMAPS: Record<string, Record<string, string>> = {
  Default: {
    ArrowUp: "DPAD_UP",
    ArrowDown: "DPAD_DOWN",
    ArrowLeft: "DPAD_LEFT",
    ArrowRight: "DPAD_RIGHT",
    Enter: "CENTER",
    Backspace: "BACK",
    Escape: "BACK",
    KeyH: "HOME",
    KeyM: "MENU",
    Space: "PLAY_PAUSE",
    Equal: "VOLUME_UP",
    Minus: "VOLUME_DOWN",
    KeyU: "MUTE",
  },
  Netflix: {
    ArrowUp: "DPAD_UP",
    ArrowDown: "DPAD_DOWN",
    ArrowLeft: "DPAD_LEFT",
    ArrowRight: "DPAD_RIGHT",
    Enter: "CENTER",
    Escape: "BACK",
    Backspace: "BACK",
    KeyP: "PLAY_PAUSE",
  },
};

export const useDeviceStore = create<DeviceState>((set) => ({
  devices: [],
  selectedDevice: null,
  activeTab: "devices",

  // App Manager
  installedApps: [],
  installedAppsLoading: false,
  setInstalledApps: (installedApps) => set({ installedApps }),
  setInstalledAppsLoading: (installedAppsLoading) => set({ installedAppsLoading }),
  
  // Logcat
  logs: [],
  logcatFilter: "",
  logcatMinLevel: "V",
  
  // Network
  networkRequests: [],
  selectedRequest: null,
  activeProxyPort: null,
  proxyEnabled: false,
  localHostIp: "",
  
  // Screencap
  screencapActive: false,
  screencapFrame: null,
  
  // Keyboard
  keyboardEnabled: false,
  keyboardMode: "keymap",
  activeKeymapProfile: "Default",
  keymapProfiles: DEFAULT_KEYMAPS,

  // Mouse Capture
  captureActive: false,
  captureMode: null,
  captureWsPort: null,
  capturePermissionGranted: null,
  virtualCursorPos: { x: 960, y: 540 },
  virtualCursorPressed: false,
  captureHideSystemCursor: false,
  captureSensitivity: 2.0,
  captureDragThreshold: 8,
  captureWsClientCount: 0,

  setDevices: (devices) => set({ devices }),
  setSelectedDevice: (selectedDevice) => set({ selectedDevice }),
  setActiveTab: (activeTab) => set({ activeTab }),
  
  addLogLine: (line) =>
    set((state) => {
      // Prevent logs list from growing infinitely (cap at 500 logs for high UI responsiveness)
      const logs = [...state.logs, line];
      if (logs.length > 500) {
        logs.shift();
      }
      return { logs };
    }),
  addLogLines: (lines) =>
    set((state) => {
      let logs = [...state.logs, ...lines];
      if (logs.length > 500) {
        logs = logs.slice(logs.length - 500);
      }
      return { logs };
    }),
  clearLogs: () => set({ logs: [] }),
  setLogcatFilter: (logcatFilter) => set({ logcatFilter }),
  setLogcatMinLevel: (logcatMinLevel) => set({ logcatMinLevel }),
  
  addNetworkRequest: (req) =>
    set((state) => {
      const idx = state.networkRequests.findIndex((r) => r.id === req.id);
      let networkRequests;
      if (idx !== -1) {
        // Update request
        networkRequests = [...state.networkRequests];
        networkRequests[idx] = req;
      } else {
        // Insert new request
        networkRequests = [...state.networkRequests, req];
      }
      return { networkRequests };
    }),
  setSelectedRequest: (selectedRequest) => set({ selectedRequest }),
  clearNetworkRequests: () => set({ networkRequests: [], selectedRequest: null }),
  setProxyEnabled: (proxyEnabled) => set({ proxyEnabled }),
  setProxyPort: (activeProxyPort) => set({ activeProxyPort }),
  setHostIp: (localHostIp) => set({ localHostIp }),
  
  setScreencapActive: (screencapActive) => set({ screencapActive }),
  setScreencapFrame: (screencapFrame) => set({ screencapFrame }),
  
  setKeyboardEnabled: (keyboardEnabled) => set({ keyboardEnabled }),
  setKeyboardMode: (keyboardMode) => set({ keyboardMode }),
  setKeymapProfile: (activeKeymapProfile) => set({ activeKeymapProfile }),
  updateKeymapProfile: (profileName, mapping) =>
    set((state) => ({
      keymapProfiles: {
        ...state.keymapProfiles,
        [profileName]: mapping,
      },
    })),

  // Mouse capture
  setCaptureActive: (captureActive) => set({ captureActive }),
  setCaptureMode: (captureMode) => set({ captureMode }),
  setCaptureWsPort: (captureWsPort) => set({ captureWsPort }),
  setCapturePermissionGranted: (capturePermissionGranted) => set({ capturePermissionGranted }),
  setVirtualCursorPos: (virtualCursorPos) => set({ virtualCursorPos }),
  setVirtualCursorPressed: (virtualCursorPressed) => set({ virtualCursorPressed }),
  setCaptureHideSystemCursor: (captureHideSystemCursor) => set({ captureHideSystemCursor }),
  setCaptureSensitivity: (captureSensitivity) => set({ captureSensitivity }),
  setCaptureDragThreshold: (captureDragThreshold) => set({ captureDragThreshold }),
  setCaptureWsClientCount: (captureWsClientCount) => set({ captureWsClientCount }),
}));
