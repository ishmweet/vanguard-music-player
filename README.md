# Vanguard Player

> A free, open-source desktop music player. Stream anything from YouTube with no ads, no tracking, and no subscriptions. Download tracks, manage your local library, and own your music.

![Platform](https://img.shields.io/badge/platform-Linux%20%7C%20Windows-informational?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)
![Tauri](https://img.shields.io/badge/Tauri-v2-blue?style=flat-square)
![Rust](https://img.shields.io/badge/backend-Rust-orange?style=flat-square)
![React](https://img.shields.io/badge/frontend-React%2019-61DAFB?style=flat-square)

---

## Features

**Streaming & Search**
Search YouTube directly, stream audio instantly via yt-dlp + mpv, with search history and a Quick Picks strip of recently played tracks.

**Offline Library**
Scan a local folder, play any audio file, filter tracks instantly, drag to reorder, rename files, and export your library as an M3U playlist.

**Downloads**
Download any YouTube track in your choice of format (MP3, Opus, M4A, FLAC) and quality. Embeds cover art and metadata into files. Skips duplicates automatically.

**Playlists**
Create and manage playlists, import from Spotify (via Exportify CSV) or directly from a YouTube playlist URL, and maintain a Liked Songs collection.

**Queue**
A persistent, reorderable queue panel with full drag-to-reorder support that survives across sessions.

**Playback**
Full transport controls with seek, volume, playback speed, shuffle, three repeat modes, A-B loop, bookmarks, and a 3-band equalizer. Keyboard shortcuts and hardware media keys supported on both platforms.

---

## Installation

### Linux (Debian / Ubuntu)

```bash
sudo apt install ./vanguard-player_<version>_amd64.deb
```

All dependencies (`mpv`, `yt-dlp`, `ffmpeg`, `pulseaudio-utils`) are installed automatically by `apt`.

### Windows

Download and run the `.exe` installer from the [Releases](../../releases) page. All required binaries are bundled — no extra setup needed.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Tailwind CSS |
| Backend | Rust, Tauri v2 |
| Audio | mpv (IPC via socket / named pipe) |
| Streaming | yt-dlp |
| Media info | ffprobe / ffmpeg |
| MPRIS2 | zbus 3 (Linux) |

---

## Building from Source

**Prerequisites:** Node.js 18+, Rust stable, Tauri CLI v2.

**Linux** — install system dependencies:

```bash
sudo apt install mpv yt-dlp ffmpeg ffprobe pulseaudio-utils \
  libwebkit2gtk-4.1-dev libgtk-3-dev \
  libayatana-appindicator3-dev librsvg2-dev
```

**Windows** — download `binaries.zip` from the [Releases](../../releases) page and place the contents in `src-tauri/binaries/`:

```
src-tauri/binaries/
├── mpv-x86_64-pc-windows-msvc.exe
├── yt-dlp-x86_64-pc-windows-msvc.exe
├── ffmpeg-x86_64-pc-windows-msvc.exe
└── ffprobe-x86_64-pc-windows-msvc.exe
```

**Build:**

```bash
git clone https://github.com/ishmweet/vanguard-music-player.git
cd vanguard-music-player
npm install
cargo tauri build
```

For development with hot reload:

```bash
cargo tauri dev
```

---

## License

MIT