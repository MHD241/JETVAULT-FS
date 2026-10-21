"""Derive general-aviation parking positions from Overture/OSM gate points.

OSM 'airport_gate' nodes sit at the terminal facade (where an airliner's door meets
the jet bridge). A Cessna parked there would be inside the building, so for each gate
we walk away from the nearest building until a 9 m radius (C172 half-span + margin)
circle is clear of all buildings and lies on paved apron. The aircraft faces away from
the building so it can taxi out. Results are written back to airport.json as
"stands": [[x, y, heading_deg_true], ...].

Usage: python3 tools/derive_stands.py [public/data/egph/airport.json]
"""
import json, math, sys
import shapely.geometry as sg
from shapely.ops import unary_union, nearest_points

CLEAR_R = 9.0
TAXIWAY_HALF = 11.5


def derive(ap, clear_r=None):
    clear = clear_r or CLEAR_R
    blds = unary_union([sg.Polygon(b["pts"]).buffer(0) for b in ap["buildings"] if len(b["pts"]) >= 3])
    paved = unary_union([sg.Polygon(p).buffer(0) for p in ap["aprons"]] +
                        [sg.LineString(t).buffer(TAXIWAY_HALF) for t in ap["taxiways"] if len(t) >= 2])
    out = []
    gates = ap.get("gates") or ap["stands"]
    for g in gates:
        x, y = g[0], g[1]
        p = sg.Point(x, y)
        nb = nearest_points(blds, p)[0]
        dx, dy = x - nb.x, y - nb.y
        L = math.hypot(dx, dy)
        if L < 0.5:  # gate inside a building: use direction to the apron centroid
            c = paved.centroid
            dx, dy = c.x - x, c.y - y
            L = math.hypot(dx, dy)
        ux, uy = dx / L, dy / L
        for d in [i * 2.0 for i in range(0, 60)]:
            q = sg.Point(x + ux * d, y + uy * d)
            circ = q.buffer(clear)
            if not circ.intersects(blds) and paved.contains(q.buffer(4.0)):
                hdg = (math.degrees(math.atan2(ux, uy)) + 360) % 360
                if all(math.hypot(q.x - o[0], q.y - o[1]) > 2 * clear for o in out):
                    out.append([round(q.x, 2), round(q.y, 2), round(hdg, 1)])
                break
    return gates, out


if __name__ == "__main__":
    path = sys.argv[1] if len(sys.argv) > 1 else "public/data/egph/airport.json"
    ap = json.load(open(path))
    gates, stands = derive(ap)
    ap["gates"] = gates
    ap["stands"] = stands
    ap["standsJet"] = derive(ap, 20.0)[1]
    json.dump(ap, open(path, "w"), separators=(",", ":"))
    print(f"{len(gates)} gates -> {len(stands)} GA stands")
