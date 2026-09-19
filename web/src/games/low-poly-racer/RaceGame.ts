import * as THREE from 'three';
import type { GameContext, GameHandle } from '../../platform/types';
import { addLights, clamp, createThreeApp, mat, type ThreeApp } from '../_shared/three';
import { createHud, finishRunHud, type Hud } from '../_shared/hud';
import { blip, unlockAudio } from '../_shared/audio';
import * as T from './track.ts';

const GHOST_KEY = 'pfg:ridgeline:ghost';
const RECORD_MS = 80;

interface Frame {
  t: number;
  x: number;
  z: number;
  heading: number;
}

interface Ghost {
  lapMs: number;
  frames: Frame[];
}

type Phase = 'countdown' | 'race' | 'over';

export class RaceGame implements GameHandle {
  private app: ThreeApp;
  private hud: Hud;
  private samples = T.sampleTrack();
  private carMesh: THREE.Group;
  private ghostMesh: THREE.Group;

  car: T.Car;
  laps: T.LapState;
  phase: Phase = 'countdown';
  time = 0; // ms of game time
  private raceStart = 0;
  private countdownLeft = 3.2;
  private hint = 0;
  private grass = false;
  ghost: Ghost | null = null;
  private recording: Frame[] = [];
  private lastRecord = 0;
  bestLap = Infinity;
  private pointer = { down: false, steer: 0 };

  constructor(container: HTMLElement, private ctx: GameContext) {
    this.app = createThreeApp(container, { fov: 60, background: 0x0b1020 });
    this.hud = createHud(container);
    const sun = addLights(this.app.scene, 80);
    sun.position.set(40, 60, 20);
    this.app.scene.fog = new THREE.Fog(0x0b1020, 80, 220);

    this.buildWorld();
    this.carMesh = this.buildCar(0xf72585, 1);
    this.ghostMesh = this.buildCar(0x4cc9f0, 0.35);
    this.ghostMesh.visible = false;
    this.app.scene.add(this.carMesh, this.ghostMesh);

    this.car = T.spawnCar(this.samples);
    this.laps = T.newLapState(0);
    this.ghost = this.loadGhost();
    if (this.ghost) this.bestLap = this.ghost.lapMs;

    this.bindInput();
    this.hud.setHint('↑/W gas · ↓/S brake · ←/→ steer · or hold click and move · Esc to leave');
    this.ctx.setStatus(this.ghost ? `ghost lap ${T.fmtTime(this.ghost.lapMs)}` : `${T.LAPS} laps, beat the clock`);
    this.paintHud();
    this.app.start((dt) => this.update(dt));
    if (import.meta.env.DEV) Object.assign(window, { __pfg: this });
  }

  // ---------- world ----------

  private buildWorld(): void {
    const { scene } = this.app;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(320, 320), mat(0x1c3b2a, { flatShading: true }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.05;
    ground.receiveShadow = true;
    scene.add(ground);

    scene.add(this.ribbon(T.TRACK_WIDTH, 0, 0x2b3040, 0));
    scene.add(this.ribbon(0.7, T.TRACK_WIDTH / 2 + 0.35, 0xffffff, 0.01, 0xf72585));
    scene.add(this.ribbon(0.7, -(T.TRACK_WIDTH / 2 + 0.35), 0xffffff, 0.01, 0xf72585));

    // Start line.
    const s0 = this.samples[0];
    const line = new THREE.Mesh(new THREE.PlaneGeometry(T.TRACK_WIDTH, 1.2), new THREE.MeshBasicMaterial({ color: 0xe8ecf5 }));
    line.rotation.x = -Math.PI / 2;
    line.rotation.z = -Math.atan2(s0.tz, s0.tx);
    line.position.set(s0.x, 0.02, s0.z);
    scene.add(line);

    // Trees away from the road.
    const trunk = new THREE.CylinderGeometry(0.25, 0.3, 1.2, 6);
    const crown = new THREE.ConeGeometry(1.4, 3.2, 6);
    const trunkMat = mat(0x5b3a21);
    const crownMat = mat(0x2f6b3a, { flatShading: true });
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 140; i++) {
      const p = { x: (rand() - 0.5) * 240, z: (rand() - 0.5) * 240 };
      if (Math.abs(T.nearest(this.samples, p, 0).lateral) < T.TRACK_WIDTH / 2 + 4) continue;
      const t = new THREE.Mesh(trunk, trunkMat);
      const c = new THREE.Mesh(crown, crownMat);
      t.position.set(p.x, 0.6, p.z);
      c.position.set(p.x, 2.6, p.z);
      c.castShadow = true;
      scene.add(t, c);
    }
  }

  /** A strip following the track at a lateral offset; optional alternating colour for kerbs. */
  private ribbon(width: number, offset: number, colour: number, y: number, alt?: number): THREE.Mesh {
    const n = this.samples.length;
    const positions: number[] = [];
    const colours: number[] = [];
    const indices: number[] = [];
    const a = new THREE.Color(colour);
    const b = new THREE.Color(alt ?? colour);
    for (let i = 0; i < n; i++) {
      const s = this.samples[i];
      const nx = -s.tz;
      const nz = s.tx;
      const cx = s.x + nx * offset;
      const cz = s.z + nz * offset;
      positions.push(cx + nx * (width / 2), y, cz + nz * (width / 2), cx - nx * (width / 2), y, cz - nz * (width / 2));
      const c = Math.floor(i / 6) % 2 === 0 ? a : b;
      colours.push(c.r, c.g, c.b, c.r, c.g, c.b);
      const j = (i + 1) % n;
      indices.push(i * 2, i * 2 + 1, j * 2, i * 2 + 1, j * 2 + 1, j * 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
    mesh.receiveShadow = true;
    return mesh;
  }

  private buildCar(colour: number, opacity: number): THREE.Group {
    const g = new THREE.Group();
    const extra = opacity < 1 ? { transparent: true, opacity, depthWrite: false } : {};
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.5, 1.3), mat(colour, extra));
    body.position.y = 0.45;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.45, 1.1), mat(0x1a1f2e, extra));
    cabin.position.set(-0.2, 0.9, 0);
    body.castShadow = cabin.castShadow = opacity === 1;
    g.add(body, cabin);
    const wheelGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.3, 10);
    for (const [x, z] of [[0.8, 0.7], [0.8, -0.7], [-0.8, 0.7], [-0.8, -0.7]]) {
      const w = new THREE.Mesh(wheelGeo, mat(0x0b0d12, extra));
      w.rotation.x = Math.PI / 2;
      w.position.set(x, 0.3, z);
      g.add(w);
    }
    return g;
  }

  // ---------- input ----------

  private bindInput(): void {
    const container = this.app.canvas.parentElement!;
    this.app.on(window, 'keydown', (e: KeyboardEvent) => {
      unlockAudio();
      if (e.code === 'Escape') this.ctx.exit();
      if (e.code === 'KeyR' && this.phase === 'over') this.restart();
    });
    const steerFrom = (e: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      this.pointer.steer = clamp(((e.clientX - rect.left) / rect.width) * 2 - 1, -1, 1);
    };
    this.app.on(container, 'pointerdown', (e: PointerEvent) => {
      unlockAudio();
      if (this.phase === 'over') {
        this.restart();
        return;
      }
      this.pointer.down = true;
      steerFrom(e);
    });
    this.app.on(window, 'pointermove', (e: PointerEvent) => this.pointer.down && steerFrom(e));
    this.app.on(window, 'pointerup', () => {
      this.pointer.down = false;
      this.pointer.steer = 0;
    });
  }

  private input(): T.Input {
    const k = this.app.keys;
    const throttle = k.has('ArrowUp') || k.has('KeyW') || this.pointer.down ? 1 : 0;
    const brake = k.has('ArrowDown') || k.has('KeyS') || k.has('Space') ? 1 : 0;
    const keySteer = (k.has('ArrowRight') || k.has('KeyD') ? 1 : 0) - (k.has('ArrowLeft') || k.has('KeyA') ? 1 : 0);
    return { throttle, brake, steer: keySteer || this.pointer.steer };
  }

  // ---------- ghost ----------

  private loadGhost(): Ghost | null {
    try {
      const raw = localStorage.getItem(GHOST_KEY);
      const g = raw ? (JSON.parse(raw) as Ghost) : null;
      return g && Array.isArray(g.frames) && g.frames.length > 2 ? g : null;
    } catch {
      return null;
    }
  }

  private saveGhost(g: Ghost): void {
    this.ghost = g;
    try {
      localStorage.setItem(GHOST_KEY, JSON.stringify(g));
    } catch {
      /* fine: the ghost lives for this session only */
    }
  }

  private ghostPose(lapMs: number): Frame | null {
    const g = this.ghost;
    if (!g) return null;
    const f = g.frames;
    if (lapMs >= f[f.length - 1].t) return f[f.length - 1];
    let i = 0;
    while (i < f.length - 2 && f[i + 1].t < lapMs) i++;
    const a = f[i];
    const b = f[i + 1];
    const k = clamp((lapMs - a.t) / Math.max(1, b.t - a.t), 0, 1);
    let dh = b.heading - a.heading;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    return { t: lapMs, x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, heading: a.heading + dh * k };
  }

  // ---------- flow ----------

  private paintHud(): void {
    const lapMs = this.phase === 'race' ? this.time - this.laps.lapStart : 0;
    const kmh = Math.round(Math.abs(this.car.speed) * 3.6);
    this.hud.setTopLeft(T.fmtTime(lapMs), `lap ${Math.min(this.laps.lap + 1, T.LAPS)}/${T.LAPS} · ${kmh} km/h${this.grass ? ' · grass' : ''}`);
    this.hud.setTopRight(Number.isFinite(this.bestLap) ? T.fmtTime(this.bestLap) : '—', 'best lap');
  }

  private lapDone(ms: number): void {
    this.hud.toast(`lap ${this.laps.lap} · ${T.fmtTime(ms)}`, 1400);
    blip({ freq: 660, to: 990, ms: 200, type: 'sine' });
    if (ms < this.bestLap) {
      this.bestLap = ms;
      this.saveGhost({ lapMs: ms, frames: this.recording });
      this.ghostMesh.visible = true;
      this.ctx.setStatus(`best lap ${T.fmtTime(ms)}`);
    }
    this.recording = [];
    this.lastRecord = 0;
    if (this.laps.lap >= T.LAPS) this.finish();
  }

  private finish(): void {
    this.phase = 'over';
    const runBest = Math.min(...this.laps.lapTimes);
    const total = this.laps.lapTimes.reduce((a, b) => a + b, 0);
    finishRunHud(this.ctx, this.hud, T.lapToScore(runBest), {
      title: 'Chequered flag',
      big: T.fmtTime(runBest),
      detail: `best lap · total ${T.fmtTime(total)}`,
      hint: 'R or tap to race again · Esc for the catalog',
      formatBest: (score) => `lap ${T.fmtTime(T.scoreToLap(score))}`
    });
  }

  private restart(): void {
    this.hud.panel(null);
    this.car = T.spawnCar(this.samples);
    this.laps = T.newLapState(this.time);
    this.phase = 'countdown';
    this.countdownLeft = 3.2;
    this.recording = [];
    this.paintHud();
  }

  /** Test helper: place the car on the centre line at a track progress (0..1). */
  teleport(progress: number): void {
    const s = this.samples[Math.floor(progress * this.samples.length) % this.samples.length];
    this.car.x = s.x;
    this.car.z = s.z;
    this.car.heading = Math.atan2(s.tz, s.tx);
    this.hint = T.nearest(this.samples, s, this.hint).index;
  }

  private update(dt: number): void {
    this.time += dt * 1000;

    if (this.phase === 'countdown') {
      this.countdownLeft -= dt;
      const n = Math.ceil(this.countdownLeft);
      if (this.countdownLeft <= 0) {
        this.phase = 'race';
        this.raceStart = this.time;
        this.laps = T.newLapState(this.time);
        this.hud.toast('GO', 600);
        blip({ freq: 880, ms: 300, type: 'square' });
      } else {
        this.hud.toast(String(n), 400);
      }
    }

    if (this.phase === 'race') {
      const near = T.nearest(this.samples, this.car, this.hint);
      this.hint = near.index;
      this.grass = !T.onTrack({ ...near, lateral: Math.abs(near.lateral) - 0.4 });
      T.stepCar(this.car, this.input(), this.grass, dt);

      const after = T.nearest(this.samples, this.car, this.hint);
      const lapMs = this.time - this.laps.lapStart;
      if (this.time - this.lastRecord >= RECORD_MS) {
        this.lastRecord = this.time;
        this.recording.push({ t: lapMs, x: this.car.x, z: this.car.z, heading: this.car.heading });
      }
      const done = T.updateLaps(this.laps, after.progress, this.time);
      if (done !== null) this.lapDone(done);

      const pose = this.ghost ? this.ghostPose(this.time - this.laps.lapStart) : null;
      this.ghostMesh.visible = Boolean(pose);
      if (pose) {
        this.ghostMesh.position.set(pose.x, 0, pose.z);
        this.ghostMesh.rotation.y = -pose.heading;
      }
    }

    this.carMesh.position.set(this.car.x, 0, this.car.z);
    this.carMesh.rotation.y = -this.car.heading;

    const fx = Math.cos(this.car.heading);
    const fz = Math.sin(this.car.heading);
    const cam = this.app.camera;
    const target = new THREE.Vector3(this.car.x - fx * 10, 4.5, this.car.z - fz * 10);
    cam.position.lerp(target, Math.min(1, 5 * dt));
    cam.lookAt(this.car.x + fx * 6, 0.8, this.car.z + fz * 6);

    this.paintHud();
    void this.raceStart;
  }

  destroy(): void {
    this.hud.destroy();
    this.app.destroy();
  }
}
