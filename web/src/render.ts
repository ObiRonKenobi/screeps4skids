export interface GameObject {
  _id: string;
  type?: string;
  x?: number;
  y?: number;
  name?: string;
  hits?: number;
  hitsMax?: number;
  store?: { energy?: number };
  storeCapacityResource?: { energy?: number };
  energy?: number;
  energyCapacity?: number;
  spawning?: { name?: string } | null;
  user?: string;
  level?: number;
  progress?: number;
  progressTotal?: number;
  body?: unknown[];
  structureType?: string;
}

export interface RenderState {
  terrain: string | null;
  objects: Record<string, GameObject>;
  selectedId: string | null;
}

const ROOM = 50;

export class RoomView {
  private cell = 14;
  private originX = 0;
  private originY = 0;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;

  constructor(private canvas: HTMLCanvasElement) {
    canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      const next = Math.min(32, Math.max(6, this.cell + (event.deltaY < 0 ? 2 : -2)));
      if (next === this.cell) return;
      const anchorX = rect.width / 2;
      const anchorY = rect.height / 2;
      const worldX = (anchorX - this.originX) / this.cell;
      const worldY = (anchorY - this.originY) / this.cell;
      this.cell = next;
      this.originX = anchorX - worldX * this.cell;
      this.originY = anchorY - worldY * this.cell;
      this.clamp();
    }, { passive: false });
    canvas.addEventListener('pointerdown', (event) => {
      this.dragging = true;
      this.lastX = event.clientX;
      this.lastY = event.clientY;
      canvas.setPointerCapture(event.pointerId);
      canvas.parentElement?.classList.add('dragging');
    });
    canvas.addEventListener('pointerup', () => {
      this.dragging = false;
      canvas.parentElement?.classList.remove('dragging');
    });
    canvas.addEventListener('pointermove', (event) => {
      if (!this.dragging) return;
      this.originX += event.clientX - this.lastX;
      this.originY += event.clientY - this.lastY;
      this.lastX = event.clientX;
      this.lastY = event.clientY;
      this.clamp();
    });
  }

  tileAt(clientX: number, clientY: number): { x: number; y: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    const x = Math.floor((clientX - rect.left - this.originX) / this.cell);
    const y = Math.floor((clientY - rect.top - this.originY) / this.cell);
    if (x < 0 || y < 0 || x >= ROOM || y >= ROOM) return null;
    return { x, y };
  }

  fit() {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 20 || rect.height < 20) return;
    this.cell = Math.max(6, Math.floor(Math.min(rect.width, rect.height) / ROOM));
    this.originX = Math.floor((rect.width - this.cell * ROOM) / 2);
    this.originY = Math.floor((rect.height - this.cell * ROOM) / 2);
  }

  draw(state: RenderState) {
    const rect = this.canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.floor(rect.width * ratio));
    const height = Math.max(1, Math.floor(rect.height * ratio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#031407';
    ctx.fillRect(0, 0, rect.width, rect.height);
    ctx.save();
    ctx.translate(this.originX, this.originY);
    this.drawTerrain(ctx, state.terrain);
    this.drawRoads(ctx, state.objects);
    this.drawObjects(ctx, state);
    ctx.restore();
  }

  private clamp() {
    const rect = this.canvas.getBoundingClientRect();
    const size = this.cell * ROOM;
    this.originX = place(this.originX, rect.width, size);
    this.originY = place(this.originY, rect.height, size);
  }

  private drawTerrain(ctx: CanvasRenderingContext2D, terrain: string | null) {
    const cell = this.cell;
    ctx.fillStyle = GRASS;
    ctx.fillRect(0, 0, ROOM * cell, ROOM * cell);
    for (let y = 0; y < ROOM; y += 1) {
      for (let x = 0; x < ROOM; x += 1) {
        const tile = terrainAt(terrain, x, y);
        if (tile === '1' || tile === '3') drawWall(ctx, terrain, x, y, cell);
        else if (tile === '2') drawSwamp(ctx, x, y, cell);
        else drawTuft(ctx, x, y, cell);
      }
    }
  }

  private drawRoads(ctx: CanvasRenderingContext2D, objects: Record<string, GameObject>) {
    const cell = this.cell;
    const roads = new Set<string>();
    const sites = new Set<string>();
    Object.values(objects).forEach((object) => {
      if (!Number.isFinite(object.x) || !Number.isFinite(object.y)) return;
      const at = object.x + ',' + object.y;
      if (object.type === 'road') roads.add(at);
      else if (object.type === 'constructionSite' && object.structureType === 'road') sites.add(at);
    });
    const roadAt = (x: number, y: number) => roads.has(x + ',' + y);
    const anyAt = (x: number, y: number) => roadAt(x, y) || sites.has(x + ',' + y);
    const edge = Math.max(2, Math.round(cell * 0.34));
    const fill = Math.max(1, edge - Math.max(1, Math.round(cell * 0.12)));
    roads.forEach((at) => {
      const [x, y] = at.split(',').map(Number);
      stampRoads(ctx, x, y, cell, roadAt, edge, ROAD_EDGE);
    });
    roads.forEach((at) => {
      const [x, y] = at.split(',').map(Number);
      stampRoads(ctx, x, y, cell, roadAt, fill, ROAD);
    });
    sites.forEach((at) => {
      const [x, y] = at.split(',').map(Number);
      stampRoads(ctx, x, y, cell, anyAt, fill, ROAD, true);
    });
  }

  private drawObjects(ctx: CanvasRenderingContext2D, state: RenderState) {
    const list = Object.values(state.objects).filter((object) => Number.isFinite(object.x) && Number.isFinite(object.y) && !isRoad(object));
    list.sort((a, b) => rank(a.type) - rank(b.type));
    for (const object of list) {
      const x = (object.x || 0) * this.cell;
      const y = (object.y || 0) * this.cell;
      drawGlyph(ctx, object, x, y, this.cell);
      if (object._id === state.selectedId) brackets(ctx, x, y, this.cell);
    }
    const selected = state.selectedId ? state.objects[state.selectedId] : undefined;
    if (selected && isRoad(selected) && Number.isFinite(selected.x) && Number.isFinite(selected.y)) {
      brackets(ctx, (selected.x || 0) * this.cell, (selected.y || 0) * this.cell, this.cell);
    }
  }
}

function place(origin: number, view: number, size: number) {
  if (size <= view) return Math.floor((view - size) / 2);
  return Math.max(view - size, Math.min(0, origin));
}

const GRASS = '#0c3a1c';
const ROAD = '#f0d15a';
const ROAD_EDGE = '#7a4512';
const INK = '#102010';
const CREAM = '#f4ffe8';
const RED = '#e23d3d';
const YELLOW = '#ffe14a';
const BLUE = '#3aa0ff';
const LEAF = '#7dff6a';

const PALETTE: Record<string, string> = {
  k: INK,
  w: CREAM,
  r: RED,
  y: YELLOW,
  b: BLUE,
  g: LEAF,
  s: '#c5d0bc'
};

const SPRITES: Record<string, string[]> = {
  creep: [
    '..kkkk..',
    '.kwwwwk.',
    '.kywwyk.',
    '.kwwwwk.',
    '.kggggk.',
    'kgkrrkg.',
    '.kggggk.',
    '.k.kk.k.'
  ],
  spawn: [
    '.rrrrrr.',
    'rrrrrrrr',
    'kwwwwwwk',
    'kwywwywk',
    'kwwwwwwk',
    'kwwrrwwk',
    'kwwwwwwk',
    'kkkkkkkk'
  ],
  extension: [
    '...kk...',
    '..kbbk..',
    '.kbyybk.',
    '.kbyybk.',
    '.kbyybk.',
    '.kbbbbk.',
    '..kbbk..',
    '...kk...'
  ],
  source: [
    '...kk...',
    '..kyyk..',
    '.kywwyk.',
    'kyyyyyyk',
    '.kywwyk.',
    '..kyyk..',
    '...kk...',
    '........'
  ],
  mineral: [
    '...kk...',
    '..kbbk..',
    '.kbwwbk.',
    'kbbbbbbk',
    '.kbwwbk.',
    '..kbbk..',
    '...kk...',
    '........'
  ],
  controller: [
    '...kk...',
    '..kwwk..',
    '.kbwwbk.',
    'kbwwwwbk',
    '.kbwwbk.',
    '..kbbk..',
    '..kwwk..',
    '..kkkk..'
  ],
  site: [
    'yy....yy',
    'y......y',
    '........',
    '........',
    '........',
    '........',
    'y......y',
    'yy....yy'
  ],
  wall: [
    'kkkkkkkk',
    'kssksskk',
    'kkkkkkkk',
    'kssksskk',
    'kkkkkkkk',
    'kksskssk',
    'kkkkkkkk',
    'kkkkkkkk'
  ]
};

function rank(type?: string) {
  if (type === 'creep') return 5;
  if (type === 'spawn') return 4;
  if (type === 'source' || type === 'mineral') return 2;
  return 3;
}

function isRoad(object: GameObject) {
  return object.type === 'road' || (object.type === 'constructionSite' && object.structureType === 'road');
}

function terrainAt(terrain: string | null, x: number, y: number) {
  if (!terrain || x < 0 || y < 0 || x >= ROOM || y >= ROOM) return '0';
  return terrain[y * ROOM + x];
}

function drawWall(ctx: CanvasRenderingContext2D, terrain: string | null, x: number, y: number, cell: number) {
  const left = x * cell;
  const top = y * cell;
  ctx.fillStyle = '#071a0e';
  ctx.fillRect(left, top, cell, cell);
  const lip = Math.max(1, Math.floor(cell * 0.16));
  ctx.fillStyle = '#1d6b3a';
  const above = terrainAt(terrain, x, y - 1);
  const beside = terrainAt(terrain, x - 1, y);
  if (above !== '1' && above !== '3') ctx.fillRect(left, top, cell, lip);
  if (beside !== '1' && beside !== '3') ctx.fillRect(left, top, lip, cell);
  ctx.fillStyle = '#0e3a1c';
  ctx.fillRect(left, top + Math.floor(cell / 2), cell, 1);
}

function drawSwamp(ctx: CanvasRenderingContext2D, x: number, y: number, cell: number) {
  const left = x * cell;
  const top = y * cell;
  ctx.fillStyle = '#0c2a44';
  ctx.fillRect(left, top, cell, cell);
  ctx.fillStyle = BLUE;
  const drop = Math.max(1, Math.floor(cell / 6));
  ctx.fillRect(left + Math.floor(cell * 0.28), top + Math.floor(cell * 0.42), drop, drop);
  ctx.fillRect(left + Math.floor(cell * 0.48), top + Math.floor(cell * 0.32), drop * 2, drop);
  ctx.fillRect(left + Math.floor(cell * 0.42), top + Math.floor(cell * 0.58), drop * 2, drop);
}

function drawTuft(ctx: CanvasRenderingContext2D, x: number, y: number, cell: number) {
  if ((x * 17 + y * 31) % 9 !== 0) return;
  ctx.fillStyle = '#146b32';
  const blade = Math.max(1, Math.floor(cell / 7));
  ctx.fillRect(x * cell + ((x * 3) % Math.max(1, cell - blade)), y * cell + ((y * 5) % Math.max(1, cell - blade * 2)), blade, blade * 2);
}

function stampRoads(ctx: CanvasRenderingContext2D, x: number, y: number, cell: number, joined: (x: number, y: number) => boolean, size: number, color: string, dotted = false) {
  const cx = x * cell + cell / 2;
  const cy = y * cell + cell / 2;
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  band(ctx, cx, cy, cx, cy, size, color, dotted);
  dirs.forEach(([dx, dy]) => {
    if (!joined(x + dx, y + dy)) return;
    band(ctx, cx, cy, cx + dx * cell * 0.56, cy + dy * cell * 0.56, size, color, dotted);
  });
}

function band(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, size: number, color: string, dotted: boolean) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const length = Math.max(Math.abs(dx), Math.abs(dy));
  const steps = Math.max(1, Math.ceil(length / Math.max(1, size / 2)));
  ctx.fillStyle = color;
  for (let i = 0; i <= steps; i += dotted ? 2 : 1) {
    const t = i / steps;
    ctx.fillRect(Math.round(x0 + dx * t - size / 2), Math.round(y0 + dy * t - size / 2), size, size);
  }
}

function drawGlyph(ctx: CanvasRenderingContext2D, object: GameObject, x: number, y: number, cell: number) {
  const name = object.type === 'constructionSite' ? 'site' : object.type === 'constructedWall' || object.type === 'rampart' ? 'wall' : object.type || '';
  const rows = SPRITES[name] || SPRITES.site;
  blit(ctx, x, y, cell, rows);
}

function blit(ctx: CanvasRenderingContext2D, x: number, y: number, cell: number, rows: string[]) {
  const n = rows.length;
  for (let py = 0; py < n; py += 1) {
    const row = rows[py];
    for (let px = 0; px < row.length; px += 1) {
      const color = PALETTE[row[px]];
      if (!color) continue;
      const x0 = x + Math.floor((px * cell) / n);
      const x1 = x + Math.floor(((px + 1) * cell) / n);
      const y0 = y + Math.floor((py * cell) / n);
      const y1 = y + Math.floor(((py + 1) * cell) / n);
      ctx.fillStyle = color;
      ctx.fillRect(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0));
    }
  }
}

function brackets(ctx: CanvasRenderingContext2D, x: number, y: number, cell: number) {
  const arm = Math.max(2, Math.floor(cell * 0.3));
  ctx.strokeStyle = CREAM;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y + arm);
  ctx.lineTo(x, y);
  ctx.lineTo(x + arm, y);
  ctx.moveTo(x + cell, y + arm);
  ctx.lineTo(x + cell, y);
  ctx.lineTo(x + cell - arm, y);
  ctx.moveTo(x, y + cell - arm);
  ctx.lineTo(x, y + cell);
  ctx.lineTo(x + arm, y + cell);
  ctx.moveTo(x + cell, y + cell - arm);
  ctx.lineTo(x + cell, y + cell);
  ctx.lineTo(x + cell - arm, y + cell);
  ctx.stroke();
}

export function cargo(object: GameObject) {
  const amount = object.store?.energy ?? object.energy ?? 0;
  const cap = object.storeCapacityResource?.energy ?? object.energyCapacity;
  if (cap == null) return String(amount);
  return amount + '/' + cap;
}
