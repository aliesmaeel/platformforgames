import * as THREE from 'three';

/**
 * Boot/teardown for the Three.js games. Owns the renderer, a resize
 * observer, the frame loop and keyboard state. If WebGL is unavailable the
 * simulation still runs (nothing is drawn and the HUD says why), which keeps
 * the games testable headless and degrades gracefully on locked-down browsers.
 */

export interface ThreeApp {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer | null;
  canvas: HTMLCanvasElement;
  keys: Set<string>;
  /** Width/height of the drawing surface in CSS pixels. */
  size: { w: number; h: number };
  start(update: (dt: number, elapsed: number) => void): void;
  destroy(): void;
  /** Register a listener that is removed on destroy. */
  on<K extends keyof WindowEventMap>(target: Window, type: K, fn: (ev: WindowEventMap[K]) => void): void;
  on<K extends keyof HTMLElementEventMap>(target: HTMLElement, type: K, fn: (ev: HTMLElementEventMap[K]) => void): void;
}

export function createThreeApp(container: HTMLElement, opts: { fov?: number; background?: number } = {}): ThreeApp {
  container.style.position = 'relative';
  const canvas = document.createElement('canvas');
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.display = 'block';
  canvas.tabIndex = 0;
  container.append(canvas);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(opts.background ?? 0x070910);
  const camera = new THREE.PerspectiveCamera(opts.fov ?? 55, 16 / 9, 0.1, 500);

  let renderer: THREE.WebGLRenderer | null = null;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
  } catch {
    renderer = null;
    const note = document.createElement('div');
    note.className = 'pfg-hud__nogl';
    note.textContent = 'WebGL is unavailable in this browser, so the game runs without graphics.';
    container.append(note);
  }

  const size = { w: 1, h: 1 };
  const resize = () => {
    const rect = container.getBoundingClientRect();
    size.w = Math.max(1, rect.width);
    size.h = Math.max(1, rect.height);
    camera.aspect = size.w / size.h;
    camera.updateProjectionMatrix();
    renderer?.setSize(size.w, size.h, false);
  };
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();

  const keys = new Set<string>();
  const cleanups: (() => void)[] = [];
  const on = (target: EventTarget, type: string, fn: (ev: never) => void) => {
    const listener = fn as unknown as EventListener;
    target.addEventListener(type, listener);
    cleanups.push(() => target.removeEventListener(type, listener));
  };
  on(window, 'keydown', (e: KeyboardEvent) => {
    keys.add(e.code);
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  });
  on(window, 'keyup', (e: KeyboardEvent) => keys.delete(e.code));
  on(window, 'blur', () => keys.clear());

  let raf = 0;
  let last = performance.now();
  let elapsed = 0;
  let alive = true;

  const app: ThreeApp = {
    scene,
    camera,
    renderer,
    canvas,
    keys,
    size,
    start(update) {
      const frame = (now: number) => {
        if (!alive) return;
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        elapsed += dt;
        update(dt, elapsed);
        renderer?.render(scene, camera);
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
    },
    destroy() {
      alive = false;
      cancelAnimationFrame(raf);
      observer.disconnect();
      cleanups.forEach((fn) => fn());
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        mesh.geometry?.dispose?.();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat?.dispose?.();
      });
      renderer?.dispose();
      container.replaceChildren();
      container.style.position = '';
    },
    on: on as unknown as ThreeApp['on']
  };
  return app;
}

/** Standard three-point-ish lighting used across the 3D games. */
export function addLights(scene: THREE.Scene, shadowSize = 40): THREE.DirectionalLight {
  scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x141822, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(12, 24, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -shadowSize;
  sun.shadow.camera.right = shadowSize;
  sun.shadow.camera.top = shadowSize;
  sun.shadow.camera.bottom = -shadowSize;
  sun.shadow.camera.far = 120;
  scene.add(sun);
  return sun;
}

export const mat = (color: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.05, ...extra });

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
