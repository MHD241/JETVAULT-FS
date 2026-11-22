// Friendly start-up failures: a clear message instead of a blank page or a stuck loading bar.

/** Turns a start-up error into a message for the player and a hint about what to try. */
export function describeError(e: unknown): { title: string; hint: string } {
  const msg = e instanceof Error ? e.message : String(e ?? '');
  if (/webgl|context|gpu/i.test(msg)) return { title: 'This browser could not start 3D graphics', hint: 'JetVault needs WebGL 2. Try a current Chrome, Edge, Firefox or Safari, turn on hardware acceleration in the browser settings, and update your graphics driver.' };
  if (/fetch|network|load failed|failed to load|NetworkError|404|abort/i.test(msg)) return { title: 'The game data could not be downloaded', hint: 'Check your internet connection and try again. If it keeps happening the website may be updating: wait a minute and reload.' };
  if (/memory|allocation|array buffer/i.test(msg)) return { title: 'The device ran out of memory', hint: 'Close other tabs and apps and reload. On a phone or an older computer, try the Low graphics setting.' };
  return { title: 'JetVault could not start', hint: 'Reload the page. If it still fails, try another browser, and tell us what you see below.' };
}

export function webglAvailable(): boolean {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2')); } catch { return false; }
}

/** Replaces the loading screen with the message, a Reload button and the technical detail. */
export function showFatal(e: unknown) {
  const { title, hint } = describeError(e), detail = e instanceof Error ? e.message : String(e ?? '');
  const el = document.getElementById('loading') ?? document.body;
  el.innerHTML = '';
  const box = document.createElement('div'); box.style.cssText = 'max-width:560px;margin:12vh auto 0;padding:0 24px;color:#eaf2fb;font:16px/1.5 system-ui,sans-serif;text-align:left';
  const h = document.createElement('h2'); h.textContent = title; h.style.cssText = 'margin:0 0 12px;font-weight:600;color:#fff';
  const p = document.createElement('p'); p.textContent = hint;
  const b = document.createElement('button'); b.textContent = 'Reload'; b.style.cssText = 'margin:8px 0 18px;padding:10px 22px;border:0;border-radius:6px;background:#3cc8ff;color:#06101e;font:600 15px system-ui';
  b.onclick = () => location.reload();
  const d = document.createElement('pre'); d.textContent = detail; d.style.cssText = 'white-space:pre-wrap;color:#8fa3b8;font-size:12px';
  box.append(h, p, b, d); el.appendChild(box); (el as HTMLElement).style.display = 'block';
}
