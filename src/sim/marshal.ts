// Stand marshal: works out which signal a marshaller standing in front of an airliner stand gives,
// from the aircraft's position relative to the stand centreline (pure function, unit tested).
// Geometry: the stand has an aircraft datum position and a nose heading (compass, rad); the aircraft
// arrives from behind it, so "along" is how far the datum still has to travel.

export type MarshalSignal = 'idle' | 'ahead' | 'left' | 'right' | 'slow' | 'stop' | 'brakes' | 'engines' | 'overshoot';

export interface MarshalStand { east: number; north: number; heading: number }
export interface MarshalAircraft {
  east: number; north: number; heading: number; // datum position (local ENU) and nose heading (compass rad)
  speed: number; // ground speed, m/s
  parkingBrake: boolean; enginesRunning: boolean;
}
export interface MarshalCall {
  signal: MarshalSignal;
  /** Distance the datum still has to travel to the stop mark (m), negative once past it. */
  distance: number;
  /** Datum offset right of the stand centreline (m); positive means turn left to get back on it. */
  lateral: number;
  /** Turn needed, deg: positive = turn right. */
  turnDeg: number;
  text: string;
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export function marshalCall(st: MarshalStand, a: MarshalAircraft): MarshalCall {
  const fx = Math.sin(st.heading), fy = Math.cos(st.heading), rx = fy, ry = -fx;
  const dx = a.east - st.east, dy = a.north - st.north;
  const along = dx * fx + dy * fy, lateral = dx * rx + dy * ry;
  const distance = -along;
  // aim at the centreline: the line from the aircraft to a point on it ~one aircraft-length ahead of where it is now
  const aim = Math.max(18, distance * 0.75);
  const want = st.heading - Math.atan2(Math.max(-30, Math.min(30, lateral)), aim);
  const turn = wrap(want - a.heading);
  const turnDeg = (turn * 180) / Math.PI;
  const mk = (signal: MarshalSignal, text: string): MarshalCall => ({ signal, distance, lateral, turnDeg, text });
  if (distance < -2.5) return mk('overshoot', 'MARSHAL: STOP - you are past the stop mark. Set the brake; ask for pushback to reposition');
  const stopped = a.speed < 0.4;
  if (distance < 1.0 || (stopped && distance < 2.0)) {
    if (!a.parkingBrake) return mk('stop', 'MARSHAL: STOP - set the parking brake (K)');
    if (a.enginesRunning) return mk('engines', 'MARSHAL: cut the engines (use the mixture/cut-off or throttle idle; the bridge can now connect)');
    return mk('brakes', 'MARSHAL: parked. Chocks in. Connect the jet bridge (J)');
  }
  if (Math.abs(lateral) > 1.2 && distance < 10) return mk('stop', `MARSHAL: STOP - ${Math.abs(lateral).toFixed(1)} m ${lateral > 0 ? 'right' : 'left'} of the centreline, you cannot be corrected here`);
  if (distance < 12 || (distance < 22 && a.speed > 3.5)) return mk('slow', `MARSHAL: slow - ${Math.max(0, distance).toFixed(0)} m to stop`);
  if (turnDeg > 7) return mk('right', `MARSHAL: turn right  (${Math.round(distance)} m to go)`);
  if (turnDeg < -7) return mk('left', `MARSHAL: turn left  (${Math.round(distance)} m to go)`);
  return mk('ahead', `MARSHAL: come ahead - ${Math.round(distance)} m to stop`);
}
