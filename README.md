# Vanguard Music Player

Vanguard Music Player is a lightweight open-source desktop music player that streams music directly from **YouTube / YouTube Music**.

The goal of this project is to create a **fast, clean, modern music player** without the heavy overhead of Electron apps.

## Tech Stack

- **Tauri** (Rust backend)
- **React + TypeScript**
- **Vite**
- **TailwindCSS**
- **yt-dlp** for audio extraction

---

# Features

- Stream music directly from **YouTube**
- Lightweight desktop application
- Modern **neon green UI**
- Search songs instantly
- Playlist support
- Spotify playlist import *(planned)*

---


# Requirements

Before running the project, install the following tools:

- Node.js
- Rust
- Cargo
- Tauri dependencies
- yt-dlp

---

# Linux Setup (Debian / Ubuntu / Zorin / PopOS)

### 1. Install Node.js

```bash
sudo apt install nodejs npm
```

Check installation:

```bash
node -v
npm -v
```

---

### 2. Install Rust

```bash
curl https://sh.rustup.rs -sSf | sh
```

Reload shell:

```bash
source $HOME/.cargo/env
```

Verify:

```bash
rustc --version
cargo --version
```

---

### 3. Install Tauri Dependencies

```bash
sudo apt install \
libwebkit2gtk-4.1-dev \
build-essential \
curl \
wget \
file \
libxdo-dev \
libssl-dev \
libayatana-appindicator3-dev \
librsvg2-dev
```

---

### 4. Install yt-dlp

```bash
sudo apt install yt-dlp
```

Verify:

```bash
yt-dlp --version
```

---

# Arch Linux

```bash
sudo pacman -S nodejs npm rust yt-dlp \
webkit2gtk base-devel curl wget file openssl
```

---

# Fedora

```bash
sudo dnf install nodejs npm rust cargo yt-dlp \
webkit2gtk4.1-devel \
openssl-devel \
libappindicator-gtk3-devel
```

---

# Windows Setup

### 1. Install Node.js

Download the **LTS version**:

https://nodejs.org

Verify installation:

```bash
node -v
npm -v
```

---

### 2. Install Rust

Download and install:

https://rustup.rs

Verify installation:

```bash
rustc --version
cargo --version
```

---

### 3. Install Visual Studio Build Tools

Install:

Visual Studio Build Tools

Required component:

```
Desktop development with C++
```

---

### 4. Install yt-dlp

Download from:

https://github.com/yt-dlp/yt-dlp/releases

Place `yt-dlp.exe` in your **PATH**.

---

# macOS Setup

### 1. Install Homebrew

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

---

### 2. Install dependencies

```bash
brew install node rust yt-dlp
```

---

# Running the Project

Clone the repository:

```bash
git clone https://github.com/ishmweet/vanguard-music-player.git
```

Enter the project directory:

```bash
cd vanguard-music-player
```

Install frontend dependencies:

```bash
npm install
```

Run the application:

```bash
npm run tauri dev
```

---

# Building the Application

To build the desktop application:

```bash
npm run tauri build
```

The compiled application will appear in:

```
src-tauri/target/release
```

---

# Contributing

Contributions are welcome.

You can help by:

- Improving UI
- Adding features
- Fixing bugs
- Optimizing performance

---

# License

MIT License

---

# Author

**Ishmeet Singh**

GitHub:  
https://github.com/ishmweet
