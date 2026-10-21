// End-to-end browser flight using only keyboard/mouse input (no state injection after spawn).
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const url = process.argv[2] ?? 'http://localhost:4173/';
const out = process.argv[3] ?? 'shots';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(url);
await page.waitForFunction(() => !document.getElementById('loading'), null, { timeout: 180000 });
const st = () => page.evaluate(() => { const a = window.jetvault, ac = a.sim.aircraft, i = a.sim.systems.ind; const ft = a.frameTimes; return { fps: +(ft.length / ft.reduce((x, y) => x + y, 0)).toFixed(1), rate: a.sim.timeScale, t: +a.sim.simTime.toFixed(1), ias: i.iasKt, alt: i.altitudeFt, agl: ac.agl, rpm: i.rpm, running: ac.engine.running, onGround: ac.onGround, crashed: ac.crashed, reason: ac.crashReason, bat: a.sim.controls.masterBattery, mags: a.sim.controls.mags, thr: a.sim.controls.throttle, pitch: ac.euler[1] * 57.3, park: a.sim.controls.parkingBrake }; });
const log = async (m) => console.log(m, JSON.stringify(await st()));

// 1. Menu: choose stand 1, cold and dark, click FLY (real DOM clicks)
await page.click('text=Parking stand 1');
await page.check('#cd');
await page.click('button.jv-btn:has-text("FLY")');
await page.waitForTimeout(1500);
await log('cold & dark');
// 2. Click the battery master on the instrument panel (raycast from screen position)
const clickPanel = async (regionId) => {
  const pos = await page.evaluate((id) => {
    const a = window.jetvault, r = a.cockpit.regions.find((q) => q.id === id);
    const u = (r.x + r.w * 0.75) / 2400, v = 1 - (r.y + r.h * 0.4) / 880;
    // panel local coords -> world -> screen
    const THREE = a.scene.constructor; // not needed; use panel mesh matrix
    const m = a.cockpit.panelMesh;
    const local = { x: (u - 0.5) * 1.5, y: (v - 0.5) * 0.55, z: 0 };
    const p = m.localToWorld(new (m.position.constructor)(local.x, local.y, local.z));
    p.project(a.rig.camera);
    return { x: (p.x + 1) / 2 * innerWidth, y: (1 - p.y) / 2 * innerHeight, onScreen: Math.abs(p.x) < 1 && Math.abs(p.y) < 1 };
  }, regionId);
  if (!pos.onScreen) throw new Error(`${regionId} not on screen`);
  await page.mouse.click(pos.x, pos.y);
  await page.waitForTimeout(300);
};
await page.evaluate(() => { const a = window.jetvault; a.rig.headPitch = -0.45; });
await page.waitForTimeout(800);
await clickPanel('sw-masterBattery');
await log('after clicking BAT');
await page.screenshot({ path: `${out}/f1-panel-bat.png` });
// software GL is slow: use the simulator's own sim-rate key (R) twice -> 4x
await page.keyboard.press('KeyR'); await page.keyboard.press('KeyR');
// 3. Automatic start (Ctrl+E performs the switch sequence through the controls)
await page.keyboard.press('Control+KeyE');
await page.waitForFunction(() => window.jetvault.sim.aircraft.engine.running, null, { timeout: 300000 });
await log('engine started');
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/f2-running.png` });
// 4. Release parking brake (B), taxi a bit then reposition to runway via menu for the takeoff
await page.keyboard.press('KeyB');
await log('brake released');
await page.keyboard.press('Escape');
await page.click('text=Runway 24');
await page.click('button.jv-btn:has-text("FLY")');
await page.waitForTimeout(1000);
await page.keyboard.press('KeyR'); await page.keyboard.press('KeyR');
await page.evaluate(() => { const a = window.jetvault; a.rig.headPitch = -0.15; });
// 5. Full throttle (F4) and hold centreline with rudder keys automatically? keep straight: no wind
await page.keyboard.press('F4');
await log('full throttle');
await page.waitForFunction(() => window.jetvault.sim.systems.ind.iasKt > 52, null, { timeout: 600000 });
await log('rotate speed');
await page.keyboard.down('ArrowDown');
await page.waitForFunction(() => window.jetvault.sim.aircraft.euler[1] * 57.3 > 4, null, { timeout: 120000 });
await page.keyboard.up('ArrowDown');
await log('rotated');
await page.waitForFunction(() => !window.jetvault.sim.aircraft.onGround || window.jetvault.sim.aircraft.crashed, null, { timeout: 300000 });
await log('liftoff');
await page.screenshot({ path: `${out}/f3-liftoff-cockpit.png` });
await page.keyboard.press('Digit2');
await page.waitForFunction(() => window.jetvault.sim.aircraft.agl > 60 || window.jetvault.sim.aircraft.crashed, null, { timeout: 600000 });
await log('climbing');
await page.screenshot({ path: `${out}/f4-climb-chase.png` });
console.log('errors', errors);
await browser.close();
