import { chromium } from 'playwright-core';
const out = process.argv[2];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 620 } });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto('http://localhost:4173/');
await page.waitForFunction(() => !document.getElementById('loading'), null, { timeout: 180000 });
await page.evaluate(async () => { const j = window.jetvault; j.selectAircraft('glider'); j.world.setAirport('EGPM'); await j.airportChanged(); await j.fly({ kind: 'runway', ident: '10' });
  document.querySelector('.jv-hud') && (document.querySelector('.jv-hud').style.display = 'none'); j.rig.setMode('chase', j.sim.aircraft); j.rig.chaseDist = 45; j.rig.orbitEl = 0.3; j.rig.orbitAz = 0.6; });
await page.waitForTimeout(6000);
await page.screenshot({ path: `${out}/rt1.png` });
// move the glider 400 m down the field, then call the buggy
await page.evaluate(() => { const j = window.jetvault; const ac = j.sim.aircraft; j.sim.placeAtLaunchPoint(ac.pos.y + 450, ac.pos.x - 120, 2.0); });
await page.waitForTimeout(3000);
const log = [];
const st = () => page.evaluate(() => { const j = window.jetvault; const ac = j.sim.aircraft; return { btn: [...document.querySelectorAll('.jv-bridge')].filter((b) => b.style.display !== 'none').map((b) => b.textContent), e: Math.round(ac.pos.y), n: Math.round(ac.pos.x), kt: +(Math.hypot(ac.vel.x, ac.vel.y)).toFixed(1), hd: Math.round(ac.euler[2] * 57.3), bug: [Math.round(j.buggy.east), Math.round(j.buggy.north), Math.round(j.buggy.heading * 57.3), +j.buggy.speed.toFixed(1)], tow: j.buggy.towing, hook: j.retrieving ? Math.round(j.hookDistance()) : null, onGround: ac.onGround }; });
log.push(await st());
await page.evaluate(() => window.jetvault.handleSimple('launch'));
await page.waitForTimeout(1500);
log.push(await st());
await page.screenshot({ path: `${out}/rt2.png` });
// drive: autopilot-ish toward hook point: steer to target hitch position
const drive = async (target, secs, speed) => {
  for (let i = 0; i < secs * 5; i++) {
    await page.evaluate(([tg, spd]) => { const j = window.jetvault; const b = j.buggy; const ac = j.sim.aircraft; const h = ac.euler[2];
      const T = tg.nose ? { e: ac.pos.y + Math.sin(h) * 9, n: ac.pos.x + Math.cos(h) * 9 } : tg;
      const want = Math.atan2(T.e - b.east, T.n - b.north); let d = want - b.heading; d = Math.atan2(Math.sin(d), Math.cos(d)); j.simple.tugSteer = Math.max(-1, Math.min(1, d * 1.5)); j.simple.setThrottle(spd); }, [target, speed]);
    await page.waitForTimeout(200);
  }
};
await drive({ nose: true }, 12, 0.3);
log.push(await st());
await page.evaluate(() => window.jetvault.simple.setThrottle(0));
await page.waitForTimeout(1500);
log.push(await st());
await page.evaluate(() => window.jetvault.handleSimple('launch'));
await page.waitForTimeout(500);
log.push(await st());
await page.screenshot({ path: `${out}/rt3.png` });
await drive({ e: 2173, n: 26842 }, 70, 0.5);
log.push(await st());
await page.screenshot({ path: `${out}/rt4.png` });
await page.evaluate(() => window.jetvault.simple.setThrottle(0));
await page.waitForTimeout(2000);
log.push(await st());
await page.evaluate(() => window.jetvault.handleSimple('launch'));
await page.waitForTimeout(2500);
log.push(await st());
await page.screenshot({ path: `${out}/rt5.png` });

await browser.close();
console.log(errs); console.log(JSON.stringify(log, null, 1));
