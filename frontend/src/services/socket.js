import { io } from 'socket.io-client';

let socket = null;

// Reuses existing JWT auth — joins role rooms server-side, no duplicate auth system.
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://127.0.0.1:5000';
export function getSocket() {
  if (socket) return socket;
  const token = localStorage.getItem('fleet_token');
  socket = io(SOCKET_URL, { auth: { token }, reconnection: true, reconnectionDelay: 2000 });
  return socket;
}

export function resetSocket() {
  try { socket?.disconnect(); } catch { /* ignore */ }
  socket = null;
}
