import * as THREE from 'three';
import type { GameContext, GameHandle } from '../../platform/types';
import { addLights, createThreeApp, lerp, mat, type ThreeApp } from '../_shared/three';
import { createHud, finishRunHud, type Hud } from '../_shared/hud';
import { blip, noise, unlockAudio } from '../_shared/audio';
import * as S from './stack.ts';

const H = 0.5; // slab height

interface Falling {
  mesh: THREE.Mesh;
  vy: number;
  spin: number;
  age: number;
}

const colourFor = (level: number): THREE.Color => new THREE.Color().setHSL(((level * 13) % 360) / 360, 0.62, 0.56);

export class StackGame implements GameHandle {
  private app: ThreeApp;
  private hud: Hud;
  private tower = new THREE.Group();
  private falling: Falling[] = [];
  private movingMesh: THREE.Mesh | null = null;

  count = 0; // slabs placed on top of the base
  score = 0;
  combo = 0;
  over = false;
  below: S.Slab = { x: 0, z: 0, w: S.START_SIZE, d: S.START_SIZE };
  current: S.Slab = { ...this.below };
  axis: S.Axis = 'x';
  private dir = 1;
  private camY = 0;

  constructor(container: HTMLElement, private ctx: GameContext) {
    this.app = createThreeApp(container, { fov: 40 });
    this.hud = createHud(container);
    addLights(this.app.scene, 14);
    this.app.scene.add(this.tower);
    this.app.camera.position.set(9, 10, 9);

    this.app.on(window, 'keydown', (e: KeyboardEvent) => {
      unlockAudio();
      if (e.code === 'Escape') this.ctx.exit();
      else if (e.code === 'Space' || e.code === 'Enter') this.tap();
      else if (e.code === 'KeyR' && this.over) this.restart();
    });
    this.app.on(container, 'pointerdown', () => {
      unlockAudio();
      this.tap();
    });

    this.reset();
    this.hud.setHint('tap / space to drop · Esc to leave');
    this.app.start((dt) => this.update(dt));
    if (import.meta.env.DEV) Object.assign(window, { __pfg: this });
  }

  private reset(): void {
    for (const child of [...this.tower.children]) {
      this.tower.remove(child);
      (child as THREE.Mesh).geometry.dispose();
    }
    for (const f of this.falling) this.app.scene.remove(f.mesh);
    this.falling = [];
    this.count = 0;
    this.score = 0;
    this.combo = 0;
    this.over = false;
    this.below = { x: 0, z: 0, w: S.START_SIZE, d: S.START_SIZE };
    this.addSlab(this.below, 0, colourFor(0));
    this.axis = 'z';
    this.spawnMoving();
    this.camY = 0;
    this.ctx.setStatus('stack it high');
    this.paintHud();
  }

  private slabMesh(slab: S.Slab, level: number, colour: THREE.Color): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(slab.w, H, slab.d), mat(colour.getHex(), { roughness: 0.6 }));
    mesh.position.set(slab.x, level * H + H / 2, slab.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  private addSlab(slab: S.Slab, level: number, colour: THREE.Color): void {
    this.tower.add(this.slabMesh(slab, level, colour));
  }

  private spawnMoving(): void {
    this.axis = this.axis === 'x' ? 'z' : 'x';
    const amp = S.amplitudeFor(this.below, this.axis);
    this.current = { ...this.below, [this.axis]: -amp };
    this.dir = 1;
    this.movingMesh?.geometry.dispose();
    if (this.movingMesh) this.tower.remove(this.movingMesh);
    this.movingMesh = this.slabMesh(this.current, this.count + 1, colourFor(this.count + 1));
    this.tower.add(this.movingMesh);
  }

  /** Drop the moving slab. Exposed for tests. */
  tap(): void {
    if (this.over) {
      this.restart();
      return;
    }
    const result = S.drop(this.below, this.current, this.axis);
    if (!result) {
      this.miss();
      return;
    }
    this.count++;
    this.score += result.perfect ? 2 : 1;
    if (result.perfect) {
      this.combo++;
      blip({ freq: 660 + Math.min(this.combo, 8) * 60, to: 1100, ms: 120, type: 'sine' });
      this.hud.toast(this.combo >= 2 ? `perfect ×${this.combo}` : 'perfect', 600);
    } else {
      this.combo = 0;
      blip({ freq: 320, ms: 60, type: 'triangle', gain: 0.04 });
    }

    let placed = result.placed;
    if (result.perfect && this.combo % S.COMBO_FOR_GROWTH === 0) placed = S.grown(placed, this.axis);

    this.tower.remove(this.movingMesh!);
    this.movingMesh!.geometry.dispose();
    this.movingMesh = null;
    this.addSlab(placed, this.count, colourFor(this.count));

    if (result.cut) {
      const mesh = this.slabMesh(result.cut, this.count, colourFor(this.count));
      this.app.scene.add(mesh);
      this.falling.push({ mesh, vy: 0, spin: (Math.random() - 0.5) * 3, age: 0 });
    }

    this.below = placed;
    this.spawnMoving();
    this.paintHud();
  }

  private miss(): void {
    this.over = true;
    noise(220, 0.09);
    if (this.movingMesh) {
      this.tower.remove(this.movingMesh);
      this.app.scene.add(this.movingMesh);
      this.falling.push({ mesh: this.movingMesh, vy: 0, spin: 1.5, age: 0 });
      this.movingMesh = null;
    }
    finishRunHud(this.ctx, this.hud, this.score, {
      title: 'Toppled',
      detail: `${this.count} high`,
      hint: 'R or tap to play again · Esc for the catalog'
    });
  }

  private restart(): void {
    this.hud.panel(null);
    this.reset();
  }

  private paintHud(): void {
    this.hud.setTopLeft(String(this.count), 'height');
    this.hud.setTopRight(this.score.toLocaleString(), 'score');
  }

  /** Test helper: park the moving slab at an exact offset. */
  setCurrent(x: number, z: number): void {
    this.current.x = x;
    this.current.z = z;
  }

  private update(dt: number): void {
    if (!this.over && this.movingMesh) {
      const amp = S.amplitudeFor(this.below, this.axis);
      const v = S.speedFor(this.count) * this.dir;
      this.current[this.axis] += v * dt;
      if (this.current[this.axis] > amp) this.dir = -1;
      if (this.current[this.axis] < -amp) this.dir = 1;
      this.movingMesh.position.set(this.current.x, (this.count + 1) * H + H / 2, this.current.z);
    }

    for (const f of [...this.falling]) {
      f.vy -= 20 * dt;
      f.age += dt;
      f.mesh.position.y += f.vy * dt;
      f.mesh.rotation.x += f.spin * dt;
      f.mesh.rotation.z += f.spin * 0.6 * dt;
      if (f.age > 2.5) {
        this.app.scene.remove(f.mesh);
        f.mesh.geometry.dispose();
        this.falling.splice(this.falling.indexOf(f), 1);
      }
    }

    const targetY = this.count * H;
    this.camY = lerp(this.camY, targetY, Math.min(1, 4 * dt));
    this.app.camera.position.set(9, 10 + this.camY, 9);
    this.app.camera.lookAt(0, this.camY + 1, 0);
  }

  destroy(): void {
    for (const f of this.falling) f.mesh.geometry.dispose();
    this.hud.destroy();
    this.app.destroy();
  }
}
