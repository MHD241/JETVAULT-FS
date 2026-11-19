import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
const page = await b.newPage({ viewport: { width: 960, height: 540 } });
page.on('pageerror', (e) => console.log('PAGEERR', e.message));
await page.goto('http://localhost:4173/?pro&noforest');
await page.waitForFunction(() => !document.getElementById('loading'), null, { timeout: 240000, polling: 500 });
for (const id of ['approach','dusk']) {
  await page.evaluate(async (id) => { const j = window.jetvault; const { } = {}; await j.directorStart(window.jetvaultShots.find((s) => s.id === id)); }, id).catch(e => console.log('ERR', e.message.slice(0,200)));
  await page.waitForFunction(() => window.jetvault.director?.state === 'run', null, { timeout: 120000, polling: 500 });
  // fast-forward the sim without rendering
  const r = await page.evaluate(() => { const j = window.jetvault, d = j.director; for (let i = 0; i < 240 * (d.shot.duration - 1) && !j.sim.aircraft.crashed; i++) j.sim.step(); const a = j.sim.aircraft; return { ias: +(a.cas * 1.944).toFixed(0), alt: +a.altitude.toFixed(0), phase: d.script.phase, crashed: j.sim.aircraft.crashed, t: d.script.t.toFixed(1), cam: j.rig.freePos.toArray().map(Math.round) }; });
  console.log(id, JSON.stringify(r));
  await page.waitForFunction(() => window.jetvault.director?.state === 'cut', null, { timeout: 120000, polling: 500 });
  console.log(id, 'CUT reached', await page.evaluate(() => document.body.innerText.includes('START AGAIN')));
}
await b.close();
