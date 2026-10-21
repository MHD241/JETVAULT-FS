import { chromium } from 'playwright-core';
const [,, url, out] = process.argv;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(url);
await page.waitForFunction(() => !document.getElementById('loading'), null, { timeout: 180000 });
const cases = [
  ['night-approach', { timeOfDay: 23, cloudCover: 'FEW', visibility: 30000, rain: 0 }, { kind: 'approach', ident: '24', distanceNm: 2 }, 'cockpit', { headPitch: -0.05 }],
  ['dusk-runway', { timeOfDay: 20.6, dayOfYear: 172, cloudCover: 'SCT', visibility: 30000, rain: 0 }, { kind: 'runway', ident: '06' }, 'chase', { orbitAz: 2.6, orbitEl: 0.15, chaseDist: 18 }],
  ['showers', { windDirection: 250, windSpeed: 16, gustSpeed: 26, turbulence: 0.45, visibility: 6000, cloudCover: 'BKN', cloudBaseFt: 1800, rain: 0.6, timeOfDay: 13 }, { kind: 'approach', ident: '24', distanceNm: 3 }, 'cockpit', { headPitch: -0.05 }],
  ['low-cloud-fog', { windSpeed: 3, gustSpeed: 0, turbulence: 0.05, visibility: 800, cloudCover: 'OVC', cloudBaseFt: 600, rain: 0.1, timeOfDay: 9 }, { kind: 'runway', ident: '24' }, 'chase', {}],
  ['above-overcast', { windSpeed: 5, visibility: 30000, cloudCover: 'OVC', cloudBaseFt: 1500, rain: 0, timeOfDay: 15 }, { kind: 'air', east: 0, north: -6000, altFt: 4000, hdg: 0 }, 'chase', { orbitAz: 0.6, orbitEl: 0.2, chaseDist: 25 }],
];
for (const [name, wx, spawn, mode, rig] of cases) {
  await page.evaluate(([wx, spawn, mode, rig]) => { const a = window.jetvault; a.applyWeather({ ...a.weather, ...wx }); a.fly(spawn); a.rig.setMode(mode, a.sim.aircraft); Object.assign(a.rig, rig); }, [wx, spawn, mode, rig]);
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${out}/wx-${name}.png` });
  console.log('shot', name, await page.evaluate(() => { const a = window.jetvault; return JSON.stringify({ night: a.env.night.toFixed(2), light: a.env.lightLevel.toFixed(2), inCloud: a.env.inCloud.toFixed(2), sunEl: a.env.sunElevation.toFixed(1), crashed: a.sim.aircraft.crashed }); }));
}
await browser.close();
