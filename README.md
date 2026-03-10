<div align="center">

# 🎵 Vanguard Player

**A free, open-source, ad-free music player for macOS, Windows, and Linux.**  
High-fidelity audio playback · YouTube streaming · Library management · Zero tracking · Zero paywalls.

![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)
![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-blue)
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
---

## 🖥️ Supported Platforms

| Platform | Status |
|----------|--------|
| Linux (x86_64) | ✅ Fully supported |
| Windows 10/11 | ✅ Fully supported |
| macOS | ✅ Fully supported |

---

## 🚀 Installation

### 📥 For End Users — Quick Start

#### macOS

**Step 1: Download**
- Go to the [GitHub Releases](https://github.com/shubhushubhu99/vanguard-music-player/releases) page
- Download the latest `.dmg` file (e.g., `vanguard-player_0.1.0_aarch64.dmg`)

**Step 2: Install the App**
1. Double-click the `.dmg` file to mount it
2. Drag the **vanguard-player** app icon to the **Applications** folder
3. Eject the DMG file (click the eject icon next to it in Finder)
4. **Open Applications folder** and find **vanguard-player.app**

**Step 3: Fix "Damaged" Error (Important!)**
When you first try to open the app, macOS may show:  
> "vanguard-player" is damaged and can't be opened. You should move it to the Bin.

This is normal for downloaded apps. Run this command in Terminal to fix it:

```bash
xattr -rd com.apple.quarantine /Applications/vanguard-player.app
```

Then double-click the app to launch it. ✅

**Alternative: Use Spotlight**
- Press `⌘ + Space` and type `vanguard`
- Press Enter to launch

**Step 4: Grant Permissions**
- On first launch, click **Open** when prompted by macOS security
- This is normal; the code is open-source and [available on GitHub](https://github.com/shubhushubhu99/vanguard-music-player)

**Step 5: Install Runtime Dependencies**
The app will check for required dependencies (`mpv`, `yt-dlp`, `ffmpeg`) on first launch.

**Option A: Let the app auto-install (Recommended)**
- The app will prompt you to install missing dependencies
- Click **Install Dependencies** → **Auto-Install**
- Enter your Mac password when prompted
- Homebrew will be installed automatically if needed

**Option B: Manual installation via Terminal**
```bash
# Install Homebrew first (if you don't have it)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Then install the dependencies
brew install mpv ffmpeg yt-dlp
```

**Done!** You can now search, stream, and download music. 🎵

---

#### Windows

**Step 1: Download**
- Go to [GitHub Releases](https://github.com/ishmweet/vanguard-player/releases)
- Download the `.msi` or `.exe` installer for your system

**Step 2: Install**
- Double-click the installer and follow the prompts
- The app will be added to your **Start Menu**

**Step 3: Install Runtime Dependencies**
On first launch, the app will detect missing dependencies.
- Click **Install Dependencies** → **Auto-Install**
- The system will use `winget` or `chocolatey` to install `mpv`, `ffmpeg`, and `yt-dlp`
- If auto-install fails, [install Chocolatey](https://chocolatey.org/install) and try again

---

#### Linux

**Step 1: Download**
- Go to [GitHub Releases](https://github.com/ishmweet/vanguard-player/releases)
- Download `.AppImage` (works on any Linux) or `.deb` (Ubuntu/Debian)

**Step 2: Install**

*For AppImage:*
```bash
chmod +x vanguard-player-*.AppImage
./vanguard-player-*.AppImage
```

*For .deb:*
```bash
sudo dpkg -i vanguard-player-*.deb
```

**Step 3: Install Runtime Dependencies**
```bash
# Ubuntu/Debian
sudo apt install mpv ffmpeg yt-dlp

# Fedora/RHEL
sudo dnf install mpv ffmpeg yt-dlp

# Arch
sudo pacman -S mpv ffmpeg yt-dlp
```

---

## ⚙️ Runtime Dependencies

Vanguard Player relies on three external tools at runtime. The app checks for these on startup and can attempt to install them automatically on supported platforms.

| Dependency | Purpose |
|------------|---------|
| `mpv` | Audio playback engine (streams & local files via IPC socket) |
| `yt-dlp` | YouTube search, streaming URL resolution, and downloads |
| `ffmpeg` / `ffprobe` | Audio metadata, waveform generation, and normalization |

> **Tip:** 
> - **Linux**: Install manually or let the in-app auto-installer attempt it.
> - **Windows**: Auto-install uses `winget` or `chocolatey`.
> - **macOS**: Auto-install uses Homebrew. Install it first from https://brew.sh if not already installed.

---

## 🛠️ For Developers — Build from Source

### macOS Development Setup

**Prerequisites:**
- macOS 10.13+
- Apple Silicon (M1/M2/M3) or Intel Mac

**Step 1: Install Xcode Command Line Tools**
```bash
xcode-select --install
```

**Step 2: Install Homebrew**
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

**Step 3: Install Dependencies**
```bash
brew install node rust mpv ffmpeg yt-dlp

# Verify installations
node --version    # v18+
rustc --version   # 1.70+
mpv --version
yt-dlp --version
```

**Step 4: Clone & Build**
```bash
# Clone the repository
git clone https://github.com/ishmweet/vanguard-player.git
cd vanguard-player

# Install JavaScript dependencies
npm install

# Install Tauri CLI
cargo install tauri-cli

# Run in development mode (hot-reload)
cargo tauri dev
```

**Step 5: Build Release Installer**
```bash
cargo tauri build
```

The `.dmg` installer and binary will be in `src-tauri/target/release/bundle/macos/`.

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
