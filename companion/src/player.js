const { STARTER_MAIN, gclLevel, roomCandidates, spawnTiles } = require('./screeps');
const { openGameSocket, handleFrame, pick } = require('./world');
const { generateRoom } = require('./cli');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let claimTail = Promise.resolve();

function exclusive(work) {
  const run = claimTail.then(work, work);
  claimTail = run.then(() => {}, () => {});
  return run;
}

function moduleText(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value.code === 'string') return value.code;
  return '';
}

class PlayerView {
  constructor(options) {
    this.api = options.api;
    this.userId = String(options.userId || '');
    this.username = options.username;
    this.colonyUser = options.username;
    this.ownerRoom = options.ownerRoom || '';
    this.cliHost = options.cliHost || 'screeps';
    this.seedStarter = options.seedStarter !== false;
    this.gcl = gclLevel(options.gcl);
    this.room = null;
    this.terrain = null;
    this.objects = {};
    this.users = {};
    this.tick = null;
    this.cpu = null;
    this.logs = [];
    this.code = '';
    this.ready = false;
    this.authed = false;
    this.objectsReady = false;
    this.listeners = new Set();
    this.feed = null;
    this.stopped = false;
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
    return { energy, capacity, cpu: this.cpu, gcl: this.gcl };
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
      code: this.code,
      ready: this.ready
    };
  }

  async prepare() {
    await this.ensureColony();
    this.code = await readMain(this.api);
    this.terrain = await this.api.terrain(this.room);
    const time = await this.api.time();
    this.tick = Number(time.time);
    this.ready = true;
    this.logs.push({ tick: this.tick, text: 'This is ' + this.username + "'s colony." });
    this.emit(this.snapshot());
  }

  watch() {
    if (this.stopped) return;
    this.authed = false;
    this.feed = openGameSocket(this.api.baseUrl, (socket, frame) => handleFrame(this, socket, frame));
    this.feed.done.catch((error) => {
      if (!this.stopped) console.error('player socket:', error.message);
    });
  }

  stop() {
    this.stopped = true;
    if (this.feed) this.feed.close();
  }

  async saveMain(source) {
    if (typeof source !== 'string') throw new Error('Could not save.');
    if (source.length > 500000) throw new Error('That script is too large.');
    const code = await this.api.getCode();
    const modules = {};
    Object.entries(code.modules || {}).forEach(([name, value]) => {
      modules[name] = moduleText(value);
    });
    modules.main = source;
    await this.api.saveCode(modules);
    this.code = source;
  }

  async ensureColony() {
    const status = await this.api.worldStatus();
    if (status.status === 'normal') {
      const start = await this.api.request('GET', '/api/user/world-start-room', null, true);
      const room = start.room && start.room[0];
      if (!room) throw new Error('account has no room');
      this.room = room;
      await this.maybeSeedCode();
      return;
    }
    this.room = await exclusive(() => this.claimFreshRoom());
    await this.maybeSeedCode();
  }

  async claimFreshRoom() {
    let size = 8;
    try {
      const world = await this.api.worldSize();
      size = world.width || world.height || size;
    } catch (error) {
      console.error('world-size:', error.message);
    }
    for (const name of roomCandidates(size)) {
      if (name === this.ownerRoom) continue;
      let terrain = null;
      try {
        terrain = await this.api.terrain(name);
      } catch (error) {
        await generateRoom(this.cliHost, name);
        terrain = await this.waitForTerrain(name);
      }
      if (await this.roomOwned(name)) continue;
      const tiles = spawnTiles(terrain);
      for (const tile of tiles) {
        try {
          await this.api.placeSpawn(name, tile.x, tile.y, 'Spawn1');
          return name;
        } catch (error) {
          console.error('place-spawn', name, tile.x, tile.y, error.message);
          if (/already playing/i.test(error.message)) return name;
          if (/room busy/i.test(error.message)) break;
        }
      }
    }
    throw new Error('no free room');
  }

  async waitForTerrain(room) {
    let last = new Error('no terrain');
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        return await this.api.terrain(room);
      } catch (error) {
        last = error;
        await sleep(400);
      }
    }
    throw last;
  }

  async roomOwned(room) {
    try {
      const overview = await this.api.request('GET', '/api/game/room-overview?room=' + encodeURIComponent(room), null, true);
      return Boolean(overview && overview.owner);
    } catch (error) {
      return false;
    }
  }

  async maybeSeedCode() {
    if (!this.seedStarter) return;
    const text = await readMain(this.api);
    if (text.trim()) return;
    await this.api.saveCode({ main: STARTER_MAIN });
  }
}

async function readMain(api) {
  const code = await api.getCode();
  return moduleText(code.modules && code.modules.main);
}

module.exports = { PlayerView };
