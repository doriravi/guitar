// Live "jam" client — multi-device shared songwriting.
//
// Connects to the backend's raw WebSocket relay (/ws/jam?room=CODE). Every
// device that joins the same room code shares a channel: whatever one device
// broadcasts (the current song, an edit) is mirrored to the others. The backend
// also pushes {type:'presence',count} frames so we can show how many devices are
// connected.
//
// Usage:
//   const jam = createJam({ onSong, onPresence, onStatus });
//   jam.join('AB12');        // connect to a room
//   jam.sendSong(songObj);   // broadcast the current song to peers
//   jam.leave();

import { API_BASE } from './api';

// Derive the ws(s):// URL from the REST API base (or this origin when same-origin).
function wsUrl(room) {
  let base = API_BASE;
  if (!base) base = (typeof window !== 'undefined') ? window.location.origin : '';
  const httpUrl = new URL('/ws/jam', base);
  httpUrl.protocol = httpUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  httpUrl.searchParams.set('room', room);
  return httpUrl.toString();
}

// A short, unambiguous room code (no easily-confused chars like 0/O, 1/I).
export function makeRoomCode() {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}

export function createJam({ onSong, onPresence, onStatus } = {}) {
  let ws = null;
  let room = null;
  let closedByUs = false;
  let retry = 0;

  const setStatus = (s) => onStatus?.(s);

  function connect() {
    if (!room) return;
    closedByUs = false;
    setStatus('connecting');
    try {
      ws = new WebSocket(wsUrl(room));
    } catch {
      setStatus('error');
      return;
    }

    ws.onopen = () => { retry = 0; setStatus('connected'); };

    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === 'presence') onPresence?.(msg.count);
      else if (msg.type === 'song' && msg.song) onSong?.(msg.song, msg.from);
    };

    ws.onclose = () => {
      setStatus('disconnected');
      // Auto-reconnect (capped backoff) unless we intentionally left.
      if (!closedByUs && room) {
        retry = Math.min(retry + 1, 5);
        setTimeout(connect, retry * 800);
      }
    };

    ws.onerror = () => setStatus('error');
  }

  function send(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
      return true;
    }
    return false;
  }

  return {
    join(code) {
      room = (code || '').trim().toUpperCase();
      connect();
      return room;
    },
    leave() {
      closedByUs = true;
      room = null;
      if (ws) { try { ws.close(); } catch {} ws = null; }
      setStatus('idle');
    },
    // Broadcast the current song to everyone else in the room.
    sendSong(song, from = 'me') { return send({ type: 'song', song, from }); },
    get room() { return room; },
    get connected() { return !!ws && ws.readyState === WebSocket.OPEN; },
  };
}
