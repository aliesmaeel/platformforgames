import Phaser from 'phaser';
import type { GameContext } from '../../platform/types';
import { COLOURS, MONO, Overlay, finishRun, label } from '../_shared/phaser';
import * as W from './well';

export const WIDTH = 960;
export const HEIGHT = 540;

const CELL = 25;
const WELL_X = (WIDTH - W.COLS * CELL) / 2;
const WELL_Y = 20;
const LEFT_X = WELL_X - 150;
const RIGHT_X = WELL_X + W.COLS * CELL + 40;

const DAS_MS = 160;
const ARR_MS = 45;
const SOFT_MS = 40;
const LOCK_MS = 450;
const MAX_LOCK_RESETS = 12;
const FLASH_MS = 110;

const KIND_COLOURS = [0x4cc9f0, 0xffd166, 0xa78bfa, 0x8ac926, 0xf72585, 0x60a5fa, 0xff9f1c];

export class StackScene extends Phaser.Scene {
  private ctx!: GameContext;
  private grid!: W.Grid;
  private piece!: W.Piece;
  private hold: number | null = null;
  private holdUsed = false;
  private queue: number[] = [];
  private bag!: Generator<number, never, void>;

  private score = 0;
  private lines = 0;
  private level = 1;
  private over = false;
  private gravityAcc = 0;
  private lockAcc = 0;
  private lockResets = 0;
  private flashRows: number[] = [];
  private flashAcc = 0;

  private gfx!: Phaser.GameObjects.Graphics;
  private overlay!: Overlay;
  private scoreText!: Phaser.GameObjects.Text;
  private levelText!: Phaser.GameObjects.Text;
  private linesText!: Phaser.GameObjects.Text;

  private keys!: Record<'left' | 'right' | 'down', Phaser.Input.Keyboard.Key>;
  private das = { dir: 0, held: 0, repeat: 0 };

  constructor() {
    super('stack');
  }

  init(data: { ctx: GameContext }): void {
    this.ctx = data.ctx;
    this.grid = W.createGrid();
    this.bag = W.bag(Math.random);
    this.queue = Array.from({ length: 3 }, () => this.bag.next().value);
    this.hold = null;
    this.holdUsed = false;
    this.score = 0;
    this.lines = 0;
    this.level = 1;
    this.over = false;
    this.gravityAcc = 0;
    this.lockAcc = 0;
    this.lockResets = 0;
    this.flashRows = [];
    this.das = { dir: 0, held: 0, repeat: 0 };
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#070910');
    this.overlay = new Overlay(this);

    this.add
      .rectangle(WELL_X - 4, WELL_Y - 4, W.COLS * CELL + 8, W.ROWS * CELL + 8, COLOURS.raised)
      .setOrigin(0, 0)
      .setStrokeStyle(1, COLOURS.line);

    label(this, LEFT_X, WELL_Y, 'HOLD');
    label(this, RIGHT_X, WELL_Y, 'NEXT');
    label(this, RIGHT_X, WELL_Y + 250, 'SCORE');
    this.scoreText = this.add.text(RIGHT_X, WELL_Y + 264, '0', { fontFamily: MONO, fontSize: '28px', color: COLOURS.accent });
    label(this, RIGHT_X, WELL_Y + 310, 'LEVEL');
    this.levelText = this.add.text(RIGHT_X, WELL_Y + 324, '1', { fontFamily: MONO, fontSize: '28px', color: COLOURS.text });
    label(this, RIGHT_X, WELL_Y + 370, 'LINES');
    this.linesText = this.add.text(RIGHT_X, WELL_Y + 384, '0', { fontFamily: MONO, fontSize: '28px', color: COLOURS.text });

    this.add.text(LEFT_X - 60, HEIGHT - 120, '← → move\n↑ / X rotate · Z back\n↓ soft · space hard\nC hold · Esc leave', {
      fontFamily: MONO,
      fontSize: '12px',
      color: COLOURS.faint,
      lineSpacing: 4
    });

    this.gfx = this.add.graphics();
    this.bindInput();
    this.next();
    this.ctx.setStatus('level 1');
  }

  // ---------- input ----------

  private bindInput(): void {
    const kb = this.input.keyboard!;
    this.keys = {
      left: kb.addKey('LEFT'),
      right: kb.addKey('RIGHT'),
      down: kb.addKey('DOWN')
    };
    kb.on('keydown-LEFT', () => this.tapMove(-1));
    kb.on('keydown-RIGHT', () => this.tapMove(1));
    kb.on('keydown-UP', () => this.rotate(1));
    kb.on('keydown-X', () => this.rotate(1));
    kb.on('keydown-Z', () => this.rotate(-1));
    kb.on('keydown-SPACE', () => this.hardDrop());
    kb.on('keydown-C', () => this.swapHold());
    kb.on('keydown-SHIFT', () => this.swapHold());
    kb.on('keydown-R', () => this.over && this.scene.restart({ ctx: this.ctx }));
    kb.on('keydown-ESC', () => this.ctx.exit());

    // Touch: left/right thirds move, top-middle rotates, bottom-middle hard drops.
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (this.over) {
        this.scene.restart({ ctx: this.ctx });
        return;
      }
      if (p.x < WELL_X) this.tapMove(-1);
      else if (p.x > WELL_X + W.COLS * CELL) this.tapMove(1);
      else if (p.y < HEIGHT / 2) this.rotate(1);
      else this.hardDrop();
    });
  }

  private tapMove(dir: -1 | 1): void {
    if (this.over) return;
    this.das = { dir, held: 0, repeat: 0 };
    this.shift(dir);
  }

  private shift(dir: number): void {
    const moved = W.tryMove(this.grid, this.piece, 0, dir);
    if (moved) {
      this.piece = moved;
      this.touchLock();
    }
  }

  private rotate(dir: 1 | -1): void {
    if (this.over) return;
    const rotated = W.tryRotate(this.grid, this.piece, dir);
    if (rotated) {
      this.piece = rotated;
      this.touchLock();
    }
  }

  private hardDrop(): void {
    if (this.over) return;
    const d = W.dropDistance(this.grid, this.piece);
    this.piece = { ...this.piece, r: this.piece.r + d };
    this.score += d * 2;
    this.lockNow();
  }

  private swapHold(): void {
    if (this.over || this.holdUsed) return;
    const current = this.piece.kind;
    if (this.hold === null) {
      this.hold = current;
      this.next();
    } else {
      const kind = this.hold;
      this.hold = current;
      this.piece = W.spawn(kind);
    }
    this.holdUsed = true;
    this.gravityAcc = 0;
    this.lockAcc = 0;
  }

  /** A successful move while resting delays the lock, up to a limit. */
  private touchLock(): void {
    if (!W.tryMove(this.grid, this.piece, 1, 0) && this.lockResets < MAX_LOCK_RESETS) {
      this.lockAcc = 0;
      this.lockResets++;
    }
  }

  // ---------- flow ----------

  private next(): void {
    const kind = this.queue.shift()!;
    this.queue.push(this.bag.next().value);
    this.piece = W.spawn(kind);
    this.holdUsed = false;
    this.gravityAcc = 0;
    this.lockAcc = 0;
    this.lockResets = 0;
    if (!W.fits(this.grid, this.piece)) this.end();
  }

  private lockNow(): void {
    const inside = W.lock(this.grid, this.piece);
    if (!inside) {
      this.end();
      return;
    }
    const cleared = W.clearLines(this.grid);
    if (cleared.length) {
      this.lines += cleared.length;
      this.score += W.lineScore(cleared.length, this.level);
      const level = W.levelFor(this.lines);
      if (level !== this.level) {
        this.level = level;
        this.ctx.setStatus(`level ${level}`);
      }
      // Rows have already collapsed; flash the rows that now occupy the top of the cleared area.
      this.flashRows = cleared;
      this.flashAcc = FLASH_MS;
    }
    this.paintHud();
    this.next();
  }

  private end(): void {
    if (this.over) return;
    this.over = true;
    finishRun(this.ctx, this.overlay, this.score, {
      title: 'Topped out',
      detail: `${this.lines} lines · level ${this.level}`,
      hint: 'R or tap to play again · Esc for the catalog'
    });
  }

  private paintHud(): void {
    this.scoreText.setText(this.score.toLocaleString());
    this.levelText.setText(String(this.level));
    this.linesText.setText(String(this.lines));
  }

  update(_t: number, delta: number): void {
    if (!this.over) this.step(delta);
    this.draw();
  }

  private step(delta: number): void {
    // Auto-repeat for held left/right.
    const held = this.keys.left.isDown ? -1 : this.keys.right.isDown ? 1 : 0;
    if (held && held === this.das.dir) {
      this.das.held += delta;
      if (this.das.held >= DAS_MS) {
        this.das.repeat += delta;
        while (this.das.repeat >= ARR_MS) {
          this.das.repeat -= ARR_MS;
          this.shift(held);
        }
      }
    } else if (held) {
      this.das = { dir: held, held: 0, repeat: 0 };
    } else {
      this.das.dir = 0;
    }

    if (this.flashAcc > 0) {
      this.flashAcc -= delta;
      if (this.flashAcc <= 0) this.flashRows = [];
      return;
    }

    const soft = this.keys.down.isDown;
    const interval = soft ? SOFT_MS : W.gravityMs(this.level);
    this.gravityAcc += delta;
    while (this.gravityAcc >= interval) {
      this.gravityAcc -= interval;
      const down = W.tryMove(this.grid, this.piece, 1, 0);
      if (down) {
        this.piece = down;
        if (soft) this.score += 1;
      } else {
        break;
      }
    }

    if (!W.tryMove(this.grid, this.piece, 1, 0)) {
      this.lockAcc += delta;
      if (this.lockAcc >= LOCK_MS) this.lockNow();
    } else {
      this.lockAcc = 0;
    }
  }

  // ---------- drawing ----------

  private cell(g: Phaser.GameObjects.Graphics, x: number, y: number, colour: number, alpha = 1): void {
    g.fillStyle(colour, alpha);
    g.fillRoundedRect(x + 1, y + 1, CELL - 2, CELL - 2, 4);
  }

  private mini(g: Phaser.GameObjects.Graphics, kind: number | null, x: number, y: number): void {
    if (kind === null) return;
    const size = 18;
    for (const [dr, dc] of W.SHAPES[kind][0]) {
      g.fillStyle(KIND_COLOURS[kind], 1);
      g.fillRoundedRect(x + dc * size + 1, y + dr * size + 1, size - 2, size - 2, 3);
    }
  }

  private draw(): void {
    const g = this.gfx;
    g.clear();

    for (let r = 0; r < W.ROWS; r++) {
      for (let c = 0; c < W.COLS; c++) {
        const v = this.grid[r][c];
        const x = WELL_X + c * CELL;
        const y = WELL_Y + r * CELL;
        if (v !== W.EMPTY) this.cell(g, x, y, KIND_COLOURS[v - 1]);
        else if ((r + c) % 2 === 0) this.cell(g, x, y, 0x111726, 0.6);
      }
    }
    for (const r of this.flashRows) {
      g.fillStyle(0xffffff, 0.85);
      g.fillRect(WELL_X, WELL_Y + r * CELL, W.COLS * CELL, CELL);
    }

    if (!this.over) {
      const ghost = W.ghost(this.grid, this.piece);
      for (const [r, c] of W.cells(ghost)) {
        if (r >= 0) this.cell(g, WELL_X + c * CELL, WELL_Y + r * CELL, KIND_COLOURS[this.piece.kind], 0.22);
      }
      for (const [r, c] of W.cells(this.piece)) {
        if (r >= 0) this.cell(g, WELL_X + c * CELL, WELL_Y + r * CELL, KIND_COLOURS[this.piece.kind]);
      }
    }

    this.mini(g, this.hold, LEFT_X, WELL_Y + 24);
    this.queue.forEach((kind, i) => this.mini(g, kind, RIGHT_X, WELL_Y + 24 + i * 70));
  }
}

