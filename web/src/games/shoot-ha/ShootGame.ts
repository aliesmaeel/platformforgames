import type { GameContext, GameHandle } from '../../platform/types';
import { blip, unlockAudio } from '../_shared/audio';
import { wsUrl } from '../../platform/endpoints';
import * as R from './rules.ts';

/**
 * Shoot-ha: flick-football on a canvas. Rules live in rules.ts; this file is
 * the pitch, the discs, the drag-to-flick input and the DOM chrome around it.
 */

const TEAM = [
  { base: '#2f6fe4', dark: '#12378c', light: '#9cc0ff' },
  { base: '#e0313f', dark: '#86111c', light: '#ffa3aa' }
];

const CSS = `
.sh{position:absolute;inset:0;display:flex;flex-direction:column;background:#0a2a10;font-family:system-ui,sans-serif;color:#eef8ea;container-type:size}
.sh__hud{display:grid;grid-template-columns:1fr auto 1fr;gap:8px;padding:6px 8px 4px;align-items:stretch}
.sh__player{display:flex;align-items:center;gap:8px;padding:4px 18px 4px 10px;background:#0e3616;color:#f2fbef;min-width:0;opacity:.7;border-bottom:3px solid transparent;clip-path:polygon(0 0,100% 0,calc(100% - 14px) 100%,0 100%)}
.sh__player.p1{flex-direction:row-reverse;padding:4px 10px 4px 18px;clip-path:polygon(0 0,100% 0,100% 100%,14px 100%)}
.sh__player.active{opacity:1;border-bottom-color:#ffd23f}
.sh__chip{width:20px;height:20px;border-radius:50%;flex:none;box-shadow:inset 0 -3px 0 rgba(0,0,0,.3),0 0 0 2px rgba(255,255,255,.8)}
.p0 .sh__chip{background:#2f6fe4}.p1 .sh__chip{background:#e0313f}
.sh__name{font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;min-width:0}
.p1 .sh__name{text-align:right}
.sh__clock{font-family:ui-monospace,monospace;font-weight:700;font-size:20px;font-variant-numeric:tabular-nums}
.sh__clock.low{color:#ff6b75}
.sh__score{display:flex;align-items:center;background:#050d06;border:2px solid #1f5a2a;border-radius:6px;padding:2px 6px;font-family:ui-monospace,monospace;font-weight:800;font-size:26px;color:#c8ff3d}
.sh__score span{width:30px;text-align:center}.sh__score i{width:2px;height:22px;background:#1f5a2a}
.sh__wrap{flex:1;min-height:0;display:grid;place-items:center;padding:0 6px 6px;position:relative}
.sh canvas{display:block;touch-action:none;border-radius:8px}
.sh__banner{position:absolute;inset:0;display:grid;place-content:center;text-align:center;pointer-events:none;opacity:0;transform:scale(.9);transition:opacity .2s,transform .25s}
.sh__banner.show{opacity:1;transform:scale(1)}
.sh__banner h2{margin:0;font-weight:800;font-size:clamp(34px,7vw,72px);color:#fff;line-height:.95;text-shadow:0 4px 0 rgba(0,0,0,.35),0 0 30px rgba(0,0,0,.35)}
.sh__banner p{margin:6px 0 0;color:#fff;font-weight:500;text-shadow:0 2px 6px rgba(0,0,0,.6)}
.sh__overlay{position:absolute;inset:0;display:grid;place-items:center;padding:12px;background:rgba(3,18,7,.78)}
.sh__overlay[hidden]{display:none}
.sh__card{max-width:440px;width:100%;text-align:center;max-height:100%;overflow:auto}
.sh__card h1{margin:0;font-weight:800;font-size:clamp(28px,5vw,48px);line-height:.9;color:#fff}
.sh__card h1 small{display:block;font-weight:700;font-size:.36em;color:#ffd23f;margin-top:4px}
.sh__card ul{text-align:left;margin:10px auto;padding-left:18px;font-size:12px;line-height:1.45;color:#cfe3ca;max-width:56ch}
@container (max-height:430px){.sh__card ul{display:none}.sh__card h1{font-size:28px}}
.sh__card p{margin:8px 0 12px;color:#cfe3ca}
.sh__btns{display:flex;gap:10px;justify-content:center;flex-wrap:wrap}
.sh__btns button{font:inherit;font-weight:700;font-size:13px;border:0;border-radius:999px;padding:8px 16px;cursor:pointer;background:#ffd23f;color:#1b1500;box-shadow:0 3px 0 #a88400}
.sh__btns button.alt{background:#e8f3e5;color:#0e3616;box-shadow:0 3px 0 #97ad93}
.sh__btns button:active{transform:translateY(2px);box-shadow:none}
.sh__btns input{font:inherit;font-family:ui-monospace,monospace;font-weight:700;font-size:15px;width:88px;text-align:center;text-transform:uppercase;letter-spacing:.15em;border:2px solid #1f5a2a;border-radius:999px;background:#050d06;color:#c8ff3d;padding:6px 10px}
.sh__online{margin:12px 0 6px!important;font-size:12px;color:#9bb898!important}
.sh__net{min-height:1.2em;font-family:ui-monospace,monospace;font-size:12px;color:#ffd23f!important;margin:8px 0 0!important}
.sh__net .code{font-size:26px;letter-spacing:.2em;color:#c8ff3d;display:block;margin-top:2px}
`;

let cssInjected = false;

interface Aim {
  d: R.Body;
  px: number;
  py: number;
}

export class ShootGame implements GameHandle {
  private root: HTMLDivElement;
  private cv: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private el: Record<string, HTMLElement> = {};
  private observer: ResizeObserver;
  private raf = 0;
  private t0 = performance.now();
  private scale = 1;
  private dpr = 1;
  private bannerTimer = 0;
  private hudCache = '';
  private aim: Aim | null = null;
  private aiTimer = 0;
  private trail: { x: number; y: number }[] = [];
  private cleanups: (() => void)[] = [];

  match: R.Match | null = null;
  names = ['You', 'Computer'];
  submitted = false;
  ws: WebSocket | null = null;
  side = 0;
  code: string | null = null;
  private pendingRematch = false;

  constructor(private container: HTMLElement, private ctx: GameContext) {
    if (!cssInjected) {
      const style = document.createElement('style');
      style.textContent = CSS;
      document.head.append(style);
      cssInjected = true;
    }
    container.style.position = 'relative';
    this.root = document.createElement('div');
    this.root.className = 'sh';
    this.root.innerHTML = `
      <header class="sh__hud">
        <div class="sh__player p0" data-el="pl0"><span class="sh__chip"></span><span class="sh__name" data-el="n0">You</span><span class="sh__clock" data-el="c0">3:00</span></div>
        <div class="sh__score"><span data-el="s0">0</span><i></i><span data-el="s1">0</span></div>
        <div class="sh__player p1" data-el="pl1"><span class="sh__chip"></span><span class="sh__name" data-el="n1">Computer</span><span class="sh__clock" data-el="c1">3:00</span></div>
      </header>
      <div class="sh__wrap" data-el="wrap">
        <canvas data-el="cv"></canvas>
        <div class="sh__banner" data-el="banner"><h2 data-el="bt"></h2><p data-el="bs"></p></div>
        <div class="sh__overlay" data-el="menu">
          <div class="sh__card">
            <h1>Shoot-ha<small>شوتها</small></h1>
            <ul>
              <li>Drag back from one of your discs and let go to flick it.</li>
              <li>Each player gets 3 minutes. Your clock only runs on your turn.</li>
              <li>First to 2 goals wins. If your clock hits zero, you lose, whatever the score.</li>
              <li>A goal scored straight from kick-off doesn't count.</li>
              <li>Discs that end up inside a goal get moved back out.</li>
              <li>Matches against the computer count for the leaderboard.</li>
            </ul>
            <div class="sh__btns"><button data-el="bAI">Play the computer</button><button class="alt" data-el="bPVP">Two players, one device</button></div>
            <p class="sh__online">Or play a friend on another computer</p>
            <div class="sh__btns"><button class="alt" data-el="bHost">Host a match</button><input data-el="code" placeholder="CODE" maxlength="4" autocapitalize="characters" /><button class="alt" data-el="bJoin">Join</button></div>
            <p class="sh__net" data-el="net"></p>
          </div>
        </div>
        <div class="sh__overlay" data-el="over" hidden>
          <div class="sh__card"><h1 data-el="ot">Blue wins</h1><p data-el="os"></p>
            <div class="sh__btns"><button data-el="bAgain">Play again</button><button class="alt" data-el="bMenu">Change mode</button></div>
          </div>
        </div>
      </div>`;
    container.append(this.root);
    this.root.querySelectorAll<HTMLElement>('[data-el]').forEach((n) => (this.el[n.dataset.el!] = n));
    this.cv = this.el.cv as HTMLCanvasElement;
    this.g = this.cv.getContext('2d')!;

    this.el.bAI.onclick = () => this.startMatch('ai');
    this.el.bPVP.onclick = () => this.startMatch('pvp');
    this.el.bAgain.onclick = () => this.match && this.startMatch(this.match.mode);
    void this.pendingRematch;
    this.el.bMenu.onclick = () => this.toMenu();
    this.el.bHost.onclick = () => this.host();
    this.el.bJoin.onclick = () => this.join((this.el.code as HTMLInputElement).value);
    (this.el.code as HTMLInputElement).onkeydown = (e) => {
      if (e.key === 'Enter') this.join((this.el.code as HTMLInputElement).value);
      e.stopPropagation();
    };

    this.bindInput();
    this.observer = new ResizeObserver(() => this.fit());
    this.observer.observe(this.el.wrap);
    this.fit();
    this.ctx.setStatus('pick a mode');
    this.raf = requestAnimationFrame((t) => {
      this.t0 = t;
      this.loop(t);
    });
    if (import.meta.env.DEV) Object.assign(window, { __pfg: this });
  }

  // ---------- match ----------

  startMatch(mode: R.Mode, first = Math.random() < 0.5 ? 0 : 1): void {
    unlockAudio();
    if (mode === 'online') {
      if (this.match?.state === 'over') {
        // Rematch: both sides must ask; the server restarts us with a fresh kick-off.
        this.pendingRematch = true;
        this.send({ kind: 'rematch' });
        this.el.over.hidden = true;
        this.banner('Waiting for your opponent', '', 60000);
        return;
      }
    } else {
      this.names = mode === 'ai' ? [this.ctx.player, 'Computer'] : ['Blue', 'Red'];
      this.closeSocket();
    }
    this.el.n0.textContent = this.names[0];
    this.el.n1.textContent = this.names[1];
    this.match = new R.Match(mode, mode === 'online' ? this.side : 0);
    this.submitted = false;
    this.pendingRematch = false;
    this.aim = null;
    this.trail = [];
    this.el.menu.hidden = true;
    this.el.over.hidden = true;
    this.ctx.setStatus(mode === 'ai' ? 'vs computer' : mode === 'pvp' ? 'two players' : `online · you are ${this.side === 0 ? 'blue' : 'red'}`);
    this.banner('Coin toss', '', 1000, () => {
      const who =
        mode === 'ai' ? (first === 0 ? 'You kick off' : 'Computer kicks off')
        : mode === 'online' ? (first === this.side ? 'You kick off' : `${this.names[first]} kicks off`)
        : `${this.names[first]} kicks off`;
      this.banner(who, '', 1200, () => this.handle(this.match!.begin(first)));
    });
  }

  private toMenu(): void {
    this.closeSocket();
    this.el.over.hidden = true;
    this.el.menu.hidden = false;
    this.el.banner.classList.remove('show');
    clearTimeout(this.bannerTimer);
    this.match = null;
    this.ctx.setStatus('pick a mode');
  }

  // ---------- online ----------

  private net(text: string, code?: string): void {
    this.el.net.textContent = text;
    if (code) {
      const c = document.createElement('span');
      c.className = 'code';
      c.textContent = code;
      this.el.net.append(c);
    }
  }

  private connect(onOpen: () => void): void {
    this.closeSocket();
    const ws = new WebSocket(wsUrl('/ws/shoot-ha'));
    this.ws = ws;
    ws.onopen = onOpen;
    ws.onmessage = (ev) => this.onNet(JSON.parse(String(ev.data)));
    ws.onerror = () =>
      this.net(`Could not reach the match server at ${new URL(ws.url).host}. It needs the score service running (npm run dev), and both players must open the same site address.`);
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.match?.mode === 'online' && this.match.state !== 'over') this.opponentLeft('Connection lost');
    };
  }

  private closeSocket(): void {
    const ws = this.ws;
    this.ws = null;
    this.code = null;
    ws?.close();
  }

  host(): void {
    unlockAudio();
    this.net('Connecting…');
    this.connect(() => this.ws?.send(JSON.stringify({ type: 'host', name: this.ctx.player })));
  }

  join(code: string): void {
    unlockAudio();
    const clean = code.trim().toUpperCase();
    if (clean.length !== 4) {
      this.net('Enter the 4-letter code your friend sees');
      return;
    }
    this.net('Joining…');
    this.connect(() => this.ws?.send(JSON.stringify({ type: 'join', code: clean, name: this.ctx.player })));
  }

  private send(payload: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'relay', payload }));
  }

  private onNet(msg: { type: string } & Record<string, unknown>): void {
    if (msg.type === 'hosted') {
      this.code = msg.code as string;
      this.net('Share this code, then wait here:', this.code);
    } else if (msg.type === 'error') {
      this.net(msg.message as string);
      this.closeSocket();
    } else if (msg.type === 'start') {
      this.side = msg.side as number;
      this.names = msg.names as string[];
      this.el.banner.classList.remove('show');
      clearTimeout(this.bannerTimer);
      this.match = null; // so startMatch treats this as a fresh match, not a rematch request
      this.startMatch('online', msg.first as number);
    } else if (msg.type === 'relay') {
      const p = msg.payload as Record<string, unknown>;
      const m = this.match;
      if (!m) return;
      if (p.kind === 'shot') {
        m.adopt(p.snap as R.Snapshot);
        const disc = m.world.bodies[p.disc as number];
        if (disc && disc.team === m.turn && !m.isHuman(m.turn)) {
          m.shoot(disc, p.vx as number, p.vy as number);
          this.lastClick = 0;
          blip({ freq: 600, to: 330, ms: 60, type: 'triangle', gain: 0.2 });
        }
      } else if (p.kind === 'timeout') {
        this.handle(m.timeout(p.team as number));
      }
    } else if (msg.type === 'left') {
      this.opponentLeft(`${this.names[1 - this.side] || 'Your opponent'} left the match`);
    }
  }

  private opponentLeft(reason: string): void {
    const m = this.match;
    if (!m) return;
    if (m.state !== 'over') {
      m.state = 'over';
      this.aim = null;
      this.el.ot.textContent = 'Match abandoned';
      this.el.os.textContent = `${reason}. Score was ${m.score[0]}–${m.score[1]}.`;
      this.el.over.hidden = false;
      this.el.banner.classList.remove('show');
      clearTimeout(this.bannerTimer);
      this.ctx.setStatus('opponent left');
    } else {
      this.net(reason);
    }
    this.closeSocket();
  }

  private handle(events: R.MatchEvent[]): void {
    const m = this.match!;
    for (const e of events) {
      if (e.type === 'turn') {
        if (m.mode === 'ai' && !m.isHuman(e.team)) this.aiTimer = 0.8 + Math.random() * 0.7;
      } else if (e.type === 'ballIn') {
        this.goalSound();
      } else if (e.type === 'nogoal') {
        this.banner('No goal', 'Scoring straight from kick-off is a foul', 1900, () => this.handle(m.resume()));
      } else if (e.type === 'goal') {
        const sub = e.final ? '' : `${this.names[e.team]} ${m.mode === 'ai' && e.team === 0 ? 'score' : 'scores'}`;
        this.banner('GOAL!', sub, e.final ? 1300 : 1700, () => this.handle(m.resume()));
      } else if (e.type === 'over') {
        if (e.why === 'time' && m.mode === 'online' && e.winner !== this.side) this.send({ kind: 'timeout', team: this.side });
        this.endGame(e.winner, e.why);
      }
    }
  }

  private endGame(winner: number, why: 'goals' | 'time'): void {
    const m = this.match!;
    this.aim = null;
    const loser = 1 - winner;
    const you = m.mode !== 'pvp';
    this.el.ot.textContent = you ? (winner === m.localSide ? 'You win' : `${this.names[winner]} ${m.mode === 'ai' ? 'wins' : 'wins'}`) : `${this.names[winner]} wins`;
    this.el.os.textContent =
      why === 'time'
        ? `${you && loser === m.localSide ? 'You' : this.names[loser]} ran out of time. Final score ${m.score[0]}–${m.score[1]}.`
        : `First to ${R.WIN_GOALS} goals. Final score ${m.score[0]}–${m.score[1]}.`;
    this.el.over.hidden = false;
    if (m.mode !== 'pvp' && !this.submitted) {
      this.submitted = true;
      const score = R.matchScore(m);
      this.ctx.setStatus('submitting…');
      void this.ctx.submitScore(score).then((r) => {
        if (r) this.ctx.setStatus(`rank #${r.rank} · best ${r.best}${r.offline ? ' (offline)' : ''}`);
      });
    } else {
      this.ctx.setStatus(`${this.names[winner]} wins`);
    }
  }

  private banner(title: string, sub: string, ms: number, cb?: () => void): void {
    clearTimeout(this.bannerTimer);
    this.el.bt.textContent = title;
    this.el.bs.textContent = sub;
    this.el.banner.classList.add('show');
    this.bannerTimer = window.setTimeout(() => {
      this.el.banner.classList.remove('show');
      cb?.();
    }, ms);
  }

  // ---------- sound ----------

  private lastClick = 0;
  private tone = (vol: number, f: number): void => {
    const now = performance.now();
    if (now - this.lastClick < 25) return;
    this.lastClick = now;
    blip({ freq: f, to: f * 0.55, ms: 80, type: 'triangle', gain: Math.min(0.22, vol) });
  };
  private goalSound(): void {
    [0, 120, 240].forEach((d, i) => setTimeout(() => blip({ freq: 520 + i * 180, to: 300, ms: 300, type: 'square', gain: 0.12 }), d));
  }

  // ---------- input ----------

  private toWorld(e: PointerEvent): { x: number; y: number } {
    const r = this.cv.getBoundingClientRect();
    return { x: (e.clientX - r.left) / this.scale - R.OX, y: (e.clientY - r.top) / this.scale - R.OY };
  }

  /** Screen position of a world point; used by tests to drag discs. */
  toScreen(x: number, y: number): { x: number; y: number } {
    const r = this.cv.getBoundingClientRect();
    return { x: r.left + (x + R.OX) * this.scale, y: r.top + (y + R.OY) * this.scale };
  }

  private bindInput(): void {
    const on = <K extends keyof HTMLElementEventMap>(target: HTMLElement | Window, type: K | string, fn: (e: never) => void) => {
      target.addEventListener(type, fn as EventListener);
      this.cleanups.push(() => target.removeEventListener(type, fn as EventListener));
    };
    on(this.cv, 'pointerdown', (e: PointerEvent) => {
      unlockAudio();
      const m = this.match;
      if (!m || m.state !== 'aim' || !m.isHuman(m.turn)) return;
      const p = this.toWorld(e);
      const d = R.pickDisc(m.world, m.turn, p);
      if (!d) return;
      this.aim = { d, px: p.x, py: p.y };
      this.cv.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    on(this.cv, 'pointermove', (e: PointerEvent) => {
      const p = this.toWorld(e);
      if (this.aim) {
        this.aim.px = p.x;
        this.aim.py = p.y;
        return;
      }
      const m = this.match;
      this.cv.style.cursor = m && m.state === 'aim' && m.isHuman(m.turn) && R.pickDisc(m.world, m.turn, p) ? 'grab' : 'default';
    });
    on(this.cv, 'pointerup', () => {
      if (!this.aim || !this.match) return;
      const { d, px, py } = this.aim;
      this.aim = null;
      if (this.match.state !== 'aim') return;
      const v = R.flick(d, px, py);
      if (v) this.shoot(d, v.vx, v.vy);
    });
    on(this.cv, 'pointercancel', () => (this.aim = null));
    on(window, 'keydown', (e: KeyboardEvent) => {
      if (e.code === 'Escape') this.ctx.exit();
      if (e.code === 'KeyR' && this.match?.state === 'over') this.startMatch(this.match.mode);
    });
  }

  /** Flick a disc; exposed for tests. */
  shoot(d: R.Body, vx: number, vy: number): void {
    const m = this.match;
    if (!m) return;
    if (m.mode === 'online' && m.state === 'aim' && m.turn === this.side) {
      this.send({ kind: 'shot', disc: m.world.bodies.indexOf(d), vx, vy, snap: m.snapshot() });
    }
    m.shoot(d, vx, vy);
    this.lastClick = 0;
    blip({ freq: 600, to: 330, ms: 60, type: 'triangle', gain: 0.2 });
  }

  // ---------- layout ----------

  private fit(): void {
    const wrap = this.el.wrap;
    const aw = wrap.clientWidth - 12;
    const ah = wrap.clientHeight - 6;
    this.scale = Math.max(0.2, Math.min(aw / R.VW, ah / R.VH));
    this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const cw = Math.floor(R.VW * this.scale);
    const ch = Math.floor(R.VH * this.scale);
    this.cv.style.width = `${cw}px`;
    this.cv.style.height = `${ch}px`;
    this.cv.width = Math.round(cw * this.dpr);
    this.cv.height = Math.round(ch * this.dpr);
  }

  // ---------- rendering ----------

  private drawPitch(): void {
    const g = this.g;
    g.fillStyle = '#145e22';
    g.fillRect(-R.OX, -R.OY, R.VW, R.VH);
    const n = 14;
    const sw = R.W / n;
    for (let i = 0; i < n; i++) {
      g.fillStyle = i % 2 ? '#2a9a38' : '#32a940';
      g.fillRect(i * sw, 0, sw + 0.5, R.H);
    }
    const grad = g.createRadialGradient(R.W / 2, R.H / 2, 40, R.W / 2, R.H / 2, R.W * 0.62);
    grad.addColorStop(0, 'rgba(210,255,120,.18)');
    grad.addColorStop(1, 'rgba(0,40,0,.18)');
    g.fillStyle = grad;
    g.fillRect(0, 0, R.W, R.H);
    for (const side of [0, 1]) {
      const gx = side ? R.W : -R.DEPTH;
      g.fillStyle = 'rgba(0,30,5,.55)';
      g.fillRect(gx, R.TOP, R.DEPTH, R.GOAL);
      g.strokeStyle = 'rgba(255,255,255,.35)';
      g.lineWidth = 1;
      g.beginPath();
      for (let x = gx; x <= gx + R.DEPTH; x += 10) { g.moveTo(x, R.TOP); g.lineTo(x, R.BOT); }
      for (let y = R.TOP; y <= R.BOT; y += 10) { g.moveTo(gx, y); g.lineTo(gx + R.DEPTH, y); }
      g.stroke();
      g.strokeStyle = '#fff';
      g.lineWidth = 4;
      g.strokeRect(gx, R.TOP, R.DEPTH, R.GOAL);
    }
    g.strokeStyle = 'rgba(255,255,255,.9)';
    g.lineWidth = 3;
    g.strokeRect(0, 0, R.W, R.H);
    g.beginPath(); g.moveTo(R.W / 2, 0); g.lineTo(R.W / 2, R.H); g.stroke();
    g.beginPath(); g.arc(R.W / 2, R.H / 2, 80, 0, Math.PI * 2); g.stroke();
    for (const side of [0, 1]) {
      const x0 = side ? R.W - 150 : 0;
      const x1 = side ? R.W - 55 : 0;
      g.strokeRect(x0, R.H / 2 - 170, 150, 340);
      g.strokeRect(x1, R.H / 2 - 105, 55, 210);
      const sx = side ? R.W - 110 : 110;
      g.beginPath(); g.arc(sx, R.H / 2, 3.5, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill();
      g.beginPath();
      if (side) g.arc(sx, R.H / 2, 72, Math.PI - 0.95, Math.PI + 0.95);
      else g.arc(sx, R.H / 2, 72, -0.95, 0.95);
      g.stroke();
    }
    g.beginPath(); g.arc(R.W / 2, R.H / 2, 4, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill();
    for (const [px, py] of R.POSTS) {
      g.beginPath(); g.arc(px, py, R.POST_R, 0, Math.PI * 2); g.fillStyle = '#f4f4f4'; g.fill();
      g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 1.5; g.stroke();
    }
  }

  private star(x: number, y: number, r: number, rot: number): void {
    const g = this.g;
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = rot + (i * Math.PI) / 5 - Math.PI / 2;
      const rr = i % 2 ? r * 0.45 : r;
      g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    g.closePath();
  }

  private drawDisc(b: R.Body, now: number): void {
    const g = this.g;
    const m = this.match!;
    const c = TEAM[b.team];
    g.beginPath(); g.ellipse(b.x + 3, b.y + 6, b.r, b.r * 0.92, 0, 0, Math.PI * 2); g.fillStyle = 'rgba(0,0,0,.28)'; g.fill();
    if (m.state === 'aim' && b.team === m.turn && m.isHuman(m.turn)) {
      const p = 0.5 + 0.5 * Math.sin(now / 220);
      g.beginPath(); g.arc(b.x, b.y, b.r + 5 + p * 3, 0, Math.PI * 2);
      g.strokeStyle = `rgba(255,210,63,${0.35 + p * 0.45})`; g.lineWidth = 3; g.stroke();
    }
    g.beginPath(); g.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    const rg = g.createLinearGradient(b.x, b.y - b.r, b.x, b.y + b.r);
    rg.addColorStop(0, '#ffffff'); rg.addColorStop(1, '#b9c2c9');
    g.fillStyle = rg; g.fill();
    g.beginPath(); g.arc(b.x, b.y, b.r - 4, 0, Math.PI * 2);
    const fg = g.createRadialGradient(b.x - 7, b.y - 9, 2, b.x, b.y, b.r);
    fg.addColorStop(0, c.light); fg.addColorStop(0.45, c.base); fg.addColorStop(1, c.dark);
    g.fillStyle = fg; g.fill();
    this.star(b.x, b.y, 11, b.rot * 0.15);
    g.fillStyle = 'rgba(255,255,255,.92)'; g.fill();
    g.beginPath(); g.ellipse(b.x - 6, b.y - 11, 11, 5, -0.4, 0, Math.PI * 2); g.fillStyle = 'rgba(255,255,255,.28)'; g.fill();
  }

  private drawBall(): void {
    const g = this.g;
    const b = this.match!.world.ball;
    const trail = this.trail;
    for (let i = 1; i < trail.length; i++) {
      const a = i / trail.length;
      g.beginPath(); g.moveTo(trail[i - 1].x, trail[i - 1].y); g.lineTo(trail[i].x, trail[i].y);
      g.strokeStyle = `rgba(200,255,120,${a * 0.55})`; g.lineWidth = b.r * 1.6 * a; g.lineCap = 'round'; g.stroke();
    }
    g.beginPath(); g.ellipse(b.x + 2, b.y + 4, b.r, b.r * 0.9, 0, 0, Math.PI * 2); g.fillStyle = 'rgba(0,0,0,.3)'; g.fill();
    g.save();
    g.beginPath(); g.arc(b.x, b.y, b.r, 0, Math.PI * 2); g.fillStyle = '#fbfbfb'; g.fill(); g.clip();
    g.fillStyle = '#1a1a1a';
    const pent = (cx: number, cy: number, r: number, rot: number) => {
      g.beginPath();
      for (let i = 0; i < 5; i++) {
        const a = rot + (i * 2 * Math.PI) / 5;
        g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      }
      g.fill();
    };
    pent(b.x, b.y, b.r * 0.38, b.rot);
    for (let i = 0; i < 5; i++) {
      const a = b.rot + (i * 2 * Math.PI) / 5 + Math.PI / 5;
      pent(b.x + Math.cos(a) * b.r * 0.98, b.y + Math.sin(a) * b.r * 0.98, b.r * 0.34, a);
    }
    g.restore();
    g.beginPath(); g.arc(b.x, b.y, b.r, 0, Math.PI * 2); g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 1; g.stroke();
  }

  private drawAim(): void {
    if (!this.aim) return;
    const g = this.g;
    const { d, px, py } = this.aim;
    const dx = d.x - px;
    const dy = d.y - py;
    const dist = Math.hypot(dx, dy);
    if (dist < 6) return;
    const power = Math.min(dist, R.MAXDRAG) / R.MAXDRAG;
    const nx = dx / dist;
    const ny = dy / dist;
    g.setLineDash([4, 6]); g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(d.x, d.y); g.lineTo(d.x - nx * Math.min(dist, R.MAXDRAG), d.y - ny * Math.min(dist, R.MAXDRAG)); g.stroke();
    g.setLineDash([]);
    const len = 50 + power * 170;
    const sx = d.x + nx * (d.r + 4);
    const sy = d.y + ny * (d.r + 4);
    const ex = sx + nx * len;
    const ey = sy + ny * len;
    const col = power < 0.5 ? '#fff4b0' : power < 0.85 ? '#ffd23f' : '#ff5a4a';
    g.strokeStyle = col; g.lineWidth = 6; g.lineCap = 'round';
    g.beginPath(); g.moveTo(sx, sy); g.lineTo(ex - nx * 10, ey - ny * 10); g.stroke();
    g.beginPath(); g.moveTo(ex, ey);
    g.lineTo(ex - nx * 20 - ny * 12, ey - ny * 20 + nx * 12);
    g.lineTo(ex - nx * 20 + ny * 12, ey - ny * 20 - nx * 12);
    g.closePath(); g.fillStyle = col; g.fill();
    g.beginPath(); g.arc(d.x, d.y, d.r + 9, -Math.PI / 2, -Math.PI / 2 + power * Math.PI * 2);
    g.strokeStyle = col; g.lineWidth = 4; g.stroke();
  }

  private draw(now: number): void {
    const g = this.g;
    g.setTransform(this.scale * this.dpr, 0, 0, this.scale * this.dpr, R.OX * this.scale * this.dpr, R.OY * this.scale * this.dpr);
    this.drawPitch();
    const m = this.match;
    if (!m) return;
    for (const b of m.world.bodies) if (!b.ball) this.drawDisc(b, now);
    this.drawBall();
    this.drawAim();
  }

  private paintHud(): void {
    const m = this.match;
    const clocks = m ? m.clocks : [R.TIME, R.TIME];
    const score = m ? m.score : [0, 0];
    const key = [R.fmtClock(clocks[0]), R.fmtClock(clocks[1]), score[0], score[1], m?.turn, m?.state].join('|');
    if (key === this.hudCache) return;
    this.hudCache = key;
    for (const t of [0, 1]) {
      this.el[`c${t}`].textContent = R.fmtClock(clocks[t]);
      this.el[`c${t}`].classList.toggle('low', clocks[t] <= 30);
      this.el[`s${t}`].textContent = String(score[t]);
      this.el[`pl${t}`].classList.toggle('active', Boolean(m) && (m!.state === 'aim' || m!.state === 'sim') && m!.turn === t);
    }
  }

  // ---------- loop ----------

  private loop(now: number): void {
    const dt = Math.min(0.05, (now - this.t0) / 1000);
    this.t0 = now;
    const m = this.match;
    if (m) {
      if (m.mode === 'ai' && m.state === 'aim' && !m.isHuman(m.turn)) {
        this.aiTimer -= dt;
        if (this.aiTimer <= 0) {
          const s = R.aiShot(m.world, m.turn, m.kickoffPending);
          this.shoot(s.disc, s.vx, s.vy);
        }
      }
      const events = m.tick(dt, this.tone);
      if (m.state === 'sim') {
        const ball = m.world.ball;
        if (Math.hypot(ball.vx, ball.vy) > 120) this.trail.push({ x: ball.x, y: ball.y });
        else if (this.trail.length) this.trail.shift();
        if (this.trail.length > 14) this.trail.shift();
      } else this.trail = [];
      if (events.length) this.handle(events);
    }
    this.paintHud();
    this.draw(now);
    this.raf = requestAnimationFrame((t) => this.loop(t));
  }

  destroy(): void {
    this.closeSocket();
    cancelAnimationFrame(this.raf);
    clearTimeout(this.bannerTimer);
    this.observer.disconnect();
    this.cleanups.forEach((fn) => fn());
    this.root.remove();
    this.container.style.position = '';
  }
}
