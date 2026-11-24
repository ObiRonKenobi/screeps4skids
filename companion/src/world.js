const WebSocket = require('ws');
const { STARTER_MAIN, ScreepsApi, gclLevel, roomCandidates, spawnTiles } = require('./screeps');

const KEEP = ['_id', 'type', 'x', 'y', 'name', 'hits', 'hitsMax', 'store', 'storeCapacityResource', 'energy', 'energyCapacity', 'spawning', 'user', 'level', 'progress', 'progressTotal', 'mineralType', 'body'];

function pick(object) {
  const out = {};
  KEEP.forEach((key) => {
    if (object[key] !== undefined) out[key] = object[key];
  });
  return out;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class World {
  constructor(options) {
    this.api = new ScreepsApi(options.url);
    this.ownerUsername = options.ownerUsername;
    this.ownerPassword = options.ownerPassword;
    this.seedStarter = options.seedStarter !== false;
    this.roomOverride = options.room || '';
    this.room = null;
    this.terrain = null;
    this.objects = {};
    this.users = {};
    this.tick = null;
    this.cpu = null;
    this.gcl = null;
    this.logs = [];
    this.colonyUser = options.ownerUsername;
    this.ownerUserId = '';
    this.ready = false;
    this.listeners = new Set();
  }

  onEvent(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(message) {
    for (const listener of this.listeners) listener(message);
  }

  pushLog(text) {
    const line = { tick: this.tick, text };
    this.logs.push(line);
    if (this.logs.length > 40) this.logs.shift();
    this.emit({ type: 'log', ...line });
  }

  snapshot() {
    return {
      type: 'snapshot',
      room: this.room,
      terrain: this.terrain,
      tick: this.tick,
      objects: this.objects,
      users: this.users,
      logs: this.logs,
      status: this.status(),
      colonyUser: this.colonyUser,
      ready: this.ready
    };
  }

  status() {
    let energy = 0;
    let capacity = 0;
    Object.values(this.objects).forEach((object) => {
      if (!object || object.type === 'source' || object.type === 'mineral') return;
      const stored = object.store && object.store.energy;
      if (typeof stored === 'number') energy += stored;
      else if (typeof object.energy === 'number' && object.type !== 'source') energy += object.energy;
      const cap = object.storeCapacityResource && object.storeCapacityResource.energy;
      if (typeof cap === 'number') capacity += cap;
      else if (typeof object.energyCapacity === 'number' && object.type !== 'source') capacity += object.energyCapacity;
    });
    return {
      energy,
      capacity,
      cpu: this.cpu,
      gcl: this.gcl
    };
  }

  applyUsers(users) {
    if (!users) return;
    Object.entries(users).forEach(([id, user]) => {
      if (user) this.users[id] = { _id: user._id || id, username: user.username };
    });
  }

  applyObjects(patch, announce) {
    if (!patch) return;
    Object.entries(patch).forEach(([id, value]) => {
      if (value == null) {
        const previous = this.objects[id];
        if (announce && previous && previous.type === 'creep') {
          this.pushLog((previous.name || 'creep') + ' is gone');
        }
        delete this.objects[id];
        return;
      }
      const previous = this.objects[id];
      const next = pick(Object.assign({}, previous, value));
      this.objects[id] = next;
      if (!announce) return;
      if (!previous && next.type === 'creep') this.pushLog((next.name || 'creep') + ' is here');
      if (next.type === 'spawn' && next.spawning && next.spawning.name && (!previous || !previous.spawning || previous.spawning.name !== next.spawning.name)) {
        this.pushLog('Spawning ' + next.spawning.name);
      }
    });
  }

  async start() {
    for (;;) {
      try {
        await this.boot();
        await this.watch();
      } catch (error) {
        this.ready = false;
        console.error('world relay:', error.message);
        this.emit({ type: 'waiting', error: 'server starting' });
        await sleep(3000);
      }
    }
  }

  async boot() {
    await this.waitForServer();
    await this.ensureOwner();
    const me = await this.api.me();
    this.colonyUser = me.username || this.ownerUsername;
    this.ownerUserId = String(me._id || '');
    this.gcl = gclLevel(me.gcl);
    await this.ensureColony();
    const time = await this.api.time();
    this.tick = Number(time.time);
    this.terrain = await this.api.terrain(this.room);
    this.ready = true;
    this.emit(this.snapshot());
  }

  async waitForServer() {
    for (let attempt = 1; attempt <= 120; attempt += 1) {
      try {
        await this.api.request('GET', '/api/version', null, false);
        return;
      } catch (error) {
        if (attempt === 120) throw error;
        await sleep(2000);
      }
    }
  }

  async ensureOwner() {
    try {
      await this.api.signin(this.ownerUsername, this.ownerPassword);
      return;
    } catch (error) {
      if (error.status !== 401 && !/unauthorized/i.test(error.message)) throw error;
    }
    await this.api.register(this.ownerUsername, this.ownerPassword);
    await this.api.signin(this.ownerUsername, this.ownerPassword);
  }

  async ensureColony() {
    const status = await this.api.worldStatus();
    if (status.status === 'normal') {
      const start = await this.api.request('GET', '/api/user/world-start-room', null, true);
      const room = this.roomOverride || (start.room && start.room[0]);
      if (!room) throw new Error('owner has no room');
      this.room = room;
      await this.maybeSeedCode();
      return;
    }
    this.room = await this.chooseRoom();
    const terrain = await this.api.terrain(this.room);
    const tiles = spawnTiles(terrain);
    let placed = false;
    for (const tile of tiles) {
      try {
        await this.api.placeSpawn(this.room, tile.x, tile.y, 'Spawn1');
        placed = true;
        break;
      } catch (error) {
        console.error('place-spawn', this.room, tile.x, tile.y, error.message);
        if (/already playing/i.test(error.message)) {
          placed = true;
          break;
        }
      }
    }
    if (!placed) throw new Error('could not place Spawn1 in ' + this.room);
    await this.maybeSeedCode();
  }

  async chooseRoom() {
    if (this.roomOverride) return this.roomOverride;
    let size = 8;
    try {
      const world = await this.api.worldSize();
      size = world.width || world.height || size;
    } catch (error) {
      console.error('world-size:', error.message);
    }
    for (const room of roomCandidates(size)) {
      try {
        await this.api.terrain(room);
        return room;
      } catch (error) {
        continue;
      }
    }
    throw new Error('no generated room yet');
  }

  async maybeSeedCode() {
    if (!this.seedStarter) return;
    const code = await this.api.getCode();
    const main = code.modules && code.modules.main;
    const text = typeof main === 'string' ? main : (main && main.code) || '';
    if (text.trim()) return;
    await this.api.saveCode({ main: STARTER_MAIN });
    this.pushLog('Starter harvester installed for ' + this.colonyUser);
  }

  watch() {
    this.authed = false;
    this.userId = this.ownerUserId;
    const feed = openGameSocket(this.api.baseUrl, (socket, frame) => handleFrame(this, socket, frame));
    return feed.done;
  }

  }


function readCpu(data) {
  if (typeof data === 'number') return data;
  if (data && typeof data.cpu === 'number') return data.cpu;
  return null;
}

function handleFrame(state, socket, frame) {
  if (frame === 'o') return;
  if (typeof frame !== 'string') return;
  if (!state.authed && (frame.startsWith('time ') || frame.startsWith('protocol '))) {
    state.authed = true;
    socket.send('auth ' + state.api.token);
    return;
  }
  if (frame.startsWith('auth ok ')) {
    state.api.token = frame.slice('auth ok '.length).trim();
    socket.send('subscribe room:' + state.room);
    if (state.userId) socket.send('subscribe user:' + state.userId + '/cpu');
    return;
  }
  if (frame.startsWith('auth failed')) {
    socket.close();
    return;
  }
  let payload;
  try {
    payload = JSON.parse(frame);
  } catch (error) {
    return;
  }
  if (!Array.isArray(payload) || payload.length < 2) return;
  const [channel, data] = payload;
  if (channel === 'room:' + state.room && data) {
    if (typeof data.gameTime === 'number') state.tick = data.gameTime;
    state.applyUsers(data.users);
    state.applyObjects(data.objects, state.objectsReady);
    state.objectsReady = true;
    state.emit({
      type: 'patch',
      tick: state.tick,
      objects: data.objects || {},
      users: state.users,
      status: state.status()
    });
  }
  if (typeof channel === 'string' && channel.endsWith('/cpu')) {
    state.cpu = readCpu(data);
    state.emit({ type: 'status', ...state.status(), tick: state.tick });
  }
}

function openGameSocket(baseUrl, onFrame) {
  const socket = new WebSocket(baseUrl.replace(/^http/, 'ws') + '/socket/websocket');
  let settled = false;
  let stopping = false;
  let resolveDone;
  let rejectDone;
  const done = new Promise((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  const finish = (error) => {
    if (settled) return;
    settled = true;
    try { socket.close(); } catch (closeError) { /* already closed */ }
    if (stopping || !error) resolveDone();
    else rejectDone(error instanceof Error ? error : new Error(String(error)));
  };
  socket.on('error', (error) => finish(error));
  socket.on('close', () => finish(stopping ? null : new Error('screeps socket closed')));
  socket.on('message', (raw) => {
    let frames;
    try {
      frames = decodeFrames(raw.toString());
    } catch (error) {
      console.error('socket frame:', error.message);
      return;
    }
    frames.forEach((frame) => onFrame(socket, frame));
  });
  return {
    done,
    close() {
      stopping = true;
      finish(null);
    }
  };
}

function decodeFrames(text) {
  if (!text || text === 'h' || text === 'o') return text === 'o' ? ['o'] : [];
  if (text[0] === 'c' && text[1] === '[') return [];
  if (text[0] === 'a' && text[1] === '[') {
    const messages = JSON.parse(text.slice(1));
    return Array.isArray(messages) ? messages : [];
  }
  return [text];
}

module.exports = { World, openGameSocket, handleFrame, pick, readCpu };
