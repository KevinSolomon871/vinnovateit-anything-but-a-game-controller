<h1>Anything but a Game Controller — Cyber Marble Run</h1>



<p>Turn your smartphone into a real-time motion controller for a 2D laptop browser game using WebSockets and mobile motion sensors.</p>



<hr>



<h2>Demo</h2>



\* <b>Video Demonstration:</b> https://drive.google.com/file/d/1xWBQ\_hQ2\_lSz3f5jZbagrDJYAHqED8BP/view?usp=drive\_link

\* <b>Local Game URL:</b> http://localhost:3000



<hr>



<h2>Tech Stack</h2>



\* <b>Backend:</b> Node.js, Express, ws (WebSockets)

\* <b>Laptop Client:</b> HTML5 Canvas, Vanilla JavaScript

\* <b>Mobile Controller:</b> DeviceOrientation API, DeviceMotion API, Web Vibration API

\* <b>Device Pairing:</b> Dynamic QR code generation via qrcode



<hr>



<h2>Key Features</h2>



<b>Pairing System</b>

\* The laptop creates a session with a unique 4-character Room ID.

\* A dynamic QR code displays the local network link.

\* Scanning the QR code or manually entering the code links the phone and laptop over WebSockets.



<b>Motion Controls \& Calibration</b>

\* <b>Tilt Steering:</b> Uses phone tilt angles (beta and gamma) mapped to the marble velocity.

\* <b>Shake to Jump:</b> Uses accelerometer spikes to jump over hazards.

\* <b>Calibration:</b> Sets any resting hand position as the neutral (0, 0) point.

\* <b>iOS Compatibility:</b> Handles explicit permission requests for Safari motion sensors.



<b>Low Latency \& Physics Tuning</b>

\* <b>60Hz Rate Limiting:</b> Sends telemetry packets every \~16ms to avoid network bloat.

\* <b>Input Filtering:</b> Uses a low-pass filter to smooth hand tremors.

\* <b>Deadzone \& Speed Limit:</b> 12% deadzone prevents micro-drifting, with strict velocity caps and friction damping for tight control.

\* <b>Live Ping:</b> Real-time round-trip latency shown in milliseconds on both screens.



<hr>



<h2>Setup \& Running Locally</h2>



1\. <b>Clone the repository:</b>

```bash

git clone \[https://github.com/KevinSolomon871/vinnovateit-anything-but-a-game-controller.git](https://github.com/KevinSolomon871/vinnovateit-anything-but-a-game-controller.git)

cd vinnovateit-anything-but-a-game-controller

