import type { GameModule } from '../../platform/types';
import { TiltGame } from './TiltGame';

const game: GameModule = {
  mount: (container, ctx) => new TiltGame(container, ctx)
};

export default game;
