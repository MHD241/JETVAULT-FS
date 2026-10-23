"""JetVault geodata pipeline for the Edinburgh (EGPH) test region.

Produces, in public/data/egph/:
  terrain_hi.bin   Int16 heights (decimetres MSL), 48 km square, 30 m grid
  terrain_lo.bin   Int16 heights (decimetres MSL), 240 km square, 240 m grid
  landcover_hi.png 8-bit ESA WorldCover classes, 48 km square, 20 m grid
  landcover_lo.png 8-bit ESA WorldCover classes, 240 km square, 240 m grid
  airport.json     runways / taxiways / aprons / stands / buildings in local metres
  buildings.bin    extruded footprints for the wider region (see write_buildings)
  meta.json        grid metadata, projection, attribution

Local frame: transverse Mercator centred on the EGPH aerodrome reference point,
x = east (m), y = north (m). Within +/-120 km the scale error is < 0.02 %.

Data sources (see ASSETS_AND_LICENCES.md):
  Copernicus DEM GLO-30 (c) DLR e.V. 2010-2014 and (c) Airbus Defence and Space GmbH
    2014-2018 provided under COPERNICUS by the European Union and ESA.
  ESA WorldCover 10 m 2021 v200, CC BY 4.0.
  OurAirports (public domain) for runway thresholds.
  Overture Maps (OSM-derived, ODbL) for taxiways, aprons, stands, buildings.

Usage:
  pip install rasterio pyproj numpy pyarrow shapely scipy
  python3 tools/fetch_overture.py
  CURL_CA_BUNDLE=... python3 tools/build_geodata.py
"""
import json, math, os, struct
import numpy as np
from PIL import Image
import rasterio
from rasterio.warp import reproject, Resampling
from rasterio.transform import from_origin
from pyproj import CRS, Transformer
from scipy import ndimage
import shapely.geometry as sg
from shapely.ops import transform as shp_transform

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, "tools", "cache" if os.environ.get("AIRPORT", "egph") == "egph" else "cache_" + os.environ.get("AIRPORT"))
REGION = os.environ.get("AIRPORT", "egph")
OUT = os.path.join(ROOT, "public", "data", REGION)

ARP_LAT, ARP_LON = (55.950145, -3.372288) if REGION == "egph" else (56.191031, -3.328505)
LOCAL = CRS.from_proj4(f"+proj=tmerc +lat_0={ARP_LAT} +lon_0={ARP_LON} +k=1 +x_0=0 +y_0=0 +ellps=WGS84 +units=m +no_defs")
WGS = CRS.from_epsg(4326)
to_local = Transformer.from_crs(WGS, LOCAL, always_xy=True)
to_wgs = Transformer.from_crs(LOCAL, WGS, always_xy=True)

HI = dict(half=24000.0, step=30.0) if REGION == "egph" else dict(half=16000.0, step=30.0)
LO = dict(half=120000.0, step=240.0)
LC_HI = dict(half=24000.0, step=20.0) if REGION == "egph" else dict(half=16000.0, step=20.0)
LC_LO = dict(half=120000.0, step=240.0)

# Runway 06/24 from OurAirports (public domain). Elevations in ft.
RUNWAYS = [
    dict(id="06/24", width_ft=148, surface="asphalt",
         ends=[dict(ident="06", lat=55.944, lon=-3.39014, elev_ft=110, hdg_true=59, displaced_ft=700),
               dict(ident="24", lat=55.955898, lon=-3.35506, elev_ft=100, hdg_true=239, displaced_ft=700)]),
]
if REGION == "egpm":
    # Portmoak (Scottish Gliding Centre): OurAirports has the airfield point only, no runways. The launch line
    # follows the worn track visible in the Sentinel-2 imagery (found by a line-contrast search along headings
    # 88-112 deg, ~1,000 m long, heading 103 deg true, ~84 m south of the OpenStreetMap strip); designators come
    # from the heading. Elevation ~350 ft AMSL (Loch Leven basin). Surface: grass.
    RUNWAYS = [
        dict(id="10/28", width_ft=100, surface="grass",
             ends=[dict(ident="10", lat=56.191244, lon=-3.33752, elev_ft=350, hdg_true=103, displaced_ft=0),
                   dict(ident="28", lat=56.189224, lon=-3.321826, elev_ft=350, hdg_true=283, displaced_ft=0)]),
    ]
ILS = []  # not sourced yet; see PROJECT_STATE (do not invent frequencies)


def grid(spec):
    n = int(round(2 * spec["half"] / spec["step"])) + 1
    return n, from_origin(-spec["half"] - spec["step"] / 2, spec["half"] + spec["step"] / 2, spec["step"], spec["step"])


def dem_urls(lat0, lat1, lon0, lon1):
    for la in range(math.floor(lat0), math.floor(lat1) + 1):
        for lo in range(math.floor(lon0), math.floor(lon1) + 1):
            ns = f"N{la:02d}" if la >= 0 else f"S{-la:02d}"
            ew = f"E{lo:03d}" if lo >= 0 else f"W{-lo:03d}"
            name = f"Copernicus_DSM_COG_10_{ns}_00_{ew}_00_DEM"
            yield f"/vsicurl/https://copernicus-dem-30m.s3.amazonaws.com/{name}/{name}.tif"


def wc_urls(lat0, lat1, lon0, lon1):
    seen = set()
    for la in range(math.floor(lat0 / 3) * 3, math.floor(lat1 / 3) * 3 + 1, 3):
        for lo in range(math.floor(lon0 / 3) * 3, math.floor(lon1 / 3) * 3 + 1, 3):
            ns = f"N{la:02d}" if la >= 0 else f"S{-la:02d}"
            ew = f"E{lo:03d}" if lo >= 0 else f"W{-lo:03d}"
            if (ns, ew) in seen:
                continue
            seen.add((ns, ew))
            yield f"/vsicurl/https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_{ns}{ew}_Map.tif"


def bbox_wgs(spec):
    h = spec["half"] * 1.02
    xs = [-h, h, h, -h, 0, 0, h, -h]
    ys = [-h, -h, h, h, h, -h, 0, 0]
    lon, lat = to_wgs.transform(xs, ys)
    return min(lat), max(lat), min(lon), max(lon)


def warp(urls, spec, dtype, resampling, nodata_fill, overview=None, bbox=None):
    """Reproject the part of each source raster inside bbox (lat0, lat1, lon0, lon1) onto the local grid."""
    from rasterio.windows import from_bounds
    n, tf = grid(spec)
    dst = np.full((n, n), np.nan, dtype=np.float32)
    la0, la1, lo0, lo1 = bbox
    for url in urls:
        try:
            kw = {"overview_level": overview} if overview is not None else {}
            src = rasterio.open(url, **kw)
        except Exception as e:  # sea tiles do not exist in Copernicus DEM
            print("  skip", url.split("/")[-1], type(e).__name__)
            continue
        with src:
            win = from_bounds(lo0, la0, lo1, la1, src.transform).round_offsets().round_lengths()
            win = win.intersection(rasterio.windows.Window(0, 0, src.width, src.height))
            arr = src.read(1, window=win).astype(np.float32)
            if src.nodata is not None:
                arr[arr == src.nodata] = np.nan
            tmp = np.full((n, n), np.nan, dtype=np.float32)
            reproject(source=arr, destination=tmp, src_transform=src.window_transform(win),
                      src_crs=src.crs, dst_transform=tf, dst_crs=LOCAL, resampling=resampling,
                      src_nodata=np.nan, dst_nodata=np.nan)
            m = ~np.isnan(tmp)
            dst[m] = tmp[m]
            print("  read", url.split("/")[-1], arr.shape, int(m.sum()))
    dst[np.isnan(dst)] = nodata_fill
    return dst.astype(dtype)


def overview_for(spec, native_m):
    ratio = spec["step"] / native_m
    lvl = None
    for i, f in enumerate([2, 4, 8, 16, 32, 64]):
        if f <= ratio / 1.5:
            lvl = i
    return lvl


def local_xy(lon, lat):
    x, y = to_local.transform(lon, lat)
    return float(x), float(y)


def runway_geometry():
    out = []
    for rw in RUNWAYS:
        a, b = rw["ends"]
        ax, ay = local_xy(a["lon"], a["lat"])
        bx, by = local_xy(b["lon"], b["lat"])
        length = math.hypot(bx - ax, by - ay)
        hdg = (math.degrees(math.atan2(bx - ax, by - ay)) + 360) % 360
        out.append(dict(id=rw["id"], width=rw["width_ft"] * 0.3048, length=length, surface=rw["surface"],
                        ends=[dict(ident=e["ident"], x=x, y=y, elev=e["elev_ft"] * 0.3048,
                                   displaced=e["displaced_ft"] * 0.3048, hdgTrue=h)
                              for e, x, y, h in ((a, ax, ay, hdg), (b, bx, by, (hdg + 180) % 360))]))
    return out


def load_fc(name):
    p = os.path.join(CACHE, name)
    return json.load(open(p)) if os.path.exists(p) else {"features": []}


def proj_geom(g):
    return shp_transform(lambda x, y, z=None: to_local.transform(x, y), sg.shape(g))


def flatten_airport(h, spec, runways, aprons, boundary):
    """Replace the DSM inside the aerodrome with a smooth graded surface.

    Copernicus GLO-30 is a surface model (includes buildings / vehicles), so the raw
    data is too rough to taxi on. Inside the aerodrome boundary the surface becomes a
    heavily low-passed version of the DEM, the runway strip becomes a straight grade
    between the published threshold elevations, and the result is blended back into
    the original terrain over 300 m.
    """
    n, _ = grid(spec)
    s = spec["step"]
    xs = -spec["half"] + np.arange(n) * s
    X, Y = np.meshgrid(xs, xs[::-1])  # row 0 = north
    smooth = ndimage.gaussian_filter(h.astype(np.float64), sigma=200.0 / s)
    from shapely import contains_xy
    inside = contains_xy(boundary.buffer(150), X, Y)
    dist_out = ndimage.distance_transform_edt(~inside) * s
    w = np.clip(1.0 - dist_out / 300.0, 0, 1)
    w = w * w * (3 - 2 * w)
    surf = smooth.copy()
    for rw in runways:
        a, b = rw["ends"]
        dx, dy = b["x"] - a["x"], b["y"] - a["y"]
        L = math.hypot(dx, dy)
        ux, uy = dx / L, dy / L
        t = ((X - a["x"]) * ux + (Y - a["y"]) * uy)
        d = np.abs(-(X - a["x"]) * uy + (Y - a["y"]) * ux)
        tc = np.clip(t / L, 0, 1)
        prof = a["elev"] + (b["elev"] - a["elev"]) * tc
        # extend beyond ends flat; blend from 75 m to 250 m lateral
        rwm = np.clip((250.0 - d) / 175.0, 0, 1) * np.clip((t + 400) / 300.0, 0, 1) * np.clip((L + 400 - t) / 300.0, 0, 1)
        rwm = rwm * rwm * (3 - 2 * rwm)
        surf = surf * (1 - rwm) + prof * rwm
    return h * (1 - w) + surf * w


def write_i16(path, arr_m):
    dm = np.clip(np.round(arr_m * 10.0), -32767, 32767).astype("<i2")
    dm.tofile(path)


def write_buildings(path, feats, airport_boundary):
    """Binary layout (little endian):
       u32 count; per building: u16 nverts, f32 base?, f32 height, then nverts * (f32 x, f32 y)
    Heights default to 3.2 m/floor or 8 m when unknown. Base elevation is sampled at runtime."""
    recs = []
    for f in feats:
        g = f["geometry"]
        if g["type"] == "Polygon":
            polys = [g["coordinates"]]
        elif g["type"] == "MultiPolygon":
            polys = g["coordinates"]
        else:
            continue
        p = f["properties"]
        hgt = p.get("height")
        if hgt is None and p.get("num_floors"):
            hgt = 3.2 * float(p["num_floors"]) + 1.0
        if hgt is None:
            hgt = 8.0
        for poly in polys:
            ring = poly[0]
            xy = [to_local.transform(lon, lat) for lon, lat, *_ in ring][:-1]
            if len(xy) < 3:
                continue
            area = 0.5 * sum(xy[i][0] * xy[(i + 1) % len(xy)][1] - xy[(i + 1) % len(xy)][0] * xy[i][1] for i in range(len(xy)))
            if abs(area) < 8:
                continue
            if area < 0:
                xy = xy[::-1]  # counter-clockwise
            recs.append((float(hgt), xy))
    with open(path, "wb") as fo:
        fo.write(struct.pack("<I", len(recs)))
        for hgt, xy in recs:
            fo.write(struct.pack("<Hf", len(xy), hgt))
            fo.write(np.asarray(xy, dtype="<f4").tobytes())
    return len(recs)


def main():
    os.makedirs(OUT, exist_ok=True)
    infra = load_fc("infrastructure.geojson")
    boundary = None
    taxiways, aprons, stands, rw_lines = [], [], [], []
    for f in infra["features"]:
        c = f["properties"]["class"]
        g = proj_geom(f["geometry"])
        if c in ("international_airport", "airport"):
            boundary = g
        elif c == "taxiway":
            taxiways.append([[round(x, 2), round(y, 2)] for x, y in g.coords])
        elif c == "apron":
            aprons.append([[round(x, 2), round(y, 2)] for x, y in g.exterior.coords][:-1])
        elif c == "airport_gate":
            stands.append([round(g.x, 2), round(g.y, 2)])
        elif c in ("runway", "stopway"):
            rw_lines.append(dict(cls=c, pts=[[round(x, 2), round(y, 2)] for x, y in g.coords]))
    runways = runway_geometry()
    if boundary is None:
        boundary = sg.Point(0, 0).buffer(2500)

    print("DEM hi")
    la0, la1, lo0, lo1 = bbox_wgs(HI)
    hi = warp(dem_urls(la0, la1, lo0, lo1), HI, np.float32, Resampling.bilinear, 0.0, bbox=(la0, la1, lo0, lo1))
    hi = flatten_airport(hi, HI, runways, aprons, boundary)
    write_i16(os.path.join(OUT, "terrain_hi.bin"), hi)

    print("DEM lo")
    la0, la1, lo0, lo1 = bbox_wgs(LO)
    lo = warp(dem_urls(la0, la1, lo0, lo1), LO, np.float32, Resampling.average, 0.0, overview=overview_for(LO, 30), bbox=(la0, la1, lo0, lo1))
    write_i16(os.path.join(OUT, "terrain_lo.bin"), lo)

    print("Landcover hi")
    la0, la1, lo0, lo1 = bbox_wgs(LC_HI)
    lc = warp(wc_urls(la0, la1, lo0, lo1), LC_HI, np.uint8, Resampling.mode, 80, overview=overview_for(LC_HI, 10), bbox=(la0, la1, lo0, lo1))
    Image.fromarray(lc.astype(np.uint8), "L").save(os.path.join(OUT, "landcover_hi.png"), optimize=True)
    print("Landcover lo")
    la0, la1, lo0, lo1 = bbox_wgs(LC_LO)
    lcl = warp(wc_urls(la0, la1, lo0, lo1), LC_LO, np.uint8, Resampling.mode, 80, overview=overview_for(LC_LO, 10), bbox=(la0, la1, lo0, lo1))
    Image.fromarray(lcl.astype(np.uint8), "L").save(os.path.join(OUT, "landcover_lo.png"), optimize=True)

    # Buildings: airport-area ones go to airport.json (collision), all go to buildings.bin (render)
    bld = load_fc("buildings.geojson")["features"]
    airport_blds = []
    near = boundary.buffer(200)
    for f in bld:
        g = proj_geom(f["geometry"])
        if g.geom_type != "Polygon" or not near.intersects(g):
            continue
        p = f["properties"]
        hgt = p.get("height") or (3.2 * float(p["num_floors"]) + 1.0 if p.get("num_floors") else 8.0)
        ring = [[round(x, 2), round(y, 2)] for x, y in sg.polygon.orient(g, 1.0).exterior.coords][:-1]
        airport_blds.append(dict(h=round(float(hgt), 1), pts=ring))
    nb = write_buildings(os.path.join(OUT, "buildings.bin"), bld, boundary)

    lon_c, lat_c = ARP_LON, ARP_LAT
    airport = dict(icao="EGPH" if REGION == "egph" else "EGPM", name="Edinburgh Airport" if REGION == "egph" else "Portmoak (Scottish Gliding Centre)", arp=dict(lat=lat_c, lon=lon_c, elev=(135 if REGION == "egph" else 350) * 0.3048),
                   runways=runways, runwayLines=rw_lines, taxiways=taxiways, aprons=aprons, stands=stands,
                   boundary=[[round(x, 1), round(y, 1)] for x, y in boundary.exterior.coords][:-1],
                   buildings=airport_blds, ils=ILS,
                   frequencies=dict(ATIS=131.35, GND=121.75, TWR=118.7, APP=121.2) if REGION == "egph" else {},
                   navaids=[dict(id="EDN", type="NDB", khz=341, lat=55.97840118408203, lon=-3.2841200828552246),
                            dict(id="UW", type="NDB", khz=368, lat=55.90520095825195, lon=-3.5025100708007812)] if REGION == "egph" else [])
    for nv in airport["navaids"]:
        nv["x"], nv["y"] = local_xy(nv["lon"], nv["lat"])
    if REGION == "egph":
        from derive_stands import derive
        airport["gates"], airport["stands"] = derive(airport)
        airport["standsJet"] = derive(airport, 20.0)[1]
    else:
        # one parking spot on the grass beside the launch point (the first runway end), facing along the runway
        e = runways[0]["ends"][0]
        h = math.radians(e["hdgTrue"])
        airport["gates"] = []
        airport["stands"] = [[round(e["x"] + math.cos(h) * 40 + 25, 1), round(e["y"] - math.sin(h) * 40 + 10, 1), round(e["hdgTrue"], 1)]]
    json.dump(airport, open(os.path.join(OUT, "airport.json"), "w"), separators=(",", ":"))

    meta = dict(
        projection=LOCAL.to_proj4(), origin=dict(lat=ARP_LAT, lon=ARP_LON),
        terrainHi=dict(file="terrain_hi.bin", n=grid(HI)[0], half=HI["half"], step=HI["step"], scale=0.1),
        terrainLo=dict(file="terrain_lo.bin", n=grid(LO)[0], half=LO["half"], step=LO["step"], scale=0.1),
        landcoverHi=dict(file="landcover_hi.png", n=grid(LC_HI)[0], half=LC_HI["half"], step=LC_HI["step"]),
        landcoverLo=dict(file="landcover_lo.png", n=grid(LC_LO)[0], half=LC_LO["half"], step=LC_LO["step"]),
        buildings=dict(file="buildings.bin", count=nb),
        rowOrder="north-to-south",
        attribution=[
            "Copernicus DEM GLO-30: (c) DLR e.V. 2010-2014 and (c) Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA",
            "ESA WorldCover 10 m 2021 v200, (c) ESA WorldCover project, CC BY 4.0",
            "Airport and building geometry: Overture Maps Foundation, derived from OpenStreetMap (c) OpenStreetMap contributors, ODbL",
            "Runway thresholds (EGPH): OurAirports (public domain); Portmoak strip: OpenStreetMap via Overture Maps",
        ])
    json.dump(meta, open(os.path.join(OUT, "meta.json"), "w"), indent=1)
    print("done; buildings:", nb, "airport buildings:", len(airport_blds))


if __name__ == "__main__":
    main()
