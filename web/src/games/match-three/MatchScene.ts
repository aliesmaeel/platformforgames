import Phaser from 'phaser';
import type { GameContext } from '../../platform/types';
import * as B from './board';
import { LEVELS, type Level } from './levels';

export const WIDTH = 960;
export const HEIGHT = 540;

const ROWS = 8;
const COLS = 8;
const CELL = 56;
const GEM = 44;
const BOARD_X = 40;
const BOARD_Y = (HEIGHT - ROWS * CELL) / 2;
const HUD_X = 540;

const SWAP_MS = 130;
const CLEAR_MS = 160;
const DROP_MS_PER_ROW = 70;
const DRAG_PX = 18;

/** Colour + shape per gem index. Shapes keep the game readable without colour. */
const GEMS = [
  { colour: 0xf72585, shape: 'circle' },
  { colour: 0xff9f1c, shape: 'square' },
  { colour: 0xffd166, shape: 'diamond' },
  { colour: 0x8ac926, shape: 'triangle' },
  { colour: 0x4cc9f0, shape: 'hexagon' },
  { colour: 0xa78bfa, shape: 'star' }
] as const;

const MONO = 'ui-monospace, monospace';
const SANS = 'system-ui, sans-serif';

type GemSprite = Phaser.GameObjects.Image;

interface SceneData {
  ctx: GameContext;
  level?: number;
  score?: number;
}

export class MatchScene extends Phaser.Scene {
  private ctx!: GameContext;
  private levelIndex = 0;
  private level!: Level;
  private rng!: B.Rng;

  private grid!: B.Grid;
  private sprites: (GemSprite | null)[][] = [];
  private score = 0;
  private movesLeft = 0;
  private remaining: number[] = [];
  private busy = false;
  private over = false;

  private selected: B.Pos | null = null;
  private dragFrom: { pos: B.Pos; x: number; y: number } | null = null;
  private highlight!: Phaser.GameObjects.Rectangle;

  private movesText!: Phaser.GameObjects.Text;
  private scoreText!: Phaser.GameObjects.Text;
  private goalTexts: Phaser.GameObjects.Text[] = [];
  private toast?: Phaser.GameObjects.Text;

  constructor() {
    super('match');
  }

  init(data: SceneData): void {
    this.ctx = data.ctx;
    this.levelIndex = data.level ?? 0;
    this.score = data.score ?? 0;
    this.level = LEVELS[this.levelIndex];
    this.rng = B.mulberry32(this.level.seed);
    this.sprites = [];
    this.goalTexts = [];
    this.selected = null;
    this.dragFrom = null;
    this.busy = false;
    this.over = false;
    this.toast = undefined;
    this.movesLeft = this.level.moves;
    this.remaining = this.level.goals.map((g) => g.count);
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#070910');
    this.makeTextures();

    this.add
      .rectangle(BOARD_X - 8, BOARD_Y - 8, COLS * CELL + 16, ROWS * CELL + 16, 0x0d1220)
      .setOrigin(0, 0)
      .setStrokeStyle(1, 0x232838);
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if ((r + c) % 2 === 0) {
          this.add.rectangle(this.cx(c), this.cy(r), CELL, CELL, 0x111726);
        }
      }
    }

    this.highlight = this.add
      .rectangle(0, 0, CELL - 4, CELL - 4)
      .setStrokeStyle(3, 0xe8ecf5)
      .setVisible(false)
      .setDepth(3);

    this.grid = B.createBoard(ROWS, COLS, this.level.colours, this.rng);
    for (let r = 0; r < ROWS; r++) {
      this.sprites.push([]);
      for (let c = 0; c < COLS; c++) {
        this.sprites[r].push(this.makeGem(r, c, this.grid[r][c]));
      }
    }

    this.buildHud();
    this.bindInput();
    this.ctx.setStatus(`level ${this.levelIndex + 1} of ${LEVELS.length}`);
  }

  // ---------- geometry ----------

  private cx = (c: number) => BOARD_X + c * CELL + CELL / 2;
  private cy = (r: number) => BOARD_Y + r * CELL + CELL / 2;

  private cellAt(x: number, y: number): B.Pos | null {
    const c = Math.floor((x - BOARD_X) / CELL);
    const r = Math.floor((y - BOARD_Y) / CELL);
    return r >= 0 && r < ROWS && c >= 0 && c < COLS ? { r, c } : null;
  }

  // ---------- textures ----------

  private makeTextures(): void {
    // Drawn with a 2D canvas rather than generateTexture so no WebGL
    // framebuffer round-trip is needed; works identically on the Canvas renderer.
    GEMS.forEach((gem, i) => {
      const key = `gem-${i}`;
      if (this.textures.exists(key)) return;
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = GEM;
      const g = canvas.getContext('2d')!;
      const h = GEM / 2;
      g.fillStyle = `#${gem.colour.toString(16).padStart(6, '0')}`;

      const poly = (points: { x: number; y: number }[]) => {
        g.beginPath();
        points.forEach((p, k) => (k === 0 ? g.moveTo(p.x, p.y) : g.lineTo(p.x, p.y)));
        g.closePath();
        g.fill();
      };

      switch (gem.shape) {
        case 'circle':
          g.beginPath();
          g.arc(h, h, h, 0, Math.PI * 2);
          g.fill();
          break;
        case 'square':
          g.beginPath();
          g.roundRect(3, 3, GEM - 6, GEM - 6, 8);
          g.fill();
          break;
        case 'diamond':
          poly([{ x: h, y: 0 }, { x: GEM, y: h }, { x: h, y: GEM }, { x: 0, y: h }]);
          break;
        case 'triangle':
          poly([{ x: h, y: 2 }, { x: GEM - 2, y: GEM - 4 }, { x: 2, y: GEM - 4 }]);
          break;
        case 'hexagon':
          poly(
            Array.from({ length: 6 }, (_, k) => {
              const a = (Math.PI / 3) * k - Math.PI / 6;
              return { x: h + h * Math.cos(a), y: h + h * Math.sin(a) };
            })
          );
          break;
        case 'star':
          poly(
            Array.from({ length: 10 }, (_, k) => {
              const a = (Math.PI / 5) * k - Math.PI / 2;
              const rad = k % 2 === 0 ? h : h * 0.45;
              return { x: h + rad * Math.cos(a), y: h + rad * Math.sin(a) };
            })
          );
          break;
      }
      this.textures.addCanvas(key, canvas);
    });
  }

  private makeGem(r: number, c: number, colour: number, fromAbove = 0): GemSprite {
    return this.add
      .image(this.cx(c), this.cy(r) - fromAbove * CELL, `gem-${colour}`)
      .setDepth(2);
  }

  // ---------- HUD ----------

  private buildHud(): void {
    const label = (y: number, text: string) =>
      this.add.text(HUD_X, y, text, { fontFamily: MONO, fontSize: '12px', color: '#5c6684' });

    this.add.text(HUD_X, BOARD_Y - 2, `LEVEL ${this.levelIndex + 1}`, {
      fontFamily: MONO,
      fontSize: '12px',
      color: '#5c6684'
    });
    this.add.text(HUD_X, BOARD_Y + 14, this.level.name, {
      fontFamily: SANS,
      fontSize: '24px',
      color: '#e8ecf5'
    });

    label(BOARD_Y + 66, 'MOVES');
    this.movesText = this.add.text(HUD_X, BOARD_Y + 80, String(this.movesLeft), {
      fontFamily: MONO,
      fontSize: '44px',
      color: '#e8ecf5'
    });

    label(BOARD_Y + 146, 'CLEAR');
    this.level.goals.forEach((goal, i) => {
      const y = BOARD_Y + 176 + i * 40;
      this.add.image(HUD_X + 16, y, `gem-${goal.colour}`).setScale(0.62);
      this.goalTexts.push(
        this.add
          .text(HUD_X + 44, y, '', { fontFamily: MONO, fontSize: '22px', color: '#e8ecf5' })
          .setOrigin(0, 0.5)
      );
    });

    const scoreY = BOARD_Y + 186 + this.level.goals.length * 40 + 12;
    label(scoreY, 'SCORE');
    this.scoreText = this.add.text(HUD_X, scoreY + 14, '0', {
      fontFamily: MONO,
      fontSize: '28px',
      color: '#4cc9f0'
    });

    this.add.text(HUD_X, HEIGHT - 36, 'tap two gems or drag · Esc to leave', {
      fontFamily: MONO,
      fontSize: '12px',
      color: '#5c6684'
    });

    this.paintHud();
  }

  private paintHud(): void {
    this.movesText.setText(String(this.movesLeft));
    this.movesText.setColor(this.movesLeft <= 5 ? '#f72585' : '#e8ecf5');
    this.scoreText.setText(this.score.toLocaleString());
    this.remaining.forEach((n, i) => {
      const done = n <= 0;
      this.goalTexts[i].setText(done ? '✓' : String(n));
      this.goalTexts[i].setColor(done ? '#8ac926' : '#e8ecf5');
    });
  }

  private showToast(text: string): void {
    this.toast?.destroy();
    this.toast = this.add
      .text(BOARD_X + (COLS * CELL) / 2, BOARD_Y + (ROWS * CELL) / 2, text, {
        fontFamily: SANS,
        fontSize: '30px',
        color: '#e8ecf5',
        backgroundColor: '#0b0d12ee',
        padding: { x: 18, y: 10 }
      })
      .setOrigin(0.5)
      .setDepth(10)
      .setAlpha(0);
    this.tweens.add({
      targets: this.toast,
      alpha: 1,
      duration: 120,
      yoyo: true,
      hold: 650,
      onComplete: () => this.toast?.destroy()
    });
  }

  // ---------- input ----------

  private bindInput(): void {
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.onDown(p));
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.onMove(p));
    this.input.on('pointerup', () => (this.dragFrom = null));
    this.input.keyboard?.on('keydown-ESC', () => this.ctx.exit());
    this.input.keyboard?.on('keydown-R', () => {
      if (this.over) this.scene.restart({ ctx: this.ctx, level: 0, score: 0 });
    });
  }

  private onDown(p: Phaser.Input.Pointer): void {
    if (this.over) {
      this.scene.restart({ ctx: this.ctx, level: 0, score: 0 });
      return;
    }
    if (this.busy) return;
    const pos = this.cellAt(p.x, p.y);
    if (!pos) {
      this.select(null);
      return;
    }
    if (this.selected && B.adjacent(this.selected, pos)) {
      void this.trySwap(this.selected, pos);
      return;
    }
    this.select(pos);
    this.dragFrom = { pos, x: p.x, y: p.y };
  }

  private onMove(p: Phaser.Input.Pointer): void {
    if (!this.dragFrom || this.busy || !p.isDown) return;
    const dx = p.x - this.dragFrom.x;
    const dy = p.y - this.dragFrom.y;
    if (Math.abs(dx) < DRAG_PX && Math.abs(dy) < DRAG_PX) return;
    const from = this.dragFrom.pos;
    const to =
      Math.abs(dx) > Math.abs(dy)
        ? { r: from.r, c: from.c + Math.sign(dx) }
        : { r: from.r + Math.sign(dy), c: from.c };
    this.dragFrom = null;
    if (to.r < 0 || to.r >= ROWS || to.c < 0 || to.c >= COLS) return;
    void this.trySwap(from, to);
  }

  private select(pos: B.Pos | null): void {
    this.selected = pos;
    this.highlight.setVisible(Boolean(pos));
    if (pos) this.highlight.setPosition(this.cx(pos.c), this.cy(pos.r));
  }

  // ---------- game flow ----------

  private tween(config: Phaser.Types.Tweens.TweenBuilderConfig): Promise<void> {
    return new Promise((resolve) => {
      this.tweens.add({ ...config, onComplete: () => resolve() });
    });
  }

  private animateSwap(a: B.Pos, b: B.Pos): Promise<void> {
    const sa = this.sprites[a.r][a.c]!;
    const sb = this.sprites[b.r][b.c]!;
    this.sprites[a.r][a.c] = sb;
    this.sprites[b.r][b.c] = sa;
    return Promise.all([
      this.tween({ targets: sa, x: this.cx(b.c), y: this.cy(b.r), duration: SWAP_MS, ease: 'Quad.easeInOut' }),
      this.tween({ targets: sb, x: this.cx(a.c), y: this.cy(a.r), duration: SWAP_MS, ease: 'Quad.easeInOut' })
    ]).then(() => undefined);
  }

  private async trySwap(a: B.Pos, b: B.Pos): Promise<void> {
    this.busy = true;
    this.select(null);

    await this.animateSwap(a, b);
    B.swap(this.grid, a, b);

    if (B.findMatches(this.grid).length === 0) {
      B.swap(this.grid, a, b);
      await this.animateSwap(b, a);
      this.busy = false;
      return;
    }

    this.movesLeft--;
    this.paintHud();
    await this.resolve();
    this.afterMove();
  }

  private async resolve(): Promise<void> {
    let cascade = 1;
    for (;;) {
      const groups = B.findMatches(this.grid);
      if (groups.length === 0) break;

      const cells = B.matchedCells(groups);
      this.score += B.scoreGroups(groups, cascade);
      for (const p of cells) {
        const colour = this.grid[p.r][p.c];
        this.level.goals.forEach((goal, i) => {
          if (goal.colour === colour) this.remaining[i]--;
        });
      }
      if (cascade > 1) this.showToast(`×${cascade}`);
      this.paintHud();

      await Promise.all(
        cells.map((p) => {
          const s = this.sprites[p.r][p.c]!;
          this.sprites[p.r][p.c] = null;
          return this.tween({ targets: s, scale: 0, alpha: 0.4, duration: CLEAR_MS, ease: 'Back.easeIn' }).then(() =>
            s.destroy()
          );
        })
      );
      B.clearCells(this.grid, cells);

      const drops = B.collapse(this.grid);
      const spawns = B.refill(this.grid, this.level.colours, this.rng);

      const anims: Promise<void>[] = [];
      for (const d of drops) {
        const s = this.sprites[d.from.r][d.from.c]!;
        this.sprites[d.from.r][d.from.c] = null;
        this.sprites[d.to.r][d.to.c] = s;
        anims.push(
          this.tween({ targets: s, y: this.cy(d.to.r), duration: (d.to.r - d.from.r) * DROP_MS_PER_ROW, ease: 'Quad.easeIn' })
        );
      }
      for (const sp of spawns) {
        const s = this.makeGem(sp.pos.r, sp.pos.c, sp.colour, sp.fromAbove);
        this.sprites[sp.pos.r][sp.pos.c] = s;
        anims.push(
          this.tween({ targets: s, y: this.cy(sp.pos.r), duration: (sp.pos.r + sp.fromAbove) * DROP_MS_PER_ROW * 0.8, ease: 'Quad.easeIn' })
        );
      }
      await Promise.all(anims);
      cascade++;
    }

    if (!B.findMove(this.grid)) {
      B.shuffle(this.grid, this.rng);
      this.showToast('no moves — reshuffled');
      await Promise.all(
        this.sprites.flat().map((s) => s && this.tween({ targets: s, alpha: 0, duration: 200 }))
      );
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          this.sprites[r][c]?.destroy();
          this.sprites[r][c] = this.makeGem(r, c, this.grid[r][c]).setAlpha(0);
        }
      }
      await Promise.all(this.sprites.flat().map((s) => this.tween({ targets: s, alpha: 1, duration: 200 })));
    }
  }

  private afterMove(): void {
    const cleared = this.remaining.every((n) => n <= 0);
    if (cleared) {
      const bonus = this.movesLeft * 50;
      this.score += bonus;
      this.paintHud();
      const last = this.levelIndex + 1 >= LEVELS.length;
      if (last) {
        this.finish('All levels cleared', `+${bonus} move bonus`);
      } else {
        this.busy = true;
        this.showOverlay('Level cleared', `+${bonus} move bonus`, 'tap to continue');
        this.input.once('pointerdown', () =>
          this.scene.restart({ ctx: this.ctx, level: this.levelIndex + 1, score: this.score })
        );
      }
      return;
    }
    if (this.movesLeft <= 0) {
      this.finish('Out of moves', `reached level ${this.levelIndex + 1}`);
      return;
    }
    this.busy = false;
  }

  private finish(title: string, detail: string): void {
    this.over = true;
    this.busy = true;
    this.showOverlay(title, `${detail} · submitting…`, 'R or tap to play again · Esc for the catalog');
    void this.ctx.submitScore(this.score).then((result) => {
      if (!result) return;
      this.ctx.setStatus(`best ${result.best}${result.offline ? ' (offline)' : ''}`);
      this.showOverlay(title, `rank #${result.rank} · best ${result.best}`, 'R or tap to play again · Esc for the catalog');
    });
  }

  private overlay?: Phaser.GameObjects.Container;

  private showOverlay(title: string, detail: string, hint: string): void {
    this.overlay?.destroy();
    const panel = this.add.rectangle(0, 0, 400, 200, 0x0b0d12, 0.94).setStrokeStyle(1, 0x232838);
    const t = this.add.text(0, -58, title, { fontFamily: SANS, fontSize: '28px', color: '#e8ecf5' }).setOrigin(0.5);
    const s = this.add
      .text(0, -12, this.score.toLocaleString(), { fontFamily: MONO, fontSize: '44px', color: '#4cc9f0' })
      .setOrigin(0.5);
    const d = this.add.text(0, 34, detail, { fontFamily: MONO, fontSize: '14px', color: '#99a2b8' }).setOrigin(0.5);
    const h = this.add.text(0, 66, hint, { fontFamily: MONO, fontSize: '13px', color: '#5c6684' }).setOrigin(0.5);
    this.overlay = this.add
      .container(BOARD_X + (COLS * CELL) / 2, HEIGHT / 2, [panel, t, s, d, h])
      .setDepth(20);
  }
}
