// Headless browser smoke test: loads the built simulator, records console errors,
// exercises views and flight, and saves screenshots.
// Usage: node tools/browser/check.mjs <url> <outdir> [scenario]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:4173/';
const out = process.argv[3] ?? 'shots';
const scenario = process.argv[4] ?? 'basic';
mkdirSync(out, { recursive: true });
const exe = process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: exe, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
const t0 = Date.now();
await page.goto(url);
await page.waitForFunction(() => !document.getElementById('loading'), null, { timeout: 180000 });
console.log(`loaded in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
const shot = async (name) => { await page.screenshot({ path: `${out}/${name}.png` }); console.log('shot', name); };
const evalJ = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);
const fps = async () => evalJ(() => { const t = window.jetvault.frameTimes; return t.length / t.reduce((a, b) => a + b, 0); });

await wait(1500);
await shot('01-menu');
if (scenario === 'basic' || scenario === 'all') {
  // spawn on runway 24 in chase view
  await evalJ(() => { const a = window.jetvault; a.rig.setMode('chase', a.sim.aircraft); a.fly({ kind: 'runway', ident: '24' }); });
  await wait(3000);
  await shot('02-runway24-chase');
  await evalJ(() => { const a = window.jetvault; a.rig.setMode('cockpit', a.sim.aircraft); });
  await wait(2000);
  await shot('03-runway24-cockpit');
  console.log('fps (software GL)', (await fps()).toFixed(1));
  await evalJ(() => { const a = window.jetvault; a.rig.setMode('tower', a.sim.aircraft); });
  await wait(1500);
  await shot('04-tower');
  // approach view
  await evalJ(() => { const a = window.jetvault; a.fly({ kind: 'approach', ident: '06', distanceNm: 3 }); a.rig.setMode('cockpit', a.sim.aircraft); a.rig.headPitch = -0.05; });
  await wait(2500);
  await shot('05-approach06-cockpit');
  await evalJ(() => { const a = window.jetvault; a.rig.setMode('chase', a.sim.aircraft); a.rig.orbitAz = 2.4; a.rig.orbitEl = 0.25; a.rig.chaseDist = 22; });
  await wait(2500);
  await shot('06-approach06-chase');
  // debug collision view at a stand
  await evalJ(() => { const a = window.jetvault; a.fly({ kind: 'stand', index: 0, coldAndDark: true }); a.rig.setMode('chase', a.sim.aircraft); a.rig.orbitAz = 0.9; a.rig.orbitEl = 0.35; a.rig.chaseDist = 14; a.debug.toggle(); });
  await wait(2500);
  await shot('07-stand-debug');
  await evalJ(() => { const a = window.jetvault; a.debug.toggle(); a.rig.setMode('cockpit', a.sim.aircraft); a.rig.headPitch = -0.35; a.rig.headYaw = 0.0; });
  await wait(2000);
  await shot('08-cockpit-panel-cold');
}
const state = await evalJ(() => { const a = window.jetvault, ac = a.sim.aircraft; return { crashed: ac.crashed, reason: ac.crashReason, alt: ac.altitude, agl: ac.agl, onGround: ac.onGround, info: a.renderer.info.render }; });
console.log('state', JSON.stringify(state));
console.log('console errors/warnings:', errors.length);
for (const e of errors.slice(0, 30)) console.log('  ', e);
await browser.close();
