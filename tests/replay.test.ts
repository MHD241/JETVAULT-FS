import { describe, it, expect } from 'vitest';
import { ReplayRecorder, sampleReplay, parseReplay, REPLAY_HZ, Replay } from '../src/replay';

const src = (x: number, yaw = 0) => ({ pos: { x, y: 0, z: -100 }, q: { w: Math.cos(yaw / 2), x: 0, y: 0, z: Math.sin(yaw / 2) }, vel: { x: 50, y: 0, z: 0 }, gearExt: 1, flap: 0.2, spoiler: 0, elevator: 0.01, aileronL: 0, aileronR: 0, rudder: 0 });

describe('replay', () => {
  it('records at 20 Hz and keeps only the last maxSeconds', () => {
    const rec = new ReplayRecorder(10);
    for (let i = 0; i <= 60 * 240; i++) { const t = i / 240; rec.record(t, src(t * 50), 0.5, 1, 12); }
    expect(rec.frames.length).toBeGreaterThan(10 * REPLAY_HZ - 3); expect(rec.frames.length).toBeLessThan(10 * REPLAY_HZ + 5);
    expect(rec.duration).toBeGreaterThan(9.8); expect(rec.duration).toBeLessThan(11);
    expect(rec.frames[rec.frames.length - 1].t).toBeCloseTo(60, 1);
  });
  it('starts over when time goes backwards', () => {
    const rec = new ReplayRecorder(); for (let t = 0; t < 5; t += 0.05) rec.record(t, src(t), 0, 0, 12);
    rec.record(0.5, src(0), 0, 0, 12); expect(rec.frames.length).toBe(1);
  });
  it('interpolates position, attitude and surfaces between frames and clamps outside', () => {
    const rec = new ReplayRecorder(); rec.record(0, src(0, 0), 0, 0, 10); rec.record(0.05, src(10, Math.PI / 2), 1, 1, 11);
    const m = sampleReplay(rec.frames, 0.025);
    expect(m.p[0]).toBeCloseTo(5, 5); expect(m.thr).toBeCloseTo(0.5, 5); expect(m.tod).toBeCloseTo(10.5, 3);
    expect(Math.hypot(...m.q)).toBeCloseTo(1, 6); expect(m.q[3]).toBeGreaterThan(0.3); expect(m.q[3]).toBeLessThan(0.45);   // about 45 deg of yaw: sin(22.5 deg) = 0.38
    expect(sampleReplay(rec.frames, -5).p[0]).toBe(0); expect(sampleReplay(rec.frames, 99).p[0]).toBe(10);
  });
  it('save and load round-trips, and hostile files are rejected or clamped', () => {
    const rec = new ReplayRecorder(); for (let t = 0; t < 2; t += 0.05) rec.record(t, src(t * 10), 0.3, 5, 9);
    const rp: Replay = { version: 1, aircraft: 'a320', airport: 'EGPH', dayOfYear: 190, cloud: 'SCT', windDirection: 240, windSpeed: 8, qnh: 1013, temperatureC: 12, frames: rec.frames };
    const back = parseReplay(JSON.stringify(rp))!;
    expect(back.frames.length).toBe(rec.frames.length); expect(back.aircraft).toBe('a320'); expect(back.frames[10].p).toEqual(rec.frames[10].p);
    expect(parseReplay('nope')).toBeNull(); expect(parseReplay(JSON.stringify({ version: 2, frames: [] }))).toBeNull();
    expect(parseReplay(JSON.stringify({ ...rp, frames: [{ ...rec.frames[0], p: [1, 2] }, rec.frames[1]] }))).toBeNull();
    expect(parseReplay(JSON.stringify({ ...rp, frames: [rec.frames[1], rec.frames[0]] }))).toBeNull();   // time must not go backwards
    const evil = parseReplay(JSON.stringify({ ...rp, aircraft: '<script>x</script>abcdefghijklmnop', frames: [{ ...rec.frames[0], p: [1e30, 0, 0] }, rec.frames[1]] }))!;
    expect(evil.aircraft).not.toMatch(/[<>/]/); expect(evil.frames[0].p[0]).toBe(3e6);
  });
});
