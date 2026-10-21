import { flatWorld, newSim, run, kt, ft, TestPilot } from '../../tests/helpers';
import { RAD, KT, FT, DEG } from '../../src/core/math';
const mode = process.argv[2] ?? 'level';
function setup(altFt: number, kias: number, mtow = true) {
  const sim = newSim(flatWorld(0));
  sim.spawn({ kind: 'runway', ident: '36' });
  const ac = sim.aircraft;
  if (mtow) { ac.payload[1] = 1157 - ac.mass; ac.updateMass(); }
  ac.placeInFlight(0, 1000, altFt * FT, 0, kias * KT * Math.sqrt(1.225 / 1.0), 0);
  sim.controls.parkingBrake = false;
  return sim;
}
if (mode === 'level') {
  for (const thr of [0.5, 0.65, 0.8, 1.0]) {
    const sim = setup(3000, 100);
    const p = new TestPilot(sim); sim.controls.throttle = thr;
    run(sim, 150, () => { p.holdAltitudeWithPitch(3000 * FT); p.wingsLevel(0); });
    const ac = sim.aircraft; const [phi, th] = ac.euler;
    console.log(`thr ${thr} alt ${ft(ac.altitude).toFixed(0)} KCAS ${kt(ac.cas).toFixed(1)} KTAS ${kt(ac.tas).toFixed(1)} rpm ${ac.engine.rpm.toFixed(0)} hp ${(ac.engine.power/745.7).toFixed(0)} pitch ${(th*RAD).toFixed(1)} alpha ${(ac.alpha*RAD).toFixed(1)} elev ${(ac.elevator*RAD).toFixed(1)} stick ${sim.controls.pitch.toFixed(2)} roll ${(phi*RAD).toFixed(1)} beta ${(ac.beta*RAD).toFixed(2)} ail ${sim.controls.roll.toFixed(3)} rud ${sim.controls.yaw.toFixed(3)} vs ${(-ac.vel.z/FT*60).toFixed(0)}`);
  }
}
if (mode === 'cruise') {
  const sim = setup(8000, 100, false);
  const p = new TestPilot(sim); sim.controls.throttle = 1;
  // lean to best power: find mixture giving max power
  let best = 1, bestP = 0;
  run(sim, 30, () => { p.holdAltitudeWithPitch(8000 * FT); p.wingsLevel(0); });
  for (let m = 1; m >= 0.6; m -= 0.02) { sim.controls.mixture = m; run(sim, 2, () => { p.holdAltitudeWithPitch(8000 * FT); p.wingsLevel(0); }); if (sim.aircraft.engine.power > bestP) { bestP = sim.aircraft.engine.power; best = m; } }
  sim.controls.mixture = best;
  run(sim, 200, () => { p.holdAltitudeWithPitch(8000 * FT); p.wingsLevel(0); });
  const ac = sim.aircraft;
  console.log(`8000ft full thr mix ${best.toFixed(2)} KTAS ${kt(ac.tas).toFixed(1)} KCAS ${kt(ac.cas).toFixed(1)} rpm ${ac.engine.rpm.toFixed(0)} hp ${(ac.engine.power/745.7).toFixed(0)} gph ${(ac.engine.fuelFlow/0.72*3600/3.785).toFixed(1)} mass ${ac.mass.toFixed(0)}`);
}
if (mode === 'climb') {
  const sim = setup(1000, 74);
  const p = new TestPilot(sim); sim.controls.throttle = 1;
  run(sim, 20, () => { p.holdSpeedWithPitch(74); p.wingsLevel(0); });
  const a0 = sim.aircraft.altitude;
  run(sim, 60, () => { p.holdSpeedWithPitch(74); p.wingsLevel(0); });
  const ac = sim.aircraft;
  console.log(`climb Vy 74: ROC ${(((ac.altitude - a0) / 60) / FT * 60).toFixed(0)} fpm KCAS ${kt(ac.cas).toFixed(1)} rpm ${ac.engine.rpm.toFixed(0)} pitch ${(ac.euler[1]*RAD).toFixed(1)} rud ${sim.controls.yaw.toFixed(2)} ail ${sim.controls.roll.toFixed(2)}`);
}
if (mode === 'stall') {
  for (const flap of [0, 3]) {
    const sim = setup(4000, 70);
    const p = new TestPilot(sim);
    sim.controls.throttle = 0; sim.controls.flapLever = flap; sim.aircraft.flap = flap * 10 * DEG;
    let target = 65; let minCas = 999; let stallAt = 0;
    const t = run(sim, 120, (tt) => {
      const ac = sim.aircraft;
      target = Math.max(20, 65 - tt * 1.0); // 1 kt/s deceleration
      p.holdAltitudeWithPitch(4000 * FT);
      p.wingsLevel(0);
      minCas = Math.min(minCas, kt(ac.cas));
      // stall = uncommanded loss of altitude rate with full aft stick or nose drop
      if (sim.controls.pitch > 0.98 && ac.vel.z > 3 && !stallAt) { stallAt = kt(ac.cas); return true; }
    });
    const ac = sim.aircraft;
    console.log(`flap ${flap*10}: stall at KCAS ${stallAt.toFixed(1)} (min ${minCas.toFixed(1)}) t ${t.toFixed(0)} alpha ${(ac.alpha*RAD).toFixed(1)} wingCL ${ac.wingCL.toFixed(2)} mass ${ac.mass.toFixed(0)} horn ${ac.stallWarning}`);
  }
}
