# Anything but a Game Controller — Cyber Marble Run

A complete, zero-config full-stack Node.js + WebSocket project that transforms any mobile phone into a **60Hz gyroscopic motion controller** for a laptop 2D arcade browser game (**Cyber Marble Run / Maze Survivor**).

## Directory Structure

```text
anything-but-a-game-controller/
├── package.json
├── server.js              # Express + ws server, LAN IP detection, QR pairing endpoint
└── public/
    ├── index.html         # Laptop browser game UI & pairing sidebar
    ├── game.js            # 2D Canvas "Cyber Marble Run" physics & WebSocket host
    ├── controller.html    # Mobile web motion controller UI
    ├── controller.js      # iOS/Android gyro permissions, calibration, 60Hz throttle, haptics
    └── style.css          # Cyber / Arcade dark mode theme
```

## Quick Start

1. **Install dependencies** (`express`, `ws`, `qrcode`):
   ```bash
   npm install
   ```
2. **Start the server**:
   ```bash
   npm start
   ```
3. **Pair your phone**:
   - The terminal will automatically detect your local Wi-Fi LAN IP and print the exact Laptop Game URL (`http://<HOST_IP>:3000`).
   - Open `http://<HOST_IP>:3000` on your laptop browser.
   - Scan the on-screen QR code with your phone camera (or open `http://<HOST_IP>:3000/controller.html` and enter the 4-character Room ID manually).
   - Tap **"Start / Calibrate Sensors"** on your phone to grant iOS Safari / Android sensor permissions and zero out your comfortable holding angle.
