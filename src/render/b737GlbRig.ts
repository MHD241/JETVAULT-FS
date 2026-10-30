/** Animation rig for the supplied, single-node glTF 737 exterior.
 *
 * Its 141 primitives have no named joints.  We identify the independently
 * modelled trailing-edge panels by their measured, model-local bounds.  Unlike
 * the older FBX rig this does not cut or replace the main wing skin: it moves
 * existing glTF primitives only.  A change to the source asset must be audited
 * before these mappings are reused.
 */
import * as THREE from 'three';
import type { Aircraft } from '../sim/fdm/aircraft';

type Kind = 'aileronL' | 'aileronR' | 'flapL' | 'flapR' | 'elevatorL' | 'elevatorR' | 'rudder';
type Surface = { pivot: THREE.Group; kind: Kind; neutral: THREE.Quaternion };

// Primitive numbers in public/models/b738_geo.bin (glTF 2.0). Kept together
// here so the asset mapping is inspectable and can be replaced independently.
export const GLB_737_SURFACES: Record<Kind, readonly number[]> = {
  aileronL: [73, 77], aileronR: [109, 111],
  flapL: [41, 42, 57, 58], flapR: [112, 113, 115, 116],
  elevatorL: [29, 30, 32, 33, 34], elevatorR: [35, 36, 37, 38],
  rudder: [137],
};

/** Split a glTF primitive into its own pivot group, preserving its original mesh/material. */
export class B737GlbRig {
  readonly report: string[] = [];
  private surfaces: Surface[] = [];

  constructor(root: THREE.Object3D) {
    const meshes: THREE.Mesh[] = [];
    root.traverse((object) => { if ((object as THREE.Mesh).isMesh) meshes.push(object as THREE.Mesh); });
    // Each primitive has a separate bounding box in the source glTF. Three.js
    // normally creates one Mesh per primitive; refuse silent mis-mapping if
    // the loader merged these primitives into fewer render objects.
    if (meshes.length !== 141) {
      this.report.push(`not rigged: expected 141 meshes, got ${meshes.length}`);
      return;
    }
    const frame = new THREE.Vector3();
    for (const [kind, indices] of Object.entries(GLB_737_SURFACES) as [Kind, readonly number[]][]) {
      let n = 0;
      for (const idx of indices) {
        const mesh = meshes[idx];
        if (!mesh || !mesh.parent) continue;
        mesh.geometry.computeBoundingBox();
        const bb = mesh.geometry.boundingBox;
        if (!bb || bb.isEmpty()) continue;
        const parent = mesh.parent;
        // Refuse unexpected primitive transforms rather than moving geometry
        // around the wrong hinge in a future asset revision.
        if (mesh.position.lengthSq() > 1e-10 || mesh.rotation.x || mesh.rotation.y || mesh.rotation.z ||
            mesh.scale.distanceToSquared(new THREE.Vector3(1, 1, 1)) > 1e-10) continue;
        // Preserve the rest transform, and attach the part under a new hinge.
        // Original glTF root has identity transforms; use local coordinates.
        const hinge = bb.getCenter(frame).clone();
        if (kind === 'rudder') {
          hinge.z = bb.min.z + (bb.max.z - bb.min.z) * 0.25;
        } else {
          hinge.z = bb.min.z + (bb.max.z - bb.min.z) * 0.28;
        }
        const pivot = new THREE.Group();
        pivot.name = `JV737_${kind}_${idx}`;
        pivot.position.copy(hinge);
        parent.add(pivot);
        // Reposition the existing mesh relative to its hinge.
        mesh.position.sub(hinge);
        pivot.add(mesh);
        this.surfaces.push({ pivot, kind, neutral: pivot.quaternion.clone() });
        n++;
      }
      this.report.push(`${kind}: ${n}/${indices.length}`);
    }
  }

  update(ac: Aircraft): void {
    for (const { pivot, kind, neutral } of this.surfaces) {
      const angle = kind === 'aileronL' ? ac.aileronL
        : kind === 'aileronR' ? ac.aileronR
        : kind === 'flapL' || kind === 'flapR' ? ac.flap
        : kind === 'elevatorL' || kind === 'elevatorR' ? ac.elevator
        : ac.rudder;
      const axis = kind === 'rudder' ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
      // In the source glTF, +Y is up and +Z points aft.
      pivot.quaternion.copy(neutral).multiply(new THREE.Quaternion().setFromAxisAngle(axis, angle));
    }
  }
}
