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

The design language is deliberate: near-black backgrounds, neon green (`#39FF14`) as the sole accent colour, monospace typography for numbers and paths. Minimal. Terminal-inspired. Every interaction has a clear purpose.

> No account required. No telemetry. No ads. No cloud dependency beyond YouTube itself.

---

## Features

### 🔍 Streaming & Search
- Search YouTube directly from the app — results appear as a track list with thumbnails, artist, and duration
- Stream audio instantly via `yt-dlp` + `mpv` IPC — no video, no buffering delay
- Search history dropdown (up to 8 recent queries) with one-click re-search
- **Quick Picks** — a strip of your 20 most recently played tracks on the home screen for instant replay
- Audio chunks are cached to disk so re-playing a recent stream is instant

### 📁 Offline Library
- Point Vanguard at any folder and it scans instantly, then enriches metadata (title, artist, duration) in the background without blocking the UI
- Filter your library in real time — zero latency, pure in-memory search
- Drag-to-reorder tracks (disabled automatically while searching)
- Rename any file directly from the UI — the rename is applied on disk
- Delete files from within the app
- Show any track in your system file manager
- Export your entire library as an M3U playlist

### ⬇️ Downloads
- Download any YouTube track with one click from search results or right-click menu
- Choose your **audio format**: MP3, Opus, M4A, or FLAC
- Choose your **quality**: High (320kbps+), Medium (~128kbps), or Low
- **Embed Thumbnail** — cover art is written directly into the file's metadata tags
- All metadata (title, artist, album) is embedded automatically
- **Duplicate Detection** — scans your download folder before downloading and skips if the track already exists (matched by title, case-insensitive)

### 🎵 Playlists
- Create, name, and describe playlists; edit or delete them at any time
- Upload a custom cover image for any playlist
- Drag-to-reorder playlists in the sidebar and tracks within playlists
- **Search within a playlist** — filter tracks by title or artist in real time
- **Liked Songs** — a built-in smart playlist. Heart any track anywhere in the app to add it. The cover is permanently a heart icon and cannot be changed
- **Import from Spotify** — export your Spotify playlist as a CSV file using [exportify.net](https://exportify.net), upload it, and Vanguard automatically matches each track against YouTube with a live progress feed showing match/fail status for every song
- **Import from YouTube** — paste any public YouTube playlist URL and it imports instantly — no matching needed, all tracks map directly

### 📋 Queue
- Add any track to the persistent queue from search results, playlists, or right-click menus
- Drag-to-reorder the queue at any time
- Remove individual tracks from the queue without interrupting playback
- Queue survives across sessions

### ▶️ Playback Engine
- **mpv backend** via IPC socket (Unix) / named pipe (Windows) — full codec support, hardware decoding
- **Shuffle** across the current context (queue, playlist, or offline library)
- **Repeat modes** — Off, Repeat All, Repeat One
- **Playback speed** — 0.5×, 0.75×, 1×, 1.25×, 1.5×, 2×
- **Volume control** — slider and scroll wheel; mute/unmute with memory of previous level
- **Seek bar** — click or drag anywhere to seek; waveform visualisation overlay on local files
- **A-B Loop** — set a loop start point (A) and end point (B) anywhere in a track; the player loops that segment continuously until cleared
- **Bookmarks** — save one position per track; the player jumps to the bookmark when the track is next played
- **Continue Where Left Off** — saves your position every 5 seconds per track; resumes automatically on next play (works for both streaming and local files)
- **Next-track prefetching** — the first queued track is pre-fetched in the background for faster transitions
- **EBU R128 Loudness Normalisation** — optional loudnorm filter equalises perceived volume across all tracks; can be disabled for a ~100ms faster playback start

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

Media keys are registered globally via `tauri-plugin-global-shortcut` on both Linux and Windows and work even when the app is not in focus.

### 🐧 MPRIS2 Integration (Linux)
Vanguard registers a full `org.mpris.MediaPlayer2.vanguard` D-Bus service on the session bus. This means:
- **playerctl** works: `playerctl play-pause`, `playerctl next`, `playerctl metadata`
- **KDE Connect** can control playback from your phone
- **GNOME Shell extensions** and taskbar widgets display Now Playing info
- All metadata (title, artist, cover art URL, duration) and playback state are pushed in real time via `PropertiesChanged` signals

### 📊 Stats
- **Total listen time** — displayed as a large HH:MM:SS counter with neon green glow separators

### 🌙 Sleep Timer
Preset buttons (5, 10, 15, 20, 30, 45, 60, 90 minutes) or custom input. A live countdown shows in the sidebar while active. Cancellable at any time. When it expires, playback pauses automatically.

### 🖱️ Right-Click Context Menus
Available on every track in every view (search results, queue, playlists, Quick Picks):
- Play, Add to Queue, Add to Playlist, Download, Copy URL, Copy Title, Open in YouTube, Track Info

Available on playlist cards:
- Play All, Rename, Change Cover, Delete

### 💾 Backup & Restore
- **Backup** — exports everything (all playlists, queue, play history, EQ settings, search history, Quick Picks, playback preferences) as a single JSON file
- **Restore** — imports a backup JSON and restores all state
- **Reset** — clears all data and returns the app to its default state

### 🔄 Automatic Update Check
On startup, Vanguard queries the GitHub Releases API and compares the running version against the latest release. If a newer version exists, a notification card appears in Settings → Updates and a small green dot appears on the Settings icon in the sidebar.

---

## Installation

### Linux — Debian / Ubuntu / Mint

Download the latest `.deb` package from the [Releases](https://github.com/ishmweet/vanguard-music-player/releases) page.

```bash
sudo apt install ./vanguard-player_<version>_amd64.deb
```

`apt` resolves and installs all required system dependencies automatically:
`mpv`, `yt-dlp`, `ffmpeg`, `ffprobe`

Launch from your application menu or run:

```bash
vanguard-player
```

### Windows

Download and run the `.exe` installer from the [Releases](https://github.com/ishmweet/vanguard-music-player/releases) page.

The NSIS installer bundles all required binaries (`mpv`, `yt-dlp`, `ffmpeg`, `ffprobe`) and extracts them to `%LOCALAPPDATA%\Programs\vanguard-deps\` on first launch. No additional setup is required.

---

## Building from Source

### Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| [Node.js](https://nodejs.org/) | 18+ | For the frontend build |
| [Rust](https://rustup.rs/) | stable | `rustup install stable` |
| [Tauri CLI](https://tauri.app/start/prerequisites/) | v2 | `cargo install tauri-cli --version "^2"` |

### Linux — System Dependencies

```bash
sudo apt install mpv yt-dlp ffmpeg \
  libwebkit2gtk-4.1-dev libgtk-3-dev \
  libayatana-appindicator3-dev librsvg2-dev
```

### Windows — Bundled Binaries

Download `binaries.zip` from the [Releases](https://github.com/ishmweet/vanguard-music-player/releases) page and extract the contents into `src-tauri/binaries/`:

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

Output packages will be at:

| Platform | Path |
|---|---|
| Linux `.deb` | `src-tauri/target/release/bundle/deb/` |
| Windows `.exe` | `src-tauri/target/release/bundle/nsis/` |

### Development Mode

```bash
cargo tauri dev
```

Hot reload is active on both the React frontend (via Vite) and the Rust backend (via `cargo watch`). The terminal window visible during `cargo tauri dev` is the dev runner — it does not appear in production builds.

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
System audio output (PipeWire / PulseAudio / DirectSound)
```

Vanguard never downloads a full video. yt-dlp extracts the audio stream directly and pipes it to mpv, which handles decoding and output. All playback control (seek, pause, volume, speed, EQ, position polling) happens over the IPC socket using JSON commands.

### Local File Playback

Local files bypass yt-dlp entirely. The file path is passed directly to mpv via `play_local_file`. ffprobe reads the file's metadata (title, artist, duration, codec, bitrate) and ffmpeg generates waveform amplitude data for the visualisation in the seek bar.

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
Each match (or failure) updates the live progress list
    │
    ▼
User names the playlist → saved to localStorage
```

### YouTube Playlist Import Flow

```
User pastes playlist URL
    │
    ▼
yt-dlp fetches all video metadata from the playlist
    │
    ▼
Tracks are imported directly with YouTube IDs
(no matching step needed)
    │
    ▼
User names the playlist → saved to localStorage
```

---

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| UI Framework | React 19 + TypeScript | Component rendering, state management |
| Styling | Tailwind CSS | Utility-first CSS |
| Icons | lucide-react | All UI icons |
| Desktop Shell | Tauri v2 | Native window, IPC bridge, file system access |
| Backend | Rust (stable) | All system operations |
| Audio Engine | mpv | Decoding and playback via IPC |
| Streaming / Download | yt-dlp | YouTube search, streaming, downloading |
| Media Info | ffprobe / ffmpeg | Metadata reading, waveform generation, format conversion |
| MPRIS2 | zbus 3 | D-Bus integration on Linux |
| Global Shortcuts | tauri-plugin-global-shortcut | Hardware media key support |
| File Dialogs | tauri-plugin-dialog | Folder/file pickers |
| URL Opening | tauri-plugin-opener | Opening links in the system browser |
| HTTP | reqwest | GitHub update check |

---

## Project Structure

```
vanguard-music-player/
├── src/
│   └── App.tsx              # Entire React UI (~3,700 lines)
├── src-tauri/
│   ├── src/
│   │   └── main.rs          # Rust backend (~1,800 lines)
│   ├── build.rs             # Build script (Windows subsystem flags)
│   ├── Cargo.toml           # Rust dependencies
│   ├── tauri.conf.json      # Tauri configuration
│   ├── icons/               # App icons (all sizes)
│   └── binaries/            # Windows-only bundled executables
├── public/
├── index.html
├── package.json
└── vite.config.ts
```

---

## Data & Privacy

All application state is stored locally in the webview's `localStorage` under `vg_*` prefixed keys. There is no database, no cloud sync, and no external server. The only network requests Vanguard makes are:

| Request | When | Purpose |
|---|---|---|
| YouTube search / stream | When you search or play | Via yt-dlp |
| YouTube thumbnail images | When displaying track art | Direct img src |
| GitHub Releases API | Once on startup | Update check |

No usage data, crash reports, or analytics are ever collected or transmitted.

---

## Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you'd like to change.

```bash
# Fork the repo, then:
git clone https://github.com/your-username/vanguard-music-player.git
cd vanguard-music-player
npm install
cargo tauri dev
```

---

## License

MIT © [ishmweet](https://github.com/ishmweet)

---

<div align="center">

*Built with Rust, React, and a stubborn belief that music software shouldn't require an account.*