import { cargo, GameObject, RoomView } from './render';

type Panel = 'colony' | 'login' | 'create' | 'guide' | 'code';

interface Status {
  energy: number;
  capacity: number;
  cpu: number | null;
  gcl: number | null;
}

interface LogLine {
  tick: number | null;
  text: string;
}

const app = document.querySelector('#app');
if (!app) throw new Error('missing app');

const state: {
  panel: Panel;
  room: string;
  tick: number | null;
  viewer: string;
  colonyUser: string;
  terrain: string | null;
  objects: Record<string, GameObject>;
  users: Record<string, { username?: string }>;
  logs: LogLine[];
  status: Status;
  selectedId: string | null;
  selectedTile: { x: number; y: number } | null;
  createStep: 'code' | 'password';
  message: string;
  code: string;
  codeVersion: number;
  restarting: boolean;
} = {
  panel: 'colony',
  room: '----',
  tick: null,
  viewer: 'VISITOR',
  colonyUser: '',
  terrain: null,
  objects: {},
  users: {},
  logs: [],
  status: { energy: 0, capacity: 0, cpu: null, gcl: null },
  selectedId: null,
  selectedTile: null,
  createStep: 'code',
  message: '',
  code: '',
  codeVersion: 0,
  restarting: false
};

app.innerHTML = `
  <header>
    <div>RBYT3R.COM // SCREEPS PRIVATE SERVER // TICK: <b id="tick">----</b></div>
    <div>USER: <b id="user">VISITOR</b></div>
  </header>
  <div id="layout">
    <section id="map-wrap">
      <div id="room-name">ROOM ----</div>
      <div id="viewport"><canvas id="room"></canvas></div>
      <div id="room-foot">ROOM ----</div>
    </section>
    <aside>
      <nav>
        <button type="button" data-panel="colony" aria-pressed="true">COLONY</button>
        <button type="button" data-panel="login">LOG IN</button>
        <button type="button" data-panel="create">CREATE ACCOUNT</button>
        <button type="button" data-panel="guide">HOW TO PLAY</button>
      </nav>
      <div id="panel"></div>
    </aside>
  </div>
`;

const tickEl = document.querySelector('#tick') as HTMLElement;
const userEl = document.querySelector('#user') as HTMLElement;
const roomName = document.querySelector('#room-name') as HTMLElement;
const roomFoot = document.querySelector('#room-foot') as HTMLElement;
const panel = document.querySelector('#panel') as HTMLElement;
const canvas = document.querySelector('#room') as HTMLCanvasElement;
const view = new RoomView(canvas);

const nav = document.querySelector('nav') as HTMLElement;
nav.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest('button');
  if (!(button instanceof HTMLButtonElement)) return;
  if (button.dataset.panel === 'logout') {
    send({ type: 'logout' });
    return;
  }
  state.panel = button.dataset.panel as Panel;
  state.message = '';
  paintChrome();
});

canvas.addEventListener('click', (event) => {
  if (canvas.parentElement?.classList.contains('dragging')) return;
  const tile = view.tileAt(event.clientX, event.clientY);
  if (!tile) {
    state.selectedId = null;
    state.selectedTile = null;
  } else {
    state.selectedTile = { x: tile.x, y: tile.y };
    const onTile = objectsOnTile(tile.x, tile.y);
    if (!onTile.length) state.selectedId = null;
    else {
      const index = onTile.findIndex((object) => object._id === state.selectedId);
      state.selectedId = onTile[(index + 1) % onTile.length]._id;
    }
  }
  paintChrome();
});

let panelSignature = '';
let navSignature = '';
let announcedDead = false;

function signedIn() {
  return state.viewer !== 'VISITOR';
}

function paintNav() {
  const items: [Panel | 'logout', string][] = signedIn()
    ? [['colony', 'COLONY'], ['code', 'CODE'], ['logout', 'LOG OUT'], ['guide', 'HOW TO PLAY']]
    : [['colony', 'COLONY'], ['login', 'LOG IN'], ['create', 'CREATE ACCOUNT'], ['guide', 'HOW TO PLAY']];
  const signature = items.map(([id]) => id).join();
  if (signature !== navSignature) {
    navSignature = signature;
    nav.replaceChildren();
    items.forEach(([id, label]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.panel = id;
      button.textContent = label;
      nav.append(button);
    });
    if (!items.some(([id]) => id === state.panel)) state.panel = 'colony';
  }
  nav.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.panel === state.panel));
  });
}

function paintChrome() {
  paintNav();
  const dead = colonyDead();
  if (dead && !announcedDead) state.panel = 'colony';
  announcedDead = dead;
  tickEl.textContent = state.tick == null ? '----' : String(state.tick);
  userEl.textContent = state.viewer;
  roomName.textContent = 'ROOM ' + state.room;
  roomFoot.textContent = 'ROOM ' + state.room;
  const signature = state.panel === 'colony'
    ? ['colony', state.selectedId, selectionKey(), state.logs.map((line) => line.text).join('|'), energyKey(), state.status.cpu, state.status.gcl, state.colonyUser, controllerKey(), dead ? 'dead' : '', state.restarting ? 'restart' : '', state.message].join('~')
    : state.panel === 'code'
      ? ['code', state.codeVersion, state.message].join('~')
      : [state.panel, state.createStep, state.message, state.panel === 'guide' ? state.colonyUser : ''].join('~');
  if (signature !== panelSignature) {
    panelSignature = signature;
    panel.replaceChildren(renderPanel());
  }
  view.draw({ terrain: state.terrain, objects: state.objects, selectedId: state.selectedId });
}

function renderPanel(): HTMLElement {
  if (state.panel === 'login') return loginForm();
  if (state.panel === 'create') return createForm();
  if (state.panel === 'guide') return guide();
  if (state.panel === 'code') return codeForm();
  return colonyPanel();
}

function colonyPanel() {
  const root = document.createElement('div');
  if (colonyDead()) root.append(gameOver());
  root.append(section('SYSTEM LOGS', logList()));
  root.append(section('COLONY STATUS', colonyStatus()));
  root.append(section('UNIT DETAILS', unitList()));
  return root;
}

function colonyDead() {
  if (!signedIn() || !state.terrain) return false;
  const objects = Object.values(state.objects);
  if (objects.some((object) => object.type === 'creep')) return false;
  if (objects.some((object) => object.type === 'spawn' && object.spawning)) return false;
  return energyPool().energy < 200;
}

function gameOver() {
  const wrap = document.createElement('section');
  wrap.className = 'panel game-over';
  wrap.append(heading('GAME OVER'));
  const message = document.createElement('p');
  message.textContent = 'Game Over! Your colony is dead.';
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = state.restarting ? 'STARTING OVER...' : 'START OVER';
  button.disabled = state.restarting;
  button.addEventListener('click', () => {
    if (state.restarting) return;
    state.restarting = true;
    state.message = 'Starting over...';
    send({ type: 'restart' });
    paintChrome();
  });
  wrap.append(message, button);
  if (state.message) wrap.append(note(state.message));
  return wrap;
}

function section(title: string, body: HTMLElement) {
  const wrap = document.createElement('section');
  wrap.className = 'panel';
  const heading = document.createElement('h2');
  heading.textContent = title;
  wrap.append(heading, body);
  return wrap;
}

function logList() {
  const list = document.createElement('ul');
  list.className = 'log';
  const lines = state.logs.slice(-12);
  if (!lines.length) {
    const item = document.createElement('li');
    item.textContent = state.terrain ? 'Watching the colony.' : 'Waiting for the server.';
    list.append(item);
    return list;
  }
  lines.forEach((line) => {
    const item = document.createElement('li');
    const time = document.createElement('time');
    time.textContent = line.tick == null ? '[----]' : '[' + line.tick + ']';
    item.append(time, document.createTextNode(line.text));
    list.append(item);
  });
  return list;
}

function colonyStatus() {
  const wrap = document.createElement('div');
  wrap.append(statusList(), energyMeter(), controllerMeter());
  return wrap;
}

function energyPool() {
  let energy = 0;
  let capacity = 0;
  Object.values(state.objects).forEach((object) => {
    if (object.type !== 'spawn' && object.type !== 'extension') return;
    const stored = object.store && object.store.energy;
    energy += typeof stored === 'number' ? stored : (object.energy || 0);
    const cap = object.storeCapacityResource && object.storeCapacityResource.energy;
    capacity += typeof cap === 'number' ? cap : (object.energyCapacity || 0);
  });
  return { energy, capacity };
}

function energyKey() {
  const pool = energyPool();
  return pool.energy + ':' + pool.capacity;
}

function energyMeter() {
  const pool = energyPool();
  const wrap = document.createElement('div');
  wrap.className = 'meter';
  const label = document.createElement('div');
  label.className = 'meter-label';
  label.textContent = 'ENERGY POOL';
  const track = document.createElement('div');
  track.className = 'meter-track';
  const fill = document.createElement('div');
  fill.className = pool.capacity > 0 && pool.energy < 200 ? 'meter-fill meter-low' : 'meter-fill';
  track.append(fill);
  const readout = document.createElement('div');
  readout.className = 'meter-readout';
  if (pool.capacity <= 0) {
    readout.textContent = '----';
  } else {
    const pct = Math.max(0, Math.min(100, (pool.energy / pool.capacity) * 100));
    readout.textContent = formatNumber(pool.energy) + ' / ' + formatNumber(pool.capacity);
    fill.style.width = pct.toFixed(2) + '%';
  }
  wrap.append(label, track, readout);
  return wrap;
}

function statusList() {
  const list = document.createElement('dl');
  addRow(list, 'COLONY', state.colonyUser || '----');
  addRow(list, 'CPU', state.status.cpu == null ? '----' : state.status.cpu.toFixed(1) + 'ms');
  addRow(list, 'GCL', state.status.gcl == null ? '----' : String(state.status.gcl));
  return list;
}

const CONTROLLER_LEVELS: Record<number, number> = {
  1: 200,
  2: 45000,
  3: 135000,
  4: 405000,
  5: 1215000,
  6: 3645000,
  7: 10935000
};

function controllerObject() {
  return Object.values(state.objects).find((object) => object.type === 'controller');
}

function controllerTarget(controller: GameObject) {
  if (controller.progressTotal != null && controller.progressTotal > 0) return controller.progressTotal;
  if (controller.level == null) return 0;
  return CONTROLLER_LEVELS[controller.level] || 0;
}

function controllerKey() {
  const controller = controllerObject();
  if (!controller) return '';
  return [controller.level, controller.progress, controller.progressTotal].join(':');
}

function controllerMeter() {
  const wrap = document.createElement('div');
  wrap.className = 'meter';
  const label = document.createElement('div');
  label.className = 'meter-label';
  const track = document.createElement('div');
  track.className = 'meter-track';
  const fill = document.createElement('div');
  fill.className = 'meter-fill';
  track.append(fill);
  const readout = document.createElement('div');
  readout.className = 'meter-readout';
  const controller = controllerObject();
  const progress = controller?.progress ?? 0;
  const total = controller ? controllerTarget(controller) : 0;
  if (!controller || controller.level == null) {
    label.textContent = 'CONTROLLER';
    readout.textContent = '----';
  } else if (controller.level >= 8 || total <= 0) {
    label.textContent = 'CONTROLLER LEVEL ' + controller.level;
    readout.textContent = 'MAX';
    fill.style.width = '100%';
  } else {
    const pct = Math.max(0, Math.min(100, (progress / total) * 100));
    label.textContent = 'CONTROLLER LEVEL ' + controller.level;
    readout.textContent = formatNumber(progress) + ' / ' + formatNumber(total);
    fill.style.width = pct.toFixed(2) + '%';
  }
  wrap.append(label, track, readout);
  return wrap;
}

function positionText(x?: number, y?: number) {
  if (x == null || y == null) return '';
  return x + ',' + y;
}

function unitList() {
  const list = document.createElement('dl');
  const object = state.selectedId ? state.objects[state.selectedId] : undefined;
  const position = object
    ? positionText(object.x, object.y)
    : positionText(state.selectedTile?.x, state.selectedTile?.y);
  if (!object && !position) {
    addRow(list, 'SELECTED', 'none');
    return list;
  }
  if (!object) {
    addRow(list, 'POSITION', position);
    return list;
  }
  const owner = object.user && state.users[object.user] ? state.users[object.user].username : '';
  if (object.type === 'constructionSite') {
    addRow(list, 'NAME', 'construction site');
    addRow(list, 'TYPE', structureLabel(object.structureType));
    if (position) addRow(list, 'POSITION', position);
    const total = object.progressTotal ?? 0;
    const progress = object.progress ?? 0;
    addRow(list, 'PROGRESS', total > 0 ? formatNumber(progress) + ' / ' + formatNumber(total) : formatNumber(progress));
    return list;
  }
  addRow(list, 'NAME', object.name || object.type || 'object');
  addRow(list, 'TYPE', object.type || '----');
  if (position) addRow(list, 'POSITION', position);
  if (owner) addRow(list, 'OWNER', owner);
  if (object.hits != null) addRow(list, 'HEALTH', object.hits + '/' + (object.hitsMax ?? object.hits));
  addRow(list, 'CARGO', cargo(object));
  if (object.level != null) addRow(list, 'LEVEL', String(object.level));
  const target = controllerTarget(object);
  if (object.type === 'controller' && target > 0) {
    addRow(list, 'PROGRESS', formatNumber(object.progress ?? 0) + ' / ' + formatNumber(target));
  }
  if (object.spawning && object.spawning.name) addRow(list, 'TASK', 'Spawning ' + object.spawning.name);
  return list;
}

function objectsOnTile(x: number, y: number) {
  const rank = (type?: string) => type === 'constructionSite' ? 0 : type === 'creep' ? 1 : 2;
  return Object.values(state.objects)
    .filter((object) => object.x === x && object.y === y)
    .sort((a, b) => rank(a.type) - rank(b.type) || (a._id < b._id ? -1 : 1));
}

function selectionKey() {
  const object = state.selectedId ? state.objects[state.selectedId] : undefined;
  if (object) {
    const position = positionText(object.x, object.y);
    if (object.type === 'constructionSite') {
      return [position, object.structureType || '', object.progress ?? 0, object.progressTotal ?? 0].join(':');
    }
    return position;
  }
  return positionText(state.selectedTile?.x, state.selectedTile?.y);
}

function structureLabel(type?: string) {
  if (!type) return '----';
  const names: Record<string, string> = {
    constructedWall: 'wall',
    extension: 'extension',
    road: 'road',
    spawn: 'spawn',
    rampart: 'rampart',
    container: 'container',
    tower: 'tower',
    storage: 'storage',
    link: 'link',
    extractor: 'extractor',
    lab: 'lab',
    terminal: 'terminal',
    observer: 'observer',
    nuker: 'nuker',
    factory: 'factory',
    powerSpawn: 'power spawn'
  };
  return names[type] || type.replace(/([A-Z])/g, ' $1').trim().toLowerCase();
}

function addRow(list: HTMLDListElement, name: string, value: string) {
  const term = document.createElement('dt');
  term.textContent = name;
  const detail = document.createElement('dd');
  detail.textContent = value;
  list.append(term, detail);
}

function loginForm() {
  const form = document.createElement('form');
  form.append(heading('LOG IN'), field('Username', 'login-user'), field('Password', 'login-pass', 'password'));
  const button = document.createElement('button');
  button.type = 'submit';
  button.textContent = 'ENTER';
  form.append(button, note(state.message));
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const username = valueOf(form, 'login-user');
    const password = valueOf(form, 'login-pass');
    send({ type: 'login', username, password });
    state.message = 'Checking...';
    paintChrome();
  });
  return form;
}

function createForm() {
  const form = document.createElement('form');
  form.append(heading('CREATE ACCOUNT'));
  if (state.createStep === 'code') {
    form.append(field('Username', 'new-user'), field('Signup word', 'new-code', 'password'));
    const help = document.createElement('p');
    help.className = 'note';
    help.textContent = 'The signup word is the one given to you in person. Then you choose your own password.';
    const button = document.createElement('button');
    button.type = 'submit';
    button.textContent = 'CHECK WORD';
    form.append(help, button);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      send({ type: 'register', step: 'code', username: valueOf(form, 'new-user'), code: valueOf(form, 'new-code') });
      state.message = 'Checking...';
      paintChrome();
    });
  } else {
    form.append(field('Your password', 'new-pass', 'password'));
    const button = document.createElement('button');
    button.type = 'submit';
    button.textContent = 'CREATE';
    form.append(button);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      send({ type: 'register', step: 'password', password: valueOf(form, 'new-pass') });
      state.message = 'Creating...';
      paintChrome();
    });
  }
  form.append(note(state.message));
  return form;
}

function codeForm() {
  const form = document.createElement('form');
  form.append(heading('CODE'));
  const help = document.createElement('p');
  help.className = 'note';
  help.textContent = 'This is the main script for your colony. The server runs it every tick. Save sends it to your room.';
  const area = document.createElement('textarea');
  area.name = 'source';
  area.spellcheck = false;
  area.value = state.code;
  const button = document.createElement('button');
  button.type = 'submit';
  button.textContent = 'SAVE';
  form.append(help, area, button, note(state.message));
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    state.code = area.value;
    send({ type: 'code', source: area.value });
    state.message = 'Saving...';
    paintChrome();
  });
  return form;
}

function guide() {
  const root = document.createElement('div');
  root.className = 'guide';
  root.append(heading('HOW TO PLAY'));
  const host = state.colonyUser || 'the host';
  const paragraphs = [
    'Until you log in, this page shows ' + host + "'s colony, live. You can watch those creeps. You cannot command them.",
    'Screeps is played by writing JavaScript. The server runs your main loop every tick, even while you are away. You do not click units to move them.',
    'Create an account with the signup word you were given, then log in. The map switches to your colony. Open CODE to write and save your script.',
    'Logging in as ' + host + ' stays on this colony and opens CODE for this script.',
    'A colony starts with a spawn, energy sources, and a room controller. A creep is a body of parts: WORK mines, CARRY holds energy, MOVE walks.',
    'Your first script finds a source, mines it, and carries the energy back to the spawn. Feeding the controller raises the room level and unlocks more buildings.'
  ];
  paragraphs.forEach((text) => {
    const p = document.createElement('p');
    p.textContent = text;
    root.append(p);
  });
  const pre = document.createElement('pre');
  pre.textContent = `module.exports.loop = function () {
  for (const name in Game.creeps) {
    const creep = Game.creeps[name];
    if (creep.store.getFreeCapacity() > 0) {
      const source = creep.pos.findClosestByRange(FIND_SOURCES);
      if (source && creep.harvest(source) === ERR_NOT_IN_RANGE) creep.moveTo(source);
    } else if (Game.spawns.Spawn1) {
      if (creep.transfer(Game.spawns.Spawn1, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
        creep.moveTo(Game.spawns.Spawn1);
      }
    }
  }
};`;
  root.append(pre);
  root.append(guideList('PARTS', [
    ['WORK  100', 'harvest, build, repair, upgradeController, dismantle'],
    ['CARRY  50', 'Holds 50 resources. withdraw, transfer, pickup, drop'],
    ['MOVE  50', 'moveTo. One MOVE carries one other part at full speed on open ground'],
    ['ATTACK  80', 'attack, in melee range'],
    ['RANGED_ATTACK  150', 'rangedAttack, rangedMassAttack'],
    ['HEAL  250', 'heal, rangedHeal'],
    ['CLAIM  600', 'claimController, reserveController, attackController'],
    ['TOUGH  10', 'Absorbs damage. No action of its own']
  ]));
  root.append(guideList('ACTIONS', [
    ['moveTo(target)', 'Walk to a position, creep, or structure. Any creep.'],
    ['harvest(target)', 'WORK. Mine an energy source or a mineral.'],
    ['build(site)', 'WORK. Spend carried energy on a construction site.'],
    ['repair(structure)', 'WORK. Spend energy to restore hits.'],
    ['upgradeController(controller)', 'WORK. Spend energy to raise the room level.'],
    ['dismantle(structure)', 'WORK. Tear a structure down.'],
    ['transfer(target, resource)', 'CARRY. Put carried resources into a structure or creep.'],
    ['withdraw(target, resource)', 'CARRY. Take resources out of a structure.'],
    ['pickup(resource)', 'CARRY. Pick up a dropped pile.'],
    ['drop(resource)', 'CARRY. Drop what this creep is holding.'],
    ['attack(target)', 'ATTACK. Strike an adjacent creep or structure.'],
    ['rangedAttack(target)', 'RANGED_ATTACK. Shoot up to 3 tiles away.'],
    ['rangedMassAttack()', 'RANGED_ATTACK. Hit every enemy in range.'],
    ['heal(target)', 'HEAL. Heal an adjacent creep.'],
    ['rangedHeal(target)', 'HEAL. Heal a creep up to 3 tiles away.'],
    ['claimController(controller)', 'CLAIM. Take an unowned controller.'],
    ['reserveController(controller)', 'CLAIM. Reserve a neutral controller.'],
    ['attackController(controller)', 'CLAIM. Reduce a hostile controller.'],
    ['suicide()', 'Remove this creep immediately. Any creep.']
  ]));
  root.append(guideList('BUILDINGS', [
    ['spawn', 'Level 1. Births creeps and holds 300 energy.'],
    ['extension', 'Level 2. Adds 50 energy to the spawn pool. Cost 3,000.'],
    ['road', 'Any level. Halves walking fatigue. Cost 300 on open ground.'],
    ['container', 'Any level. Holds 2,000. Creeps can walk on it. It decays. Cost 5,000.'],
    ['wall', 'Level 2. Blocks movement. Costs 1 to place and a huge amount to fill.'],
    ['rampart', 'Level 2. Your creeps walk through. Enemies do not.'],
    ['tower', 'Level 3. Repairs, attacks, or heals anywhere in the room. Holds 1,000. Cost 5,000.'],
    ['storage', 'Level 4. Holds 1,000,000. Does not decay. Cost 30,000.'],
    ['link', 'Level 5. Sends energy to another link in the room. Cost 5,000.'],
    ['extractor', 'Level 6. Built on the mineral so creeps can mine it. Cost 5,000.'],
    ['lab', 'Level 6. Mixes minerals into boosts. Cost 50,000.'],
    ['terminal', 'Level 6. Sends resources to other rooms. Cost 100,000.'],
    ['factory', 'Level 7. Turns resources into commodities. Cost 100,000.'],
    ['observer', 'Level 8. Looks into a distant room. Cost 8,000.'],
    ['power spawn', 'Level 8. Processes power. Cost 100,000.'],
    ['nuker', 'Level 8. Launches a nuke at another room. Cost 100,000.']
  ]));
  return root;
}

function guideList(title: string, rows: [string, string][]) {
  const block = document.createElement('div');
  block.append(heading(title));
  const list = document.createElement('dl');
  list.className = 'guide-list';
  rows.forEach(([name, detail]) => {
    const term = document.createElement('dt');
    term.textContent = name;
    const description = document.createElement('dd');
    description.textContent = detail;
    list.append(term, description);
  });
  block.append(list);
  return block;
}

function heading(text: string) {
  const h = document.createElement('h2');
  h.textContent = text;
  return h;
}

function field(labelText: string, name: string, type = 'text') {
  const label = document.createElement('label');
  label.textContent = labelText;
  const input = document.createElement('input');
  input.name = name;
  input.type = type;
  input.autocomplete = type === 'password' ? 'current-password' : 'username';
  label.append(input);
  return label;
}

function note(text: string) {
  const p = document.createElement('p');
  p.className = text.toLowerCase().includes('fail') || text.toLowerCase().includes('reject') || text.toLowerCase().includes('taken') || text.toLowerCase().includes('could not') ? 'error' : 'note';
  p.textContent = text;
  return p;
}

function valueOf(form: HTMLFormElement, name: string) {
  const input = form.elements.namedItem(name);
  return input instanceof HTMLInputElement ? input.value : '';
}

function formatNumber(value: number) {
  return Math.round(value).toLocaleString('en-US');
}

let socket: WebSocket | null = null;

function connect() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  socket = new WebSocket(protocol + '//' + location.host + '/ws');
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    apply(message);
    paintChrome();
  });
  socket.addEventListener('close', () => {
    state.logs.push({ tick: state.tick, text: 'Connection closed. Retrying.' });
    setTimeout(connect, 2000);
  });
}

function send(message: unknown) {
  if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function apply(message: {
  type?: string;
  room?: string;
  terrain?: string | null;
  tick?: number | null;
  objects?: Record<string, GameObject | null>;
  users?: Record<string, { username?: string }>;
  logs?: LogLine[];
  status?: Status;
  colonyUser?: string;
  text?: string;
  ok?: boolean;
  error?: string;
  username?: string;
  step?: string;
  energy?: number;
  capacity?: number;
  cpu?: number | null;
  gcl?: number | null;
  code?: string;
}) {
  if (message.type === 'snapshot') {
    state.room = message.room || state.room;
    state.terrain = message.terrain || null;
    state.tick = message.tick ?? state.tick;
    state.objects = message.objects as Record<string, GameObject> || {};
    state.users = message.users || {};
    state.logs = message.logs || [];
    if (message.status) state.status = message.status;
    if (message.colonyUser) state.colonyUser = message.colonyUser;
    if (typeof message.code === 'string') {
      if (message.code !== state.code) {
        state.code = message.code;
        state.codeVersion += 1;
      }
    } else if (!signedIn() && state.code) {
      state.code = '';
      state.codeVersion += 1;
    }
    state.selectedId = null;
    state.selectedTile = null;
    view.fit();
  }
  if (message.type === 'patch') {
    if (message.tick != null) state.tick = message.tick;
    if (message.users) Object.assign(state.users, message.users);
    Object.entries(message.objects || {}).forEach(([id, value]) => {
      if (value == null) delete state.objects[id];
      else state.objects[id] = Object.assign({}, state.objects[id], value, { _id: id });
    });
    if (message.status) state.status = message.status;
  }
  if (message.type === 'status' && message.status == null) {
    state.status = {
      energy: Number(message.energy ?? state.status.energy),
      capacity: Number(message.capacity ?? state.status.capacity),
      cpu: message.cpu ?? state.status.cpu,
      gcl: message.gcl ?? state.status.gcl
    };
    if (message.tick != null) state.tick = message.tick;
  }
  if (message.type === 'log' && message.text) {
    state.logs.push({ tick: message.tick ?? null, text: message.text });
    if (state.logs.length > 40) state.logs.shift();
  }
  if (message.type === 'auth') {
    if (message.ok && message.username) {
      state.viewer = message.username;
      state.message = '';
      state.panel = 'colony';
    } else {
      state.message = message.error || 'Login failed.';
    }
  }
  if (message.type === 'logout') {
    state.viewer = 'VISITOR';
    state.code = '';
    state.codeVersion += 1;
    state.panel = 'colony';
    state.message = '';
    state.selectedId = null;
    state.selectedTile = null;
    state.restarting = false;
    announcedDead = false;
  }
  if (message.type === 'code') {
    state.message = message.ok ? 'Saved.' : (message.error || 'Could not save.');
  }
  if (message.type === 'restart') {
    state.restarting = false;
    state.message = message.ok ? '' : (message.error || 'Could not start over.');
    if (message.ok) state.panel = 'colony';
  }
  if (message.type === 'register') {
    if (message.step === 'code' && message.ok) {
      state.createStep = 'password';
      state.message = 'Signup word accepted. Choose your password.';
    } else if (message.step === 'password' && message.ok) {
      state.createStep = 'code';
      state.panel = 'login';
      state.message = 'Account created. Log in with your username and password.';
    } else {
      state.message = message.error || 'Signup was rejected.';
    }
  }
}

connect();
paintChrome();
requestAnimationFrame(function frame() {
  view.draw({ terrain: state.terrain, objects: state.objects, selectedId: state.selectedId });
  requestAnimationFrame(frame);
});
window.addEventListener('resize', () => view.fit());
