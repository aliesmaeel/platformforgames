import type { GameModule } from '../../platform/types';
import { mountPhaser } from '../_shared/phaser';
import { HEIGHT, RunScene, WIDTH } from './RunScene';

const game: GameModule = {
  mount: (container, ctx) =>
    mountPhaser(container, ctx, 'run', RunScene, { width: WIDTH, height: HEIGHT, physics: { default: 'arcade', arcade: { debug: false } } })
};

export default game;
