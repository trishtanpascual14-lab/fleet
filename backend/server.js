require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const api = require('./routes/api');

const app = express();
// Prod-ready CORS: pag may FRONTEND_URL env, yun lang allowed.
// Pag wala (local XAMPP), open pa rin para di masira dev.
const FRONTEND_URL = (process.env.FRONTEND_URL || '').split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors({ origin: FRONTEND_URL.length ? FRONTEND_URL : true, credentials: true }));
app.use(express.json());

app.get('/', (req, res) => res.json({ success: true, message: 'Smart Fleet API running', version: '1.0.0' }));
app.use('/api', api);
app.use((req, res) => res.status(404).json({ success: false, message: 'Endpoint not found' }));
// eslint-disable-next-line
app.use((err, req, res, next) => { console.error(err); res.status(500).json({ success: false, message: 'Internal server error' }); });

const PORT = process.env.PORT || 5000;
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: FRONTEND_URL.length ? FRONTEND_URL : '*', methods: ['GET', 'POST', 'PATCH', 'PUT'] } });
app.set('io', io);

const JWT_SECRET = process.env.JWT_SECRET || 'smartfleet_capstone_secret_2026';
// OTP table creation temporarily disabled - kept for future
// try {
//   const { ensureOtpTable } = require('./utils/otp');
//   ensureOtpTable().catch((e) => console.error('OTP table init failed:', e.message));
// } catch {}
// role rooms: role:admin, role:fleet_manager, role:dispatcher, role:driver + user:<id>
io.on('connection', (socket) => {
  try {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token || null;
    if (token) {
      const u = jwt.verify(token, JWT_SECRET);
      // OTP disabled - all tokens are full auth
      socket.data.user = u;
      if (u.role) socket.join(`role:${u.role}`);
      if (u.id) socket.join(`user:${u.id}`);
      if (u.driver_id) socket.join(`driver:${u.driver_id}`);
    }
  } catch { /* allow anonymous (IoT) but no rooms */ }
  socket.on('join', (room) => { if (typeof room === 'string' && room.length < 60) socket.join(room); });
  socket.on('disconnect', () => {});
});

server.listen(PORT, () => console.log(`Smart Fleet API listening on http://localhost:${PORT}`));
