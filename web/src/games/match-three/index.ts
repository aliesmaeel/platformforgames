import Phaser from 'phaser';
import type { GameContext, GameHandle, GameModule } from '../../platform/types';
import { HEIGHT, MatchScene, WIDTH } from './MatchScene';

const game: GameModule = {
  mount(container: HTMLElement, ctx: GameContext): GameHandle {
    const instance = new Phaser.Game({
      type: Phaser.AUTO,
      parent: container,
      width: WIDTH,
      height: HEIGHT,
      backgroundColor: '#070910',
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
      input: { keyboard: true, touch: true },
      scene: []
    });

    instance.scene.add('match', MatchScene, true, { ctx });
    if (import.meta.env.DEV) Object.assign(window, { __match: instance });

    return {
      destroy() {
        instance.destroy(true);
      }
    };
  }
};

export default game;
