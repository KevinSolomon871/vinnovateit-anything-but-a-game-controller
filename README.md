# \# Anything but a Game Controller — Cyber Marble Run

# 

# A real-time motion controller web ecosystem that transforms any smartphone into a precision low-latency motion controller for a 2D laptop browser game using WebSockets and native device telemetry.

# 

# \---

# 

# \## Live Demo \& Video Showcase

# \- \*\*Video Demonstration:\*\* \[Insert Google Drive / YouTube Unlisted Link Here]

# \- \*\*Web App / Build Link:\*\* `http://<LAN\_IP>:3000` (Self-hosted zero-config Express server)

# 

# \---

# 

# \## Tech Stack

# 

# | Layer | Technologies Used |

# | :--- | :--- |

# | \*\*Server / Broker\*\* | Node.js, Express, `ws` (native WebSocket library) |

# | \*\*Laptop Client (Game)\*\* | Vanilla JavaScript, HTML5 Canvas 2D Engine, WebSockets |

# | \*\*Mobile Client (Controller)\*\* | Mobile Safari/Chrome Web APIs (`DeviceOrientationEvent`, `DeviceMotionEvent`), Web Vibration API |

# | \*\*Pairing \& Discovery\*\* | Node.js `os` network inspection, `qrcode` dynamic SVG generation |

# 

# \---

# 

# \## Pairing \& Session Architecture

# 

# 1\. \*\*Zero-Config LAN Discovery:\*\* On startup, `server.js` queries `os.networkInterfaces()` to isolate the host machine's primary IPv4 interface and generates a local network URL.

# 2\. \*\*Room Code Generation:\*\* The laptop client establishes a WebSocket connection and registers a random 4-character room token (e.g., `CYBR`).

# 3\. \*\*QR Code Handshake:\*\* The server renders a dynamic QR code pointing directly to `http://<HOST\_IP>:<PORT>/controller.html?room=<ROOM\_ID>`.

# 4\. \*\*Direct Join:\*\* Scanning the QR code on a mobile device auto-populates the room ID and establishes a bidirectional WebSocket pipe between the controller and the game instance. Manual room code entry is supported as a fallback.

# 

# \---

# 

# \## Latency \& Telemetry Optimization

# 

# Achieving responsive, fluid motion control over local networks requires mitigating packet congestion and sensor noise:

# 

# 1\. \*\*60Hz Telemetry Throttling:\*\*

# &#x20;  \* Mobile sensors fire events at erratic intervals (often >100Hz). Telemetry broadcasts are throttled to a fixed \~16.67ms interval (60Hz) matching the laptop monitor refresh cycle.

# &#x20;  \* Outgoing packets check `socket.bufferedAmount === 0` to discard stale telemetry before transmission, preventing TCP buffer bloat.

# 2\. \*\*Exponential Moving Average (Low-Pass Filter):\*\*

# &#x20;  \* Raw gyro and accelerometer values contain hand tremors. A low-pass filter smooths the incoming orientation:

# &#x20;    $$\\text{tilt}\_{\\text{filtered}} = \\text{tilt}\_{\\text{filtered}} + (\\text{tilt}\_{\\text{raw}} - \\text{tilt}\_{\\text{filtered}}) \\times \\alpha$$

# &#x20;    \*(with $\\alpha = 0.25$ ensuring smooth interpolation without perceptual lag)\*.

# 3\. \*\*Continuous Deadzone \& Velocity Clamping:\*\*

# &#x20;  \* A continuous radial deadzone ($\\approx 12\\%$) suppresses micro-jitters when the phone rests in the neutral position.

# &#x20;  \* Linear drag and maximum velocity clamps prevent runaway acceleration while preserving tight cornering.

# 4\. \*\*Heartbeat RTT Diagnostics:\*\*

# &#x20;  \* Alternating `ping\_check` / `pong\_check` payloads calculate real-time round-trip latency (displayed in ms on both controller and game HUDs). Typical local network latency sits consistently between 4ms and 15ms.

# 

# \---

# 

# \## Sensor Permissions \& Neutral Calibration

# 

# \* \*\*iOS Permission Flow:\*\* Adheres to iOS 13+ security sandboxing by invoking `DeviceOrientationEvent.requestPermission()` directly inside an explicit user-activation touch gesture.

# \* \*\*Neutral Angle Calibration:\*\* Users can tap \*\*Calibrate\*\* at any holding posture (flat on a desk, reclined, or upright). The current Euler angles ($\\beta\_0, \\gamma\_0$) are captured as baseline offsets:

# &#x20; $$\\Delta\\beta = \\beta - \\beta\_0, \\quad \\Delta\\gamma = \\gamma - \\gamma\_0$$

# \* \*\*Haptics:\*\* Device vibration (`navigator.vibrate(\[20])`) provides tactile feedback on barrier collision, void hazards, and jump triggers.

# 

# \---

# 

# \## Getting Started

# 

# \### Prerequisites

# \* \[Node.js](https://nodejs.org/) (v16.x or higher)

# \* Laptop and smartphone connected to the same Wi-Fi network (or phone hotspot)

# 

# \### Installation \& Launch

# 1\. Clone the repository:

# &#x20;  ```bash

# &#x20;  git clone \[https://github.com/KevinSolomon871/vinnovateit-anything-but-a-game-controller.git](https://github.com/KevinSolomon871/vinnovateit-anything-but-a-game-controller.git)

# &#x20;  cd vinnovateit-anything-but-a-game-controller

