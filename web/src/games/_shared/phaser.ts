import Phaser from 'phaser';
import type { GameContext, GameHandle } from '../../platform/types';

/** Shared plumbing for the Phaser-based games: boot, teardown, overlay, run end. */

export const MONO = 'ui-monospace, monospace';
export const SANS = 'system-ui, sans-serif';
export const COLOURS = {
  bg: 0x070910,
  panel: 0x0b0d12,
  raised: 0x0d1220,
  line: 0x232838,
  text: '#e8ecf5',
  dim: '#99a2b8',
  faint: '#5c6684',
  accent: '#4cc9f0',
  danger: '#f72585'
};

interface MountOptions {
  width: number;
  height: number;
  physics?: Phaser.Types.Core.PhysicsConfig;
  data?: Record<string, unknown>;
}

export function mountPhaser(
  container: HTMLElement,
  ctx: GameContext,
  key: string,
  SceneClass: typeof Phaser.Scene,
  opts: MountOptions
): GameHandle {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: container,
    width: opts.width,
    height: opts.height,
    backgroundColor: '#070910',
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    physics: opts.physics,
    input: { keyboard: true, touch: true },
    scene: []
  });
  game.scene.add(key, SceneClass, true, { ctx, ...opts.data });
  // Test hook: lets the e2e suite read scene state. Stripped from production builds.
  if (import.meta.env.DEV) Object.assign(window, { __pfg: game });
  return {
    destroy() {
      game.destroy(true);
    }
  };
}

export interface OverlaySpec {
  title: string;
  big?: string;
  detail: string;
  hint: string;
  x?: number;
  y?: number;
  width?: number;
}

/** Centered result panel; call show() again to update its text. */
export class Overlay {
  private node?: Phaser.GameObjects.Container;
  constructor(private scene: Phaser.Scene) {}

  show(spec: OverlaySpec): void {
    this.hide();
    const s = this.scene;
    const w = spec.width ?? 420;
    const panel = s.add.rectangle(0, 0, w, 200, COLOURS.panel, 0.94).setStrokeStyle(1, COLOURS.line);
    const title = s.add.text(0, -58, spec.title, { fontFamily: SANS, fontSize: '28px', color: COLOURS.text }).setOrigin(0.5);
    const big = s.add.text(0, -12, spec.big ?? '', { fontFamily: MONO, fontSize: '44px', color: COLOURS.accent }).setOrigin(0.5);
    const detail = s.add.text(0, 34, spec.detail, { fontFamily: MONO, fontSize: '14px', color: COLOURS.dim }).setOrigin(0.5);
    const hint = s.add.text(0, 66, spec.hint, { fontFamily: MONO, fontSize: '13px', color: COLOURS.faint }).setOrigin(0.5);
    this.node = s.add
      .container(spec.x ?? s.scale.width / 2, spec.y ?? s.scale.height / 2, [panel, title, big, detail, hint])
      .setDepth(50);
  }

  hide(): void {
    this.node?.destroy();
    this.node = undefined;
  }

  get visible(): boolean {
    return Boolean(this.node);
  }
}

/** Submit a finished run and keep the overlay's detail line in sync with the result. */
export function finishRun(
  ctx: GameContext,
  overlay: Overlay,
  score: number,
  spec: Omit<OverlaySpec, 'big'>
): void {
  overlay.show({ ...spec, big: score.toLocaleString(), detail: `${spec.detail} · submitting…` });
  void ctx.submitScore(score).then((result) => {
    if (!result) return;
    ctx.setStatus(`best ${result.best}${result.offline ? ' (offline)' : ''}`);
    overlay.show({ ...spec, big: score.toLocaleString(), detail: `rank #${result.rank} · best ${result.best}` });
  });
}

export const label = (scene: Phaser.Scene, x: number, y: number, text: string, size = 12, colour = COLOURS.faint) =>
  scene.add.text(x, y, text, { fontFamily: MONO, fontSize: `${size}px`, color: colour });
