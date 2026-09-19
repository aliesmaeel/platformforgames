import type { GameModule } from '../../platform/types';
import { ShootGame } from './ShootGame';

const game: GameModule = {
  mount: (container, ctx) => new ShootGame(container, ctx)
};

export default game;
