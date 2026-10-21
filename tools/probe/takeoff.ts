import { flatWorld, newSim, run, kt, ft, TestPilot } from '../../tests/helpers';
import { RAD, KT, FT, DEG, clamp } from '../../src/core/math';
const sim = newSim(flatWorld(0));
sim.spawn({ kind: 'runway', ident: '36' });
const ac = sim.aircraft;
ac.payload[1] = 1157 - ac.mass; ac.updateMass();
const c = sim.controls;
c.flapLever = 1; ac.flap = 10 * DEG;
c.brakeLeft = 1; c.brakeRight = 1; c.throttle = 1; c.mixture = 1;
run(sim, 8);
const x0 = ac.pos.x;
console.log('brakes held at full power, rpm', ac.engine.rpm.toFixed(0), 'moved', (ac.pos.x - x0).toFixed(2));
c.brakeLeft = 0; c.brakeRight = 0;
const p = new TestPilot(sim);
let liftoff = 0, liftT = 0, at50 = 0, maxPitch = 0, rotateAt = 0;
let iY = 0;
run(sim, 60, (t) => {
  const [phi, th, psi] = ac.euler;
  maxPitch = Math.max(maxPitch, th);
  const ias = kt(ac.cas);
  // centreline tracking with rudder/nosewheel (heading 0, east offset y)
  const latErr = ac.pos.y; iY += latErr * 0.001;
  if (ac.onGround) {
    c.yaw = clamp(-psi * 6 - latErr * 0.05 - ac.omega.z * 2, -1, 1);
    c.roll = clamp(-phi * 3, -1, 1);
    c.pitch = ias > 49 ? clamp(6 * (10 * DEG - th) - 1.0 * ac.omega.y, -1, 1) : 0;
    if (ias > 51 && !rotateAt) rotateAt = ac.pos.x - x0;
  } else {
    if (!liftoff) { liftoff = ac.pos.x - x0; liftT = t; console.log('liftoff KIAS', ias.toFixed(1), 'pitch', (th*RAD).toFixed(1)); }
    p.holdSpeedWithPitch(57); p.wingsLevel(0);
    if (!at50 && ac.agl - 0.95 > 50 * FT) { at50 = ac.pos.x - x0; return true; }
  }

});
console.log(`rotate ${ft(rotateAt).toFixed(0)} ft, ground roll ${ft(liftoff).toFixed(0)} ft (${liftT.toFixed(1)} s), to 50 ft ${ft(at50).toFixed(0)} ft; POH flaps10 short-field: 960 / 1630 ft. max pitch ${(maxPitch*RAD).toFixed(1)} crashed ${ac.crashed} ${ac.crashReason}`);
console.log('events', ac.events.map(e=>e.name));
