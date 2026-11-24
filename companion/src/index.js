const http = require('http');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { ScreepsApi } = require('./screeps');
const { World } = require('./world');
const { PlayerView } = require('./player');

const port = Number(process.env.PORT || 21080);
const sharedCode = process.env.SHARED_CODE || '';
const ownerUsername = process.env.SCREEPS_OWNER_USERNAME || '';
const ownerPassword = process.env.SCREEPS_OWNER_PASSWORD || '';
const screepsUrl = process.env.SCREEPS_URL || 'http://screeps:21025';

if (!sharedCode || !ownerUsername || !ownerPassword) {
  console.error('SHARED_CODE, SCREEPS_OWNER_USERNAME, and SCREEPS_OWNER_PASSWORD are required');
  process.exit(1);
}

const world = new World({
  url: screepsUrl,
  ownerUsername,
  ownerPassword,
  room: process.env.ROOM || '',
  seedStarter: process.env.SEED_STARTER !== '0'
});

const clients = new Set();
const attempts = new Map();

function codesMatch(input) {
  const left = crypto.createHash('sha256').update(String(input), 'utf8').digest();
  const right = crypto.createHash('sha256').update(sharedCode, 'utf8').digest();
  return crypto.timingSafeEqual(left, right);
}

function rateLimited(ip) {
  const now = Date.now();
  const row = attempts.get(ip) || { fails: 0, reset: now + 15 * 60 * 1000 };
  if (now > row.reset) {
    row.fails = 0;
    row.reset = now + 15 * 60 * 1000;
  }
  attempts.set(ip, row);
  return row.fails >= 8;
}

function markFail(ip) {
  const row = attempts.get(ip) || { fails: 0, reset: Date.now() + 15 * 60 * 1000 };
  row.fails += 1;
  attempts.set(ip, row);
}

function send(socket, message) {
  if (socket.readyState === 1) socket.send(JSON.stringify(message));
}

function validUsername(username) {
  return typeof username === 'string' && /^[A-Za-z0-9_-]{3,20}$/.test(username);
}

async function handleRegister(socket, message, ip) {
  if (rateLimited(ip)) {
    send(socket, { type: 'register', ok: false, error: 'Too many attempts. Wait and try again.' });
    return;
  }
  if (message.step === 'code') {
    const username = typeof message.username === 'string' ? message.username.trim() : '';
    if (!validUsername(username) || !codesMatch(message.code || '')) {
      markFail(ip);
      socket.pending = null;
      send(socket, { type: 'register', step: 'code', ok: false, error: 'Signup was rejected.' });
      return;
    }
    const api = new ScreepsApi(screepsUrl);
    try {
      const taken = await api.request('GET', '/api/register/check-username?username=' + encodeURIComponent(username), null, false);
      if (taken.error) {
        send(socket, { type: 'register', step: 'code', ok: false, error: 'That username is taken.' });
        return;
      }
    } catch (error) {
      send(socket, { type: 'register', step: 'code', ok: false, error: 'That username is taken.' });
      return;
    }
    socket.pending = { username, at: Date.now() };
    send(socket, { type: 'register', step: 'code', ok: true });
    return;
  }
  if (message.step === 'password') {
    const pending = socket.pending;
    const password = typeof message.password === 'string' ? message.password : '';
    if (!pending || Date.now() - pending.at > 10 * 60 * 1000) {
      socket.pending = null;
      send(socket, { type: 'register', step: 'password', ok: false, error: 'Start again with the signup word.' });
      return;
    }
    if (password.length < 8) {
      send(socket, { type: 'register', step: 'password', ok: false, error: 'Use at least 8 characters.' });
      return;
    }
    const api = new ScreepsApi(screepsUrl);
    try {
      await api.register(pending.username, password);
      socket.pending = null;
      send(socket, { type: 'register', step: 'password', ok: true, username: pending.username });
    } catch (error) {
      markFail(ip);
      send(socket, { type: 'register', step: 'password', ok: false, error: 'Could not create that account.' });
    }
  }
}

function stopPlayer(socket) {
  if (!socket.player) return;
  socket.player.stop();
  socket.player = null;
}

function showOwnerColony(socket) {
  socket.session = null;
  send(socket, { type: 'logout', ok: true });
  send(socket, world.snapshot());
}

async function handleLogin(socket, message, ip) {
  if (rateLimited(ip)) {
    send(socket, { type: 'auth', ok: false, error: 'Too many attempts. Wait and try again.' });
    return;
  }
  const username = typeof message.username === 'string' ? message.username.trim() : '';
  const password = typeof message.password === 'string' ? message.password : '';
  if (!validUsername(username) || !password) {
    markFail(ip);
    send(socket, { type: 'auth', ok: false, error: 'Login failed.' });
    return;
  }
  const api = new ScreepsApi(screepsUrl);
  try {
    await api.signin(username, password);
    const me = await api.me();
    stopPlayer(socket);
    const player = new PlayerView({
      api,
      userId: me._id,
      username: me.username || username,
      gcl: me.gcl,
      ownerRoom: world.room || process.env.ROOM || 'W5N5',
      cliHost: new URL(screepsUrl).hostname,
      seedStarter: process.env.SEED_STARTER !== '0'
    });
    socket.player = player;
    socket.session = { username: player.username, userId: player.userId };
    player.onEvent((update) => send(socket, update));
    send(socket, { type: 'auth', ok: true, username: socket.session.username });
    await player.prepare();
    player.watch();
  } catch (error) {
    console.error('login:', error.message);
    const opened = Boolean(socket.player);
    stopPlayer(socket);
    socket.session = null;
    if (!opened) {
      markFail(ip);
      send(socket, { type: 'auth', ok: false, error: 'Login failed.' });
      return;
    }
    send(socket, { type: 'logout', ok: true });
    send(socket, world.snapshot());
    send(socket, { type: 'log', tick: world.tick, text: 'Could not open that colony.' });
  }
}

async function handleRestart(socket) {
  const player = socket.player;
  if (!player) {
    send(socket, { type: 'restart', ok: false, error: 'Log in to start over.' });
    return;
  }
  try {
    const room = await player.restart();
    if (player.username === world.ownerUsername) await world.retarget(room);
    send(socket, { type: 'restart', ok: true });
  } catch (error) {
    console.error('restart:', error.message);
    send(socket, { type: 'restart', ok: false, error: error.message === 'The colony is still alive.' ? error.message : 'Could not start over.' });
  }
}

async function handleCode(socket, message) {
  if (!socket.player) {
    send(socket, { type: 'code', ok: false, error: 'Log in to edit your script.' });
    return;
  }
  try {
    await socket.player.saveMain(message.source);
    send(socket, { type: 'code', ok: true });
  } catch (error) {
    send(socket, { type: 'code', ok: false, error: 'Could not save.' });
  }
}

const server = http.createServer((req, res) => {
  res.writeHead(404);
  res.end();
});

const sockets = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url, 'http://companion');
  if (url.pathname !== '/ws') {
    socket.destroy();
    return;
  }
  sockets.handleUpgrade(request, socket, head, (ws) => {
    sockets.emit('connection', ws, request);
  });
});

sockets.on('connection', (socket, request) => {
  const ip = (request.headers['x-forwarded-for'] || request.socket.remoteAddress || 'unknown').toString().split(',')[0].trim();
  clients.add(socket);
  socket.session = null;
  socket.pending = null;
  send(socket, world.snapshot());
  socket.on('message', (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch (error) {
      return;
    }
    if (!message || typeof message.type !== 'string') return;
    if (message.type === 'login') handleLogin(socket, message, ip);
    if (message.type === 'register') handleRegister(socket, message, ip);
    if (message.type === 'logout') {
      stopPlayer(socket);
      showOwnerColony(socket);
    }
    if (message.type === 'code') handleCode(socket, message);
    if (message.type === 'restart') handleRestart(socket);
  });
  socket.on('close', () => {
    stopPlayer(socket);
    clients.delete(socket);
    socket.session = null;
    socket.pending = null;
  });
});

world.onEvent((message) => {
  for (const socket of clients) {
    if (socket.player) continue;
    send(socket, message);
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log('companion listening on ' + port);
  world.start();
});
