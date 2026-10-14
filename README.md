\# Anything but a Game Controller — Cyber Marble Run



Turn your smartphone into a real-time motion controller for a 2D laptop browser game using WebSockets and native mobile motion APIs.



\---



\## Demo

\- \*\*Video Demonstration:\*\* 'https://drive.google.com/file/d/1xWBQ\_hQ2\_lSz3f5jZbagrDJYAHqED8BP/view?usp=drive\_link'

\- \*\*Live Local Server:\*\* `http://localhost:3000`



\---



\## Tech Stack

\- \*\*Server:\*\* Node.js, Express, `ws` (WebSockets)

\- \*\*Game (Laptop):\*\* HTML5 Canvas, Vanilla JavaScript

\- \*\*Controller (Mobile):\*\* DeviceOrientation API, DeviceMotion API, Web Vibration API

\- \*\*Pairing:\*\* Dynamic QR code generation via `qrcode`



\---



\## Features \& Implementation



\### 1. Pairing System

\- The laptop game starts a session and generates a 4-character Room ID.

\- A dynamic QR code encodes the local LAN link (`http://<LAN\_IP>:3000/controller.html?room=<ROOM\_ID>`).

\- Scanning the QR code or manually entering the code on mobile links both devices instantly over a dedicated WebSocket room.



\### 2. Motion Controls \& Calibration

\- \*\*Tilt Steering:\*\* Uses phone `beta` (pitch) and `gamma` (roll) angles mapped directly to the marble's 2D velocity vectors.

\- \*\*Shake to Jump:\*\* Uses accelerometer spikes to trigger jumps over pits and obstacles.

\- \*\*One-Tap Calibration:\*\* Captures current holding posture as the neutral `(0, 0)` reference point.

\- \*\*iOS Compatibility:\*\* Handles explicit user-gesture permission requests for Safari motion sensors.



\### 3. Latency \& Input Smoothing

\- \*\*60Hz Telemetry:\*\* Controller data is throttled to \~16ms intervals to prevent network congestion.

\- \*\*Low-Pass Filter:\*\* Applies an exponential moving average to filter sensor noise and hand tremors.

\- \*\*Deadzone \& Velocity Cap:\*\* Includes a \~12% neutral deadzone to stop micro-drifting, with strict velocity clamping and friction damping for tight handling.

\- \*\*RTT Ping Monitor:\*\* Heartbeat packets continuously display round-trip latency in milliseconds on both screens.



\---



\## Setup \& Running Locally



1\. \*\*Clone the repository:\*\*

&#x20;  ```bash

&#x20;  git clone \[https://github.com/KevinSolomon871/vinnovateit-anything-but-a-game-controller.git](https://github.com/KevinSolomon871/vinnovateit-anything-but-a-game-controller.git)

&#x20;  cd vinnovateit-anything-but-a-game-controller

