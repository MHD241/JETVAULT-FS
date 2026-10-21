import { describe, it, expect, beforeAll } from 'vitest';
import { loadEGPH, newSim, run, kt, CALM_ISA } from './helpers';
import { World } from '../src/world/world';
import { DEG, RAD, clamp, Vec3 } from '../src/core/math';

let world: World;
beforeAll(async () => { world = await loadEGPH(); });

describe('EGPH data', () => {
  it('runway 06/24 matches published geometry', () => {
    const rw = world.airport.runways[0];
    expect(rw.id).toBe('06/24');
    expect(rw.length).toBeGreaterThan(2540);
    expect(rw.length).toBeLessThan(2580); // 2556 m published (8392 ft)
    expect(rw.ends[0].hdgTrue).toBeCloseTo(58.8, 0);
  });

  it('terrain at the runway thresholds is within 3 m of the published elevations', () => {
    for (const e of world.airport.runways[0].ends) {
      expect(Math.abs(world.heightAt(e.x, e.y) - e.elev)).toBeLessThan(3);
    }
  });

  it('runway surface is smooth (max local slope < 1.5 %) along the centreline', () => {
    const [a, b] = world.airport.runways[0].ends;
    let prev = world.heightAt(a.x, a.y);
    for (let i = 1; i <= 250; i++) {
      const t = i / 250;
      const h = world.heightAt(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
      expect(Math.abs(h - prev) / (2560 / 250)).toBeLessThan(0.015);
      prev = h;
    }
  });

  it('runway is classified as paved, the infield as grass', () => {
    const [a, b] = world.airport.runways[0].ends;
    expect(world.surfaceAt((a.x + b.x) / 2, (a.y + b.y) / 2).kind).toBe('asphalt');
    // 150 m perpendicular from the runway midpoint
    const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
    expect(world.surfaceAt((a.x + b.x) / 2 - (dy / L) * 150 * -1, (a.y + b.y) / 2 + (dx / L) * 150 * -1).kind).not.toBe('water');
  });

  it('the Firth of Forth is at sea level', () => {
    // a point in the Forth ~1.5 km east of the Forth Bridge, roughly 6 km north of EGPH
    expect(Math.abs(world.heightAt(3000, 9000))).toBeLessThan(6);
  });
});

describe('ground handling at EGPH', () => {
  it('rests on the gear at every stand without sinking, floating or touching buildings', () => {
    const sim = newSim(world, CALM_ISA);
    for (let i = 0; i < world.airport.stands.length; i++) {
      sim.spawn({ kind: 'stand', index: i, coldAndDark: true });
      run(sim, 4);
      const ac = sim.aircraft;
      expect(ac.crashed, `stand ${i}: ${ac.crashReason}`).toBe(false);
      expect(ac.gearStates.every((g) => g.contact)).toBe(true);
      for (const g of ac.gearStates) {
        expect(g.compression).toBeGreaterThan(0.02);
        expect(g.compression).toBeLessThan(0.15);
      }
      expect(ac.contactActive.some((x) => x)).toBe(false);
      expect(ac.vel.len()).toBeLessThan(0.01);
      // each tyre bottom (attach + leg length - compression) lies on the terrain surface
      ac.def.gear.forEach((g, k) => {
        const p = ac.worldPoint(g.attach.add(new Vec3(0, 0, g.length - ac.gearStates[k].compression)));
        expect(Math.abs(-p.z - world.heightAt(p.y, p.x))).toBeLessThan(0.01);
      });
    }
  });

  it('parking brake holds at full power; releasing it lets the aircraft taxi and steer', () => {
    const sim = newSim(world, CALM_ISA);
    sim.spawn({ kind: 'runway', ident: '24' });
    const ac = sim.aircraft, c = sim.controls;
    c.parkingBrake = true; c.throttle = 1;
    const p0 = ac.pos.clone();
    run(sim, 10);
    expect(ac.pos.sub(p0).len()).toBeLessThan(0.05);
    c.parkingBrake = false; c.throttle = 0.35;
    run(sim, 12);
    expect(kt(ac.vel.len())).toBeGreaterThan(5);
    const psi0 = ac.euler[2];
    c.throttle = 0.25; c.yaw = 1; // full right pedal: nosewheel steering
    run(sim, 6);
    let dpsi = ac.euler[2] - psi0;
    dpsi = Math.atan2(Math.sin(dpsi), Math.cos(dpsi));
    expect(dpsi * RAD).toBeGreaterThan(20);
    // brakes stop it
    c.throttle = 0; c.yaw = 0; c.brakeLeft = 1; c.brakeRight = 1;
    run(sim, 10);
    expect(ac.vel.len()).toBeLessThan(0.05);
    expect(ac.crashed).toBe(false);
  });

  it('differential braking pivots the aircraft', () => {
    const sim = newSim(world, CALM_ISA);
    sim.spawn({ kind: 'runway', ident: '06' });
    const ac = sim.aircraft, c = sim.controls;
    c.throttle = 0.3; run(sim, 6);
    const psi0 = ac.euler[2];
    c.brakeLeft = 1; c.yaw = -1; run(sim, 2);
    let dpsi = ac.euler[2] - psi0;
    dpsi = Math.atan2(Math.sin(dpsi), Math.cos(dpsi));
    expect(dpsi * RAD).toBeLessThan(-25);
    expect(ac.crashed).toBe(false);
  });

  it('takes off from runway 24 under full power and climbs away', () => {
    const sim = newSim(world, CALM_ISA);
    sim.spawn({ kind: 'runway', ident: '24' });
    const ac = sim.aircraft, c = sim.controls;
    const psiRw = ac.euler[2];
    c.throttle = 1;
    let liftoff = false;
    run(sim, 60, () => {
      const [phi, th, psi] = ac.euler;
      let e = psiRw - psi; e = Math.atan2(Math.sin(e), Math.cos(e));
      c.yaw = clamp(e * 6 - ac.omega.z * 2, -1, 1);
      c.roll = clamp(-phi * 3 - ac.omega.x * 0.5 + (ac.onGround ? 0 : e * 2), -1, 1);
      c.pitch = kt(ac.cas) > 53 ? clamp(5 * (8 * DEG - th) - ac.omega.y, -1, 1) : 0;
      if (!ac.onGround) liftoff = true;
    });
    expect(liftoff).toBe(true);
    expect(ac.crashed).toBe(false);
    expect(ac.agl).toBeGreaterThan(80);
  });
});
