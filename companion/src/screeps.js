const STARTER_MAIN = `module.exports.loop = function () {
    var spawn = Game.spawns.Spawn1;
    var creeps = Object.keys(Game.creeps);
    if (spawn && creeps.length < 2 && !spawn.spawning) {
        spawn.spawnCreep([WORK, CARRY, MOVE], 'harvester' + Game.time);
    }
    for (var i = 0; i < creeps.length; i++) {
        var creep = Game.creeps[creeps[i]];
        if (creep.store.getFreeCapacity() > 0) {
            var source = creep.pos.findClosestByRange(FIND_SOURCES);
            if (source && creep.harvest(source) === ERR_NOT_IN_RANGE) {
                creep.moveTo(source);
            }
        } else if (spawn) {
            if (creep.transfer(spawn, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                creep.moveTo(spawn);
            }
        }
    }
};
`;

class ScreepsApi {
  constructor(baseUrl) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.token = null;
  }

  async request(method, pathname, body, auth) {
    const headers = { 'content-type': 'application/json' };
    if (auth && this.token) {
      headers['x-token'] = this.token;
      headers['x-username'] = this.token;
    }
    const response = await fetch(this.baseUrl + pathname, {
      method,
      headers,
      body: body == null ? undefined : JSON.stringify(body)
    });
    const next = response.headers.get('x-token');
    if (next) this.token = next;
    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (error) {
        data = { error: text };
      }
    }
    if (!response.ok || (data && data.error)) {
      const message = (data && data.error) || response.statusText || 'request failed';
      const err = new Error(String(message));
      err.status = response.status;
      err.data = data;
      throw err;
    }
    return data || {};
  }

  async signin(username, password) {
    const data = await this.request('POST', '/api/auth/signin', {
      email: username,
      password
    }, false);
    if (!data.token) throw new Error('sign-in did not return a token');
    this.token = data.token;
    return data.token;
  }

  async register(username, password) {
    return this.request('POST', '/api/register/submit', {
      username,
      password,
      email: username.toLowerCase() + '@players.screeps.local'
    }, false);
  }

  me() {
    return this.request('GET', '/api/auth/me', null, true);
  }

  worldStatus() {
    return this.request('GET', '/api/user/world-status', null, true);
  }

  worldSize() {
    return this.request('GET', '/api/game/world-size', null, false);
  }

  async terrain(room) {
    const data = await this.request('GET', '/api/game/room-terrain?encoded=1&room=' + encodeURIComponent(room), null, false);
    const row = data.terrain && data.terrain[0];
    if (!row || typeof row.terrain !== 'string') throw new Error('no terrain');
    return row.terrain;
  }

  placeSpawn(room, x, y, name) {
    return this.request('POST', '/api/game/place-spawn', { room, x, y, name }, true);
  }

  getCode() {
    return this.request('GET', '/api/user/code?branch=default', null, true);
  }

  saveCode(modules) {
    return this.request('POST', '/api/user/code', { branch: 'default', modules }, true);
  }

  time() {
    return this.request('GET', '/api/game/time', null, false);
  }
}

function gclLevel(points) {
  let level = 1;
  const score = Number(points) || 0;
  while (level < 100 && Math.pow(level, 2.4) * 1000000 <= score) level += 1;
  return level;
}

function roomCandidates(size) {
  const span = Math.max(1, Math.min(15, Math.ceil(Number(size) || 1)));
  const names = [];
  for (let y = 0; y < span; y += 1) {
    for (let x = 0; x < span; x += 1) {
      names.push('W' + x + 'N' + y);
    }
  }
  return names;
}

function spawnTiles(terrain) {
  const plain = (x, y) => x >= 2 && y >= 2 && x <= 47 && y <= 47 && terrain[y * 50 + x] === '0';
  const tiles = [];
  for (let y = 2; y <= 47; y += 1) {
    for (let x = 2; x <= 47; x += 1) {
      if (plain(x, y) && plain(x - 1, y) && plain(x + 1, y) && plain(x, y - 1) && plain(x, y + 1)) {
        tiles.push({ x, y, dist: Math.abs(x - 25) + Math.abs(y - 25) });
      }
    }
  }
  tiles.sort((a, b) => a.dist - b.dist);
  return tiles.slice(0, 20);
}

module.exports = {
  STARTER_MAIN,
  ScreepsApi,
  gclLevel,
  roomCandidates,
  spawnTiles
};
