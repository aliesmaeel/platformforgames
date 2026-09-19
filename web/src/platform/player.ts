const KEY = 'pfg:player';

const clean = (value: string) =>
  value.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 24);

function read(): string {
  try {
    return clean(localStorage.getItem(KEY) ?? '');
  } catch {
    return '';
  }
}

let cached = read();

export function getPlayer(): string {
  if (!cached) setPlayer(`player-${Math.floor(Math.random() * 9000 + 1000)}`);
  return cached;
}

export function setPlayer(name: string): string {
  cached = clean(name) || 'anon';
  try {
    localStorage.setItem(KEY, cached);
  } catch {
    /* private mode: name lives for this session only */
  }
  return cached;
}
