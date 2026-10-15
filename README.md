<h1>Anything but a Game Controller — Cyber Marble Run</h1>



<p>Turn your smartphone into a real-time motion controller for a 2D laptop browser game using WebSockets and mobile motion sensors.</p>



<hr>



<h2>Demo</h2>



\* **Video Demonstration:** https://drive.google.com/file/d/1xWBQ\_hQ2\_lSz3f5jZbagrDJYAHqED8BP/view?usp=drive\_link

\* **Local Game URL:** http://localhost:3000



<hr>



<h2>Tech Stack</h2>



\* **Backend:** Node.js, Express, ws (WebSockets)

\* **Laptop Client:** HTML5 Canvas, Vanilla JavaScript

\* **Mobile Controller:** DeviceOrientation API, DeviceMotion API, Web Vibration API

\* **Device Pairing:** Dynamic QR code generation via qrcode



<hr>



<h2>Key Features</h2>



**Pairing System**

\* The laptop creates a session with a unique 4-character Room ID.

\* A dynamic QR code displays the local network link.

\* Scanning the QR code or manually entering the code links the phone and laptop over WebSockets.



**Motion Controls \& Calibration**

\* **Tilt Steering:** Uses phone tilt angles (beta and gamma) mapped to the marble velocity.

\* **Shake to Jump:** Uses accelerometer spikes to jump over hazards.

\* **Calibration:** Sets any resting hand position as the neutral (0, 0) point.

\* **iOS Compatibility:** Handles explicit permission requests for Safari motion sensors.



**Low Latency \& Physics Tuning**

\* **60Hz Rate Limiting:** Sends telemetry packets every \~16ms to avoid network bloat.

\* **Input Filtering:** Uses a low-pass filter to smooth hand tremors.

\* **Deadzone \& Speed Limit:** 12% deadzone prevents micro-drifting, with strict velocity caps and friction damping for tight control.

\* **Live Ping:** Real-time round-trip latency shown in milliseconds on both screens.



<hr>



<h2>Setup \\\& Running Locally</h2>



1\. **Clone the repository:**

```bash

git clone \\\[https://github.com/KevinSolomon871/vinnovateit-anything-but-a-game-controller.git](https://github.com/KevinSolomon871/vinnovateit-anything-but-a-game-controller.git)

cd vinnovateit-anything-but-a-game-controller


