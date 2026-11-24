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
  body?: unknown[];
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
      const next = this.cell + (event.deltaY < 0 ? 2 : -2);
      this.cell = Math.min(32, Math.max(6, next));
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
    ctx.fillStyle = '#031407';
    ctx.fillRect(0, 0, rect.width, rect.height);
    ctx.save();
    ctx.translate(this.originX, this.originY);
    this.drawTerrain(ctx, state.terrain);
    this.drawObjects(ctx, state);
    ctx.restore();
  }

  private clamp() {
    const rect = this.canvas.getBoundingClientRect();
    const size = this.cell * ROOM;
    const minX = Math.min(0, rect.width - size);
    const minY = Math.min(0, rect.height - size);
    this.originX = Math.max(minX, Math.min(0, this.originX));
    this.originY = Math.max(minY, Math.min(0, this.originY));
  }

  private drawTerrain(ctx: CanvasRenderingContext2D, terrain: string | null) {
    for (let y = 0; y < ROOM; y += 1) {
      for (let x = 0; x < ROOM; x += 1) {
        const tile = terrain ? terrain[y * ROOM + x] : '0';
        ctx.fillStyle = tile === '1' || tile === '3' ? '#0d3d22' : tile === '2' ? '#0a2e18' : '#062616';
        ctx.fillRect(x * this.cell, y * this.cell, this.cell, this.cell);
        ctx.strokeStyle = 'rgba(40, 160, 80, 0.28)';
        ctx.strokeRect(x * this.cell + 0.5, y * this.cell + 0.5, this.cell - 1, this.cell - 1);
      }
    }
  }

  private drawObjects(ctx: CanvasRenderingContext2D, state: RenderState) {
    const list = Object.values(state.objects).filter((object) => Number.isFinite(object.x) && Number.isFinite(object.y));
    list.sort((a, b) => rank(a.type) - rank(b.type));
    for (const object of list) {
      const x = (object.x || 0) * this.cell;
      const y = (object.y || 0) * this.cell;
      drawGlyph(ctx, object, x, y, this.cell);
      if (object._id === state.selectedId) {
        ctx.strokeStyle = '#e9ffe8';
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 1, y + 1, this.cell - 2, this.cell - 2);
      }
    }
  }
}

function rank(type?: string) {
  if (type === 'creep') return 5;
  if (type === 'spawn') return 4;
  if (type === 'source' || type === 'mineral') return 2;
  return 3;
}

function drawGlyph(ctx: CanvasRenderingContext2D, object: GameObject, x: number, y: number, cell: number) {
  const pad = Math.max(1, Math.floor(cell * 0.18));
  const body = cell - pad * 2;
  ctx.fillStyle = colorFor(object.type);
  if (object.type === 'creep') {
    ctx.fillRect(x + pad, y + pad, body, body);
    ctx.fillStyle = '#031407';
    ctx.fillRect(x + pad + body * 0.2, y + pad + body * 0.25, body * 0.2, body * 0.2);
    ctx.fillRect(x + pad + body * 0.6, y + pad + body * 0.25, body * 0.2, body * 0.2);
    return;
  }
  if (object.type === 'spawn') {
    ctx.fillRect(x + pad, y + cell * 0.35, body, body * 0.7);
    ctx.fillRect(x + cell * 0.28, y + pad, cell * 0.44, body);
    return;
  }
  if (object.type === 'source') {
    ctx.beginPath();
    ctx.arc(x + cell / 2, y + cell / 2, body / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  if (object.type === 'controller') {
    ctx.beginPath();
    ctx.moveTo(x + cell / 2, y + pad);
    ctx.lineTo(x + cell - pad, y + cell / 2);
    ctx.lineTo(x + cell / 2, y + cell - pad);
    ctx.lineTo(x + pad, y + cell / 2);
    ctx.closePath();
    ctx.fill();
    return;
  }
  ctx.fillRect(x + pad, y + pad, body, body);
}

function colorFor(type?: string) {
  if (type === 'spawn' || type === 'extension') return '#d8ffc8';
  if (type === 'creep') return '#9dffc0';
  if (type === 'source') return '#39ff88';
  if (type === 'controller') return '#e9ffe8';
  if (type === 'constructedWall' || type === 'rampart') return '#1f8a45';
  if (type === 'road') return '#146b34';
  return '#5dffa0';
}

export function cargo(object: GameObject) {
  const amount = object.store?.energy ?? object.energy ?? 0;
  const cap = object.storeCapacityResource?.energy ?? object.energyCapacity;
  if (cap == null) return String(amount);
  return amount + '/' + cap;
}
