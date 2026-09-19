import * as THREE from 'three';
import type { GameContext, GameHandle } from '../../platform/types';
import { addLights, createThreeApp, mat, type ThreeApp } from '../_shared/three';
import { createHud, finishRunHud, type Hud } from '../_shared/hud';
import { blip, noise, unlockAudio } from '../_shared/audio';
import { wsUrl } from '../../platform/endpoints';

/**
 * Knockabout client: renders what the server says and sends intent. The
 * server owns the rules (see server/src/arena.js), so nothing here scores.
 */

interface SnapPlayer {
  id: string;
  name: string;
  bot: boolean;
  colour: number;
  x: number;
  z: number;
  alive: boolean;
  dashing: boolean;
  kos: number;
  falls: number;
}

interface Snapshot {
  seq: number;
  phase: 'waiting' | 'round' | 'results';
  t: number;
  radius: number;
  players: SnapPlayer[];
}

interface Results {
  players: { id: string; name: string; bot: boolean; kos: number; falls: number }[];
}

const SEND_HZ = 20;

export class KnockGame implements GameHandle {
  private app: ThreeApp;
  private hud: Hud;
  private ws: WebSocket | null = null;
  private disc: THREE.Mesh;
  private ring: THREE.Mesh;
  private meshes = new Map<string, THREE.Group>();

  id: string | null = null;
  connected = false;
  snapshot: Snapshot | null = null;
  roundSeconds = 60;
  rounds = 0;
  lastResults: Results | null = null;
  private lastSent = 0;
  private lastInput = '';
  private pointer = { down: false, dx: 0, dz: 0 };
  private wasDashKey = false;
  private dashQueued = false;

  constructor(private container: HTMLElement, private ctx: GameContext) {
    this.app = createThreeApp(container, { fov: 50, background: 0x0b1020 });
    this.hud = createHud(container);
    addLights(this.app.scene, 24);
    this.app.camera.position.set(0, 21, 15);
    this.app.camera.lookAt(0, 0, 0);

    this.disc = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.6, 64), mat(0x1f2740));
    this.disc.position.y = -0.3;
    this.disc.receiveShadow = true;
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.08, 8, 64), mat(0x4cc9f0, { emissive: 0x4cc9f0, emissiveIntensity: 0.6 }));
    this.ring.rotation.x = Math.PI / 2;
    this.ring.position.y = 0.02;
    const grid = new THREE.GridHelper(80, 40, 0x1a2036, 0x131a2c);
    grid.position.y = -8;
    this.app.scene.add(this.disc, this.ring, grid);

    this.bindInput();
    this.connect();
    this.hud.setHint('WASD / arrows move · space to dash · shove everyone off · Esc to leave');
    this.ctx.setStatus('connecting…');
    this.app.start((dt) => this.update(dt));
    if (import.meta.env.DEV) Object.assign(window, { __pfg: this });
  }

  // ---------- network ----------

  private connect(): void {
    const ws = new WebSocket(wsUrl('/ws/knockabout'));
    this.ws = ws;
    ws.onopen = () => {
      this.connected = true;
      ws.send(JSON.stringify({ type: 'join', name: this.ctx.player }));
      this.ctx.setStatus('waiting for the round');
    };
    ws.onmessage = (ev) => this.handle(JSON.parse(String(ev.data)));
    ws.onclose = () => {
      this.connected = false;
      this.hud.panel({
        title: 'Disconnected',
        detail: 'Knockabout needs the score service running (npm run dev)',
        hint: 'Esc for the catalog'
      });
      this.ctx.setStatus('offline');
    };
    ws.onerror = () => ws.close();
  }

  private handle(msg: { type: string } & Record<string, unknown>): void {
    if (msg.type === 'welcome') {
      this.id = msg.id as string;
      this.roundSeconds = msg.roundSeconds as number;
    } else if (msg.type === 'state') {
      const snap = msg as unknown as Snapshot;
      if (this.snapshot?.phase !== 'round' && snap.phase === 'round') {
        this.hud.panel(null);
        this.hud.toast('Fight', 700);
        this.ctx.setStatus(`round ${this.rounds + 1}`);
        blip({ freq: 440, to: 880, ms: 200, type: 'square' });
      }
      const wasAlive = this.snapshot?.players.find((p) => p.id === this.id)?.alive;
      const me = snap.players.find((p) => p.id === this.id);
      if (wasAlive && me && !me.alive) noise(220, 0.09);
      this.snapshot = snap;
      this.syncMeshes(snap);
      this.paintHud(snap);
    } else if (msg.type === 'results') {
      this.rounds++;
      const results = msg as unknown as Results;
      this.lastResults = results;
      const mine = results.players.find((p) => p.id === this.id);
      const rank = results.players.findIndex((p) => p.id === this.id) + 1;
      const score = mine ? mine.kos * 100 + Math.max(0, 150 - (rank - 1) * 50) - mine.falls * 10 : 0;
      finishRunHud(this.ctx, this.hud, Math.max(0, score), {
        title: rank === 1 ? 'Last one standing' : `Finished #${rank}`,
        detail: `${mine?.kos ?? 0} KOs · ${mine?.falls ?? 0} falls · next round soon`,
        hint: 'stay to play again · Esc for the catalog'
      });
    }
  }

  private sendInput(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const k = this.app.keys;
    let dx = (k.has('ArrowRight') || k.has('KeyD') ? 1 : 0) - (k.has('ArrowLeft') || k.has('KeyA') ? 1 : 0);
    let dz = (k.has('ArrowDown') || k.has('KeyS') ? 1 : 0) - (k.has('ArrowUp') || k.has('KeyW') ? 1 : 0);
    if (!dx && !dz && this.pointer.down) {
      dx = this.pointer.dx;
      dz = this.pointer.dz;
    }
    const dashKey = k.has('Space') || k.has('ShiftLeft');
    if (dashKey && !this.wasDashKey) this.dashQueued = true;
    this.wasDashKey = dashKey;
    const payload = JSON.stringify({ type: 'input', dx, dz, dash: this.dashQueued });
    this.dashQueued = false;
    if (payload !== this.lastInput || performance.now() - this.lastSent > 500) {
      this.ws.send(payload);
      this.lastInput = payload;
      this.lastSent = performance.now();
    }
  }

  // ---------- input ----------

  private bindInput(): void {
    this.app.on(window, 'keydown', (e: KeyboardEvent) => {
      unlockAudio();
      if (e.code === 'Escape') this.ctx.exit();
    });
    const aim = (e: PointerEvent) => {
      const rect = this.container.getBoundingClientRect();
      const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const nz = ((e.clientY - rect.top) / rect.height) * 2 - 1;
      const len = Math.hypot(nx, nz) || 1;
      this.pointer.dx = nx / len;
      this.pointer.dz = nz / len;
    };
    this.app.on(this.container, 'pointerdown', (e: PointerEvent) => {
      unlockAudio();
      this.pointer.down = true;
      aim(e);
    });
    this.app.on(window, 'pointermove', (e: PointerEvent) => this.pointer.down && aim(e));
    this.app.on(window, 'pointerup', () => (this.pointer.down = false));
    this.app.on(this.container, 'dblclick', () => (this.dashQueued = true));
  }

  // ---------- rendering ----------

  private makePlayer(colour: number): THREE.Group {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 0.6, 4, 12), mat(colour, { roughness: 0.5 }));
    body.position.y = 0.8;
    body.castShadow = true;
    const eyes = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.15, 0.15), mat(0x0b0d12));
    eyes.position.set(0, 1.05, 0.45);
    g.add(body, eyes);
    return g;
  }

  private syncMeshes(snap: Snapshot): void {
    const seen = new Set<string>();
    for (const p of snap.players) {
      seen.add(p.id);
      let g = this.meshes.get(p.id);
      if (!g) {
        g = this.makePlayer(p.colour);
        g.position.set(p.x, 0, p.z);
        this.app.scene.add(g);
        this.meshes.set(p.id, g);
      }
      g.userData.target = { x: p.x, z: p.z, alive: p.alive, dashing: p.dashing };
    }
    for (const [id, g] of this.meshes) {
      if (!seen.has(id)) {
        this.app.scene.remove(g);
        this.meshes.delete(id);
      }
    }
  }

  private paintHud(snap: Snapshot): void {
    const left = Math.max(0, this.roundSeconds - snap.t);
    const me = snap.players.find((p) => p.id === this.id);
    if (snap.phase === 'round') this.hud.setTopLeft(`${Math.ceil(left)}s`, `round · ${snap.players.length} in`);
    else if (snap.phase === 'results') this.hud.setTopLeft('—', 'round over');
    else this.hud.setTopLeft('…', 'waiting for players');
    this.hud.setTopRight(String(me?.kos ?? 0), 'your KOs');
    this.hud.setList(
      [...snap.players]
        .sort((a, b) => b.kos - a.kos || a.falls - b.falls)
        .map((p) => ({ text: `${p.kos} KO · ${p.falls} out · ${p.name}${p.alive ? '' : ' ✕'}`, me: p.id === this.id }))
    );
  }

  private update(dt: number): void {
    if (performance.now() - this.lastSent >= 1000 / SEND_HZ) this.sendInput();

    const snap = this.snapshot;
    if (snap) {
      this.disc.scale.set(snap.radius, 1, snap.radius);
      this.ring.scale.set(snap.radius, snap.radius, 1);
    }
    const k = Math.min(1, 14 * dt);
    for (const g of this.meshes.values()) {
      const t = g.userData.target as { x: number; z: number; alive: boolean; dashing: boolean } | undefined;
      if (!t) continue;
      g.visible = t.alive;
      g.position.x += (t.x - g.position.x) * k;
      g.position.z += (t.z - g.position.z) * k;
      const s = t.dashing ? 1.25 : 1;
      g.scale.set(s, 1 / s, s);
    }
  }

  destroy(): void {
    this.ws?.close();
    this.hud.destroy();
    this.app.destroy();
  }
}
