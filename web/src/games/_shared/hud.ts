/**
 * DOM overlay for the 3D games: corner readouts, a hint line and a centred
 * result panel styled like the Phaser Overlay. One stylesheet is injected
 * on first use.
 */

const CSS = `
.pfg-hud{position:absolute;inset:0;pointer-events:none;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#e8ecf5}
.pfg-hud__tl{position:absolute;top:14px;left:18px}
.pfg-hud__tr{position:absolute;top:14px;right:18px;text-align:right}
.pfg-hud__big{font-size:32px;line-height:1;font-weight:600}
.pfg-hud__label{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#5c6684;margin-top:4px}
.pfg-hud__hint{position:absolute;left:18px;bottom:12px;font-size:12px;color:#5c6684}
.pfg-hud__toast{position:absolute;left:50%;top:18%;transform:translateX(-50%);font-family:system-ui,sans-serif;font-size:26px;background:#0b0d12ee;padding:8px 18px;border-radius:10px;opacity:0;transition:opacity .15s}
.pfg-hud__toast.is-on{opacity:1}
.pfg-hud__panel{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(420px,90%);background:#0b0d12f0;border:1px solid #232838;border-radius:14px;padding:22px 18px;text-align:center;pointer-events:auto}
.pfg-hud__panel h3{margin:0 0 6px;font-family:system-ui,sans-serif;font-size:28px;font-weight:500}
.pfg-hud__panel .big{font-size:44px;color:#4cc9f0;margin:4px 0}
.pfg-hud__panel .detail{font-size:14px;color:#99a2b8;margin:8px 0 2px}
.pfg-hud__panel .hint{font-size:13px;color:#5c6684}
.pfg-hud__nogl{position:absolute;left:50%;top:8px;transform:translateX(-50%);font:12px ui-monospace,monospace;color:#ff9f1c;background:#0b0d12dd;padding:4px 10px;border-radius:6px}
`;

let injected = false;

export interface Hud {
  setTopLeft(big: string, label: string): void;
  setTopRight(big: string, label: string): void;
  setHint(text: string): void;
  toast(text: string, ms?: number): void;
  panel(spec: { title: string; big?: string; detail: string; hint: string } | null): void;
  destroy(): void;
}

export function createHud(container: HTMLElement): Hud {
  if (!injected) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.append(style);
    injected = true;
  }
  const root = document.createElement('div');
  root.className = 'pfg-hud';
  const el = (cls: string) => {
    const n = document.createElement('div');
    n.className = cls;
    root.append(n);
    return n;
  };
  const tl = el('pfg-hud__tl');
  const tr = el('pfg-hud__tr');
  const hint = el('pfg-hud__hint');
  const toast = el('pfg-hud__toast');
  let panelNode: HTMLDivElement | null = null;
  let toastTimer = 0;
  container.append(root);

  const corner = (node: HTMLDivElement, big: string, label: string) => {
    node.innerHTML = '';
    const b = document.createElement('div');
    b.className = 'pfg-hud__big';
    b.textContent = big;
    const l = document.createElement('div');
    l.className = 'pfg-hud__label';
    l.textContent = label;
    node.append(b, l);
  };

  return {
    setTopLeft: (big, label) => corner(tl, big, label),
    setTopRight: (big, label) => corner(tr, big, label),
    setHint: (text) => (hint.textContent = text),
    toast(text, ms = 900) {
      toast.textContent = text;
      toast.classList.add('is-on');
      clearTimeout(toastTimer);
      toastTimer = window.setTimeout(() => toast.classList.remove('is-on'), ms);
    },
    panel(spec) {
      panelNode?.remove();
      panelNode = null;
      if (!spec) return;
      panelNode = document.createElement('div');
      panelNode.className = 'pfg-hud__panel';
      const h = document.createElement('h3');
      h.textContent = spec.title;
      const big = document.createElement('div');
      big.className = 'big';
      big.textContent = spec.big ?? '';
      const detail = document.createElement('div');
      detail.className = 'detail';
      detail.textContent = spec.detail;
      const hintEl = document.createElement('div');
      hintEl.className = 'hint';
      hintEl.textContent = spec.hint;
      panelNode.append(h, big, detail, hintEl);
      root.append(panelNode);
    },
    destroy() {
      clearTimeout(toastTimer);
      root.remove();
    }
  };
}

/** Submit a run and reflect the result on the HUD panel. */
export function finishRunHud(
  ctx: { submitScore(score: number): Promise<{ rank: number; best: number; offline: boolean } | null>; setStatus(t: string): void },
  hud: Hud,
  score: number,
  spec: { title: string; detail: string; hint: string; big?: string; formatBest?: (score: number) => string }
): void {
  const big = spec.big ?? score.toLocaleString();
  const fmt = spec.formatBest ?? ((n: number) => String(n));
  hud.panel({ ...spec, big, detail: `${spec.detail} · submitting…` });
  void ctx.submitScore(score).then((result) => {
    if (!result) return;
    ctx.setStatus(`best ${fmt(result.best)}${result.offline ? ' (offline)' : ''}`);
    hud.panel({ ...spec, big, detail: `rank #${result.rank} · ${spec.detail}` });
  });
}
