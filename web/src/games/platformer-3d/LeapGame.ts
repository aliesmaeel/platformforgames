import * as THREE from 'three';
import type { GameContext, GameHandle } from '../../platform/types';
import { addLights, createThreeApp, lerp, mat, type ThreeApp } from '../_shared/three';
import { createHud, finishRunHud, type Hud } from '../_shared/hud';
import { blip, noise, unlockAudio } from '../_shared/audio';
import * as P from './physics.ts';
import { LEVELS } from './levels.ts';

export class LeapGame implements GameHandle {
  private app: ThreeApp;
  private hud: Hud;
  private world = new THREE.Group();
  private playerMesh: THREE.Group;
  private platformMeshes = new Map<number, THREE.Mesh>();
  private coinMeshes: THREE.Mesh[] = [];

  levelIndex = 0;
  level!: P.LevelDef;
  player!: P.Player;
  checkpoint!: P.Vec3;
  levelTime = 0;
  elapsed = 0;
  score = 0;
  coins = 0;
  over = false;
  private jumpWasDown = false;
  private camPos = new THREE.Vector3();

  constructor(container: HTMLElement, private ctx: GameContext) {
    this.app = createThreeApp(container, { fov: 55, background: 0x0b1020 });
    this.hud = createHud(container);
    const sun = addLights(this.app.scene, 60);
    sun.position.set(20, 40, 30);
    this.app.scene.fog = new THREE.Fog(0x0b1020, 40, 120);
    this.app.scene.add(this.world);

    this.playerMesh = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 0.7, 4, 10), mat(0xf72585, { roughness: 0.5 }));
    body.position.y = 0.75;
    body.castShadow = true;
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 0.2), mat(0x0b0d12));
    visor.position.set(0, 1.05, 0.35);
    this.playerMesh.add(body, visor);
    this.app.scene.add(this.playerMesh);

    this.app.on(window, 'keydown', (e: KeyboardEvent) => {
      unlockAudio();
      if (e.code === 'Escape') this.ctx.exit();
      if (e.code === 'KeyR' && this.over) this.restart();
    });
    this.app.on(container, 'pointerdown', () => {
      unlockAudio();
      if (this.over) this.restart();
    });

    this.loadLevel(0);
    this.hud.setHint('WASD / arrows move · space jump (hold for height) · Esc to leave');
    this.app.start((dt) => this.update(dt));
    if (import.meta.env.DEV) Object.assign(window, { __pfg: this });
  }

  // ---------- level ----------

  private loadLevel(index: number): void {
    this.levelIndex = index;
    this.level = LEVELS[index];
    for (const c of this.level.coins) c.taken = false;
    this.checkpoint = { ...this.level.spawn };
    this.player = P.spawnPlayer(this.level.spawn);
    this.levelTime = 0;
    this.buildWorld();
    this.ctx.setStatus(`level ${index + 1} of ${LEVELS.length}`);
    this.paintHud();
  }

  private buildWorld(): void {
    for (const child of [...this.world.children]) {
      this.world.remove(child);
      (child as THREE.Mesh).geometry?.dispose();
    }
    this.platformMeshes.clear();
    this.coinMeshes = [];

    for (const p of this.level.platforms) {
      const colour = p.kind === 'goal' ? 0x8ac926 : p.kind === 'checkpoint' ? 0x4cc9f0 : p.move ? 0xffd166 : 0x2a3350;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(p.w, p.h, p.d), mat(colour, p.kind === 'goal' ? { emissive: 0x8ac926, emissiveIntensity: 0.4 } : {}));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.world.add(mesh);
      this.platformMeshes.set(p.id, mesh);
    }
    const coinGeo = new THREE.TorusGeometry(0.35, 0.12, 8, 16);
    const coinMat = mat(0xffd166, { emissive: 0xffd166, emissiveIntensity: 0.6, metalness: 0.4, roughness: 0.3 });
    for (const c of this.level.coins) {
      const mesh = new THREE.Mesh(coinGeo, coinMat);
      mesh.position.set(c.x, c.y, c.z);
      this.world.add(mesh);
      this.coinMeshes.push(mesh);
    }
  }

  // ---------- flow ----------

  private paintHud(): void {
    const t = this.levelTime;
    this.hud.setTopLeft(`${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`, `level ${this.levelIndex + 1}/${LEVELS.length} · ${this.level.name}`);
    const taken = this.level.coins.filter((c) => c.taken).length;
    this.hud.setTopRight(this.score.toLocaleString(), `score · coins ${taken}/${this.level.coins.length}`);
  }

  private fell(): void {
    this.score = Math.max(0, this.score - P.FALL_PENALTY);
    this.player = P.spawnPlayer(this.checkpoint);
    this.hud.toast(`Fell · −${P.FALL_PENALTY}`);
    noise(180, 0.07);
  }

  private cleared(): void {
    const bonus = P.timeBonus(this.levelTime);
    this.score += bonus;
    blip({ freq: 520, to: 1040, ms: 220, type: 'sine' });
    if (this.levelIndex + 1 >= LEVELS.length) {
      this.finish();
      return;
    }
    this.hud.toast(`Level clear · +${bonus}`, 1200);
    this.loadLevel(this.levelIndex + 1);
  }

  private finish(): void {
    this.over = true;
    this.paintHud();
    finishRunHud(this.ctx, this.hud, this.score, {
      title: 'Course complete',
      detail: `${this.coins} coins · ${Math.round(this.elapsed)}s`,
      hint: 'R or tap to play again · Esc for the catalog'
    });
  }

  private restart(): void {
    this.over = false;
    this.score = 0;
    this.coins = 0;
    this.elapsed = 0;
    this.hud.panel(null);
    this.loadLevel(0);
  }

  /** Test helper. */
  setPlayer(x: number, y: number, z: number): void {
    this.player = P.spawnPlayer({ x, y, z });
  }

  private input(): P.Input {
    const k = this.app.keys;
    const mx = (k.has('ArrowRight') || k.has('KeyD') ? 1 : 0) - (k.has('ArrowLeft') || k.has('KeyA') ? 1 : 0);
    const mz = (k.has('ArrowDown') || k.has('KeyS') ? 1 : 0) - (k.has('ArrowUp') || k.has('KeyW') ? 1 : 0);
    const len = Math.hypot(mx, mz) || 1;
    const jump = k.has('Space') || k.has('KeyJ');
    const jumpPressed = jump && !this.jumpWasDown;
    this.jumpWasDown = jump;
    return { mx: mx / len, mz: mz / len, jump, jumpPressed };
  }

  private update(dt: number): void {
    if (!this.over) {
      this.levelTime += dt;
      this.elapsed += dt;
      const r = P.step(this.player, this.input(), this.level, this.levelTime, dt);
      if (r.coins.length) {
        this.coins += r.coins.length;
        this.score += r.coins.length * P.COIN_VALUE;
        for (const i of r.coins) this.coinMeshes[i].visible = false;
        blip({ freq: 1200, to: 1800, ms: 90, type: 'sine', gain: 0.05 });
      }
      if (r.checkpoint) {
        const c = P.platformAt(r.checkpoint, this.levelTime);
        const at = { x: c.x, y: c.y + r.checkpoint.h / 2, z: c.z };
        if (Math.hypot(at.x - this.checkpoint.x, at.z - this.checkpoint.z) > 1) {
          this.checkpoint = at;
          this.hud.toast('Checkpoint', 700);
        }
      }
      if (r.fell) this.fell();
      else if (r.goal) this.cleared();
      this.paintHud();
    }

    // Sync meshes.
    this.level.platforms.forEach((p) => {
      const c = P.platformAt(p, this.levelTime);
      this.platformMeshes.get(p.id)?.position.set(c.x, c.y, c.z);
    });
    this.coinMeshes.forEach((m) => (m.rotation.y += 2.5 * dt));
    this.playerMesh.position.set(this.player.x, this.player.y, this.player.z);
    this.playerMesh.rotation.y = this.player.facing;

    const target = new THREE.Vector3(this.player.x * 0.6, this.player.y + 6, this.player.z + 10);
    if (this.camPos.lengthSq() === 0) this.camPos.copy(target);
    this.camPos.lerp(target, Math.min(1, 6 * dt));
    this.app.camera.position.copy(this.camPos);
    this.app.camera.lookAt(this.player.x * 0.6, this.player.y + 1, this.player.z - 3);
    void lerp;
  }

  destroy(): void {
    this.hud.destroy();
    this.app.destroy();
  }
}
