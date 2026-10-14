/**
 * Mobile Motion Controller (`public/controller.js`)
 * =================================================
 * Key Engineering Details:
 * 1. iOS Safari Sensor Permission Handling:
 *    Beginning with iOS 13+, Apple requires `DeviceOrientationEvent.requestPermission()`
 *    and `DeviceMotionEvent.requestPermission()` to be invoked directly inside a
 *    synchronous user-gesture handler (`click` on `#startCalibrateBtn`).
 * 2. Low-Pass EMA Filtering, Neutral Angle Calibration & Tilt Normalization:
 *    Raw gyroscope/accelerometer Euler angles (`beta`, `gamma`) are smoothed with an
 *    exponential moving average (LERP factor `0.25`: `filteredTilt += (rawTilt - filteredTilt) * 0.25`)
 *    before subtracting the calibrated neutral holding posture (`baseBeta`, `baseGamma`)
 *    and normalizing into `[-1.0, 1.0]` over a +/-35 degree full-deflection range.
 * 3. Latency & Backpressure Management (60Hz Stream Throttle):
 *    Orientation events on mobile browsers can fire at 100Hz–120Hz+. To prevent WebSocket
 *    backpressure and TCP head-of-line blocking, sensor readings update local state immediately
 *    and a fixed 60Hz scheduler (`16ms` interval) transmits the freshest snapshot only when
 *    `ws.readyState === WebSocket.OPEN` and `ws.bufferedAmount < 16384`.
 */

(() => {
  const ctrlStatusDot = document.getElementById('ctrlStatusDot');
  const ctrlStatusText = document.getElementById('ctrlStatusText');
  const ctrlPingValue = document.getElementById('ctrlPingValue');
  const roomForm = document.getElementById('roomForm');
  const roomInput = document.getElementById('roomInput');
  const startCalibrateBtn = document.getElementById('startCalibrateBtn');
  const recalibrateBtn = document.getElementById('recalibrateBtn');
  const sensorStateLabel = document.getElementById('sensorStateLabel');
  const bubbleStage = document.getElementById('bubbleStage');
  const bubblePuck = document.getElementById('bubblePuck');
  const bubbleReadout = document.getElementById('bubbleReadout');
  const boostBtn = document.getElementById('boostBtn');
  const jumpBtn = document.getElementById('jumpBtn');

  // ---------------------------------------------------------------------------
  // 1. Haptic Feedback Helper (`navigator.vibrate`)
  // ---------------------------------------------------------------------------
  function triggerHaptic(pattern = [25]) {
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(pattern);
      }
    } catch {
      // Ignore on browsers that do not support the Vibration API
    }
  }

  // ---------------------------------------------------------------------------
  // 2. Room ID Resolution (URL Query `?room=XXXX` or Manual Entry)
  // ---------------------------------------------------------------------------
  const params = new URLSearchParams(window.location.search);
  let roomId = (params.get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  if (roomId) {
    roomInput.value = roomId;
  }

  roomForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const entered = roomInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
    if (entered.length !== 4) {
      sensorStateLabel.textContent = 'Please enter a valid 4-character Room ID.';
      triggerHaptic([40, 40]);
      return;
    }
    roomId = entered;
    roomInput.value = roomId;
    triggerHaptic([25]);
    joinCurrentRoom();
  });

  // ---------------------------------------------------------------------------
  // 3. WebSocket Client with Graceful Auto-Reconnect & Ping/Latency Tracking
  // ---------------------------------------------------------------------------
  let ws = null;
  let reconnectTimer = null;
  let reconnectDelay = 700;
  let smoothedRtt = null;

  function connectWebSocket() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;

    try {
      ws = new WebSocket(wsUrl);
    } catch {
      scheduleReconnect();
      return;
    }

    ws.addEventListener('open', () => {
      reconnectDelay = 700;
      if (roomId.length === 4) {
        joinCurrentRoom();
      } else {
        ctrlStatusDot.className = 'status-dot';
        ctrlStatusText.textContent = 'Enter 4-Char Room ID';
      }
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
          if (msg.connected) {
            ctrlStatusDot.className = 'status-dot connected';
            ctrlStatusText.textContent = `Connected (${msg.roomId})`;
            triggerHaptic([30, 40, 30]);
          } else {
            ctrlStatusDot.className = 'status-dot';
            ctrlStatusText.textContent = `Room ${msg.roomId} (Waiting Laptop)`;
          }
          break;
        }

        case 'pong_check': {
          const rtt = Math.max(1, Date.now() - Number(msg.clientSentAt || Date.now()));
          smoothedRtt = smoothedRtt === null ? rtt : Math.round(smoothedRtt * 0.7 + rtt * 0.3);
          ctrlPingValue.textContent = `${smoothedRtt} ms`;
          break;
        }

        case 'haptic': {
          if (msg.pattern) triggerHaptic(msg.pattern);
          break;
        }

        default:
          break;
      }
    });

    ws.addEventListener('close', () => {
      ctrlStatusDot.className = 'status-dot disconnected';
      ctrlStatusText.textContent = 'Disconnected — Retrying...';
      scheduleReconnect();
    });

    ws.addEventListener('error', () => {
      ws.close();
    });
  }

  function joinCurrentRoom() {
    if (ws && ws.readyState === WebSocket.OPEN && roomId.length === 4) {
      ws.send(JSON.stringify({
        type: 'join',
        role: 'controller',
        roomId
      }));
    }
  }

  function scheduleReconnect() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
      reconnectDelay = Math.min(reconnectDelay * 1.5, 4500);
      connectWebSocket();
    }, reconnectDelay);
  }

  // Ping check every 1000ms to display real-time ms latency on both phone & laptop
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
  // 4. iOS Safari Permission Request, Low-Pass Filtering & Tilt Normalization
  // ---------------------------------------------------------------------------
  const MAX_TILT_DEG = 35;       // Full deflection at +/- 35 degrees from calibrated neutral angle
  const TILT_LERP_ALPHA = 0.25;  // Low-pass filter (EMA) smoothing factor for raw beta/gamma angles
  const SHAKE_THRESHOLD = 16.5;  // m/s^2 linear acceleration threshold for Shake-to-Jump

  const sensorState = {
    listenersAttached: false,
    rawBeta: 0,
    rawGamma: 0,
    filteredBeta: 0,
    filteredGamma: 0,
    baseBeta: 0,
    baseGamma: 0,
    needsCalibrationSnapshot: false,
    tiltX: 0,
    tiltY: 0,
    boost: false,
    pendingShakeJump: false,
    lastShakeAt: 0
  };

  /**
   * Normalizes low-pass filtered (beta, gamma) Euler angles relative to the user's
   * calibrated neutral holding posture (`baseBeta`, `baseGamma`) into `[-1.0, 1.0]`.
   */
  function computeNormalizedTilt(filteredBeta, filteredGamma) {
    const deltaX = filteredGamma - sensorState.baseGamma;
    const deltaY = filteredBeta - sensorState.baseBeta;

    const normX = Math.max(-1, Math.min(1, deltaX / MAX_TILT_DEG));
    const normY = Math.max(-1, Math.min(1, deltaY / MAX_TILT_DEG));

    sensorState.tiltX = normX;
    sensorState.tiltY = normY;
    updateBubbleLevelUI(normX, normY);
  }

  function handleOrientation(event) {
    if (event.beta === null && event.gamma === null) return;
    const rawBeta = Number(event.beta) || 0;
    const rawGamma = Number(event.gamma) || 0;

    sensorState.rawBeta = rawBeta;
    sensorState.rawGamma = rawGamma;

    if (sensorState.needsCalibrationSnapshot) {
      sensorState.baseBeta = rawBeta;
      sensorState.baseGamma = rawGamma;
      sensorState.filteredBeta = rawBeta;
      sensorState.filteredGamma = rawGamma;
      sensorState.needsCalibrationSnapshot = false;
    } else {
      // Apply low-pass filter (exponential moving average / LERP) to raw beta & gamma angles:
      // filteredTilt += (rawTilt - filteredTilt) * 0.25
      sensorState.filteredBeta += (rawBeta - sensorState.filteredBeta) * TILT_LERP_ALPHA;
      sensorState.filteredGamma += (rawGamma - sensorState.filteredGamma) * TILT_LERP_ALPHA;
    }

    computeNormalizedTilt(sensorState.filteredBeta, sensorState.filteredGamma);
  }

  function handleMotion(event) {
    // Prefer linear acceleration (gravity removed); fall back to accelerationIncludingGravity
    const acc = event.acceleration && event.acceleration.x !== null
      ? event.acceleration
      : event.accelerationIncludingGravity;
    if (!acc) return;

    const ax = Number(acc.x) || 0;
    const ay = Number(acc.y) || 0;
    const az = Number(acc.z) || 0;

    // Subtract 1G baseline if falling back to accelerationIncludingGravity
    const totalMag = Math.hypot(ax, ay, az);
    const linearEstimate = event.acceleration && event.acceleration.x !== null
      ? totalMag
      : Math.abs(totalMag - 9.81);

    const now = performance.now();
    if (linearEstimate > SHAKE_THRESHOLD && now - sensorState.lastShakeAt > 420) {
      sensorState.lastShakeAt = now;
      sensorState.pendingShakeJump = true;
      triggerHaptic([45, 30, 45]);
      sendImmediateAction('jump');
    }
  }

  /**
   * Requests iOS 13+ DeviceOrientationEvent & DeviceMotionEvent permissions inside a
   * direct user gesture (`click`), attaches listeners, and zeroes the neutral angle.
   */
  async function requestAndCalibrateSensors() {
    triggerHaptic([35]);
    try {
      // iOS 13+ explicit permission check for DeviceOrientationEvent
      if (
        typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function'
      ) {
        const orientationPerm = await DeviceOrientationEvent.requestPermission();
        if (orientationPerm !== 'granted') {
          sensorStateLabel.textContent = 'Orientation permission denied by iOS Safari.';
          return;
        }
      }

      // iOS 13+ explicit permission check for DeviceMotionEvent (for shake detection)
      if (
        typeof DeviceMotionEvent !== 'undefined' &&
        typeof DeviceMotionEvent.requestPermission === 'function'
      ) {
        const motionPerm = await DeviceMotionEvent.requestPermission();
        if (motionPerm !== 'granted') {
          sensorStateLabel.textContent = 'Motion permission denied by iOS Safari.';
          return;
        }
      }

      if (!sensorState.listenersAttached) {
        window.addEventListener('deviceorientation', handleOrientation, true);
        window.addEventListener('devicemotion', handleMotion, true);
        sensorState.listenersAttached = true;
      }

      calibrateNeutralAngle();
      startCalibrateBtn.textContent = 'Sensors Active — Tap to Re-Zero';
      sensorStateLabel.textContent = '60Hz Smoothed Gyro + Shake Detection Active';
    } catch (err) {
      console.error('[Sensor Permission Error]:', err);
      sensorStateLabel.textContent = 'Touch pad active (Hardware gyro unavailable)';
    }
  }

  function calibrateNeutralAngle() {
    sensorState.baseBeta = sensorState.rawBeta;
    sensorState.baseGamma = sensorState.rawGamma;
    sensorState.filteredBeta = sensorState.rawBeta;
    sensorState.filteredGamma = sensorState.rawGamma;
    sensorState.needsCalibrationSnapshot = true;
    computeNormalizedTilt(sensorState.filteredBeta, sensorState.filteredGamma);
    triggerHaptic([25, 40, 25]);

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'calibrated', timestamp: Date.now() }));
    }
  }

  startCalibrateBtn.addEventListener('click', requestAndCalibrateSensors);
  recalibrateBtn.addEventListener('click', calibrateNeutralAngle);

  // ---------------------------------------------------------------------------
  // 5. Visual Bubble Level Feedback & Touch-Drag Fallback
  // ---------------------------------------------------------------------------
  function updateBubbleLevelUI(normX, normY) {
    const maxRadiusPx = 76; // Max puck travel inside the 210px gauge
    const px = normX * maxRadiusPx;
    const py = normY * maxRadiusPx;
    bubblePuck.style.transform = `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px)`;
    bubbleReadout.textContent = `X: ${normX >= 0 ? '+' : ''}${normX.toFixed(2)}  |  Y: ${normY >= 0 ? '+' : ''}${normY.toFixed(2)}`;
  }

  // Allow touch/mouse dragging on the virtual bubble gauge for desktop testing
  let pointerDown = false;
  function updateFromPointer(e) {
    if (!pointerDown) return;
    const rect = bubbleStage.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const rawDx = Math.max(-1, Math.min(1, (e.clientX - cx) / 85));
    const rawDy = Math.max(-1, Math.min(1, (e.clientY - cy) / 85));
    sensorState.tiltX += (rawDx - sensorState.tiltX) * TILT_LERP_ALPHA;
    sensorState.tiltY += (rawDy - sensorState.tiltY) * TILT_LERP_ALPHA;
    updateBubbleLevelUI(sensorState.tiltX, sensorState.tiltY);
  }

  bubbleStage.addEventListener('pointerdown', (e) => {
    pointerDown = true;
    updateFromPointer(e);
  });
  window.addEventListener('pointermove', updateFromPointer);
  window.addEventListener('pointerup', () => {
    if (pointerDown) {
      pointerDown = false;
      if (!sensorState.listenersAttached) {
        sensorState.tiltX = 0;
        sensorState.tiltY = 0;
        updateBubbleLevelUI(0, 0);
      }
    }
  });

  // ---------------------------------------------------------------------------
  // 6. On-Screen Action Buttons (Boost & Jump) with Haptics
  // ---------------------------------------------------------------------------
  function sendImmediateAction(action, active = true) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'action',
        action,
        active,
        timestamp: Date.now()
      }));
    }
  }

  function setBoostState(active) {
    sensorState.boost = active;
    boostBtn.classList.toggle('active-press', active);
    if (active) triggerHaptic([30]);
    sendImmediateAction('boost', active);
  }

  boostBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    setBoostState(true);
  });
  boostBtn.addEventListener('pointerup', () => setBoostState(false));
  boostBtn.addEventListener('pointercancel', () => setBoostState(false));
  boostBtn.addEventListener('pointerleave', () => {
    if (sensorState.boost) setBoostState(false);
  });

  jumpBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    jumpBtn.classList.add('active-press');
    sensorState.pendingShakeJump = true;
    triggerHaptic([45]);
    sendImmediateAction('jump', true);
    setTimeout(() => jumpBtn.classList.remove('active-press'), 160);
  });

  // ---------------------------------------------------------------------------
  // 7. 60Hz Stream Throttle (~16.67ms) to Prevent WebSocket Backpressure
  // ---------------------------------------------------------------------------
  const STREAM_INTERVAL_MS = 1000 / 60; // ~16.67ms (60Hz cap)

  setInterval(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN || roomId.length !== 4) return;

    // Backpressure guard: skip frame if socket buffer is backed up (>16KB)
    if (ws.bufferedAmount > 16384) return;

    ws.send(JSON.stringify({
      type: 'motion',
      tiltX: Number(sensorState.tiltX.toFixed(4)),
      tiltY: Number(sensorState.tiltY.toFixed(4)),
      boost: sensorState.boost,
      shakeJump: sensorState.pendingShakeJump,
      timestamp: Date.now()
    }));

    sensorState.pendingShakeJump = false;
  }, STREAM_INTERVAL_MS);

  // Connect immediately on load
  connectWebSocket();
})();
