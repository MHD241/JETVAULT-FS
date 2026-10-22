// Passenger boarding bridges at the OSM gate positions. Visual only (no collision): each is a
// tube from the terminal/pier facade out toward the apron with a cab at the end and a support column.
// The direction is the outward normal of the nearest terminal/pier wall; lengths are estimates.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Building, pointInPoly } from '../world/obstacles';

const LENGTH = 24; // m, extended length from the facade to the cab
const FLOOR = 3.6; // m above ground (737 forward door sill height)

function tint(g: THREE.BufferGeometry, c: THREE.Color) {
  const n = g.attributes.position.count;
  g.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: n }, () => [c.r, c.g, c.b]).flat(), 3));
  return g;
}

export function buildJetBridges(gates: [number, number][], buildings: Building[], groundAt: (e: number, n: number) => number) {
  const group = new THREE.Group();
  group.name = 'jet bridges';
  const terms = buildings.filter((b) => b.role === 'terminal' || b.role === 'pier');
  const parts: THREE.BufferGeometry[] = [];
  const used: [number, number][] = [];
  const tube = new THREE.Color(0.40, 0.44, 0.50), dark = new THREE.Color(0.10, 0.12, 0.15), col = new THREE.Color(0.80, 0.82, 0.85), yellow = new THREE.Color(0.95, 0.75, 0.08);
  for (const [gx, gy] of gates) {
    if (used.some(([x, y]) => Math.hypot(x - gx, y - gy) < 9)) continue;
    // nearest wall of any terminal/pier
    let best = { d: Infinity, px: 0, py: 0, nx: 0, ny: 0, b: null as Building | null };
    for (const b of terms) {
      const n = b.pts.length / 2;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const ax = b.pts[2 * i], ay = b.pts[2 * i + 1], bx = b.pts[2 * j], by = b.pts[2 * j + 1];
        const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
        if (l2 < 1) continue;
        const t = Math.max(0, Math.min(1, ((gx - ax) * dx + (gy - ay) * dy) / l2));
        const px = ax + dx * t, py = ay + dy * t, d = Math.hypot(gx - px, gy - py);
        if (d < best.d) {
          const L = Math.sqrt(l2);
          let nx = dy / L, ny = -dx / L;
          if (pointInPoly(b.pts, px + nx * 0.5, py + ny * 0.5)) { nx = -nx; ny = -ny; }
          best = { d, px, py, nx, ny, b };
        }
      }
    }
    if (!best.b || best.d > 40) continue;
    used.push([gx, gy]);
    const base = groundAt(best.px, best.py);
    const ang = Math.atan2(best.ny, best.nx); // direction in the east/north plane
    const place = (g: THREE.BufferGeometry, along: number, up: number) => {
      // local x = outward direction. three.js: x east, y up, z -north.
      g.rotateY(ang); // rotates x toward (cos, 0, -sin) i.e. east/north-correct
      g.translate(best.px + best.nx * along, base + up, -(best.py + best.ny * along));
      parts.push(g);
    };
    const tubeG = tint(new THREE.BoxGeometry(LENGTH - 3, 3.0, 3.6), tube);
    place(tubeG, (LENGTH - 3) / 2, FLOOR + 1.3);
    const roofG = tint(new THREE.BoxGeometry(LENGTH - 3, 0.2, 3.8), col);
    place(roofG, (LENGTH - 3) / 2, FLOOR + 3.0);
    const winG = tint(new THREE.BoxGeometry(LENGTH - 5, 0.8, 3.66), dark);
    place(winG, (LENGTH - 3) / 2, FLOOR + 1.9);
    const cab = tint(new THREE.CylinderGeometry(2.4, 2.4, 3.2, 16), tube);
    place(cab, LENGTH - 1.2, FLOOR + 1.3);
    const wheelBar = tint(new THREE.BoxGeometry(0.5, FLOOR - 0.3, 0.5), dark);
    place(wheelBar, LENGTH - 5, (FLOOR - 0.3) / 2);
    const foot = tint(new THREE.BoxGeometry(2.2, 0.35, 1.2), dark);
    place(foot, LENGTH - 5, 0.17);
    const hood = tint(new THREE.BoxGeometry(4, 3.8, 4.4), col);
    place(hood, 0.5, FLOOR + 1.6);
    // stand lead-in line and stop bar painted on the apron beyond the cab
    const lead = tint(new THREE.BoxGeometry(50, 0.06, 0.45), yellow);
    place(lead, LENGTH + 4 + 25, 0.1);
    const bar = tint(new THREE.BoxGeometry(0.5, 0.06, 9), yellow);
    place(bar, LENGTH + 30, 0.1);
  }
  if (parts.length) {
    const mesh = new THREE.Mesh(mergeGeometries(parts.map((g) => g.toNonIndexed()))!, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.3 }));
    mesh.castShadow = true;
    group.add(mesh);
  }
  return group;
}
