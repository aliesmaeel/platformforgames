import type { GameModule } from '../../platform/types';
import { mountPhaser } from '../_shared/phaser';
import { HEIGHT, MatchScene, WIDTH } from './MatchScene';

const game: GameModule = {
  mount: (container, ctx) =>
    mountPhaser(container, ctx, 'match', MatchScene, { width: WIDTH, height: HEIGHT })
};

export default game;
