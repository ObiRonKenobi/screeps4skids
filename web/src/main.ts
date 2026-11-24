import { cargo, GameObject, RoomView } from './render';

type Panel = 'colony' | 'login' | 'create' | 'guide';

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
  createStep: 'code' | 'password';
  message: string;
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
  createStep: 'code',
  message: ''
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

document.querySelectorAll<HTMLButtonElement>('nav button').forEach((button) => {
  button.addEventListener('click', () => {
    state.panel = button.dataset.panel as Panel;
    state.message = '';
    paintChrome();
  });
});

canvas.addEventListener('click', (event) => {
  if (canvas.parentElement?.classList.contains('dragging')) return;
  const tile = view.tileAt(event.clientX, event.clientY);
  if (!tile) {
    state.selectedId = null;
  } else {
    const found = Object.values(state.objects).find((object) => object.x === tile.x && object.y === tile.y && object.type === 'creep')
      || Object.values(state.objects).find((object) => object.x === tile.x && object.y === tile.y);
    state.selectedId = found ? found._id : null;
  }
  paintChrome();
});

let panelSignature = '';

function paintChrome() {
  tickEl.textContent = state.tick == null ? '----' : String(state.tick);
  userEl.textContent = state.viewer;
  roomName.textContent = 'ROOM ' + state.room;
  roomFoot.textContent = 'ROOM ' + state.room;
  document.querySelectorAll<HTMLButtonElement>('nav button').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.panel === state.panel));
  });
  const signature = state.panel === 'colony'
    ? ['colony', state.selectedId, state.logs.map((line) => line.text).join('|'), state.status.energy, state.status.cpu, state.status.gcl, state.colonyUser].join('~')
    : [state.panel, state.createStep, state.message].join('~');
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
  return colonyPanel();
}

function colonyPanel() {
  const root = document.createElement('div');
  root.append(section('SYSTEM LOGS', logList()));
  root.append(section('COLONY STATUS', statusList()));
  root.append(section('UNIT DETAILS', unitList()));
  return root;
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

function statusList() {
  const list = document.createElement('dl');
  addRow(list, 'COLONY', state.colonyUser || '----');
  addRow(list, 'ENERGY', formatNumber(state.status.energy) + ' / ' + formatNumber(state.status.capacity));
  addRow(list, 'CPU', state.status.cpu == null ? '----' : state.status.cpu.toFixed(1) + 'ms');
  addRow(list, 'GCL', state.status.gcl == null ? '----' : String(state.status.gcl));
  return list;
}

function unitList() {
  const list = document.createElement('dl');
  const object = state.selectedId ? state.objects[state.selectedId] : undefined;
  if (!object) {
    addRow(list, 'SELECTED', 'none');
    return list;
  }
  const owner = object.user && state.users[object.user] ? state.users[object.user].username : '';
  addRow(list, 'NAME', object.name || object.type || 'object');
  addRow(list, 'TYPE', object.type || '----');
  if (owner) addRow(list, 'OWNER', owner);
  if (object.hits != null) addRow(list, 'HEALTH', object.hits + '/' + (object.hitsMax ?? object.hits));
  addRow(list, 'CARGO', cargo(object));
  if (object.level != null) addRow(list, 'LEVEL', String(object.level));
  if (object.spawning && object.spawning.name) addRow(list, 'TASK', 'Spawning ' + object.spawning.name);
  return list;
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

function guide() {
  const root = document.createElement('div');
  root.className = 'guide';
  root.append(heading('HOW TO PLAY'));
  const paragraphs = [
    'This page shows one colony, live. You can watch creeps, energy, and ticks. You cannot command them from here.',
    'Screeps is played by writing JavaScript. The server runs your main loop every tick, even while you are away. You do not click units to move them.',
    'Create an account with the signup word you were given, then log in. That account is yours. It does not control the colony on this screen.',
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
  return root;
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
      state.message = 'Signed in as ' + message.username + '. This screen still shows the host colony.';
      state.panel = 'colony';
    } else {
      state.message = message.error || 'Login failed.';
    }
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
