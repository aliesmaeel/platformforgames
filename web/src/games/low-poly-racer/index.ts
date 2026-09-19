import type { GameModule } from '../../platform/types';
import { RaceGame } from './RaceGame';

const game: GameModule = {
  mount: (container, ctx) => new RaceGame(container, ctx)
};

export default game;
