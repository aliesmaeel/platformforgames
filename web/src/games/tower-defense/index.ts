import type { GameModule } from '../../platform/types';
import { mountPhaser } from '../_shared/phaser';
import { DefenseScene, HEIGHT, WIDTH } from './DefenseScene';

const game: GameModule = {
  mount: (container, ctx) => mountPhaser(container, ctx, 'defense', DefenseScene, { width: WIDTH, height: HEIGHT })
};

export default game;
