import type { GameModule } from '../../platform/types';
import { StackGame } from './StackGame';

const game: GameModule = {
  mount: (container, ctx) => new StackGame(container, ctx)
};

export default game;
