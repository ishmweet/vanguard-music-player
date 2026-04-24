# Vanguard Player

> A free, open-source desktop music player built for people who actually listen.
> Stream from YouTube. Download for offline use. Own your music — no accounts, no ads, no subscriptions.

[![Platform](https://img.shields.io/badge/platform-Linux%20%7C%20Windows-informational?style=flat-square&logo=linux&logoColor=white)](https://github.com/ishmweet/vanguard-music-player/releases)
[![License](https://img.shields.io/badge/license-MIT-39FF14?style=flat-square)](LICENSE)
[![Tauri](https://img.shields.io/badge/Tauri-v2-FFC131?style=flat-square&logo=tauri&logoColor=white)](https://tauri.app)
[![Rust](https://img.shields.io/badge/Rust-stable-CE422B?style=flat-square&logo=rust&logoColor=white)](https://www.rust-lang.org)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev)

**[Download](https://github.com/ishmweet/vanguard-music-player/releases) · [Build from Source](#building-from-source) · [Report a Bug](https://github.com/ishmweet/vanguard-music-player/issues)**

---

## What is Vanguard Player?

Vanguard Player is a native desktop music application that treats `mpv` as its audio engine and `yt-dlp` as its streaming backend, wrapped inside a Tauri v2 shell (Rust + React). The result is a player with near-zero resource overhead, full system integration on both Linux and Windows, and none of the baggage that comes with a web-based music service.

> No account required. No telemetry. No ads. No cloud dependency beyond YouTube itself.

---

## Features

### 🔍 Streaming & Search
- Search YouTube directly from the app — results appear as a track list with thumbnails, artist, and duration
- Stream audio instantly via `yt-dlp` + `mpv` IPC — no video, no buffering delay
- Search history dropdown (up to 8 recent queries) with one-click re-search
- **Quick Picks** — a strip of your 20 most recently played tracks on the home screen for instant replay
- **Genre Shelves** — home screen auto-detects genres from your listening history and groups tracks into horizontal scrollable shelves (Hip-Hop, EDM, Pop, Rock, R&B, Lo-Fi, K-Pop, Phonk, and more)

### 📁 Offline Library
- Point Vanguard at any folder and it scans instantly, then enriches metadata in the background without blocking the UI
- Filter your library in real time — zero latency, pure in-memory search
- Drag-to-reorder tracks (disabled automatically while searching)
- Rename any file directly from the UI — applied on disk
- Delete files from within the app
- Show any track in your system file manager
- Export your entire library as an M3U playlist

### ⬇️ Downloads
- Download any YouTube track with one click from search results, right-click menu, or the **download button beside the heart icon** in the player bar
- Choose your **audio format**: MP3, Opus, M4A, or FLAC
- Choose your **quality**: High (320kbps+), Medium (~128kbps), or Low
- **Embed Thumbnail** — cover art written directly into file metadata tags
- All metadata (title, artist, album) embedded automatically
- **Duplicate Detection** — scans your download folder before downloading and skips if the track already exists

### 🎵 Playlists
- Create, name, and describe playlists; edit or delete at any time
- Upload a custom cover image for any playlist (except Liked Songs)
- Drag-to-reorder playlists in the sidebar and tracks within playlists
- **Search within a playlist** — filter tracks by title or artist in real time
- **Liked Songs** — built-in smart playlist; heart any track anywhere in the app to add it
- **Import from Spotify** — export your Spotify playlist as a CSV via [exportify.net](https://exportify.net), upload it, and Vanguard matches each track against YouTube with a live progress feed. Minimize the import window while it runs — a **name & description popup appears automatically when matching completes**, even if the window was closed
- **Import from YouTube** — paste any public YouTube playlist URL for instant import

### 📋 Queue
- Add any track to the persistent queue from search results, playlists, or right-click menus
- Drag-to-reorder the queue at any time
- Queue survives across sessions

### ▶️ Playback Engine
- **mpv backend** via IPC socket (Unix) / named pipe (Windows) — full codec support, hardware decoding
- **Shuffle**, **Repeat** (Off / All / One), **Playback speed** (0.5×–2×)
- **Volume control** — slider, scroll wheel, mute with memory
- **Seek bar** — click or drag; waveform visualisation overlay on local files
- **A-B Loop** — loop any segment continuously until cleared
- **Bookmarks** — save one position per track, restored on next play
- **Continue Where Left Off** — saves position every 5 seconds per track
- **Next-track prefetching** — first queued track pre-fetched in background
- **EBU R128 Loudness Normalisation** — optional loudnorm filter for consistent volume
- **Skip Silence** — auto-skips silent segments via mpv `silencedetect` filter
- **3-Band Equalizer** — real-time bass, mid, and treble adjustment (−12dB to +12dB) applied live via mpv audio filters; reset to flat with one click

### 🎤 Lyrics
- Synced lyrics with **real-time line highlighting** that scrolls automatically as the song plays — click any line to seek
- **Immersive full-screen view** — full-screen blurred album art background, left panel with cover, progress bar, controls, and audio output switcher; right panel with scrolling lyrics
- **Lyrics Source** selector in Settings → Playback: choose between **lrclib** (open, fast), **Musixmatch** (word-level richsync), or **NetEase** (best for C-pop / K-pop). Automatically falls back to lrclib → lyrics.ovh if primary source fails

### 🔊 Audio Output
- **Live device list** in Settings → Playback shows all active output devices with their form factor (headphones / speaker)
- **Switch output instantly** without restarting playback — on Linux all active streams are moved to the new sink via `pactl move-sink-input`; on Windows switching uses the **Windows Core Audio IPolicyConfig COM interface** (same mechanism used by EarTrumpet / SoundSwitch — no external modules or installs required, works on Win7–Win11)
- **Audio output dropdown in the immersive lyrics view** — switch devices without leaving the lyrics screen

### 🖥️ System Tray *(optional)*
Enable in Settings → Appearance. Once active:
- **Left-click** the tray icon to show/hide the window
- **Tray menu**: Play/Pause, Next, Previous, Show, Quit
- Closing the window hides to tray instead of exiting
- Tray events fire `tray_play_pause`, `tray_next`, `tray_prev` — wired to the same handlers as MPRIS and media keys

### ⌨️ Controls & Shortcuts

| Action | Shortcut |
|--------|----------|
| Play / Pause | `Space` |
| Seek forward 10s | `→` |
| Seek backward 10s | `←` |
| Mute / Unmute | `M` |
| Focus search bar | `Ctrl+F` |
| Play / Pause (media key) | Hardware key |
| Next track (media key) | Hardware key |
| Previous track (media key) | Hardware key |

Media keys are registered globally and work even when the app is not in focus.

### 🐧 MPRIS2 Integration (Linux)
Vanguard registers a full `org.mpris.MediaPlayer2.vanguard` D-Bus service. Works with **playerctl**, **KDE Connect**, **GNOME Shell extensions**, and any MPRIS2-compatible widget.

### 📊 Stats
Total listen time displayed as a large HH:MM:SS counter with neon glow separators.

### 🌙 Sleep Timer
Preset buttons (5–90 min) or custom input. Live countdown in sidebar. Cancellable at any time.

### 🖱️ Right-Click Context Menus
Available on every track in every view: Play, Add to Queue, Add to Playlist, Download, Copy URL, Copy Title, Open in YouTube, Track Info. Right-click on playlist cards: Play All, Rename, Change Cover, Delete.

### ⚙️ Settings
- **Downloads** — quality, format, folder, embed thumbnail, duplicate detection
- **Playback** — loudnorm, stream quality, skip silence, audio output device switcher, lyrics source selector, equalizer (bass / mid / treble, real-time via mpv)
- **Storage** — backup, restore, reset
- **Appearance** — system tray toggle
- **Updates** — automatic update check against GitHub Releases on startup

### 💾 Backup & Restore
Export all playlists, queue, play history, EQ settings, search history, Quick Picks, and preferences as a single JSON file. Restore or reset at any time.

---

## Installation

### Linux — Debian / Ubuntu / Mint

```bash
sudo apt install ./vanguard-player_<version>_amd64.deb
```

`apt` resolves and installs all required system dependencies automatically: `mpv`, `yt-dlp`, `ffmpeg`, `ffprobe`.

> For system tray support on GNOME, install `libayatana-appindicator3-1`.

Launch from your application menu or run:

```bash
vanguard-player
```

### Windows

Download and run the `.exe` installer from the [Releases](https://github.com/ishmweet/vanguard-music-player/releases) page. The NSIS installer bundles all required binaries (`mpv`, `yt-dlp`, `ffmpeg`, `ffprobe`) and extracts them to `%LOCALAPPDATA%\Programs\vanguard-deps\` on first launch. No additional setup required.

---

## Building from Source

### Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| [Node.js](https://nodejs.org/) | 18+ | Frontend build |
| [Rust](https://rustup.rs/) | stable | `rustup install stable` |
| [Tauri CLI](https://tauri.app/start/prerequisites/) | v2 | `cargo install tauri-cli --version "^2"` |

### Linux — System Dependencies

```bash
sudo apt install mpv yt-dlp ffmpeg libssl-dev pkg-config \
  libwebkit2gtk-4.1-dev libgtk-3-dev \
  libayatana-appindicator3-dev librsvg2-dev
```

### Windows — Bundled Binaries

Download `binaries.zip` from the [Releases](https://github.com/ishmweet/vanguard-music-player/releases) page and extract into `src-tauri/binaries/`:

```
src-tauri/binaries/
├── mpv-x86_64-pc-windows-msvc.exe
├── yt-dlp-x86_64-pc-windows-msvc.exe
├── ffmpeg-x86_64-pc-windows-msvc.exe
└── ffprobe-x86_64-pc-windows-msvc.exe
```

### Clone & Build

```bash
git clone https://github.com/ishmweet/vanguard-music-player.git
cd vanguard-music-player
npm install
cargo tauri build
```

| Platform | Output path |
|---|---|
| Linux `.deb` | `src-tauri/target/release/bundle/deb/` |
| Windows `.exe` | `src-tauri/target/release/bundle/nsis/` |

### Development Mode

```bash
cargo tauri dev
```

---

## How It Works

### Audio Pipeline

```
YouTube URL
    │
    ▼
yt-dlp (audio extraction, stdout pipe)
    │
    ▼
mpv (IPC-controlled via Unix socket / Windows named pipe)
    │
    ▼
System audio output (PipeWire / PulseAudio / DirectSound / WASAPI)
```

### Audio Device Switching

On **Linux**: `pactl set-default-sink` + `pactl move-sink-input` moves all active streams to the new device instantly without restarting mpv.

On **Windows**: Vanguard calls `IPolicyConfig::SetDefaultEndpoint` directly via the Windows Core Audio COM API — the same undocumented-but-stable interface used by EarTrumpet and SoundSwitch. No PowerShell modules, no third-party tools, works on Windows 7 through 11.

### Lyrics Pipeline

```
Track title + artist
    │
    ▼
Parallel fetch: primary source (lrclib / Musixmatch / NetEase) + fallbacks
    │
    ▼
LRC timestamps parsed → line-by-line sync against mpv progress
    │
    ▼
Immersive full-screen view with auto-scroll + seek-on-click
```

### Spotify Import Flow

```
User exports CSV from exportify.net
    │
    ▼
Vanguard parses CSV → extracts title + artist pairs
    │
    ▼
Up to 12 concurrent yt-dlp searches run in parallel
    │
    ▼
Each match/failure updates the live progress list
    │
    ▼ (even if window was minimized)
Name & description popup appears when matching completes
    │
    ▼
Playlist saved to localStorage
```

---

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| UI Framework | React 19 + TypeScript | Component rendering, state management |
| Styling | Tailwind CSS | Utility-first CSS |
| Icons | lucide-react | All UI icons |
| Desktop Shell | Tauri v2 | Native window, IPC bridge, file system |
| Backend | Rust (stable) | All system operations |
| Audio Engine | mpv | Decoding and playback via IPC |
| Streaming / Download | yt-dlp | YouTube search, streaming, downloading |
| Media Info | ffprobe / ffmpeg | Metadata, waveform generation, format conversion |
| Audio Devices (Windows) | windows crate (IPolicyConfig) | Native Core Audio device switching |
| MPRIS2 | zbus 3 | D-Bus integration on Linux |
| Global Shortcuts | tauri-plugin-global-shortcut | Hardware media key support |
| File Dialogs | tauri-plugin-dialog | Folder/file pickers |
| URL Opening | tauri-plugin-opener | Opening links in system browser |
| HTTP | reqwest | Lyrics fetching, GitHub update check |

---

## Project Structure

```
vanguard-music-player/
├── src/
│   └── App.tsx                   # Entire React UI
├── src-tauri/
│   ├── src/
│   │   ├── main.rs               # Rust backend
│   │   ├── tray.rs               # System tray (Linux + Windows)
│   │   └── audio_device.rs       # Audio device listing + switching
│   ├── build.rs
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── tauri.windows.conf.json
│   ├── icons/
│   └── binaries/                 # Windows-only bundled executables
├── public/
├── index.html
├── package.json
└── vite.config.ts
```

---

## Data & Privacy

All application state is stored locally in the webview's `localStorage` under `vg_*` prefixed keys. No database, no cloud sync, no external server. The only network requests Vanguard makes:

| Request | When | Purpose |
|---|---|---|
| YouTube search / stream | When you search or play | Via yt-dlp |
| YouTube thumbnail images | When displaying track art | Direct img src |
| lrclib / Musixmatch / NetEase | When lyrics are opened | Synced lyrics fetch |
| GitHub Releases API | Once on startup | Update check |

No usage data, crash reports, or analytics are ever collected or transmitted.

---

## Contributing

Pull requests are welcome. For major changes, please open an issue first.

```bash
git clone https://github.com/your-username/vanguard-music-player.git
cd vanguard-music-player
npm install
cargo tauri dev
```

---

## License

MIT © [ishmweet](https://github.com/ishmweet)

---

*Built with Rust, React, and a stubborn belief that music software shouldn't interrupt your listening with ads.*