/**
 * Anything but a Game Controller — Full-Stack WebSocket & Express Server
 * ======================================================================
 * Features:
 * 1. Express static file server serving `public/` (index.html, controller.html, etc.)
 * 2. Automatic local LAN IPv4 detection via `os.networkInterfaces()` for zero-config QR pairing.
 * 3. QR code generation endpoint (`/api/session`) using the `qrcode` library pointing to:
 *    http://<HOST_IP>:<PORT>/controller.html?room=<ROOM_ID>
 * 4. Low-latency WebSocket relay (`ws`) managing 4-character Room IDs, pairing state,
 *    60Hz sensor telemetry forwarding, and real-time Ping/Pong RTT latency measurement.
 */

const http = require('http');
const os = require('os');
const path = require('path');
const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');
const QRCode = require('qrcode');

const PORT = Number(process.env.PORT) || 3000;
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Serve static assets from /public
app.use(express.static(path.join(__dirname, 'public')));

/**
 * Automatically detects the machine's primary LAN IPv4 address across Wi-Fi / Ethernet
 * interfaces so the mobile phone on the same Wi-Fi network can scan the QR code directly.
 */
function getLocalLanIP() {
  const interfaces = os.networkInterfaces();
  const candidates = [];

  for (const [name, netList] of Object.entries(interfaces)) {
    if (!netList) continue;
    for (const net of netList) {
      const family = typeof net.family === 'string' ? net.family : (net.family === 4 ? 'IPv4' : 'IPv6');
      if (family === 'IPv4' && !net.internal) {
        // Prioritize common physical LAN interfaces (en0, wlan0, eth0, Wi-Fi)
        const isPreferred = /^(en|eth|wlan|wi-fi|wifi)/i.test(name);
        candidates.push({ address: net.address, isPreferred });
      }
    }
  }

  if (candidates.length === 0) return '127.0.0.1';
  const preferred = candidates.find((c) => c.isPreferred);
  return preferred ? preferred.address : candidates[0].address;
}

const HOST_IP = process.env.HOST_IP || getLocalLanIP();

/**
 * REST Endpoint: /api/session?room=XXXX
 * Returns the detected LAN IP, Port, full Controller Pairing URL, and a scannable
 * QR Code Data URL rendered by the `qrcode` npm package.
 */
app.get('/api/session', async (req, res) => {
  try {
    const rawRoom = String(req.query.room || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
    const roomId = rawRoom.length === 4 ? rawRoom : generateRoomId();
    const portPart = PORT ? `:${PORT}` : '';
    const controllerUrl = `http://${HOST_IP}${portPart}/controller.html?room=${roomId}`;

    // Render crisp high-contrast cyber-themed QR code using `qrcode` library
    const qrDataUrl = await QRCode.toDataURL(controllerUrl, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 260,
      color: {
        dark: '#00f5d4', // Cyber Neon Cyan modules
        light: '#0b0f19' // Deep Arcade Dark background
      }
    });

    res.json({
      roomId,
      hostIp: HOST_IP,
      port: PORT,
      controllerUrl,
      qrDataUrl
    });
  } catch (err) {
    console.error('[QR Error]:', err);
    res.status(500).json({ error: 'Failed to generate pairing QR code' });
  }
});

/**
 * Generates a unique 4-character alphanumeric Room ID (excluding ambiguous 0/O/1/I).
 */
function generateRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < 4; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

/**
 * In-Memory Room Registry
 * Structure: Map<roomId, { host: WebSocket | null, controller: WebSocket | null, lastActive: number }>
 */
const rooms = new Map();

function getOrCreateRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      host: null,
      controller: null,
      lastActive: Date.now()
    });
  }
  const room = rooms.get(roomId);
  room.lastActive = Date.now();
  return room;
}

function sendJson(ws, payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    // Latency & Backpressure Management:
    // Drop non-critical telemetry frames if the socket send buffer exceeds 64KB
    // so the game always reacts to the freshest orientation packet rather than queued lag.
    if (payload.type === 'motion' && ws.bufferedAmount > 65536) {
      return;
    }
    ws.send(JSON.stringify(payload));
  }
}

function broadcastRoomStatus(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;

  const isPaired = Boolean(
    room.host &&
    room.host.readyState === WebSocket.OPEN &&
    room.controller &&
    room.controller.readyState === WebSocket.OPEN
  );

  const statusPayload = {
    type: 'room_status',
    roomId,
    connected: isPaired,
    hostPresent: Boolean(room.host && room.host.readyState === WebSocket.OPEN),
    controllerPresent: Boolean(room.controller && room.controller.readyState === WebSocket.OPEN),
    timestamp: Date.now()
  };

  sendJson(room.host, statusPayload);
  sendJson(room.controller, statusPayload);
}

wss.on('connection', (ws) => {
  ws.roomId = null;
  ws.role = null; // 'host' | 'controller'
  ws.isAlive = true;

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (rawBuffer) => {
    let msg;
    try {
      msg = JSON.parse(rawBuffer.toString());
    } catch {
      return;
    }

    switch (msg.type) {
      case 'join': {
        const roomId = String(msg.roomId || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
        const role = msg.role === 'host' ? 'host' : 'controller';
        if (roomId.length !== 4) {
          sendJson(ws, { type: 'error', message: 'Invalid 4-character Room ID.' });
          return;
        }

        // Clean up previous room binding if client switched rooms
        if (ws.roomId && rooms.has(ws.roomId)) {
          const prevRoom = rooms.get(ws.roomId);
          if (prevRoom[ws.role] === ws) prevRoom[ws.role] = null;
          broadcastRoomStatus(ws.roomId);
        }

        ws.roomId = roomId;
        ws.role = role;
        const room = getOrCreateRoom(roomId);

        // Replace stale socket if reconnecting
        if (room[role] && room[role] !== ws && room[role].readyState === WebSocket.OPEN) {
          sendJson(room[role], { type: 'replaced', message: 'Another session took over this role.' });
          room[role].close();
        }

        room[role] = ws;
        sendJson(ws, { type: 'joined', roomId, role, hostIp: HOST_IP, port: PORT });
        broadcastRoomStatus(roomId);
        break;
      }

      // 60Hz Motion Telemetry & Action Relay (Controller -> Laptop Game Host)
      case 'motion':
      case 'action':
      case 'calibrated': {
        if (!ws.roomId || !rooms.has(ws.roomId)) return;
        const room = rooms.get(ws.roomId);
        room.lastActive = Date.now();
        if (room.host && room.host.readyState === WebSocket.OPEN) {
          sendJson(room.host, msg);
        }
        break;
      }

      // Game Haptic / State Feedback Relay (Laptop Game Host -> Mobile Controller)
      case 'haptic':
      case 'game_event': {
        if (!ws.roomId || !rooms.has(ws.roomId)) return;
        const room = rooms.get(ws.roomId);
        if (room.controller && room.controller.readyState === WebSocket.OPEN) {
          sendJson(room.controller, msg);
        }
        break;
      }

      // Application-level Ping/Pong for sub-millisecond RTT measurement on both screens
      case 'ping_check': {
        const room = ws.roomId ? rooms.get(ws.roomId) : null;
        // Echo back to sender so sender calculates server RTT, and also forward peer latency if paired
        sendJson(ws, {
          type: 'pong_check',
          clientSentAt: msg.clientSentAt,
          serverTime: Date.now(),
          peerConnected: Boolean(
            room &&
            room.host &&
            room.host.readyState === WebSocket.OPEN &&
            room.controller &&
            room.controller.readyState === WebSocket.OPEN
          )
        });

        // Relay latency telemetry to peer so both Laptop and Phone display synchronized ms ping
        if (room && typeof msg.lastRtt === 'number') {
          const peer = ws.role === 'controller' ? room.host : room.controller;
          sendJson(peer, {
            type: 'peer_latency',
            rtt: msg.lastRtt
          });
        }
        break;
      }

      default:
        break;
    }
  });

  ws.on('close', () => {
    if (ws.roomId && rooms.has(ws.roomId)) {
      const room = rooms.get(ws.roomId);
      if (room[ws.role] === ws) {
        room[ws.role] = null;
      }
      broadcastRoomStatus(ws.roomId);

      // Garbage-collect empty rooms
      if (!room.host && !room.controller) {
        rooms.delete(ws.roomId);
      }
    }
  });
});

// Heartbeat interval to clean up dead sockets
const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 15000);

wss.on('close', () => clearInterval(heartbeatInterval));

server.listen(PORT, '0.0.0.0', () => {
  const laptopUrl = `http://${HOST_IP}:${PORT}`;
  const controllerUrl = `http://${HOST_IP}:${PORT}/controller.html`;
  console.log('\n====================================================================');
  console.log('  ANYTHING BUT A GAME CONTROLLER — CYBER MARBLE RUN SERVER ONLINE');
  console.log('====================================================================');
  console.log(`  Local Loopback   : http://localhost:${PORT}`);
  console.log(`  Laptop Game URL  : ${laptopUrl}`);
  console.log(`  Mobile Controller: ${controllerUrl}?room=<ROOM_ID>`);
  console.log('--------------------------------------------------------------------');
  console.log('  Ensure your laptop and phone are on the same Wi-Fi LAN network.');
  console.log('====================================================================\n');
});
