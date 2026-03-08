<div align="center">

# 🎵 Vanguard Player

**A free, open-source, ad-free music player for Windows and Linux.**  
High-fidelity audio playback · YouTube streaming · Library management · Zero tracking · Zero paywalls.

![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux-blue)
![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri-orange)
![GitHub](https://img.shields.io/badge/GitHub-ishmweet-black?logo=github)

</div>

---

## 📖 Overview

Vanguard Player is a desktop music application built with Tauri (Rust backend) and React (TypeScript frontend). It lets you stream music from YouTube, manage local audio libraries, create playlists, download tracks, and enjoy high-quality audio — all without ads, tracking, or paywalls.

---

## ✨ Features

- 🔍 **YouTube Search & Streaming** — Search and play YouTube audio directly via `yt-dlp` + `mpv`
- 📁 **Local Library** — Scan and play local audio files (MP3, FLAC, OGG, WAV, and more)
- 📋 **Playlist Management** — Create, edit, reorder, and delete playlists; import/export M3U
- ⬇️ **Track Downloads** — Download individual tracks or batch download entire playlists
- 🎛️ **Equalizer** — Built-in EQ with adjustable bands
- ⏱️ **Sleep Timer** — Auto-stop playback after a set duration
- 🔁 **Playback Modes** — Shuffle, repeat all, repeat one
- 🏷️ **Bulk Tag Editor** — Edit track titles and artists in bulk within playlists
- 📊 **Audio Info** — View codec, bitrate, sample rate, and channel details
- 💾 **Stream Cache** — Configurable disk caching for streams to reduce bandwidth usage
- 🎚️ **Playback Speed Control** — Adjust speed without pitch distortion
- 📤 **M3U Import / Export** — Interoperable playlist files
- 🔊 **Audio Normalization** — Normalize loudness of downloaded files via `ffmpeg`
- 🌐 **Landing Page** — Polished marketing site (`index.html`) with SEO, OG tags, and animated UI

---

## 🖥️ Supported Platforms

| Platform | Status |
|----------|--------|
| Linux (x86_64) | ✅ Fully supported |
| Windows 10/11 | ✅ Fully supported |
| macOS | ❌ Not supported |

---

## 🚀 Installation

Download the latest release for your platform from the Releases page on GitHub.

### Linux
Download the `.AppImage` or `.deb` package and run it directly. You will also need the [runtime dependencies](#runtime-dependencies) installed.

### Windows
Download and run the `.msi` or `.exe` installer. Runtime dependencies can be installed automatically from within the app via **Settings → Dependencies → Auto-Install**.

---

## ⚙️ Runtime Dependencies

Vanguard Player relies on three external tools at runtime. The app checks for these on startup and can attempt to install them automatically on supported platforms.

| Dependency | Purpose |
|------------|---------|
| `mpv` | Audio playback engine (streams & local files via IPC socket) |
| `yt-dlp` | YouTube search, streaming URL resolution, and downloads |
| `ffmpeg` / `ffprobe` | Audio metadata, waveform generation, and normalization |

> **Tip:** On Linux, you can install these manually or let the in-app auto-installer attempt it. On Windows, auto-install uses `winget` or `chocolatey`.

---

## 🛠️ For Development

### Prerequisites

Before building Vanguard Player, you need to install the following on your system:

- Node.js (v18 or later) + npm
- Rust (stable toolchain)
- Tauri CLI
- The [runtime dependencies](#runtime-dependencies): `mpv`, `yt-dlp`, `ffmpeg`

---

### Installing Development Dependencies by OS

---

#### 🐧 Debian / Ubuntu / Linux Mint / Pop!_OS

```bash
# System packages
sudo apt update
sudo apt install -y curl build-essential libssl-dev libgtk-3-dev \
  libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf \
  mpv ffmpeg python3-pip

# yt-dlp (via pip, latest version)
pip3 install --upgrade --user yt-dlp

# Node.js (via NodeSource)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"

# Tauri CLI
cargo install tauri-cli
```

---

#### 🎩 Arch Linux / Manjaro / EndeavourOS

```bash
# System packages
sudo pacman -Syu --noconfirm
sudo pacman -S --noconfirm base-devel curl openssl gtk3 webkit2gtk \
  libappindicator-gtk3 librsvg mpv ffmpeg python-pip nodejs npm

# yt-dlp (via pip)
pip install --upgrade --user yt-dlp
# Or via pacman (may be slightly older)
# sudo pacman -S yt-dlp

# Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"

# Tauri CLI
cargo install tauri-cli
```

---

#### 🎩 Fedora / RHEL / AlmaLinux / Rocky Linux

```bash
# System packages
sudo dnf groupinstall -y "Development Tools"
sudo dnf install -y curl openssl-devel gtk3-devel webkit2gtk4.1-devel \
  libappindicator-gtk3-devel librsvg2-devel mpv ffmpeg python3-pip nodejs npm

# yt-dlp (via pip)
pip3 install --upgrade --user yt-dlp

# Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"

# Tauri CLI
cargo install tauri-cli
```

> **Note:** `ffmpeg` and `mpv` may require enabling RPM Fusion repositories on Fedora:
> ```bash
> sudo dnf install -y https://download1.rpmfusion.org/free/fedora/rpmfusion-free-release-$(rpm -E %fedora).noarch.rpm
> ```

---

#### 🦎 openSUSE Leap / Tumbleweed

```bash
# System packages
sudo zypper refresh
sudo zypper install -y curl gcc openssl-devel gtk3-devel webkit2gtk3-devel \
  libappindicator3-1 librsvg-devel mpv ffmpeg python3-pip nodejs npm

# yt-dlp (via pip)
pip3 install --upgrade --user yt-dlp

# Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"

# Tauri CLI
cargo install tauri-cli
```

---

#### 🪟 Windows 10 / 11

> Requires PowerShell (run as Administrator) or Windows Terminal.

```powershell
# Install winget if not already available (it ships with Windows 10 1709+)
# Then install Node.js
winget install --id OpenJS.NodeJS -e --accept-source-agreements

# Install Rust
winget install --id Rustlang.Rustup -e --accept-source-agreements
# Then restart your terminal and run:
rustup toolchain install stable

# Install mpv and ffmpeg
winget install --id mpv.net -e --accept-source-agreements
winget install --id Gyan.FFmpeg -e --accept-source-agreements

# Install yt-dlp
winget install --id yt-dlp.yt-dlp -e --accept-source-agreements
# Or via pip:
pip install --upgrade yt-dlp

# Install Tauri CLI
cargo install tauri-cli
```

> Alternatively, you can use Chocolatey:
> ```powershell
> choco install nodejs rust mpv ffmpeg yt-dlp -y
> cargo install tauri-cli
> ```

---

### Cloning & Running the Project

```bash
# Clone the repository
git clone https://github.com/your-username/vanguard-player.git
cd vanguard-player

# Install JavaScript dependencies
npm install

# Run in development mode (hot-reload)
cargo tauri dev

# Build a production release
cargo tauri build
```

The built binary and installers will be in `src-tauri/target/release/bundle/`.


---

## 🤝 Contributing

Contributions, issues, and feature requests are welcome. Feel free to open a PR or issue on GitHub.


---

## 📄 License

MIT — free and open source, always.

---
