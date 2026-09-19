import * as THREE from 'three';
import type { GameContext, GameHandle } from '../../platform/types';
import { addLights, clamp, createThreeApp, lerp, mat, type ThreeApp } from '../_shared/three';
import { createHud, finishRunHud, type Hud } from '../_shared/hud';
import { blip, noise, unlockAudio } from '../_shared/audio';
import * as M from './maze.ts';
import { LEVELS } from './levels.ts';

const MAX_TILT = 0.38;
const TILT_RATE = 9;

export class TiltGame implements GameHandle {
  private app: ThreeApp;
  private hud: Hud;
  private board = new THREE.Group();
  private ballMesh: THREE.Mesh;
  private level!: M.Level;
  levelIndex = 0;
  ball!: M.Ball;
  elapsed = 0;
  score = 0;
  over = false;
  tilt = { x: 0, z: 0 };
  target = { x: 0, z: 0 };
  private dragging = false;

  constructor(private container: HTMLElement, private ctx: GameContext) {
    this.app = createThreeApp(container, { fov: 48 });
    this.hud = createHud(container);
    addLights(this.app.scene, 20);
    this.app.scene.add(this.board);

    this.ballMesh = new THREE.Mesh(new THREE.SphereGeometry(M.RADIUS, 24, 16), mat(0xe8ecf5, { roughness: 0.35, metalness: 0.2 }));
    this.ballMesh.castShadow = true;
    this.board.add(this.ballMesh);

    this.bindInput();
    this.loadLevel(0);
    this.hud.setHint('arrows / WASD or drag to tilt · Esc to leave');
    this.app.start((dt) => this.update(dt));
    if (import.meta.env.DEV) Object.assign(window, { __pfg: this });
  }

  private bindInput(): void {
    const { app, container } = this;
    app.on(window, 'keydown', (e: KeyboardEvent) => {
      unlockAudio();
      if (e.code === 'Escape') this.ctx.exit();
      if (e.code === 'KeyR' && this.over) this.restart();
    });
    const pointerTilt = (e: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const nz = ((e.clientY - rect.top) / rect.height) * 2 - 1;
      this.target.x = clamp(nx, -1, 1) * MAX_TILT;
      this.target.z = clamp(nz, -1, 1) * MAX_TILT;
    };
    app.on(container, 'pointerdown', (e: PointerEvent) => {
      unlockAudio();
      if (this.over) {
        this.restart();
        return;
      }
      this.dragging = true;
      pointerTilt(e);
    });
    app.on(window, 'pointermove', (e: PointerEvent) => this.dragging && pointerTilt(e));
    app.on(window, 'pointerup', () => {
      this.dragging = false;
      this.target.x = 0;
      this.target.z = 0;
    });
  }

  // ---------- level setup ----------

  private loadLevel(index: number): void {
    this.levelIndex = index;
    this.level = LEVELS[index];
    this.elapsed = 0;
    this.ball = M.spawnBall(this.level);
    this.tilt = { x: 0, z: 0 };
    this.target = { x: 0, z: 0 };
    this.buildBoard();
    this.ctx.setStatus(`level ${index + 1} of ${LEVELS.length}`);
    this.paintHud();
  }

  private buildBoard(): void {
    const { level, board } = this;
    for (const child of [...board.children]) {
      if (child !== this.ballMesh) {
        board.remove(child);
        (child as THREE.Mesh).geometry?.dispose();
      }
    }
    const ox = -level.cols / 2;
    const oz = -level.rows / 2;

    const floor = new THREE.Mesh(new THREE.BoxGeometry(level.cols, 0.3, level.rows), mat(0x141a2c));
    floor.position.set(0, -0.15, 0);
    floor.receiveShadow = true;
    board.add(floor);

    const wallCells: M.Cell[] = [];
    level.walls.forEach((row, r) => row.forEach((w, c) => w && wallCells.push({ c, r })));
    const walls = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.6, 1), mat(0x2a3350), wallCells.length);
    const m = new THREE.Matrix4();
    wallCells.forEach((cell, i) => {
      m.makeTranslation(ox + cell.c + 0.5, 0.3, oz + cell.r + 0.5);
      walls.setMatrixAt(i, m);
    });
    walls.castShadow = true;
    walls.receiveShadow = true;
    board.add(walls);

    const holeGeo = new THREE.CircleGeometry(0.3, 24);
    for (const h of level.holes) {
      const hole = new THREE.Mesh(holeGeo, new THREE.MeshBasicMaterial({ color: 0x03040a }));
      hole.rotation.x = -Math.PI / 2;
      hole.position.set(ox + h.c + 0.5, 0.005, oz + h.r + 0.5);
      board.add(hole);
    }

    const goal = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.05, 10, 32), mat(0x8ac926, { emissive: 0x8ac926, emissiveIntensity: 0.7 }));
    goal.rotation.x = Math.PI / 2;
    goal.position.set(ox + level.goal.c + 0.5, 0.05, oz + level.goal.r + 0.5);
    board.add(goal);

    const span = Math.max(level.cols, level.rows * 1.5);
    this.app.camera.position.set(0, span * 0.95, span * 0.55);
    this.app.camera.lookAt(0, 0, 0);
  }

  // ---------- flow ----------

  private paintHud(): void {
    const t = this.elapsed;
    const mm = Math.floor(t / 60);
    const ss = (t % 60).toFixed(1).padStart(4, '0');
    this.hud.setTopLeft(`${mm}:${ss}`, `level ${this.levelIndex + 1}/${LEVELS.length} · ${this.level.name}`);
    this.hud.setTopRight(this.score.toLocaleString(), 'score');
  }

  private fell(): void {
    this.elapsed += M.FALL_PENALTY_S;
    this.ball = M.spawnBall(this.level);
    this.hud.toast(`Fell in · +${M.FALL_PENALTY_S}s`);
    noise(180, 0.07);
  }

  private cleared(): void {
    const gained = M.levelScore(this.elapsed);
    this.score += gained;
    blip({ freq: 520, to: 1040, ms: 220, type: 'sine' });
    if (this.levelIndex + 1 >= LEVELS.length) {
      this.finish();
      return;
    }
    this.hud.toast(`Level clear · +${gained}`, 1200);
    this.loadLevel(this.levelIndex + 1);
  }

  private finish(): void {
    this.over = true;
    this.paintHud();
    finishRunHud(this.ctx, this.hud, this.score, {
      title: 'All mazes cleared',
      detail: `${LEVELS.length} levels`,
      hint: 'R or tap to play again · Esc for the catalog'
    });
  }

  private restart(): void {
    this.over = false;
    this.score = 0;
    this.hud.panel(null);
    this.loadLevel(0);
  }

  private keyTargets(): void {
    const k = this.app.keys;
    const x = (k.has('ArrowRight') || k.has('KeyD') ? 1 : 0) - (k.has('ArrowLeft') || k.has('KeyA') ? 1 : 0);
    const z = (k.has('ArrowDown') || k.has('KeyS') ? 1 : 0) - (k.has('ArrowUp') || k.has('KeyW') ? 1 : 0);
    if (x || z) {
      this.target.x = x * MAX_TILT;
      this.target.z = z * MAX_TILT;
    } else if (!this.dragging) {
      this.target.x = 0;
      this.target.z = 0;
    }
  }

  private update(dt: number): void {
    if (!this.over) {
      this.keyTargets();
      this.tilt.x = lerp(this.tilt.x, this.target.x, Math.min(1, TILT_RATE * dt));
      this.tilt.z = lerp(this.tilt.z, this.target.z, Math.min(1, TILT_RATE * dt));
      this.elapsed += dt;

      // Sub-step so fast balls cannot tunnel through thin walls.
      const steps = 3;
      for (let i = 0; i < steps; i++) {
        const ev = M.stepBall(this.level, this.ball, this.tilt.x, this.tilt.z, dt / steps);
        if (ev === 'hole') {
          this.fell();
          break;
        }
        if (ev === 'goal') {
          this.cleared();
          break;
        }
      }
      this.paintHud();
    }

    this.board.rotation.z = -this.tilt.x;
    this.board.rotation.x = this.tilt.z;
    this.ballMesh.position.set(this.ball.x - this.level.cols / 2, M.RADIUS, this.ball.z - this.level.rows / 2);
    this.ballMesh.rotation.x += this.ball.vz * dt / M.RADIUS;
    this.ballMesh.rotation.z -= this.ball.vx * dt / M.RADIUS;
  }

  /** Test helper: place the ball. */
  setBall(x: number, z: number): void {
    this.ball = { x, z, vx: 0, vz: 0 };
  }

  destroy(): void {
    this.hud.destroy();
    this.app.destroy();
  }
}
