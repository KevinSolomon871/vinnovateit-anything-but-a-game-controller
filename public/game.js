/**
 * Cyber Marble Run / Maze Survivor — Laptop Browser Game (`public/game.js`)
 * =========================================================================
 * Architecture & Refined Physics Highlights:
 * 1. Pairing & QR Generation:
 *    Generates or persists a 4-character Room ID, queries `/api/session?room=<ID>`
 *    to render a scannable QR code (via the `qrcode` library) pointing to:
 *    `http://<HOST_IP>:<PORT>/controller.html?room=<ROOM_ID>`.
 * 2. Latency & Connection Resilience:
 *    Maintains an auto-reconnecting WebSocket to the server, measures round-trip
 *    latency (ms) via `ping_check` / `pong_check`, and tracks incoming packet Hz.
 * 3. Low-Pass Input Smoothing & Widened Radial Deadzone:
 *    Applies an exponential moving average (LERP factor `0.25`:
 *    `filteredTilt += (rawTilt - filteredTilt) * 0.25`) and a widened radial deadzone
 *    (`DEADZONE = 0.14`) around neutral tilt so minor hand tremors do not displace the ball.
 * 4. Dampened Acceleration, High Linear Drag & Strict Velocity Cap:
 *    - Tilt acceleration multiplier reduced by 50% (`BASE_ACCEL = 0.28`, `BOOST_ACCEL = 0.45`)
 *      so gentle tilts produce smooth, predictable rolling.
 *    - Strict maximum velocity cap (`MAX_SPEED = 6.5`, `MAX_BOOST_SPEED = 8.0` px/frame)
 *      prevents runaway speeds across the arena.
 *    - High linear drag (`FRICTION_GROUND = 0.91`, `FRICTION_AIR = 0.92` per frame)
 *      ensures the marble decelerates quickly and naturally when returning to neutral.
 * 5. Shake-to-Jump & Boost Mechanics:
 *    Shaking the phone or tapping Jump launches the marble along the Z-axis,
 *    allowing it to clear lethal void holes and laser obstacles at 60 FPS.
 */

(() => {
  // DOM Elements
  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');
  const roomCodeDisplay = document.getElementById('roomCodeDisplay');
  const qrImage = document.getElementById('qrImage');
  const qrFallbackCanvas = document.getElementById('qrFallbackCanvas');
  const pairUrlText = document.getElementById('pairUrlText');
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const pingValue = document.getElementById('pingValue');
  const hzValue = document.getElementById('hzValue');
  const tiltXText = document.getElementById('tiltXText');
  const tiltYText = document.getElementById('tiltYText');
  const tiltXBar = document.getElementById('tiltXBar');
  const tiltYBar = document.getElementById('tiltYBar');
  const jumpStateText = document.getElementById('jumpStateText');
  const boostStateText = document.getElementById('boostStateText');
  const scoreDisplay = document.getElementById('scoreDisplay');
  const levelDisplay = document.getElementById('levelDisplay');
  const streakDisplay = document.getElementById('streakDisplay');
  const timerDisplay = document.getElementById('timerDisplay');
  const newRoomBtn = document.getElementById('newRoomBtn');
  const resetGameBtn = document.getElementById('resetGameBtn');

  // ---------------------------------------------------------------------------
  // 1. Room ID & QR Pairing Setup
  // ---------------------------------------------------------------------------
  function createRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 4; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  let currentRoomId = sessionStorage.getItem('cyber_marble_room') || createRoomCode();
  sessionStorage.setItem('cyber_marble_room', currentRoomId);

  async function initPairingSession(roomId) {
    roomCodeDisplay.textContent = roomId;
    try {
      const response = await fetch(`/api/session?room=${encodeURIComponent(roomId)}`);
      if (!response.ok) throw new Error('Session endpoint unavailable');
      const data = await response.json();
      pairUrlText.textContent = data.controllerUrl;
      if (data.qrDataUrl) {
        qrImage.src = data.qrDataUrl;
        qrImage.style.display = 'block';
        qrFallbackCanvas.style.display = 'none';
      }
    } catch (err) {
      // Offline / file:// fallback display if server endpoint isn't reachable yet
      const fallbackUrl = `${window.location.origin}/controller.html?room=${roomId}`;
      pairUrlText.textContent = fallbackUrl;
      drawFallbackQrBadge(roomId);
    }
  }

  function drawFallbackQrBadge(roomId) {
    qrImage.style.display = 'none';
    qrFallbackCanvas.style.display = 'block';
    const qctx = qrFallbackCanvas.getContext('2d');
    qctx.fillStyle = '#0b0f19';
    qctx.fillRect(0, 0, 196, 196);
    qctx.strokeStyle = '#00f5d4';
    qctx.lineWidth = 3;
    qctx.strokeRect(10, 10, 176, 176);
    qctx.fillStyle = '#00f5d4';
    qctx.font = 'bold 28px monospace';
    qctx.textAlign = 'center';
    qctx.fillText(`ROOM ${roomId}`, 98, 95);
    qctx.font = '12px monospace';
    qctx.fillStyle = '#94a3b8';
    qctx.fillText('Open /controller.html', 98, 125);
  }

  // ---------------------------------------------------------------------------
  // 2. WebSocket Connection, Graceful Reconnect & Latency Tracking
  // ---------------------------------------------------------------------------
  let ws = null;
  let reconnectTimer = null;
  let reconnectDelay = 800;
  let isControllerConnected = false;
  let smoothedRtt = null;
  let packetCounter = 0;
  let currentHz = 0;

  // Measure incoming 60Hz telemetry packet rate every second
  setInterval(() => {
    currentHz = packetCounter;
    packetCounter = 0;
    hzValue.textContent = `${currentHz} Hz`;
  }, 1000);

  function connectWebSocket() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;

    try {
      ws = new WebSocket(wsUrl);
    } catch (e) {
      scheduleReconnect();
      return;
    }

    ws.addEventListener('open', () => {
      reconnectDelay = 800;
      ws.send(JSON.stringify({
        type: 'join',
        role: 'host',
        roomId: currentRoomId
      }));
    });

    ws.addEventListener('message', (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      switch (msg.type) {
        case 'room_status': {
          isControllerConnected = Boolean(msg.connected);
          updateConnectionIndicator();
          break;
        }

        case 'motion': {
          packetCounter++;
          handleControllerMotion(msg);
          break;
        }

        case 'action': {
          if (msg.action === 'jump') triggerJump();
          if (msg.action === 'boost') triggerBoost(Boolean(msg.active));
          break;
        }

        case 'calibrated': {
          controllerInput.rawX = 0;
          controllerInput.rawY = 0;
          controllerInput.filteredX = 0;
          controllerInput.filteredY = 0;
          controllerInput.normX = 0;
          controllerInput.normY = 0;
          spawnFloatingText(marble.x, marble.y - 24, 'SENSORS CALIBRATED!', '#00f5d4');
          break;
        }

        case 'pong_check': {
          const rtt = Math.max(1, Date.now() - Number(msg.clientSentAt || Date.now()));
          smoothedRtt = smoothedRtt === null ? rtt : Math.round(smoothedRtt * 0.7 + rtt * 0.3);
          pingValue.textContent = `${smoothedRtt} ms`;
          break;
        }

        case 'peer_latency': {
          if (typeof msg.rtt === 'number') {
            smoothedRtt = Math.round(msg.rtt);
            pingValue.textContent = `${smoothedRtt} ms`;
          }
          break;
        }

        default:
          break;
      }
    });

    ws.addEventListener('close', () => {
      isControllerConnected = false;
      updateConnectionIndicator('Reconnecting...');
      scheduleReconnect();
    });

    ws.addEventListener('error', () => {
      ws.close();
    });
  }

  function scheduleReconnect() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
      reconnectDelay = Math.min(reconnectDelay * 1.5, 5000);
      connectWebSocket();
    }, reconnectDelay);
  }

  function updateConnectionIndicator(overrideText) {
    if (overrideText) {
      statusDot.className = 'status-dot disconnected';
      statusText.textContent = overrideText;
      return;
    }
    if (isControllerConnected) {
      statusDot.className = 'status-dot connected';
      statusText.textContent = 'Connected';
    } else {
      statusDot.className = 'status-dot';
      statusText.textContent = 'Waiting for Phone...';
    }
  }

  function sendHapticToPhone(pattern) {
    if (ws && ws.readyState === WebSocket.OPEN && isControllerConnected) {
      ws.send(JSON.stringify({ type: 'haptic', pattern }));
    }
  }

  // Periodic Ping Check (every 1000ms) for live latency HUD
  setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'ping_check',
        clientSentAt: Date.now(),
        lastRtt: smoothedRtt
      }));
    }
  }, 1000);

  // ---------------------------------------------------------------------------
  // 3. Low-Pass Telemetry Smoothing & Widened Radial Deadzone Filtering
  // ---------------------------------------------------------------------------
  const DEADZONE = 0.14;         // Widened (0.12 - 0.15) deadzone around neutral to ignore minor hand jitters
  const TILT_LERP_ALPHA = 0.25;  // Low-pass EMA smoothing factor: filteredTilt += (rawTilt - filteredTilt) * 0.25

  // Physics Tuning Constants
  const BASE_ACCEL = 0.28;       // Reduced by 50% (from 0.56) for gentle, predictable rolling
  const BOOST_ACCEL = 0.45;      // Reduced by ~50% (from 0.92) for controlled boost acceleration
  const KEYBOARD_ACCEL = 0.38;   // Balanced keyboard fallback acceleration
  const MAX_SPEED = 6.5;         // Strict normal max velocity cap (within 6-8 px/frame)
  const MAX_BOOST_SPEED = 8.0;   // Strict boost max velocity cap (never exceeds 8 px/frame)
  const FRICTION_GROUND = 0.91;  // Stronger linear drag (0.90 - 0.92) for rapid deceleration at neutral
  const FRICTION_AIR = 0.92;     // Airborne linear damping (0.90 - 0.92)

  const controllerInput = {
    rawX: 0,
    rawY: 0,
    filteredX: 0,
    filteredY: 0,
    normX: 0,
    normY: 0,
    boostActive: false
  };

  /**
   * Applies a continuous radial deadzone (0.14) to the smoothed (x, y) tilt vector:
   * - Magnitudes below DEADZONE map to (0, 0).
   * - Magnitudes above DEADZONE are smoothly rescaled from [DEADZONE, 1.0] -> [0.0, 1.0]
   *   so there is zero sudden velocity jump when crossing the deadzone boundary.
   */
  function applyRadialDeadzone(x, y, deadzone = DEADZONE) {
    const mag = Math.hypot(x, y);
    if (mag < deadzone) {
      return { x: 0, y: 0 };
    }
    const clampedMag = Math.min(1, mag);
    const rescaled = (clampedMag - deadzone) / (1 - deadzone);
    const scale = rescaled / mag;
    return {
      x: x * scale,
      y: y * scale
    };
  }

  function handleControllerMotion(msg) {
    const rawTiltX = Math.max(-1, Math.min(1, Number(msg.tiltX) || 0));
    const rawTiltY = Math.max(-1, Math.min(1, Number(msg.tiltY) || 0));
    controllerInput.rawX = rawTiltX;
    controllerInput.rawY = rawTiltY;

    // Low-pass filter (exponential moving average / LERP) before deadzone & velocity calculation:
    // filteredTilt += (rawTilt - filteredTilt) * 0.25
    controllerInput.filteredX += (rawTiltX - controllerInput.filteredX) * TILT_LERP_ALPHA;
    controllerInput.filteredY += (rawTiltY - controllerInput.filteredY) * TILT_LERP_ALPHA;

    const deadzoned = applyRadialDeadzone(controllerInput.filteredX, controllerInput.filteredY);
    controllerInput.normX = deadzoned.x;
    controllerInput.normY = deadzoned.y;

    if (msg.shakeJump) {
      triggerJump();
    }
    if (typeof msg.boost === 'boolean') {
      controllerInput.boostActive = msg.boost;
    }

    // Update Sidebar Telemetry Bars
    tiltXText.textContent = controllerInput.normX.toFixed(2);
    tiltYText.textContent = controllerInput.normY.toFixed(2);
    tiltXBar.style.width = `${50 + controllerInput.normX * 50}%`;
    tiltYBar.style.width = `${50 + controllerInput.normY * 50}%`;
  }

  // Local Keyboard Fallback so the user can also test on laptop directly
  const keys = new Set();
  window.addEventListener('keydown', (e) => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
      e.preventDefault();
    }
    keys.add(e.code);
    if (e.code === 'Space') triggerJump();
    if (e.code === 'KeyR') resetGame();
  });
  window.addEventListener('keyup', (e) => {
    keys.delete(e.code);
  });

  // ---------------------------------------------------------------------------
  // 4. "Cyber Marble Run / Maze Survivor" 2D Game Engine
  // ---------------------------------------------------------------------------
  const W = canvas.width;
  const H = canvas.height;

  const gameState = {
    score: 0,
    level: 1,
    streak: 1,
    timeLeft: 60.0,
    gameOver: false,
    screenShake: 0
  };

  const marble = {
    x: 90,
    y: 90,
    vx: 0,
    vy: 0,
    radius: 15,
    z: 0,      // Height above board (0 = grounded, >0 = jumping over void holes/barriers)
    vz: 0,     // Vertical jump velocity
    trail: []
  };

  let walls = [];
  let voidHoles = [];
  let laserGates = [];
  let gems = [];
  let particles = [];
  let floatingTexts = [];

  function buildSectorArena(level) {
    walls = [];
    voidHoles = [];
    laserGates = [];
    gems = [];

    // Outer Arena Perimeter Walls
    const pad = 18;
    walls.push(
      { x: 0, y: 0, w: W, h: pad },
      { x: 0, y: H - pad, w: W, h: pad },
      { x: 0, y: 0, w: pad, h: H },
      { x: W - pad, y: 0, w: pad, h: H }
    );

    // Procedural Cyber Maze Walls based on sector level
    const layouts = [
      // Sector 1: Classic Cyber Lanes
      [
        { x: 210, y: pad, w: 22, h: 430 },
        { x: 440, y: 260, w: 22, h: H - 260 - pad },
        { x: 670, y: pad, w: 22, h: 440 },
        { x: 870, y: 240, w: 22, h: H - 240 - pad }
      ],
      // Sector 2: Reactor Chambers
      [
        { x: 180, y: 160, w: 280, h: 22 },
        { x: 640, y: 160, w: 280, h: 22 },
        { x: 340, y: 350, w: 420, h: 22 },
        { x: 180, y: 530, w: 300, h: 22 },
        { x: 620, y: 530, w: 300, h: 22 },
        { x: 540, y: 160, w: 22, h: 190 }
      ],
      // Sector 3: Spiral Gauntlet
      [
        { x: 190, y: 140, w: 720, h: 22 },
        { x: 890, y: 140, w: 22, h: 420 },
        { x: 310, y: 540, w: 600, h: 22 },
        { x: 310, y: 280, w: 22, h: 280 },
        { x: 310, y: 280, w: 430, h: 22 },
        { x: 720, y: 280, w: 22, h: 140 }
      ]
    ];

    const chosenWalls = layouts[(level - 1) % layouts.length];
    walls.push(...chosenWalls);

    // Void Holes (Lethal unless marble is airborne via Shake/Jump!)
    const holeCount = Math.min(4 + level * 2, 12);
    for (let i = 0; i < holeCount; i++) {
      const spot = findFreeSpot(34);
      voidHoles.push({
        x: spot.x,
        y: spot.y,
        radius: 26 + (i % 3) * 4,
        phase: Math.random() * Math.PI * 2
      });
    }

    // Low Laser Barriers (Can be jumped over when z > 12)
    const gateCount = 2 + (level % 3);
    for (let i = 0; i < gateCount; i++) {
      const spot = findFreeSpot(50);
      laserGates.push({
        x: spot.x - 45,
        y: spot.y - 6,
        w: 90,
        h: 12,
        phase: i * 1.4
      });
    }

    // Spawn Collectible Cyber Gems & Time Checkpoints
    const gemCount = 7 + Math.min(level, 5);
    for (let i = 0; i < gemCount; i++) {
      const spot = findFreeSpot(26);
      const isCheckpoint = i === gemCount - 1 || i % 4 === 0;
      gems.push({
        x: spot.x,
        y: spot.y,
        radius: isCheckpoint ? 15 : 11,
        type: isCheckpoint ? 'checkpoint' : 'gem',
        value: isCheckpoint ? 250 : 100,
        timeBonus: isCheckpoint ? 6.0 : 1.5,
        pulse: Math.random() * Math.PI * 2
      });
    }
  }

  function findFreeSpot(clearance) {
    for (let attempt = 0; attempt < 120; attempt++) {
      const x = 75 + Math.random() * (W - 150);
      const y = 75 + Math.random() * (H - 150);

      // Keep away from marble current position
      if (Math.hypot(x - marble.x, y - marble.y) < 120) continue;

      // Keep away from walls
      let hitsWall = false;
      for (const w of walls) {
        if (
          x + clearance > w.x &&
          x - clearance < w.x + w.w &&
          y + clearance > w.y &&
          y - clearance < w.y + w.h
        ) {
          hitsWall = true;
          break;
        }
      }
      if (hitsWall) continue;

      // Keep away from existing void holes
      let hitsHole = false;
      for (const h of voidHoles) {
        if (Math.hypot(x - h.x, y - h.y) < clearance + h.radius + 24) {
          hitsHole = true;
          break;
        }
      }
      if (!hitsHole) return { x, y };
    }
    return { x: W / 2, y: H / 2 };
  }

  function triggerJump() {
    if (gameState.gameOver) {
      resetGame();
      return;
    }
    // Only jump when grounded
    if (marble.z <= 0.5) {
      marble.vz = 9.2;
      marble.z = 1;
      spawnBurst(marble.x, marble.y, '#ff2a85', 16);
      sendHapticToPhone([35]);
    }
  }

  function triggerBoost(active) {
    controllerInput.boostActive = active;
    if (active) {
      sendHapticToPhone([20]);
    }
  }

  function spawnBurst(x, y, color, count = 14) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.2 + Math.random() * 4.8;
      particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1.0,
        color,
        size: 2 + Math.random() * 3
      });
    }
  }

  function spawnFloatingText(x, y, text, color = '#00f5d4') {
    floatingTexts.push({ x, y, text, color, life: 1.0 });
  }

  function resolveCircleRectCollision(circle, rect) {
    const closestX = Math.max(rect.x, Math.min(circle.x, rect.x + rect.w));
    const closestY = Math.max(rect.y, Math.min(circle.y, rect.y + rect.h));
    const dx = circle.x - closestX;
    const dy = circle.y - closestY;
    const distSq = dx * dx + dy * dy;

    if (distSq < circle.radius * circle.radius) {
      const dist = Math.sqrt(distSq) || 0.001;
      const overlap = circle.radius - dist;
      const nx = dx / dist;
      const ny = dy / dist;

      circle.x += nx * overlap;
      circle.y += ny * overlap;

      // Reflect velocity vector with controlled restitution (0.72)
      const vn = circle.vx * nx + circle.vy * ny;
      if (vn < 0) {
        const restitution = 0.72;
        circle.vx -= (1 + restitution) * vn * nx;
        circle.vy -= (1 + restitution) * vn * ny;

        const impactSpeed = Math.abs(vn);
        if (impactSpeed > 2.0) {
          gameState.screenShake = Math.min(6, impactSpeed * 0.65);
          spawnBurst(closestX, closestY, '#00f5d4', 8);
          sendHapticToPhone([18]);
        }
      }
    }
  }

  function resetGame() {
    gameState.score = 0;
    gameState.level = 1;
    gameState.streak = 1;
    gameState.timeLeft = 60.0;
    gameState.gameOver = false;
    marble.x = 85;
    marble.y = 85;
    marble.vx = 0;
    marble.vy = 0;
    marble.z = 0;
    marble.vz = 0;
    marble.trail = [];
    buildSectorArena(1);
    updateScoreHud();
  }

  function updateScoreHud() {
    scoreDisplay.textContent = gameState.score.toLocaleString();
    levelDisplay.textContent = gameState.level;
    streakDisplay.textContent = `x${gameState.streak}`;
    timerDisplay.textContent = `${Math.max(0, gameState.timeLeft).toFixed(1)}s`;
    if (gameState.timeLeft <= 10) {
      timerDisplay.classList.add('timer-warn');
    } else {
      timerDisplay.classList.remove('timer-warn');
    }
  }

  // ---------------------------------------------------------------------------
  // 5. Main 60fps Game Loop (Update & Render)
  // ---------------------------------------------------------------------------
  let lastFrameTime = performance.now();

  function updatePhysics(dt) {
    if (gameState.gameOver) return;

    // Countdown Timer
    gameState.timeLeft -= dt;
    if (gameState.timeLeft <= 0) {
      gameState.timeLeft = 0;
      gameState.gameOver = true;
      sendHapticToPhone([80, 50, 120]);
      updateScoreHud();
      return;
    }

    // Per-frame low-pass refinement so 60fps physics smoothly interpolates 60Hz packets
    controllerInput.filteredX += (controllerInput.rawX - controllerInput.filteredX) * TILT_LERP_ALPHA;
    controllerInput.filteredY += (controllerInput.rawY - controllerInput.filteredY) * TILT_LERP_ALPHA;
    const deadzoned = applyRadialDeadzone(controllerInput.filteredX, controllerInput.filteredY);
    controllerInput.normX = deadzoned.x;
    controllerInput.normY = deadzoned.y;

    const isBoosting = controllerInput.boostActive || keys.has('ShiftLeft') || keys.has('ShiftRight');
    boostStateText.textContent = isBoosting ? 'BOOSTING!' : 'IDLE';
    boostStateText.style.color = isBoosting ? '#ffbe0b' : '#00f5d4';

    // 1. Dampened Tilt Acceleration (~50% reduction from previous 0.56 / 0.92)
    const accelMultiplier = isBoosting ? BOOST_ACCEL : BASE_ACCEL;
    let dvx = controllerInput.normX * accelMultiplier;
    let dvy = controllerInput.normY * accelMultiplier;

    // Optional laptop keyboard fallback
    if (keys.has('ArrowLeft') || keys.has('KeyA')) dvx -= KEYBOARD_ACCEL;
    if (keys.has('ArrowRight') || keys.has('KeyD')) dvx += KEYBOARD_ACCEL;
    if (keys.has('ArrowUp') || keys.has('KeyW')) dvy -= KEYBOARD_ACCEL;
    if (keys.has('ArrowDown') || keys.has('KeyS')) dvy += KEYBOARD_ACCEL;

    marble.vx += dvx;
    marble.vy += dvy;

    // 2. Increased Linear Drag / Friction (0.91 grounded, 0.92 airborne)
    // Ensures the marble decelerates rapidly when the phone returns to neutral tilt
    const friction = marble.z > 0 ? FRICTION_AIR : FRICTION_GROUND;
    marble.vx *= friction;
    marble.vy *= friction;

    // Snap micro-velocities to zero when inside neutral deadzone
    if (Math.abs(dvx) < 0.001 && Math.abs(dvy) < 0.001 && Math.hypot(marble.vx, marble.vy) < 0.04) {
      marble.vx = 0;
      marble.vy = 0;
    }

    // 3. Strict Max Velocity Cap (MAX_SPEED = 6.5 px/frame, MAX_BOOST_SPEED = 8.0 px/frame)
    const maxAllowedSpeed = isBoosting ? MAX_BOOST_SPEED : MAX_SPEED;
    const speed = Math.hypot(marble.vx, marble.vy);
    if (speed > maxAllowedSpeed) {
      marble.vx = (marble.vx / speed) * maxAllowedSpeed;
      marble.vy = (marble.vy / speed) * maxAllowedSpeed;
    }

    marble.x += marble.vx;
    marble.y += marble.vy;

    // Jump Z-Axis Gravity Physics
    if (marble.z > 0 || marble.vz !== 0) {
      marble.z += marble.vz;
      marble.vz -= 0.46; // Gravity
      if (marble.z <= 0) {
        marble.z = 0;
        marble.vz = 0;
        spawnBurst(marble.x, marble.y, '#00f5d4', 8);
      }
    }

    jumpStateText.textContent = marble.z > 0 ? `AIRBORNE (${Math.round(marble.z)}m)` : 'GROUNDED';
    jumpStateText.style.color = marble.z > 0 ? '#ff2a85' : '#00f5d4';

    // Trail History
    marble.trail.push({ x: marble.x, y: marble.y, z: marble.z, boost: isBoosting });
    if (marble.trail.length > 22) marble.trail.shift();

    // Wall Collisions
    for (const w of walls) {
      resolveCircleRectCollision(marble, w);
    }

    // Laser Barriers (Block marble if grounded, allow jump-over if z > 10)
    for (const gate of laserGates) {
      if (marble.z < 10) {
        resolveCircleRectCollision(marble, gate);
      }
    }

    // Void Hole Hazard Check (Only affects grounded marble!)
    if (marble.z <= 2) {
      for (const hole of voidHoles) {
        const dist = Math.hypot(marble.x - hole.x, marble.y - hole.y);
        if (dist < hole.radius + 14) {
          // Gentle gravitational pull toward center of void hole
          const pull = (1 - dist / (hole.radius + 14)) * 0.28;
          marble.vx += ((hole.x - marble.x) / (dist || 1)) * pull;
          marble.vy += ((hole.y - marble.y) / (dist || 1)) * pull;
        }
        if (dist < hole.radius - 4) {
          // Fell into Void Hole! Respawn at safe corner with small time penalty
          gameState.streak = 1;
          gameState.timeLeft = Math.max(1, gameState.timeLeft - 4.0);
          gameState.screenShake = 10;
          spawnBurst(marble.x, marble.y, '#ef4444', 28);
          spawnFloatingText(hole.x, hole.y, '-4.0s VOID HAZARD! (SHAKE TO JUMP)', '#ef4444');
          sendHapticToPhone([60, 40, 80]);
          marble.x = 85;
          marble.y = 85;
          marble.vx = 0;
          marble.vy = 0;
          break;
        }
      }
    }

    // Gem & Checkpoint Collection
    for (let i = gems.length - 1; i >= 0; i--) {
      const g = gems[i];
      const dist = Math.hypot(marble.x - g.x, marble.y - g.y);
      if (dist < marble.radius + g.radius + 4) {
        const earned = g.value * gameState.streak;
        gameState.score += earned;
        gameState.streak = Math.min(8, gameState.streak + 1);
        gameState.timeLeft = Math.min(99, gameState.timeLeft + g.timeBonus);

        const color = g.type === 'checkpoint' ? '#ffbe0b' : '#00f5d4';
        spawnBurst(g.x, g.y, color, 22);
        spawnFloatingText(
          g.x,
          g.y - 12,
          `+${earned} PTS  +${g.timeBonus.toFixed(1)}s`,
          color
        );
        sendHapticToPhone(g.type === 'checkpoint' ? [30, 30, 50] : [25]);
        gems.splice(i, 1);
      }
    }

    // Sector Cleared -> Advance Level!
    if (gems.length === 0) {
      gameState.level += 1;
      gameState.score += 500 * gameState.level;
      gameState.timeLeft = Math.min(99, gameState.timeLeft + 10.0);
      spawnFloatingText(W / 2, H / 2, `SECTOR ${gameState.level} UNLOCKED! +10.0s`, '#ffbe0b');
      sendHapticToPhone([40, 40, 80]);
      buildSectorArena(gameState.level);
    }

    // Update Particles & Floating Labels
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.life -= 0.032;
      if (p.life <= 0) particles.splice(i, 1);
    }

    for (let i = floatingTexts.length - 1; i >= 0; i--) {
      const ft = floatingTexts[i];
      ft.y -= 1.1;
      ft.life -= 0.022;
      if (ft.life <= 0) floatingTexts.splice(i, 1);
    }

    if (gameState.screenShake > 0) {
      gameState.screenShake *= 0.85;
      if (gameState.screenShake < 0.2) gameState.screenShake = 0;
    }

    updateScoreHud();
  }

  function renderArena(now) {
    ctx.save();
    if (gameState.screenShake > 0) {
      const sx = (Math.random() - 0.5) * gameState.screenShake * 2;
      const sy = (Math.random() - 0.5) * gameState.screenShake * 2;
      ctx.translate(sx, sy);
    }

    // Background Clear
    ctx.fillStyle = '#050811';
    ctx.fillRect(0, 0, W, H);

    // Perspective Cyber Grid Floor
    ctx.strokeStyle = 'rgba(0, 245, 212, 0.06)';
    ctx.lineWidth = 1;
    const gridStep = 45;
    for (let x = 0; x <= W; x += gridStep) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    for (let y = 0; y <= H; y += gridStep) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }

    // Draw Void Holes (Swirling Dark Vortexes)
    for (const hole of voidHoles) {
      hole.phase += 0.04;
      const grad = ctx.createRadialGradient(hole.x, hole.y, 4, hole.x, hole.y, hole.radius + 8);
      grad.addColorStop(0, '#000000');
      grad.addColorStop(0.7, '#1e0518');
      grad.addColorStop(1, 'rgba(239, 68, 68, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(hole.x, hole.y, hole.radius + 8, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = 'rgba(239, 68, 68, 0.65)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 6]);
      ctx.lineDashOffset = -hole.phase * 12;
      ctx.beginPath();
      ctx.arc(hole.x, hole.y, hole.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Draw Laser Jump Barriers
    for (const gate of laserGates) {
      const glow = 0.6 + 0.4 * Math.sin(now * 0.008 + gate.phase);
      ctx.fillStyle = `rgba(255, 42, 133, ${0.28 * glow})`;
      ctx.fillRect(gate.x - 4, gate.y - 4, gate.w + 8, gate.h + 8);
      ctx.fillStyle = '#ff2a85';
      ctx.fillRect(gate.x, gate.y, gate.w, gate.h);
      ctx.font = '10px monospace';
      ctx.fillStyle = '#fbcfe8';
      ctx.textAlign = 'center';
      ctx.fillText('JUMP BARRIER', gate.x + gate.w / 2, gate.y - 6);
    }

    // Draw Neon Maze Walls
    for (const w of walls) {
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(w.x, w.y, w.w, w.h);
      ctx.strokeStyle = '#00f5d4';
      ctx.lineWidth = 2;
      ctx.strokeRect(w.x + 1, w.y + 1, w.w - 2, w.h - 2);
    }

    // Draw Collectible Cyber Gems & Time Checkpoints
    for (const g of gems) {
      g.pulse += 0.06;
      const r = g.radius + Math.sin(g.pulse) * 2.2;
      const isCp = g.type === 'checkpoint';
      const primary = isCp ? '#ffbe0b' : '#00f5d4';

      ctx.save();
      ctx.translate(g.x, g.y);
      ctx.rotate(g.pulse * 0.5);

      ctx.shadowColor = primary;
      ctx.shadowBlur = 16;
      ctx.fillStyle = primary;
      ctx.beginPath();
      // Octagon / Diamond Gem Geometry
      ctx.moveTo(0, -r);
      ctx.lineTo(r * 0.85, 0);
      ctx.lineTo(0, r);
      ctx.lineTo(-r * 0.85, 0);
      ctx.closePath();
      ctx.fill();

      ctx.restore();
    }

    // Draw Marble Neon Ribbon Trail
    for (let i = 0; i < marble.trail.length; i++) {
      const t = marble.trail[i];
      const alpha = (i + 1) / marble.trail.length;
      ctx.fillStyle = t.boost
        ? `rgba(255, 190, 11, ${alpha * 0.42})`
        : `rgba(0, 245, 212, ${alpha * 0.35})`;
      ctx.beginPath();
      ctx.arc(t.x, t.y - t.z * 0.5, marble.radius * (0.35 + alpha * 0.55), 0, Math.PI * 2);
      ctx.fill();
    }

    // Draw Marble Drop Shadow when Airborne (z > 0)
    if (marble.z > 0) {
      const shadowScale = Math.max(0.35, 1 - marble.z / 95);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
      ctx.beginPath();
      ctx.arc(marble.x, marble.y + 6, marble.radius * shadowScale, 0, Math.PI * 2);
      ctx.fill();
    }

    // Draw Glowing Cyber Marble (scales up when jumping along Z-axis)
    const visualRadius = marble.radius * (1 + marble.z * 0.022);
    const visualY = marble.y - marble.z * 0.85;

    ctx.save();
    ctx.shadowColor = marble.z > 0 ? '#ff2a85' : '#00f5d4';
    ctx.shadowBlur = 24;
    const marbleGrad = ctx.createRadialGradient(
      marble.x - visualRadius * 0.3,
      visualY - visualRadius * 0.3,
      2,
      marble.x,
      visualY,
      visualRadius
    );
    marbleGrad.addColorStop(0, '#ffffff');
    marbleGrad.addColorStop(0.55, marble.z > 0 ? '#ff2a85' : '#00f5d4');
    marbleGrad.addColorStop(1, '#0284c7');

    ctx.fillStyle = marbleGrad;
    ctx.beginPath();
    ctx.arc(marble.x, visualY, visualRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Draw Tilt Direction Guide Vector around Marble
    if (Math.hypot(controllerInput.normX, controllerInput.normY) > 0.02) {
      ctx.strokeStyle = 'rgba(255, 190, 11, 0.75)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(marble.x, visualY);
      ctx.lineTo(
        marble.x + controllerInput.normX * 42,
        visualY + controllerInput.normY * 42
      );
      ctx.stroke();
    }

    // Draw Particles
    for (const p of particles) {
      ctx.fillStyle = p.color;
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Draw Floating Score / Event Popups
    for (const ft of floatingTexts) {
      ctx.font = 'bold 14px monospace';
      ctx.fillStyle = ft.color;
      ctx.globalAlpha = Math.max(0, ft.life);
      ctx.textAlign = 'center';
      ctx.fillText(ft.text, ft.x, ft.y);
    }
    ctx.globalAlpha = 1;

    // Game Over Modal Overlay
    if (gameState.gameOver) {
      ctx.fillStyle = 'rgba(5, 8, 17, 0.82)';
      ctx.fillRect(0, 0, W, H);

      ctx.fillStyle = '#00f5d4';
      ctx.font = 'bold 42px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('TIME EXPIRED // RUN COMPLETE', W / 2, H / 2 - 36);

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 24px monospace';
      ctx.fillText(
        `FINAL SCORE: ${gameState.score.toLocaleString()}   |   SECTOR: ${gameState.level}`,
        W / 2,
        H / 2 + 12
      );

      ctx.fillStyle = '#ff2a85';
      ctx.font = '16px monospace';
      ctx.fillText(
        'Shake Phone, Tap JUMP on Controller, or Press [R] to Launch New Run',
        W / 2,
        H / 2 + 56
      );
    }

    ctx.restore();
  }

  function loop(now) {
    const dt = Math.min(0.1, (now - lastFrameTime) / 1000);
    lastFrameTime = now;

    updatePhysics(dt);
    renderArena(now);
    requestAnimationFrame(loop);
  }

  // UI Event Listeners
  newRoomBtn.addEventListener('click', () => {
    currentRoomId = createRoomCode();
    sessionStorage.setItem('cyber_marble_room', currentRoomId);
    initPairingSession(currentRoomId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'join', role: 'host', roomId: currentRoomId }));
    }
  });

  resetGameBtn.addEventListener('click', () => resetGame());

  // Initialize Pairing, WebSocket & Game Loop
  initPairingSession(currentRoomId);
  connectWebSocket();
  resetGame();
  requestAnimationFrame(loop);
})();
