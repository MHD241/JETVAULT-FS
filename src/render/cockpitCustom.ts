// Builds the player's own flight deck (made in the Cockpit Studio) in the 737 body frame.
// The studio's coordinates are mapped to body FRD; "live screen" parts show the instrument canvas.

import * as THREE from 'three';
import { Design, STUDIO_ORIGIN, buildMesh, ScreenKind } from '../studio/parts';

export const CUSTOM_KEY = 'jetvault.studio.cockpit', CUSTOM_USE = 'jetvault.studio.use';

export function loadCustomDesign(): Design | null {
  try {
    // the studio design is only used when asked for (?mycockpit); by default the game shows the full supplied cockpit
    if (localStorage.getItem(CUSTOM_USE) !== '1' || !new URLSearchParams(location.search).has('mycockpit')) return null;
    const d = JSON.parse(localStorage.getItem(CUSTOM_KEY) ?? 'null') as Design | null;
    return d && d.parts?.length ? d : null;
  } catch { return null; }
}

export class CockpitCustom {
  readonly root = new THREE.Group();
  constructor(design: Design, live: THREE.Texture, crops: Record<ScreenKind, number[]>, cw: number, ch: number) {
    // studio (X fwd, Y up, Z right) -> body (x fwd, y right, z down): basis columns (1,0,0), (0,0,-1), (0,1,0)
    const m = new THREE.Matrix4().set(1, 0, 0, STUDIO_ORIGIN.x, 0, 0, 1, STUDIO_ORIGIN.y, 0, -1, 0, STUDIO_ORIGIN.z, 0, 0, 0, 1);
    this.root.matrixAutoUpdate = false; this.root.matrix.copy(m);
    for (const p of design.parts) {
      const mesh = buildMesh(p, design.parts);
      if (p.type === 'screen' && p.screen) {
        const [x, y, w, h] = crops[p.screen];
        const uv = mesh.geometry.getAttribute('uv') as THREE.BufferAttribute;
        const u0 = x / cw, u1 = (x + w) / cw, v0 = 1 - (y + h) / ch, v1 = 1 - y / ch;
        uv.setXY(0, u0, v1); uv.setXY(1, u1, v1); uv.setXY(2, u0, v0); uv.setXY(3, u1, v0); uv.needsUpdate = true;
        mesh.material = new THREE.MeshBasicMaterial({ map: live, toneMapped: false, side: THREE.DoubleSide });
      } else {
        const st = mesh.material as THREE.MeshStandardMaterial; if (st.isMeshStandardMaterial) st.envMapIntensity = 0.1;
      }
      mesh.frustumCulled = false;
      this.root.add(mesh);
    }
  }
  update() { /* static: moving controls are not part of the studio yet */ }
}
