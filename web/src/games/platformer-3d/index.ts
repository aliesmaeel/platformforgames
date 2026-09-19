import type { GameModule } from '../../platform/types';
import { LeapGame } from './LeapGame';

const game: GameModule = {
  mount: (container, ctx) => new LeapGame(container, ctx)
};

export default game;
