import Phaser from 'phaser';
import type { GameContext } from '../../platform/types';
import { COLOURS, MONO, Overlay, SANS, finishRun, label } from '../_shared/phaser';
import { blip, noise, unlockAudio } from '../_shared/audio';

export const WIDTH = 960;
export const HEIGHT = 540;

type Body = Phaser.Physics.Arcade.Body;
type Arc = Phaser.GameObjects.Arc & { body: Body };

type EnemyKind = 'chaser' | 'runner' | 'shooter';
interface Enemy extends Phaser.GameObjects.Arc {
  body: Body;
  kind: EnemyKind;
  hp: number;
  speed: number;
  value: number;
  fireAt: number;
}
interface Bullet extends Phaser.GameObjects.Arc {
  body: Body;
  pierce: number;
  hits: Set<Enemy>;
}

const ENEMY: Record<EnemyKind, { r: number; hp: number; speed: number; value: number; colour: number; touch: number }> = {
  chaser: { r: 16, hp: 3, speed: 95, value: 10, colour: 0xff9f1c, touch: 15 },
  runner: { r: 10, hp: 1, speed: 210, value: 15, colour: 0xf72585, touch: 10 },
  shooter: { r: 14, hp: 2, speed: 75, value: 25, colour: 0xa78bfa, touch: 12 }
};

interface Upgrade {
  id: string;
  name: string;
  blurb: string;
  apply: (s: ArenaScene) => void;
  available?: (s: ArenaScene) => boolean;
}

const UPGRADES: Upgrade[] = [
  { id: 'rapid', name: 'Rapid fire', blurb: '20% faster shots', apply: (s) => (s.stats.fireMs *= 0.8) },
  { id: 'heavy', name: 'Heavy rounds', blurb: '+1 damage', apply: (s) => (s.stats.damage += 1) },
  { id: 'fleet', name: 'Fleet feet', blurb: '+40 move speed', apply: (s) => (s.stats.speed += 40) },
  { id: 'skin', name: 'Thick skin', blurb: '+25 max HP, full heal', apply: (s) => { s.stats.maxHp += 25; s.hp = s.stats.maxHp; } },
  { id: 'split', name: 'Split shot', blurb: '+1 bullet per shot', apply: (s) => (s.stats.shots += 1), available: (s) => s.stats.shots < 3 },
  { id: 'pierce', name: 'Piercing', blurb: 'bullets pass through +1 enemy', apply: (s) => (s.stats.pierce += 1), available: (s) => s.stats.pierce < 2 },
  { id: 'patch', name: 'Patch up', blurb: 'heal 50', apply: (s) => (s.hp = Math.min(s.stats.maxHp, s.hp + 50)), available: (s) => s.hp < s.stats.maxHp }
];

export class ArenaScene extends Phaser.Scene {
  private ctx!: GameContext;
  stats = { fireMs: 180, damage: 1, speed: 260, maxHp: 100, shots: 1, pierce: 0 };
  hp = 100;
  wave = 0;
  score = 0;
  kills = 0;
  choosing = false;
  over = false;
  taken: string[] = [];

  private player!: Arc;
  private enemies!: Phaser.Physics.Arcade.Group;
  private bullets!: Phaser.Physics.Arcade.Group;
  private enemyBullets!: Phaser.Physics.Arcade.Group;
  private sparks!: Phaser.GameObjects.Particles.ParticleEmitter;

  private keys!: Record<'W' | 'A' | 'S' | 'D' | 'UP' | 'LEFT' | 'DOWN' | 'RIGHT', Phaser.Input.Keyboard.Key>;
  private nextFire = 0;
  private invulnUntil = 0;
  private spawnQueue: EnemyKind[] = [];
  private nextSpawn = 0;

  private overlay!: Overlay;
  private hpBar!: Phaser.GameObjects.Rectangle;
  private waveText!: Phaser.GameObjects.Text;
  private scoreText!: Phaser.GameObjects.Text;
  private perkText!: Phaser.GameObjects.Text;
  private upgradeUi?: Phaser.GameObjects.Container;

  constructor() {
    super('arena');
  }

  init(data: { ctx: GameContext }): void {
    this.ctx = data.ctx;
    this.stats = { fireMs: 180, damage: 1, speed: 260, maxHp: 100, shots: 1, pierce: 0 };
    this.hp = 100;
    this.wave = 0;
    this.score = 0;
    this.kills = 0;
    this.choosing = false;
    this.over = false;
    this.taken = [];
    this.spawnQueue = [];
    this.upgradeUi = undefined;
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#070910');
    this.overlay = new Overlay(this);
    this.physics.world.setBounds(0, 0, WIDTH, HEIGHT);

    if (!this.textures.exists('dot')) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 8;
      const g = canvas.getContext('2d')!;
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.arc(4, 4, 4, 0, Math.PI * 2);
      g.fill();
      this.textures.addCanvas('dot', canvas);
    }

    // Floor grid for a sense of motion.
    const grid = this.add.graphics();
    grid.lineStyle(1, 0x111726, 1);
    for (let x = 0; x <= WIDTH; x += 40) grid.lineBetween(x, 0, x, HEIGHT);
    for (let y = 0; y <= HEIGHT; y += 40) grid.lineBetween(0, y, WIDTH, y);

    this.player = this.add.circle(WIDTH / 2, HEIGHT / 2, 14, 0xe8ecf5) as Arc;
    this.physics.add.existing(this.player);
    this.player.body.setCircle(14);
    this.player.body.setCollideWorldBounds(true);

    this.enemies = this.physics.add.group();
    this.bullets = this.physics.add.group();
    this.enemyBullets = this.physics.add.group();

    this.sparks = this.add.particles(0, 0, 'dot', {
      speed: { min: 60, max: 220 },
      scale: { start: 0.9, end: 0 },
      lifespan: { min: 200, max: 450 },
      quantity: 12,
      emitting: false
    }).setDepth(5);

    this.physics.add.overlap(this.bullets, this.enemies, (b, e) => this.bulletHitsEnemy(b as Bullet, e as Enemy));
    this.physics.add.overlap(this.player, this.enemies, (_p, e) => this.enemyTouches(e as Enemy));
    this.physics.add.overlap(this.player, this.enemyBullets, (_p, b) => {
      (b as Arc).destroy();
      this.damagePlayer(12);
    });

    this.buildHud();
    this.bindInput();
    this.startWave();
  }

  // ---------- HUD ----------

  private buildHud(): void {
    this.add.rectangle(20, 20, 200, 14, 0x232838).setOrigin(0, 0).setDepth(10);
    this.hpBar = this.add.rectangle(20, 20, 200, 14, 0x8ac926).setOrigin(0, 0).setDepth(11);
    this.waveText = this.add.text(20, 40, '', { fontFamily: MONO, fontSize: '14px', color: COLOURS.dim }).setDepth(10);
    this.scoreText = this.add.text(WIDTH - 20, 20, '0', { fontFamily: MONO, fontSize: '28px', color: COLOURS.text }).setOrigin(1, 0).setDepth(10);
    this.perkText = this.add.text(WIDTH - 20, 56, '', { fontFamily: MONO, fontSize: '12px', color: COLOURS.faint, align: 'right' }).setOrigin(1, 0).setDepth(10);
    label(this, 20, HEIGHT - 28, 'WASD move · mouse aim · hold to fire · Esc leave');
    this.paintHud();
  }

  private paintHud(): void {
    this.hpBar.width = (200 * Math.max(0, this.hp)) / this.stats.maxHp;
    this.hpBar.fillColor = this.hp < this.stats.maxHp * 0.3 ? 0xf72585 : 0x8ac926;
    this.waveText.setText(`wave ${this.wave} · ${this.enemies.countActive() + this.spawnQueue.length} left`);
    this.scoreText.setText(this.score.toLocaleString());
    this.perkText.setText(this.taken.join(' · '));
  }

  // ---------- input ----------

  private bindInput(): void {
    const kb = this.input.keyboard!;
    this.keys = kb.addKeys('W,A,S,D,UP,LEFT,DOWN,RIGHT') as typeof this.keys;
    kb.on('keydown-ESC', () => this.ctx.exit());
    kb.on('keydown-R', () => this.over && this.scene.restart({ ctx: this.ctx }));
    kb.on('keydown-ONE', () => this.pick(0));
    kb.on('keydown-TWO', () => this.pick(1));
    kb.on('keydown-THREE', () => this.pick(2));
    this.input.on('pointerdown', () => {
      unlockAudio();
      if (this.over) this.scene.restart({ ctx: this.ctx });
    });
    kb.on('keydown', () => unlockAudio());
  }

  // ---------- waves ----------

  private startWave(): void {
    this.wave++;
    const count = 5 + this.wave * 2;
    this.spawnQueue = [];
    for (let i = 0; i < count; i++) {
      const roll = Math.random();
      let kind: EnemyKind = 'chaser';
      if (this.wave >= 3 && roll < 0.2) kind = 'shooter';
      else if (this.wave >= 2 && roll < 0.5) kind = 'runner';
      this.spawnQueue.push(kind);
    }
    this.nextSpawn = this.time.now + 600;
    this.ctx.setStatus(`wave ${this.wave}`);
    this.paintHud();
    blip({ freq: 330, to: 660, ms: 180, type: 'triangle' });
  }

  private spawnEnemy(kind: EnemyKind): void {
    const spec = ENEMY[kind];
    const side = Math.floor(Math.random() * 4);
    const x = side === 0 ? -20 : side === 1 ? WIDTH + 20 : Math.random() * WIDTH;
    const y = side === 2 ? -20 : side === 3 ? HEIGHT + 20 : Math.random() * HEIGHT;
    const e = this.add.circle(x, y, spec.r, spec.colour) as Enemy;
    this.physics.add.existing(e);
    e.body.setCircle(spec.r);
    e.kind = kind;
    e.hp = spec.hp + Math.floor((this.wave - 1) / 4);
    e.speed = spec.speed;
    e.value = spec.value;
    e.fireAt = this.time.now + 1500 + Math.random() * 800;
    this.enemies.add(e);
  }

  private waveCleared(): void {
    this.score += 50 * this.wave;
    this.choosing = true;
    this.physics.pause();
    this.offerUpgrades();
    this.paintHud();
  }

  private offered: Upgrade[] = [];

  private offerUpgrades(): void {
    const pool = UPGRADES.filter((u) => !u.available || u.available(this));
    Phaser.Utils.Array.Shuffle(pool);
    this.offered = pool.slice(0, 3);

    const cards: Phaser.GameObjects.GameObject[] = [
      this.add.rectangle(0, 0, 720, 230, COLOURS.panel, 0.94).setStrokeStyle(1, COLOURS.line),
      this.add.text(0, -88, `Wave ${this.wave} cleared — pick one`, { fontFamily: SANS, fontSize: '22px', color: COLOURS.text }).setOrigin(0.5)
    ];
    this.offered.forEach((u, i) => {
      const x = (i - 1) * 230;
      const card = this.add.rectangle(x, 20, 210, 130, COLOURS.raised).setStrokeStyle(1, COLOURS.line).setInteractive({ useHandCursor: true });
      card.on('pointerover', () => card.setStrokeStyle(2, 0x4cc9f0));
      card.on('pointerout', () => card.setStrokeStyle(1, COLOURS.line));
      card.on('pointerdown', () => this.pick(i));
      cards.push(
        card,
        this.add.text(x, -10, `${i + 1}`, { fontFamily: MONO, fontSize: '12px', color: COLOURS.faint }).setOrigin(0.5),
        this.add.text(x, 14, u.name, { fontFamily: SANS, fontSize: '20px', color: COLOURS.text }).setOrigin(0.5),
        this.add.text(x, 46, u.blurb, { fontFamily: MONO, fontSize: '13px', color: COLOURS.dim }).setOrigin(0.5)
      );
    });
    this.upgradeUi = this.add.container(WIDTH / 2, HEIGHT / 2, cards).setDepth(40);
  }

  pick(i: number): void {
    if (!this.choosing || !this.offered[i]) return;
    const u = this.offered[i];
    u.apply(this);
    this.taken.push(u.name);
    this.upgradeUi?.destroy();
    this.upgradeUi = undefined;
    this.choosing = false;
    this.physics.resume();
    blip({ freq: 520, to: 1040, ms: 140, type: 'sine' });
    this.startWave();
  }

  // ---------- combat ----------

  private fire(): void {
    const p = this.input.activePointer;
    const base = Phaser.Math.Angle.Between(this.player.x, this.player.y, p.worldX, p.worldY);
    const spread = 0.16;
    for (let i = 0; i < this.stats.shots; i++) {
      const angle = base + (i - (this.stats.shots - 1) / 2) * spread;
      const b = this.add.circle(this.player.x, this.player.y, 4, 0x4cc9f0) as Bullet;
      this.physics.add.existing(b);
      b.body.setCircle(4);
      b.body.setVelocity(Math.cos(angle) * 540, Math.sin(angle) * 540);
      b.pierce = this.stats.pierce;
      b.hits = new Set();
      this.bullets.add(b);
      this.time.delayedCall(1200, () => b.active && b.destroy());
    }
    blip({ freq: 880, to: 440, ms: 50, gain: 0.03 });
  }

  private bulletHitsEnemy(b: Bullet, e: Enemy): void {
    if (b.hits.has(e)) return;
    b.hits.add(e);
    this.hit(e, this.stats.damage);
    if (b.pierce > 0) b.pierce--;
    else b.destroy();
  }

  /** Damage an enemy; kills award score and spawn sparks. */
  hit(e: Enemy, amount: number): void {
    e.hp -= amount;
    if (e.hp > 0) {
      e.setAlpha(0.6);
      this.time.delayedCall(60, () => e.active && e.setAlpha(1));
      return;
    }
    this.sparks.setParticleTint(e.fillColor);
    this.sparks.explode(12, e.x, e.y);
    noise(90, 0.05);
    this.kills++;
    this.score += e.value * this.wave;
    e.destroy();
    this.paintHud();
    if (this.enemies.countActive() === 0 && this.spawnQueue.length === 0) this.waveCleared();
  }

  private enemyTouches(e: Enemy): void {
    this.damagePlayer(ENEMY[e.kind].touch);
    if (e.kind === 'runner') this.hit(e, 999);
  }

  damagePlayer(amount: number): void {
    if (this.over || this.time.now < this.invulnUntil) return;
    this.hp -= amount;
    this.invulnUntil = this.time.now + 600;
    this.cameras.main.shake(120, 0.006);
    noise(140, 0.08);
    this.player.setFillStyle(0xf72585);
    this.time.delayedCall(150, () => this.player.setFillStyle(0xe8ecf5));
    this.paintHud();
    if (this.hp <= 0) this.end();
  }

  private end(): void {
    this.over = true;
    this.physics.pause();
    this.upgradeUi?.destroy();
    finishRun(this.ctx, this.overlay, this.score, {
      title: 'Overrun',
      detail: `wave ${this.wave} · ${this.kills} kills`,
      hint: 'R or tap to play again · Esc for the catalog'
    });
  }

  // ---------- loop ----------

  update(time: number): void {
    if (this.over || this.choosing) return;

    const k = this.keys;
    const dx = (k.D.isDown || k.RIGHT.isDown ? 1 : 0) - (k.A.isDown || k.LEFT.isDown ? 1 : 0);
    const dy = (k.S.isDown || k.DOWN.isDown ? 1 : 0) - (k.W.isDown || k.UP.isDown ? 1 : 0);
    const len = Math.hypot(dx, dy) || 1;
    this.player.body.setVelocity((dx / len) * this.stats.speed, (dy / len) * this.stats.speed);
    this.player.setAlpha(time < this.invulnUntil && Math.floor(time / 80) % 2 === 0 ? 0.4 : 1);

    if (this.input.activePointer.isDown && time >= this.nextFire) {
      this.nextFire = time + this.stats.fireMs;
      this.fire();
    }

    if (this.spawnQueue.length && time >= this.nextSpawn) {
      this.spawnEnemy(this.spawnQueue.shift()!);
      this.nextSpawn = time + Math.max(180, 450 - this.wave * 20);
      this.paintHud();
    }

    for (const obj of this.enemies.getChildren() as Enemy[]) {
      const ang = Phaser.Math.Angle.Between(obj.x, obj.y, this.player.x, this.player.y);
      const dist = Phaser.Math.Distance.Between(obj.x, obj.y, this.player.x, this.player.y);
      if (obj.kind === 'shooter') {
        const want = dist > 260 ? 1 : dist < 180 ? -1 : 0;
        const strafe = want === 0 ? 1 : 0.3;
        obj.body.setVelocity(
          Math.cos(ang) * obj.speed * want + Math.cos(ang + Math.PI / 2) * obj.speed * strafe,
          Math.sin(ang) * obj.speed * want + Math.sin(ang + Math.PI / 2) * obj.speed * strafe
        );
        if (time >= obj.fireAt) {
          obj.fireAt = time + 1800;
          const b = this.add.circle(obj.x, obj.y, 5, 0xa78bfa) as Arc;
          this.physics.add.existing(b);
          b.body.setCircle(5);
          b.body.setVelocity(Math.cos(ang) * 230, Math.sin(ang) * 230);
          this.enemyBullets.add(b);
          this.time.delayedCall(3000, () => b.active && b.destroy());
          blip({ freq: 220, to: 160, ms: 90, type: 'sawtooth', gain: 0.03 });
        }
      } else {
        obj.body.setVelocity(Math.cos(ang) * obj.speed, Math.sin(ang) * obj.speed);
      }
    }
  }
}
