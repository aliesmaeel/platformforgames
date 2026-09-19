import { CATALOG, findGame } from './registry';
import { getPlayer, setPlayer } from './player';
import { submitScore, topScores } from './scores';
import type { GameHandle, GameMeta } from './types';

/**
 * The shell owns navigation, the player identity, and the leaderboard panel.
 * Games only ever see the container they are mounted into.
 */

type Mounted = { handle: GameHandle; meta: GameMeta } | null;

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

export function startShell(root: HTMLElement): void {
  let mounted: Mounted = null;

  const header = buildHeader();
  const main = el('main', 'view');
  root.replaceChildren(header.node, main);

  const route = async () => {
    await unmount();
    const hash = location.hash.replace(/^#/, '');
    const play = hash.match(/^\/play\/([a-z0-9-]+)$/);
    const meta = play ? findGame(play[1]) : undefined;
    if (meta?.load) {
      await renderPlay(meta);
    } else {
      renderCatalog();
    }
  };

  async function unmount(): Promise<void> {
    if (!mounted) return;
    const { handle } = mounted;
    mounted = null;
    try {
      await handle.destroy();
    } catch (err) {
      console.error('[pfg] game failed to clean up', err);
    }
  }

  function renderCatalog(): void {
    header.setSubtitle(`${CATALOG.filter((g) => g.load).length} playable · ${CATALOG.length} planned`);

    const intro = el('section', 'intro');
    intro.append(
      el('h2', undefined, 'Pick something to play'),
      el(
        'p',
        undefined,
        'Every game here plugs into the same shell: one contract, one leaderboard, one player name.'
      )
    );

    const grid = el('div', 'grid');
    for (const meta of CATALOG) grid.append(card(meta));

    main.replaceChildren(intro, grid);
  }

  function card(meta: GameMeta): HTMLElement {
    const playable = Boolean(meta.load);
    const node = el('article', `card${playable ? '' : ' card--soon'}`);
    node.style.setProperty('--accent', meta.accent);

    const badges = el('div', 'badges');
    badges.append(
      el('span', 'badge', meta.dimension),
      el('span', 'badge', meta.mood),
      el('span', 'badge badge--effort', '●'.repeat(meta.effort) + '○'.repeat(5 - meta.effort))
    );

    node.append(
      el('h3', 'card__title', meta.title),
      el('p', 'card__blurb', meta.blurb),
      badges
    );

    if (playable) {
      const link = el('a', 'button');
      link.href = `#/play/${meta.id}`;
      link.textContent = 'Play';
      node.append(link);
    } else {
      node.append(el('span', 'card__soon', 'in the works'));
    }
    return node;
  }

  async function renderPlay(meta: GameMeta): Promise<void> {
    header.setSubtitle(`${meta.title} · ${meta.dimension}`);

    const back = el('a', 'button button--ghost', '← All games');
    back.href = '#/';

    const status = el('span', 'status', 'loading…');
    const bar = el('div', 'playbar');
    bar.append(back, el('h2', 'playbar__title', meta.title), status);

    const stage = el('div', 'stage');
    stage.style.setProperty('--accent', meta.accent);

    const boardBody = el('div', 'board__body');
    const board = el('aside', 'board');
    board.append(el('h3', 'board__title', 'Leaderboard'), boardBody);

    const layout = el('div', 'play');
    layout.append(stage, board);
    main.replaceChildren(bar, layout);

    const refreshBoard = async () => {
      boardBody.replaceChildren(el('p', 'muted', 'loading…'));
      const { scores, offline } = await topScores(meta.id);
      boardBody.replaceChildren(renderBoard(scores, offline, getPlayer(), meta.formatScore));
    };
    void refreshBoard();

    try {
      const mod = await meta.load!();
      let statusSet = false;
      const handle = await mod.default.mount(stage, {
        player: getPlayer(),
        setStatus: (text) => {
          statusSet = true;
          status.textContent = text;
        },
        exit: () => {
          location.hash = '#/';
        },
        submitScore: async (score) => {
          const result = await submitScore(meta.id, getPlayer(), score);
          await refreshBoard();
          return result;
        }
      });
      mounted = { handle, meta };
      if (!statusSet) status.textContent = 'good luck';
    } catch (err) {
      console.error('[pfg] failed to load game', err);
      status.textContent = 'failed to load';
      stage.replaceChildren(el('p', 'muted', 'This game could not be loaded. Check the console for details.'));
    }
  }

  function renderBoard(
    scores: { rank: number; player: string; score: number }[],
    offline: boolean,
    me: string,
    format: (score: number) => string = (n) => n.toLocaleString()
  ): HTMLElement {
    const wrap = el('div');
    if (scores.length === 0) {
      wrap.append(el('p', 'muted', 'No scores yet. Be the first.'));
    } else {
      const list = el('ol', 'board__list');
      for (const row of scores) {
        const item = el('li', row.player === me ? 'board__row board__row--me' : 'board__row');
        item.append(
          el('span', 'board__rank', String(row.rank)),
          el('span', 'board__player', row.player),
          el('span', 'board__score', format(row.score))
        );
        list.append(item);
      }
      wrap.append(list);
    }
    if (offline) wrap.append(el('p', 'muted', 'Score service offline — showing this browser only.'));
    return wrap;
  }

  function buildHeader() {
    const title = el('h1', 'brand', 'Arcade');
    const subtitle = el('p', 'brand__sub', '');

    const nameButton = el('button', 'namechip');
    const paint = () => {
      nameButton.textContent = `playing as ${getPlayer()}`;
    };
    nameButton.addEventListener('click', () => {
      const next = prompt('Player name', getPlayer());
      if (next !== null) {
        setPlayer(next);
        paint();
        void route();
      }
    });
    paint();

    const brand = el('a', 'brand__link');
    brand.href = '#/';
    brand.append(title, subtitle);

    const node = el('header', 'topbar');
    node.append(brand, nameButton);
    return { node, setSubtitle: (text: string) => (subtitle.textContent = text) };
  }

  window.addEventListener('hashchange', () => void route());
  window.addEventListener('pagehide', () => void unmount());
  void route();
}
