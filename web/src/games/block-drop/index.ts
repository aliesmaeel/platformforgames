import type { GameModule } from '../../platform/types';
import { mountPhaser } from '../_shared/phaser';
import { HEIGHT, StackScene, WIDTH } from './StackScene';

const game: GameModule = {
  mount: (container, ctx) => mountPhaser(container, ctx, 'stack', StackScene, { width: WIDTH, height: HEIGHT })
};

export default game;
