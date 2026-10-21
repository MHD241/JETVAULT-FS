import { flatWorld, newSim, run, kt, ft, TestPilot } from '../../tests/helpers';
import { RAD, KT, FT, DEG, clamp } from '../../src/core/math';
const sim = newSim(flatWorld(0));
sim.spawn({ kind: 'approach', ident: '36', distanceNm: 2 });
const ac = sim.aircraft; const c = sim.controls;
ac.payload[1] = 1157 - ac.mass; ac.updateMass();
c.flapLever = 3;
const p = new TestPilot(sim);
let thrI = 0.3, phase = 'app', tdX = 0, tdSink = 0, stopX = 0, flareStart = 0;
const tdAim = 300; // touchdown aim (m beyond threshold)
const t = run(sim, 240, (tt) => {
  const ias = kt(ac.cas);
  const [phi, th, psi] = ac.euler;
  const hgt = ac.agl - 0.95;
  if (phase === 'app') {
    // glidepath 3 deg to aim point; pitch flies the path, throttle holds 65 KIAS
    const dist = tdAim - ac.pos.x;
    const gpAlt = Math.tan(3 * DEG) * dist;
    const vsCmd = -Math.tan(3 * DEG) * ac.vel.x + (gpAlt - hgt) * 0.25;
    const vs = -ac.vel.z;
    const thetaCmd = clamp(th + (vsCmd - vs) * 0.02, -8 * DEG, 10 * DEG);
    c.pitch = clamp(3 * (thetaCmd - th) - 1.2 * ac.omega.y + c.pitch * 0.995 * 0, -1, 1) + 0.0;
    p.holdAltitudeWithPitch; // unused
    thrI = clamp(thrI + (61 + 4 - ias) * 0.002 * 1/240 * 240 * 0.01, 0, 1);
    c.throttle = clamp(thrI + (65 - ias) * 0.03, 0, 1);
    p.wingsLevel(0);
    c.yaw = clamp(c.yaw - ac.pos.y * 0.02, -1, 1);
    if (hgt < 6) { phase = 'flare'; flareStart = tt; }
  } else if (phase === 'flare') {
    c.throttle = 0;
    const vs = -ac.vel.z;
    const vsCmd = -Math.max(0.3, hgt * 0.35);
    const thetaCmd = clamp(th + (vsCmd - vs) * 0.03, -2 * DEG, 12 * DEG);
    c.pitch = clamp(3 * (thetaCmd - th) - 1.2 * ac.omega.y, -1, 1);
    p.wingsLevel(0);
    const mains = ac.gearStates[1].contact || ac.gearStates[2].contact;
    if (mains) { phase = 'roll'; tdX = ac.pos.x; tdSink = Math.max(ac.gearStates[1].touchdownSink, ac.gearStates[2].touchdownSink); console.log(`touchdown KIAS ${ias.toFixed(1)} sink ${(tdSink/FT*60).toFixed(0)} fpm pitch ${(th*RAD).toFixed(1)} x ${ac.pos.x.toFixed(0)} m after ${(tt-flareStart).toFixed(1)}s flare`); }
  } else {
    c.throttle = 0; c.pitch = 0.3;
    c.brakeLeft = c.brakeRight = ac.gearStates[0].contact ? 1 : 0;
    c.yaw = clamp(-psi * 5 - ac.pos.y * 0.05, -1, 1);
    c.roll = 0;
    if (ac.vel.len() < 0.05) { stopX = ac.pos.x; return true; }
  }
});
console.log(`phase ${phase}, landing ground roll ${ft(stopX - tdX).toFixed(0)} ft (POH short field 575 ft) crashed ${ac.crashed} ${ac.crashReason} lateral ${ac.pos.y.toFixed(1)} m nz max ${ac.maxLoadFactor.toFixed(2)}`);
