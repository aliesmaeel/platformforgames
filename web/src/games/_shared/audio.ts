/**
 * Tiny synth so games can have sound without shipping audio files. The
 * context is created lazily on the first call, which browsers require to
 * happen after a user gesture; calls before that are silently dropped.
 */

let ctx: AudioContext | null = null;
let muted = false;

function context(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();
  return ctx;
}

/** Call from a pointer/key handler to unlock audio. Safe to call repeatedly. */
export function unlockAudio(): void {
  const c = context();
  if (c && c.state === 'suspended') void c.resume();
}

export function setMuted(value: boolean): void {
  muted = value;
}

export interface Blip {
  freq: number;
  /** Optional end frequency for a sweep. */
  to?: number;
  ms?: number;
  type?: OscillatorType;
  gain?: number;
}

export function blip({ freq, to, ms = 80, type = 'square', gain = 0.06 }: Blip): void {
  const c = context();
  if (!c || muted || c.state !== 'running') return;
  const osc = c.createOscillator();
  const amp = c.createGain();
  const now = c.currentTime;
  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);
  if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), now + ms / 1000);
  amp.gain.setValueAtTime(gain, now);
  amp.gain.exponentialRampToValueAtTime(0.0001, now + ms / 1000);
  osc.connect(amp).connect(c.destination);
  osc.start(now);
  osc.stop(now + ms / 1000 + 0.02);
}

/** Short white-noise burst for hits and explosions. */
export function noise(ms = 120, gain = 0.08): void {
  const c = context();
  if (!c || muted || c.state !== 'running') return;
  const length = Math.floor((c.sampleRate * ms) / 1000);
  const buffer = c.createBuffer(1, length, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
  const src = c.createBufferSource();
  const amp = c.createGain();
  amp.gain.value = gain;
  src.buffer = buffer;
  src.connect(amp).connect(c.destination);
  src.start();
}

/** Dispose the context (call on game teardown if you want a clean slate). */
export function closeAudio(): void {
  void ctx?.close();
  ctx = null;
}
