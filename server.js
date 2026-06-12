// 貪吃貓 — multiplayer snake server
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const GRID_W = 44, GRID_H = 26;
const TICK_MS = 160;
const START_LEN = 4;
const MAX_POOPS = 12;
const RESPAWN_MS = 3000;

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/manifest+json' };

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const file = path.join(__dirname, 'public', path.normalize(urlPath).replace(/^(\.\.[\/\\])+/, ''));
  if (!file.startsWith(path.join(__dirname, 'public'))) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });

const players = new Map(); // id -> player
let poops = [];
let nextId = 1;

const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const OPP = { up: 'down', down: 'up', left: 'right', right: 'left' };

function randCell() {
  return [Math.floor(Math.random() * GRID_W), Math.floor(Math.random() * GRID_H)];
}

function occupiedCells() {
  const set = new Set();
  for (const p of players.values()) if (p.alive) for (const [x, y] of p.body) set.add(x + ',' + y);
  return set;
}

function spawnPoop() {
  const occ = occupiedCells();
  for (let i = 0; i < 50; i++) {
    const [x, y] = randCell();
    if (!occ.has(x + ',' + y) && !poops.some(p => p[0] === x && p[1] === y)) { poops.push([x, y]); return; }
  }
}

function spawnSnake(p) {
  // find a spot with room
  for (let tries = 0; tries < 100; tries++) {
    const x = 4 + Math.floor(Math.random() * (GRID_W - 8));
    const y = 4 + Math.floor(Math.random() * (GRID_H - 8));
    const occ = occupiedCells();
    let ok = true;
    for (let i = 0; i < START_LEN; i++) if (occ.has((x - i) + ',' + y)) { ok = false; break; }
    if (!ok) continue;
    p.body = [];
    for (let i = 0; i < START_LEN; i++) p.body.push([x - i, y]);
    p.dir = 'right';
    p.pendingDir = 'right';
    p.alive = true;
    return;
  }
  p.body = [[2, 2], [1, 2], [0, 2]]; p.dir = 'right'; p.pendingDir = 'right'; p.alive = true;
}

wss.on('connection', (ws) => {
  const id = nextId++;
  const p = { id, ws, name: '???', avatar: 'maru', color: '#f6c6d9', body: [], dir: 'right', pendingDir: 'right', alive: false, score: 0, joined: false };
  players.set(id, p);
  ws.send(JSON.stringify({ type: 'welcome', id, gridW: GRID_W, gridH: GRID_H }));

  ws.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type === 'join') {
      p.name = String(msg.name || '貓貓').slice(0, 12);
      p.avatar = String(msg.avatar || 'maru');
      p.color = String(msg.color || '#f6c6d9').slice(0, 9);
      p.joined = true;
      p.score = 0;
      spawnSnake(p);
    } else if (msg.type === 'dir' && p.alive) {
      const d = msg.dir;
      if (DIRS[d] && d !== OPP[p.dir]) p.pendingDir = d;
    }
  });

  ws.on('close', () => players.delete(id));
});

function tick() {
  // maintain poops
  while (poops.length < MAX_POOPS) spawnPoop();

  const alive = [...players.values()].filter(p => p.alive);

  // move heads
  const newHeads = new Map();
  for (const p of alive) {
    p.dir = p.pendingDir;
    const [dx, dy] = DIRS[p.dir];
    const [hx, hy] = p.body[0];
    const nx = (hx + dx + GRID_W) % GRID_W;
    const ny = (hy + dy + GRID_H) % GRID_H;
    newHeads.set(p.id, [nx, ny]);
  }

  // eat check first (so tail growth applies before collision pop)
  const grew = new Set();
  for (const p of alive) {
    const [nx, ny] = newHeads.get(p.id);
    const idx = poops.findIndex(q => q[0] === nx && q[1] === ny);
    if (idx >= 0) { poops.splice(idx, 1); grew.add(p.id); p.score++; }
  }

  // apply movement
  for (const p of alive) {
    p.body.unshift(newHeads.get(p.id));
    if (!grew.has(p.id)) p.body.pop();
  }

  // collisions: head into any body (own body excluding own head; others including their head cell counts as body crash too)
  const dead = [];
  for (const p of alive) {
    const [hx, hy] = p.body[0];
    for (const q of alive) {
      const start = (q.id === p.id) ? 1 : 0;
      for (let i = start; i < q.body.length; i++) {
        if (i === 0 && q.id !== p.id && q.body[0][0] === hx && q.body[0][1] === hy) { dead.push(p); }
        else if (i > 0 && q.body[i][0] === hx && q.body[i][1] === hy) { dead.push(p); }
        else continue;
        break;
      }
    }
  }
  for (const p of new Set(dead)) {
    p.alive = false;
    // drop some poops where it died
    for (let i = 0; i < p.body.length; i += 3) poops.push([p.body[i][0], p.body[i][1]]);
    poops = poops.slice(0, 40);
    const me = p;
    if (me.ws.readyState === 1) me.ws.send(JSON.stringify({ type: 'dead', score: me.score }));
    setTimeout(() => { if (players.has(me.id) && me.joined) { me.score = 0; spawnSnake(me); } }, RESPAWN_MS);
  }

  // broadcast
  const state = {
    type: 'state',
    poops,
    players: [...players.values()].filter(p => p.joined).map(p => ({
      id: p.id, name: p.name, avatar: p.avatar, color: p.color, alive: p.alive, score: p.score, body: p.body, dir: p.dir
    }))
  };
  const payload = JSON.stringify(state);
  for (const p of players.values()) if (p.ws.readyState === 1) p.ws.send(payload);
}

setInterval(tick, TICK_MS);
server.listen(PORT, () => console.log('貪吃貓 server on :' + PORT));
