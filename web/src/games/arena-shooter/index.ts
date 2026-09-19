import type { GameModule } from '../../platform/types';
import { mountPhaser } from '../_shared/phaser';
import { ArenaScene, HEIGHT, WIDTH } from './ArenaScene';

const game: GameModule = {
  mount: (container, ctx) =>
    mountPhaser(container, ctx, 'arena', ArenaScene, {
      width: WIDTH,
      height: HEIGHT,
      physics: { default: 'arcade', arcade: { debug: false } }
    })
};

export default game;
