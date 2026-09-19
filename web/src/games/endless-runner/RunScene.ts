import Phaser from 'phaser';
import type { GameContext } from '../../platform/types';

export const WIDTH = 960;
export const HEIGHT = 540;

const GROUND_Y = 470;
const PLAYER_X = 190;
const STAND_H = 54;
const SLIDE_H = 26;
const PLAYER_W = 34;

const GRAVITY = 2400;
const JUMP_V = -880;
const START_SPEED = 380;
const MAX_SPEED = 920;
const ACCEL = 9; // px/s of speed gained per second survived
const COYOTE_MS = 90;
const BUFFER_MS = 120;

type Obstacle = Phaser.GameObjects.Rectangle & { body: Phaser.Physics.Arcade.Body };

export class RunScene extends Phaser.Scene {
  private ctx!: GameContext;

  private player!: Phaser.GameObjects.Rectangle & { body: Phaser.Physics.Arcade.Body };
  private obstacles!: Phaser.Physics.Arcade.Group;
  private hills: Phaser.GameObjects.Rectangle[] = [];
  private specks: Phaser.GameObjects.Rectangle[] = [];

  private speed = START_SPEED;
  private distance = 0;
  private untilSpawn = 520;
  private sliding = false;
  private dead = false;
  private submitted = false;
  private lastGrounded = 0;
  private jumpQueuedAt = -Infinity;

  private scoreText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private overlay?: Phaser.GameObjects.Container;

  constructor() {
    super('run');
  }

  init(data: { ctx: GameContext }): void {
    this.ctx = data.ctx;
  }

  create(): void {
    this.hills = [];
    this.specks = [];
    this.overlay = undefined;
    this.lastGrounded = 0;
    this.cameras.main.setBackgroundColor('#070910');

    for (let i = 0; i < 7; i++) {
      const hill = this.add
        .rectangle(i * 160, GROUND_Y, 150, 60 + Math.random() * 120, 0x161d2e)
        .setOrigin(0, 1);
      this.hills.push(hill);
    }
    for (let i = 0; i < 40; i++) {
      this.specks.push(
        this.add.rectangle(Math.random() * WIDTH, Math.random() * (GROUND_Y - 60), 2, 2, 0x2a3350)
      );
    }

    this.add.rectangle(0, GROUND_Y, WIDTH, 4, 0x4cc9f0).setOrigin(0, 0);
    this.add.rectangle(0, GROUND_Y + 4, WIDTH, HEIGHT - GROUND_Y, 0x0d1220).setOrigin(0, 0);

    const floor = this.add.rectangle(0, GROUND_Y, WIDTH, 40, 0x000000, 0).setOrigin(0, 0);
    this.physics.add.existing(floor, true);

    this.player = this.add.rectangle(
      PLAYER_X,
      GROUND_Y - STAND_H / 2,
      PLAYER_W,
      STAND_H,
      0xe8ecf5
    ) as typeof this.player;
    this.physics.add.existing(this.player);
    this.player.body.setCollideWorldBounds(false);

    this.obstacles = this.physics.add.group({ allowGravity: false, immovable: true });

    this.physics.add.collider(this.player, floor);
    this.physics.add.overlap(this.player, this.obstacles, () => this.die());

    this.scoreText = this.add
      .text(24, 20, '0', { fontFamily: 'ui-monospace, monospace', fontSize: '34px', color: '#e8ecf5' })
      .setDepth(5);
    this.hintText = this.add
      .text(24, 62, 'space / tap to jump · down to slide', {
        fontFamily: 'ui-monospace, monospace',
        fontSize: '14px',
        color: '#5c6684'
      })
      .setDepth(5);

    this.bindInput();
    this.physics.world.gravity.y = GRAVITY;
  }

  private bindInput(): void {
    const kb = this.input.keyboard;
    if (kb) {
      kb.on('keydown-SPACE', () => this.queueJump());
      kb.on('keydown-UP', () => this.queueJump());
      kb.on('keydown-W', () => this.queueJump());
      kb.on('keydown-DOWN', () => this.setSlide(true));
      kb.on('keydown-S', () => this.setSlide(true));
      kb.on('keyup-DOWN', () => this.setSlide(false));
      kb.on('keyup-S', () => this.setSlide(false));
      kb.on('keydown-R', () => this.restart());
      kb.on('keydown-ESC', () => this.ctx.exit());
    }

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (this.dead) {
        this.restart();
      } else if (pointer.y > HEIGHT * 0.6) {
        this.setSlide(true);
      } else {
        this.queueJump();
      }
    });
    this.input.on('pointerup', () => this.setSlide(false));
  }

  private queueJump(): void {
    if (this.dead) {
      this.restart();
      return;
    }
    this.jumpQueuedAt = this.time.now;
  }

  private setSlide(on: boolean): void {
    if (this.dead || on === this.sliding) return;
    this.sliding = on;
    const height = on ? SLIDE_H : STAND_H;
    this.player.setSize(PLAYER_W, height);
    this.player.body.setSize(PLAYER_W, height, true);
    this.player.y = Math.min(this.player.y, GROUND_Y - height / 2);
    if (on) this.player.body.setVelocityY(Math.max(this.player.body.velocity.y, 400));
  }

  private spawn(): void {
    // Beams need a slide, crates need a jump; pick one and leave a fair gap.
    const beam = Math.random() < 0.35;
    let rect: Obstacle;

    if (beam) {
      // Hangs from above with a slide-height gap; tall enough that a jump cannot clear it.
      rect = this.add
        .rectangle(WIDTH + 60, GROUND_Y - SLIDE_H - 12, 64, 240, 0xf72585)
        .setOrigin(0, 1) as Obstacle;
    } else {
      const height = 38 + Math.floor(Math.random() * 46);
      rect = this.add
        .rectangle(WIDTH + 60, GROUND_Y, 30 + Math.floor(Math.random() * 30), height, 0xff9f1c)
        .setOrigin(0, 1) as Obstacle;
    }

    this.obstacles.add(rect);
    rect.body.setAllowGravity(false);
    rect.body.setImmovable(true);
    rect.body.setVelocityX(-this.speed);

    const airtime = (2 * Math.abs(JUMP_V)) / GRAVITY; // seconds to clear a jump
    const minGap = this.speed * airtime * 0.95;
    this.untilSpawn = minGap + Math.random() * 260;
  }

  update(_time: number, delta: number): void {
    if (this.dead) return;
    const dt = delta / 1000;

    this.speed = Math.min(MAX_SPEED, this.speed + ACCEL * dt);
    this.distance += this.speed * dt;
    this.scoreText.setText(String(Math.floor(this.distance / 10)));

    if (this.distance > 400) this.hintText.setAlpha(Math.max(0, 1 - (this.distance - 400) / 600));

    const shift = this.speed * dt;
    for (const hill of this.hills) {
      hill.x -= shift * 0.25;
      if (hill.x + hill.width < 0) {
        hill.x += this.hills.length * 160;
        hill.height = 60 + Math.random() * 120;
      }
    }
    for (const speck of this.specks) {
      speck.x -= shift * 0.1;
      if (speck.x < 0) {
        speck.x += WIDTH;
        speck.y = Math.random() * (GROUND_Y - 60);
      }
    }

    const body = this.player.body;
    if (body.blocked.down || body.touching.down) this.lastGrounded = this.time.now;

    const canJump = this.time.now - this.lastGrounded <= COYOTE_MS;
    const wantsJump = this.time.now - this.jumpQueuedAt <= BUFFER_MS;
    if (canJump && wantsJump) {
      this.jumpQueuedAt = -Infinity;
      this.lastGrounded = -Infinity;
      if (this.sliding) this.setSlide(false);
      body.setVelocityY(JUMP_V);
    }

    this.untilSpawn -= shift;
    if (this.untilSpawn <= 0) this.spawn();

    for (const child of this.obstacles.getChildren() as Obstacle[]) {
      child.body.setVelocityX(-this.speed);
      if (child.x + child.width < -40) child.destroy();
    }

    if (this.player.y > HEIGHT + 100) this.die();
  }

  private die(): void {
    if (this.dead) return;
    this.dead = true;
    this.player.fillColor = 0xf72585;
    this.physics.pause();
    this.cameras.main.shake(180, 0.008);

    const score = Math.floor(this.distance / 10);
    this.showOverlay(score, 'submitting…');

    if (!this.submitted) {
      this.submitted = true;
      void this.ctx.submitScore(score).then((result) => {
        if (!result) return;
        this.ctx.setStatus(`best ${result.best}${result.offline ? ' (offline)' : ''}`);
        this.showOverlay(score, `rank #${result.rank} · best ${result.best}`);
      });
    }
  }

  private showOverlay(score: number, line: string): void {
    this.overlay?.destroy();
    const panel = this.add.rectangle(0, 0, 420, 190, 0x0b0d12, 0.92).setStrokeStyle(1, 0x232838);
    const title = this.add
      .text(0, -52, 'Wiped out', { fontFamily: 'system-ui, sans-serif', fontSize: '28px', color: '#e8ecf5' })
      .setOrigin(0.5);
    const scoreLabel = this.add
      .text(0, -8, `${score}`, {
        fontFamily: 'ui-monospace, monospace',
        fontSize: '44px',
        color: '#4cc9f0'
      })
      .setOrigin(0.5);
    const detail = this.add
      .text(0, 36, line, { fontFamily: 'ui-monospace, monospace', fontSize: '14px', color: '#99a2b8' })
      .setOrigin(0.5);
    const hint = this.add
      .text(0, 66, 'R or tap to run again · Esc for the catalog', {
        fontFamily: 'ui-monospace, monospace',
        fontSize: '13px',
        color: '#5c6684'
      })
      .setOrigin(0.5);

    this.overlay = this.add
      .container(WIDTH / 2, HEIGHT / 2, [panel, title, scoreLabel, detail, hint])
      .setDepth(20);
  }

  private restart(): void {
    if (!this.dead) return;
    this.speed = START_SPEED;
    this.distance = 0;
    this.untilSpawn = 520;
    this.sliding = false;
    this.dead = false;
    this.submitted = false;
    this.jumpQueuedAt = -Infinity;
    this.physics.resume();
    this.scene.restart({ ctx: this.ctx });
  }
}
