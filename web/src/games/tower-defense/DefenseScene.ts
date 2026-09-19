import Phaser from 'phaser';
import type { GameContext } from '../../platform/types';
import { COLOURS, MONO, Overlay, SANS, finishRun } from '../_shared/phaser';
import { blip, noise, unlockAudio } from '../_shared/audio';
import * as F from './field';

export const WIDTH = 960;
export const HEIGHT = 540;

const CELL = 40;
const BAR_Y = F.MAP.rows * CELL; // 480: HUD strip below the grid
const START_GOLD = 150;
const START_LIVES = 20;
const COUNTDOWN_MS = 8000;

interface Tower {
  kind: F.TowerKind;
  cell: F.Cell;
  level: number;
  nextFire: number;
}

interface Enemy {
  kind: F.EnemyKind;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  target: F.Cell;
  slowUntil: number;
  slow: number;
}

interface Tracer {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  colour: number;
  until: number;
}

const key = (c: F.Cell) => `${c.c},${c.r}`;
const cx = (c: number) => c * CELL + CELL / 2;
const cy = (r: number) => r * CELL + CELL / 2;

export class DefenseScene extends Phaser.Scene {
  private ctx!: GameContext;
  blocked!: F.Blocked;
  field!: number[][];
  towers = new Map<string, Tower>();
  enemies: Enemy[] = [];
  gold = START_GOLD;
  lives = START_LIVES;
  wave = 0;
  score = 0;
  phase: 'build' | 'wave' = 'build';
  over = false;
  won = false;

  private spawns: { kind: F.EnemyKind; at: number }[] = [];
  private countdownEnd = 0;
  private selectedKind: F.TowerKind | null = 'arrow';
  private selectedTower: Tower | null = null;
  private tracers: Tracer[] = [];
  private hover: F.Cell | null = null;

  private gfx!: Phaser.GameObjects.Graphics;
  private overlay!: Overlay;
  private goldText!: Phaser.GameObjects.Text;
  private livesText!: Phaser.GameObjects.Text;
  private waveText!: Phaser.GameObjects.Text;
  private infoText!: Phaser.GameObjects.Text;
  private nextText!: Phaser.GameObjects.Text;
  private buttons: Phaser.GameObjects.Rectangle[] = [];

  constructor() {
    super('defense');
  }

  init(data: { ctx: GameContext }): void {
    this.ctx = data.ctx;
    this.blocked = F.emptyBlocked(F.MAP);
    this.field = F.computeField(this.blocked, F.MAP.exit);
    this.towers = new Map();
    this.enemies = [];
    this.gold = START_GOLD;
    this.lives = START_LIVES;
    this.wave = 0;
    this.score = 0;
    this.phase = 'build';
    this.over = false;
    this.won = false;
    this.spawns = [];
    this.countdownEnd = 0;
    this.selectedKind = 'arrow';
    this.selectedTower = null;
    this.tracers = [];
    this.buttons = [];
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#070910');
    this.overlay = new Overlay(this);
    this.gfx = this.add.graphics();
    this.buildHud();
    this.bindInput();
    this.ctx.setStatus('build, then space');
  }

  // ---------- HUD ----------

  private buildHud(): void {
    this.add.rectangle(0, BAR_Y, WIDTH, HEIGHT - BAR_Y, COLOURS.raised).setOrigin(0, 0).setDepth(10);
    this.add.rectangle(0, BAR_Y, WIDTH, 1, COLOURS.line).setOrigin(0, 0).setDepth(10);

    const text = (x: number, size: number, colour: string) =>
      this.add.text(x, BAR_Y + 30, '', { fontFamily: MONO, fontSize: `${size}px`, color: colour }).setOrigin(0, 0.5).setDepth(11);
    this.goldText = text(14, 18, '#ffd166');
    this.livesText = text(96, 18, '#8ac926');
    this.waveText = text(160, 12, COLOURS.dim);

    (Object.values(F.TOWERS) as F.TowerSpec[]).forEach((spec, i) => {
      const x = 300 + i * 106;
      const btn = this.add.rectangle(x, BAR_Y + 30, 100, 44, COLOURS.panel).setStrokeStyle(1, COLOURS.line).setDepth(11).setInteractive({ useHandCursor: true });
      btn.on('pointerdown', () => this.selectKind(spec.kind));
      this.buttons.push(btn);
      this.add.circle(x - 38, BAR_Y + 30, 9, spec.colour).setDepth(12);
      this.add.text(x - 22, BAR_Y + 22, `${i + 1} ${spec.name}`, { fontFamily: SANS, fontSize: '13px', color: COLOURS.text }).setOrigin(0, 0.5).setDepth(12);
      this.add.text(x - 22, BAR_Y + 39, `${spec.cost}g`, { fontFamily: MONO, fontSize: '12px', color: COLOURS.dim }).setOrigin(0, 0.5).setDepth(12);
    });

    this.infoText = this.add.text(612, BAR_Y + 30, '', { fontFamily: MONO, fontSize: '12px', color: COLOURS.dim }).setOrigin(0, 0.5).setDepth(11);

    const next = this.add.rectangle(WIDTH - 62, BAR_Y + 30, 108, 44, 0x4cc9f0).setDepth(11).setInteractive({ useHandCursor: true });
    next.on('pointerdown', () => this.callWave());
    this.nextText = this.add.text(WIDTH - 62, BAR_Y + 30, '', { fontFamily: SANS, fontSize: '14px', color: '#0b0d12', align: 'center' }).setOrigin(0.5).setDepth(12);
    this.paintHud();
  }

  private paintHud(): void {
    this.goldText.setText(`${Math.min(this.gold, 99999)}g`);
    this.livesText.setText(`♥ ${this.lives}`);
    this.waveText.setText(`wave ${this.wave}/${F.FINAL_WAVE}\nscore ${this.score}`);
    this.buttons.forEach((b, i) => {
      const kind = (Object.keys(F.TOWERS) as F.TowerKind[])[i];
      b.setStrokeStyle(kind === this.selectedKind ? 2 : 1, kind === this.selectedKind ? 0x4cc9f0 : COLOURS.line);
    });
    if (this.selectedTower) {
      const t = this.selectedTower;
      const spec = F.TOWERS[t.kind];
      const up = F.upgraded(spec, t.level);
      this.infoText.setText(`${spec.name} L${t.level} · dmg ${up.damage} · range ${up.range}\nU upgrade ${F.UPGRADE_COST(t.level)}g · X sell ${this.sellValue(t)}g`);
    } else {
      this.infoText.setText('1-3 pick · click a cell to build\nclick a tower to upgrade or sell');
    }
    if (this.phase === 'wave') this.nextText.setText('wave in\nprogress');
    else if (this.wave === 0) this.nextText.setText('Start\n(space)');
    else this.nextText.setText(`Next early\n+${this.earlyBonus()}g`);
  }

  // ---------- input ----------

  private bindInput(): void {
    const kb = this.input.keyboard!;
    kb.on('keydown-ONE', () => this.selectKind('arrow'));
    kb.on('keydown-TWO', () => this.selectKind('cannon'));
    kb.on('keydown-THREE', () => this.selectKind('frost'));
    kb.on('keydown-SPACE', () => this.callWave());
    kb.on('keydown-U', () => this.upgradeSelected());
    kb.on('keydown-X', () => this.sellSelected());
    kb.on('keydown-R', () => this.over && this.scene.restart({ ctx: this.ctx }));
    kb.on('keydown-ESC', () => (this.selectedTower ? this.select(null) : this.ctx.exit()));
    kb.on('keydown', () => unlockAudio());

    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      this.hover = p.y < BAR_Y ? { c: Math.floor(p.x / CELL), r: Math.floor(p.y / CELL) } : null;
    });
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      unlockAudio();
      if (this.over) {
        this.scene.restart({ ctx: this.ctx });
        return;
      }
      if (p.y >= BAR_Y) return;
      const cell = { c: Math.floor(p.x / CELL), r: Math.floor(p.y / CELL) };
      const existing = this.towers.get(key(cell));
      if (existing) this.select(existing);
      else if (this.selectedKind) this.tryBuild(this.selectedKind, cell);
    });
  }

  private selectKind(kind: F.TowerKind): void {
    this.selectedKind = kind;
    this.selectedTower = null;
    this.paintHud();
  }

  private select(t: Tower | null): void {
    this.selectedTower = t;
    this.paintHud();
  }

  // ---------- building ----------

  private occupied(cell: F.Cell): boolean {
    return this.enemies.some((e) => {
      const ec = { c: Math.floor(e.x / CELL), r: Math.floor(e.y / CELL) };
      return key(ec) === key(cell) || key(e.target) === key(cell);
    });
  }

  tryBuild(kind: F.TowerKind, cell: F.Cell): boolean {
    const spec = F.TOWERS[kind];
    if (this.over || this.gold < spec.cost) return false;
    if (this.occupied(cell) || !F.canBuild(this.blocked, F.MAP, cell)) {
      blip({ freq: 160, ms: 120, type: 'sawtooth', gain: 0.04 });
      return false;
    }
    this.blocked[cell.r][cell.c] = true;
    this.field = F.computeField(this.blocked, F.MAP.exit);
    this.towers.set(key(cell), { kind, cell, level: 1, nextFire: 0 });
    this.gold -= spec.cost;
    blip({ freq: 440, to: 660, ms: 90, type: 'triangle' });
    this.paintHud();
    return true;
  }

  private sellValue(t: Tower): number {
    let spent = F.TOWERS[t.kind].cost;
    for (let l = 1; l < t.level; l++) spent += F.UPGRADE_COST(l);
    return Math.floor(spent * F.SELL_RATIO);
  }

  private upgradeSelected(): void {
    const t = this.selectedTower;
    if (!t || this.over) return;
    const cost = F.UPGRADE_COST(t.level);
    if (this.gold < cost || t.level >= 5) return;
    this.gold -= cost;
    t.level++;
    blip({ freq: 520, to: 880, ms: 120, type: 'sine' });
    this.paintHud();
  }

  private sellSelected(): void {
    const t = this.selectedTower;
    if (!t || this.over) return;
    this.gold += this.sellValue(t);
    this.towers.delete(key(t.cell));
    this.blocked[t.cell.r][t.cell.c] = false;
    this.field = F.computeField(this.blocked, F.MAP.exit);
    this.select(null);
  }

  // ---------- waves ----------

  private earlyBonus(): number {
    return this.countdownEnd ? Math.max(0, Math.ceil((this.countdownEnd - this.time.now) / 1000)) * 3 : 0;
  }

  callWave(): void {
    if (this.over || this.phase === 'wave') return;
    if (this.wave > 0 && this.countdownEnd) this.gold += this.earlyBonus();
    this.startWave();
  }

  startWave(): void {
    this.wave++;
    this.phase = 'wave';
    this.countdownEnd = 0;
    let at = this.time.now + 400;
    this.spawns = [];
    for (const entry of F.waveSpec(this.wave)) {
      for (let i = 0; i < entry.count; i++) {
        this.spawns.push({ kind: entry.kind, at });
        at += entry.gapMs;
      }
    }
    this.ctx.setStatus(`wave ${this.wave} of ${F.FINAL_WAVE}`);
    blip({ freq: 330, to: 660, ms: 200, type: 'triangle' });
    this.paintHud();
  }

  private spawn(kind: F.EnemyKind): void {
    const spec = F.ENEMIES[kind];
    const hp = Math.round(spec.hp * F.hpScale(this.wave));
    const s = F.MAP.start;
    this.enemies.push({
      kind,
      x: cx(s.c) - CELL,
      y: cy(s.r),
      hp,
      maxHp: hp,
      target: { ...s },
      slowUntil: 0,
      slow: 0
    });
  }

  private waveCleared(): void {
    this.phase = 'build';
    const bonus = F.waveBonus(this.wave);
    this.gold += bonus;
    this.score += bonus;
    if (this.wave >= F.FINAL_WAVE) {
      this.won = true;
      this.score += this.lives * 100;
      this.end();
      return;
    }
    this.countdownEnd = this.time.now + COUNTDOWN_MS;
    blip({ freq: 660, to: 990, ms: 160, type: 'sine' });
    this.paintHud();
  }

  // ---------- combat ----------

  damage(e: Enemy, amount: number): void {
    e.hp -= amount;
    if (e.hp > 0) return;
    const idx = this.enemies.indexOf(e);
    if (idx === -1) return;
    this.enemies.splice(idx, 1);
    const spec = F.ENEMIES[e.kind];
    this.gold += spec.value;
    this.score += spec.value;
    noise(60, 0.03);
    this.paintHud();
    this.checkWaveEnd();
  }

  leak(e: Enemy): void {
    const idx = this.enemies.indexOf(e);
    if (idx === -1) return;
    this.enemies.splice(idx, 1);
    this.lives -= F.ENEMIES[e.kind].leak;
    this.cameras.main.shake(150, 0.006);
    noise(160, 0.08);
    this.paintHud();
    if (this.lives <= 0) {
      this.lives = 0;
      this.end();
      return;
    }
    this.checkWaveEnd();
  }

  private checkWaveEnd(): void {
    if (this.phase === 'wave' && this.spawns.length === 0 && this.enemies.length === 0) this.waveCleared();
  }

  private end(): void {
    if (this.over) return;
    this.over = true;
    finishRun(this.ctx, this.overlay, this.score, {
      title: this.won ? 'Held fast' : 'The wall fell',
      detail: this.won ? `all ${F.FINAL_WAVE} waves · ${this.lives} lives left` : `fell on wave ${this.wave}`,
      hint: 'R or tap to play again · Esc for the catalog',
      y: BAR_Y / 2
    });
  }

  private fireTowers(time: number): void {
    for (const t of this.towers.values()) {
      if (time < t.nextFire) continue;
      const spec = F.TOWERS[t.kind];
      const { damage, range } = F.upgraded(spec, t.level);
      const tx = cx(t.cell.c);
      const ty = cy(t.cell.r);
      let target: Enemy | null = null;
      let best = Infinity;
      for (const e of this.enemies) {
        if (Math.hypot(e.x - tx, e.y - ty) > range) continue;
        const d = this.field[Math.floor(e.y / CELL)]?.[Math.floor(e.x / CELL)] ?? Infinity;
        if (d < best) {
          best = d;
          target = e;
        }
      }
      if (!target) continue;
      t.nextFire = time + spec.cooldown;
      this.tracers.push({ x1: tx, y1: ty, x2: target.x, y2: target.y, colour: spec.colour, until: time + 80 });
      if (spec.splash) {
        const { x, y } = target;
        for (const e of [...this.enemies]) if (Math.hypot(e.x - x, e.y - y) <= spec.splash) this.damage(e, damage);
        blip({ freq: 120, to: 60, ms: 140, type: 'sawtooth', gain: 0.04 });
      } else {
        if (spec.slow) {
          target.slow = spec.slow;
          target.slowUntil = time + (spec.slowMs ?? 0);
        }
        this.damage(target, damage);
        blip({ freq: spec.slow ? 700 : 1000, to: spec.slow ? 500 : 700, ms: 40, gain: 0.02 });
      }
    }
  }

  // ---------- loop ----------

  update(time: number, delta: number): void {
    if (!this.over) this.step(time, delta);
    this.draw(time);
  }

  private step(time: number, delta: number): void {
    while (this.spawns.length && time >= this.spawns[0].at) this.spawn(this.spawns.shift()!.kind);

    if (this.phase === 'build' && this.countdownEnd && time >= this.countdownEnd) this.startWave();

    for (const e of [...this.enemies]) {
      const spec = F.ENEMIES[e.kind];
      const slow = time < e.slowUntil ? e.slow : 0;
      const speed = spec.speed * (1 - slow) * (delta / 1000);
      const tx = cx(e.target.c);
      const ty = cy(e.target.r);
      const dist = Math.hypot(tx - e.x, ty - e.y);
      if (dist <= speed) {
        e.x = tx;
        e.y = ty;
        if (e.target.c === F.MAP.exit.c && e.target.r === F.MAP.exit.r) {
          this.leak(e);
          continue;
        }
        const next = F.nextCell(this.field, e.target);
        if (next) e.target = next;
      } else {
        e.x += ((tx - e.x) / dist) * speed;
        e.y += ((ty - e.y) / dist) * speed;
      }
    }

    this.fireTowers(time);
    if (this.phase === 'build' && this.countdownEnd) this.paintHud();
  }

  // ---------- drawing ----------

  private draw(time: number): void {
    const g = this.gfx;
    g.clear();

    for (let r = 0; r < F.MAP.rows; r++) {
      for (let c = 0; c < F.MAP.cols; c++) {
        const x = c * CELL;
        const y = r * CELL;
        const rock = this.blocked[r][c] && !this.towers.has(key({ c, r }));
        if (rock) {
          g.fillStyle(0x1c2235, 1);
          g.fillRoundedRect(x + 3, y + 3, CELL - 6, CELL - 6, 6);
        } else {
          g.fillStyle((r + c) % 2 === 0 ? 0x0c1019 : 0x0a0d15, 1);
          g.fillRect(x, y, CELL, CELL);
        }
      }
    }
    // Start and exit markers.
    g.fillStyle(0x8ac926, 0.25);
    g.fillRect(F.MAP.start.c * CELL, F.MAP.start.r * CELL, CELL, CELL);
    g.fillStyle(0xf72585, 0.25);
    g.fillRect(F.MAP.exit.c * CELL, F.MAP.exit.r * CELL, CELL, CELL);

    // Flow hints: a dot in each cell nudged toward its next step.
    g.fillStyle(0x2a3350, 1);
    for (let r = 0; r < F.MAP.rows; r++) {
      for (let c = 0; c < F.MAP.cols; c++) {
        if (this.blocked[r][c] || !Number.isFinite(this.field[r][c])) continue;
        const next = F.nextCell(this.field, { c, r });
        if (!next) continue;
        g.fillCircle(cx(c) + (next.c - c) * 8, cy(r) + (next.r - r) * 8, 2);
      }
    }

    // Hover / build preview.
    if (this.hover && this.selectedKind && !this.selectedTower && !this.over) {
      const spec = F.TOWERS[this.selectedKind];
      const ok = this.gold >= spec.cost && !this.occupied(this.hover) && F.canBuild(this.blocked, F.MAP, this.hover);
      g.lineStyle(2, ok ? 0x8ac926 : 0xf72585, 0.9);
      g.strokeRect(this.hover.c * CELL + 2, this.hover.r * CELL + 2, CELL - 4, CELL - 4);
      g.lineStyle(1, spec.colour, 0.35);
      g.strokeCircle(cx(this.hover.c), cy(this.hover.r), spec.range);
    }

    for (const t of this.towers.values()) {
      const spec = F.TOWERS[t.kind];
      const x = cx(t.cell.c);
      const y = cy(t.cell.r);
      g.fillStyle(0x1c2235, 1);
      g.fillRoundedRect(x - 16, y - 16, 32, 32, 6);
      g.fillStyle(spec.colour, 1);
      g.fillCircle(x, y, 9 + t.level);
      if (t === this.selectedTower) {
        g.lineStyle(1, spec.colour, 0.5);
        g.strokeCircle(x, y, F.upgraded(spec, t.level).range);
        g.lineStyle(2, 0xe8ecf5, 1);
        g.strokeRect(t.cell.c * CELL + 2, t.cell.r * CELL + 2, CELL - 4, CELL - 4);
      }
    }

    this.tracers = this.tracers.filter((tr) => tr.until > time);
    for (const tr of this.tracers) {
      g.lineStyle(2, tr.colour, 0.9);
      g.lineBetween(tr.x1, tr.y1, tr.x2, tr.y2);
    }

    for (const e of this.enemies) {
      const spec = F.ENEMIES[e.kind];
      g.fillStyle(time < e.slowUntil ? 0xa78bfa : spec.colour, 1);
      g.fillCircle(e.x, e.y, spec.radius);
      const w = spec.radius * 2;
      g.fillStyle(0x232838, 1);
      g.fillRect(e.x - w / 2, e.y - spec.radius - 6, w, 3);
      g.fillStyle(0x8ac926, 1);
      g.fillRect(e.x - w / 2, e.y - spec.radius - 6, (w * e.hp) / e.maxHp, 3);
    }
  }
}
