// Thirteen with the Gang: game server.
// Serves the page from ./public and runs every online table in memory over WebSockets.
// One process must stay up for tables to survive, so deploy this as a single always-on instance.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const E = require('./public/engine.js');   // the same rules file the browser loads

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(__dirname, 'public');
const CHARACTERS = 7;          // Mick, Triston, Amanda, Bobbi, Brandon, Yana, PJ (order matches public/index.html)
const SCENES = 7;
const BOT_DELAY_MS = 1150;     // how long a computer player "thinks"
const EMPTY_TABLE_MS = 15 * 60 * 1000;      // a table nobody is connected to is removed after this
const STALE_TABLE_MS = 6 * 60 * 60 * 1000;  // any table untouched this long is removed
const MAX_TABLES = 500;

/* ---------- static files ---------- */
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  let rel;
  try { rel = decodeURIComponent((req.url || '/').split('?')[0]); } catch (e) { res.writeHead(400); return res.end('Bad request'); }
  if (rel === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

/* ---------- tables ---------- */
const tables = new Map();      // invite key -> table
const send = (ws, msg) => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); };
const rand = n => Math.floor(Math.random() * n);
function newKey() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  for (;;) { let k = ''; for (let i = 0; i < 5; i++) k += A[rand(A.length)]; if (!tables.has(k)) return k; }
}
const seatOf = (T, pid) => { const S = T.S; if (!S.owner) return -1; for (let i = 0; i < 4; i++) if (S.owner['s' + i] === pid) return i; return -1; };
const charOf = (T, pid) => { for (let i = 0; i < CHARACTERS; i++) if (T.S.seats['c' + i] === pid) return i; return -1; };
const connected = (T, pid) => { for (const p of T.conns.values()) if (p === pid) return true; return false; };

// What one player is allowed to see: their own cards, and only how many everyone else holds.
function viewFor(T, pid) {
  const v = E.clone(T.S), seat = seatOf(T, pid);
  if (v.hands) for (let i = 0; i < 4; i++) if (i !== seat) v.hands['h' + i] = v.hands['h' + i].map(() => -1);
  for (let i = 0; i < CHARACTERS; i++) v.seats['c' + i] = v.seats['c' + i] ? 'x' : '';
  if (v.owner) for (let i = 0; i < 4; i++) v.owner['s' + i] = v.owner['s' + i] ? 'x' : '';
  return { t: 'state', S: v, you: seat, ch: charOf(T, pid), host: pid === T.host, key: T.key };
}
function broadcast(T) {
  T.touched = Date.now();
  for (const [ws, pid] of T.conns) send(ws, viewFor(T, pid));
  scheduleBot(T);
}
function commit(T, ns) { ns.v = (T.S.v | 0) + 1; ns.ev.id = ns.v; T.S = ns; broadcast(T); }
function touch(T) { T.S.v = (T.S.v | 0) + 1; broadcast(T); }
function note(T, msg, except) { for (const ws of T.conns.keys()) if (ws !== except) send(ws, { t: 'note', msg }); }

function scheduleBot(T) {
  clearTimeout(T.botTimer);
  const S = T.S;
  if (S.phase !== 'play' || !S.bots || !S.bots[S.turn]) return;
  const v = S.v;
  T.botTimer = setTimeout(() => {
    if (tables.get(T.key) !== T || T.S.v !== v || T.S.phase !== 'play') return;
    const mv = E.botMove(T.S, T.S.turn);
    const ns = mv ? E.play(T.S, T.S.turn, mv) : E.pass(T.S, T.S.turn);
    if (ns) commit(T, ns);
  }, BOT_DELAY_MS);
}
// Picked characters take the first seats; the computer fills the rest from whoever nobody chose.
function castWith(picked) {
  const rest = []; for (let i = 0; i < CHARACTERS; i++) if (!picked.includes(i)) rest.push(i);
  for (let i = rest.length - 1; i > 0; i--) { const j = rand(i + 1); [rest[i], rest[j]] = [rest[j], rest[i]]; }
  return picked.concat(rest).slice(0, 4);
}
// home = which scene the game is played in: the host's pick, or a random player's home.
const dealGame = (prev, cast, pick) => Object.assign(E.deal(prev), { home: pick >= 0 && pick < SCENES ? pick : cast[rand(cast.length)] });

function attach(ws, T, pid) {
  ws.table = T; T.conns.set(ws, pid); T.emptySince = 0;
  if (!connected(T, T.host) && T.S.phase === 'lobby') T.host = pid;      // the old host is gone: whoever arrives runs the table
  const s = seatOf(T, pid);
  if (s >= 0 && T.S.away && T.S.away[s]) { T.S.away[s] = false; T.S.bots[s] = false; }   // welcome back: take your seat from the computer
  touch(T);
}
function detach(ws) {
  const T = ws.table; if (!T) return;
  const pid = T.conns.get(ws); T.conns.delete(ws); ws.table = null;
  if (!T.conns.size) { T.emptySince = Date.now(); clearTimeout(T.botTimer); }
  if (!pid || connected(T, pid)) return;          // still here on another tab or device
  const S = T.S;
  if (S.phase === 'lobby') {
    const c = charOf(T, pid); if (c >= 0) S.seats['c' + c] = '';
    if (T.host === pid && T.conns.size) T.host = T.conns.values().next().value;
    if (T.conns.size) touch(T);
    return;
  }
  const s = seatOf(T, pid);
  if (s >= 0) {                                   // mid-game: the computer covers until they come back
    S.away = S.away || [false, false, false, false];
    S.away[s] = true; S.bots[s] = true;
    if (T.conns.size) { note(T, 'A player dropped out. The computer is covering.'); touch(T); }
  }
}

function onMessage(ws, m) {
  if (!m || typeof m !== 'object') return;
  if (m.t === 'create' || m.t === 'join') {
    const pid = String(m.pid || '').slice(0, 40);
    if (pid.length < 6) return send(ws, { t: 'error', msg: 'Could not join. Reload the page and try again.' });
    if (ws.table) detach(ws);
    let T;
    if (m.t === 'create') {
      if (tables.size >= MAX_TABLES) return send(ws, { t: 'error', msg: 'The server is full right now. Try again later.' });
      const seats = {}; for (let i = 0; i < CHARACTERS; i++) seats['c' + i] = '';
      T = { key: newKey(), S: { v: 1, phase: 'lobby', seats, pick: -1 }, conns: new Map(), host: pid, botTimer: null, touched: Date.now(), emptySince: 0 };
      tables.set(T.key, T);
    } else {
      const key = String(m.key || '').toUpperCase();
      T = /^[A-Z]{5}$/.test(key) ? tables.get(key) : null;
      if (!T) return send(ws, { t: 'error', msg: 'No table with the key ' + key.slice(0, 5) + '.' });
    }
    return attach(ws, T, pid);
  }
  const T = ws.table; if (!T) return;
  const pid = T.conns.get(ws), S = T.S, seat = seatOf(T, pid);
  switch (m.t) {
    case 'leave': detach(ws); break;
    case 'claim': {                               // pick a character in the lobby; four can play
      const i = m.seat | 0;
      if (S.phase !== 'lobby' || i < 0 || i >= CHARACTERS) break;
      const cur = S.seats['c' + i]; if (cur && cur !== pid) break;
      const had = charOf(T, pid);
      let taken = 0; for (let k = 0; k < CHARACTERS; k++) if (S.seats['c' + k]) taken++;
      if (had < 0 && taken >= 4) break;
      if (had >= 0) S.seats['c' + had] = '';
      S.seats['c' + i] = pid; touch(T);
      break;
    }
    case 'field': {                               // the host picks the scene, or -1 for a surprise
      const n = m.n | 0;
      if (S.phase !== 'lobby' || pid !== T.host || n < -1 || n >= SCENES) break;
      S.pick = n; touch(T);
      break;
    }
    case 'start': {
      if (S.phase !== 'lobby' || pid !== T.host || charOf(T, pid) < 0) break;
      const picked = []; for (let i = 0; i < CHARACTERS; i++) if (S.seats['c' + i]) picked.push(i);
      const cast = castWith(picked.slice(0, 4)), owner = {};
      cast.forEach((c, s) => { owner['s' + s] = S.seats['c' + c] || ''; });
      commit(T, Object.assign(E.clone(S), dealGame(null, cast, S.pick), { cast, owner, bots: cast.map((c, s) => !owner['s' + s]), away: [false, false, false, false] }));
      break;
    }
    case 'play': {
      if (seat < 0 || !Array.isArray(m.cards) || m.cards.length > 13) break;
      const ns = E.play(S, seat, m.cards.map(Number));
      if (ns) commit(T, ns); else send(ws, viewFor(T, pid));
      break;
    }
    case 'pass': { if (seat < 0) break; const ns = E.pass(S, seat); if (ns) commit(T, ns); break; }
    case 'again': { if (seat < 0 || S.phase !== 'over') break; commit(T, Object.assign(E.clone(S), dealGame(S, S.cast, S.pick))); break; }
    case 'taunt': {
      if (seat < 0 || Date.now() - (ws.lastTaunt || 0) < 1500) break;
      ws.lastTaunt = Date.now(); T.touched = Date.now();
      for (const other of T.conns.keys()) if (other !== ws) send(other, { t: 'taunt', seat, n: m.n | 0 });
      break;
    }
  }
}

/* ---------- sockets ---------- */
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });
wss.on('connection', ws => {
  ws.alive = true; ws.table = null;
  ws.on('pong', () => { ws.alive = true; });
  ws.on('message', data => { let m; try { m = JSON.parse(data.toString()); } catch (e) { return; } try { onMessage(ws, m); } catch (e) { console.error('message failed', e); } });
  ws.on('close', () => detach(ws));
  ws.on('error', () => {});
});
// Drop sockets that stopped answering, and clear out abandoned tables.
setInterval(() => {
  for (const ws of wss.clients) { if (!ws.alive) { ws.terminate(); continue; } ws.alive = false; try { ws.ping(); } catch (e) {} }
  const now = Date.now();
  for (const [key, T] of tables) {
    if ((T.emptySince && now - T.emptySince > EMPTY_TABLE_MS) || now - T.touched > STALE_TABLE_MS) { clearTimeout(T.botTimer); tables.delete(key); }
  }
}, 30000);

server.listen(PORT, '0.0.0.0', () => console.log('Thirteen with the Gang is listening on port ' + PORT));
