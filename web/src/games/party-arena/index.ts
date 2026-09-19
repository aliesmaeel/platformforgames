import type { GameModule } from '../../platform/types';
import { KnockGame } from './KnockGame';

const game: GameModule = {
  mount: (container, ctx) => new KnockGame(container, ctx)
};

export default game;
