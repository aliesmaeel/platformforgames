import Phaser from 'phaser';
import type { GameContext, GameHandle, GameModule } from '../../platform/types';
import { HEIGHT, RunScene, WIDTH } from './RunScene';

const game: GameModule = {
  mount(container: HTMLElement, ctx: GameContext): GameHandle {
    const instance = new Phaser.Game({
      type: Phaser.AUTO,
      parent: container,
      width: WIDTH,
      height: HEIGHT,
      backgroundColor: '#070910',
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH
      },
      physics: {
        default: 'arcade',
        arcade: { debug: false }
      },
      input: { keyboard: true, touch: true },
      scene: []
    });

    instance.scene.add('run', RunScene, true, { ctx });

    return {
      destroy() {
        instance.destroy(true);
      }
    };
  }
};

export default game;
