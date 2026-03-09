# Vanguard Player

A free, open-source desktop music player. Stream anything from YouTube with no ads, no tracking, and no subscriptions. Just music.

![Platform](https://img.shields.io/badge/platform-Linux%20%7C%20Windows-informational?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)
![Tauri](https://img.shields.io/badge/Tauri-v2-blue?style=flat-square)

---

## Features

- Stream audio directly from YouTube via yt-dlp and mpv
- Import and manage local music files
- Playlist creation and management
- Waveform visualization and audio metadata display
- Loudness normalization
- Sleep timer
- Download tracks for offline playback
- Queue management with shuffle and repeat modes
- Backup and restore library data

---

## Installation

### Linux (Debian / Ubuntu)

Download the latest `.deb` package from the [Releases](../../releases) page.

```bash
sudo apt install ./vanguard-player_<version>_amd64.deb
```

`apt` will automatically install all required dependencies (`mpv`, `yt-dlp`, `ffmpeg`) alongside the application.

Once installed, launch Vanguard Player from your application menu or run:

```bash
vanguard-player
```

---

### Windows

Download the latest `.exe` installer from the [Releases](../../releases) page.

Run the installer and follow the prompts. All required binaries (`mpv`, `yt-dlp`, `ffmpeg`, `ffprobe`) are bundled inside the installer — no additional setup is needed.

Once installed, launch Vanguard Player from the Start Menu or desktop shortcut.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Tailwind CSS |
| Backend | Rust, Tauri v2 |
| Audio | mpv (IPC-controlled) |
| Streaming | yt-dlp |
| Media info | ffprobe / ffmpeg |

---

## Building from Source

### Prerequisites

- [Node.js](https://nodejs.org/) v18 or later
- [Rust](https://rustup.rs/) (stable toolchain)
- [Tauri CLI](https://tauri.app/start/prerequisites/) v2

On Linux, also install the system dependencies:

```bash
sudo apt install mpv yt-dlp ffmpeg libwebkit2gtk-4.1-dev \
  libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
```

On Windows, the required binaries need to be placed in `src-tauri/binaries/` before building. See [`scripts/fetch-windows-deps.ps1`](scripts/fetch-windows-deps.ps1) for the automated download script.

### Build

```bash
git clone https://github.com/ishmweet/vanguard-music-player.git
cd vanguard-player
npm install
cargo tauri build
```

The output package will be at:

- **Linux:** `src-tauri/target/release/bundle/deb/`
- **Windows:** `src-tauri/target/release/bundle/nsis/`

For development with hot reload:

```bash
cargo tauri dev
```

---

## License

MIT