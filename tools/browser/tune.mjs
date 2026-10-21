// Renders a few fixed views with given lighting tune values for calibration.
import { chromium } from 'playwright-core';
const [,, url, out, tuneJson] = process.argv;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(url);
await page.waitForFunction(() => !document.getElementById('loading'), null, { timeout: 180000 });
const tune = JSON.parse(tuneJson ?? '{}');
const views = JSON.parse(process.argv[5] ?? '[["chase-rwy",{"kind":"runway","ident":"24"},"chase",{}],["cockpit-rwy",{"kind":"runway","ident":"24"},"cockpit",{}],["approach",{"kind":"approach","ident":"06","distanceNm":3},"chase",{"orbitAz":2.4,"orbitEl":0.25,"chaseDist":22}]]');
for (const [name, spawn, mode, rig] of views) {
  await page.evaluate(([spawn, mode, rig, tune]) => { const a = window.jetvault; Object.assign(a.env.tune, tune); a.fly(spawn); a.rig.setMode(mode, a.sim.aircraft); Object.assign(a.rig, rig); }, [spawn, mode, rig, tune]);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log('shot', name);
}
await browser.close();
