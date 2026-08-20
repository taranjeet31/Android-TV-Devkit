# 📺 TVDev Studio

> A native desktop developer toolbox for Android TV — built with Tauri, React, and Rust.

TVDev Studio is a powerful all-in-one dev controller for Android TV devices. It wraps ADB, screen mirroring, network inspection, logcat streaming, and virtual remote control into a polished desktop UI — so you never have to juggle terminal tabs during development.

---

## ✨ Features

| Module | Description |
|---|---|
| **Device Manager** | Discover and connect to ADB devices over USB or Wi-Fi |
| **Studio Workspace** | Multi-panel layout for simultaneous tool access |
| **Virtual Remote** | On-screen D-pad, media keys, and volume controls sent as ADB keycodes |
| **Keyboard Profiles** | Map physical keyboard shortcuts to custom ADB keycodes |
| **Mouse Capture** | Lock cursor to TV viewport and relay pointer events as D-pad/clicks (`⌘⇧L` to release) |
| **Screen Mirroring** | Live device screen stream via `scrcpy` / ADB forwarding |
| **Network Inspector** | HTTP proxy with request/response capture for in-app traffic analysis |
| **Logcat Streamer** | Filtered, colour-coded logcat output with search and auto-scroll |

---

## 🖥️ Tech Stack

- **Frontend** — React 19 + TypeScript, Vite, Zustand, Lucide icons
- **Backend** — Rust (Tauri 2), Tokio async runtime, `tokio-tungstenite`
- **IPC** — Tauri commands and events bridge the UI to native ADB & system APIs
- **macOS extras** — `core-graphics` + `core-foundation` for native mouse capture

---

## 🚀 Getting Started

### Prerequisites

| Tool | Version |
|---|---|
| Node.js | ≥ 18 |
| Rust | stable (via [rustup](https://rustup.rs)) |
| Tauri CLI | v2 (`npm install -g @tauri-apps/cli`) |
| ADB | In `$PATH` (`brew install android-platform-tools`) |

### Install dependencies

```bash
npm install
```

### Run in development

```bash
npm run tauri dev
```

### Build for production

```bash
npm run tauri build
```

The distributable app (`.dmg` / `.app`) is output to `src-tauri/target/release/bundle/`.

---

## 📁 Project Structure

```
tv-dev-controller/
├── src/                      # React frontend
│   ├── components/           # Feature panels
│   │   ├── DeviceManager.tsx
│   │   ├── StudioWorkspace.tsx
│   │   ├── VirtualRemote.tsx
│   │   ├── KeyboardMapper.tsx
│   │   ├── MouseCapture.tsx
│   │   ├── ScreenMirror.tsx
│   │   ├── NetworkInspector.tsx
│   │   └── LogcatViewer.tsx
│   ├── store/
│   │   └── useDeviceStore.ts # Global Zustand state
│   ├── App.tsx
│   └── App.css
├── src-tauri/                # Rust backend
│   ├── src/
│   │   ├── adb/              # ADB command wrappers
│   │   ├── input/            # Key/mouse event routing
│   │   ├── mouse_capture/    # Native cursor lock (macOS)
│   │   ├── network/          # HTTP proxy & inspector
│   │   ├── debug/            # Logcat streaming
│   │   └── lib.rs            # Tauri command registry
│   └── tauri.conf.json
└── vite.config.ts
```

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `⌘⇧L` | Release mouse from TV capture mode |

---

## 🔌 Connecting a Device

**USB:**
1. Enable **Developer Options** and **USB Debugging** on your Android TV.
2. Plug in via USB — the device should appear in Device Manager automatically.

**Wi-Fi (ADB over TCP):**
1. Connect TV and Mac to the same network.
2. In Device Manager, enter the TV's IP and click **Connect**.

---

## 📝 License

MIT — feel free to fork and adapt for your workflow.
