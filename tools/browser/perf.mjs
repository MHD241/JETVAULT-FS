// Frame-rate measurement in headless Chromium (software WebGL / SwiftShader, no GPU).
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto(process.argv[2]);
await page.waitForFunction(() => !document.getElementById('loading'), null, { timeout: 180000 });
for (const [ac, spawn, view] of [['c172s', { kind: 'runway', ident: '24' }, 'cockpit'], ['c172s', { kind: 'runway', ident: '24' }, 'chase'], ['b738', { kind: 'runway', ident: '24' }, 'cockpit'], ['b738', { kind: 'approach', ident: '24', distanceNm: 6 }, 'chase']]) {
  await page.evaluate(([ac, spawn, view]) => { const a = window.jetvault; a.selectAircraft(ac); a.startView = view; a.fly(spawn); }, [ac, spawn, view]);
  await page.waitForTimeout(6000);
  const r = await page.evaluate(() => { const a = window.jetvault; const t = a.frameTimes; const i = a.renderer.info.render; return { fps: t.length / t.reduce((x, y) => x + y, 0), calls: i.calls, tris: i.triangles, phys: a.sim.physicsMs, crashed: a.sim.aircraft.crashed }; });
  console.log(`${ac} ${view}: ${r.fps.toFixed(1)} fps, ${r.calls} draw calls, ${(r.tris / 1e6).toFixed(2)} M tris, physics ${r.phys.toFixed(2)} ms/frame, crashed ${r.crashed}`);
}
console.log('page errors:', errs.length, errs.slice(0, 5));
await browser.close();
