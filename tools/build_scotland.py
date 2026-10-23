"""Scotland world: one shared local frame (transverse Mercator at the EGPH ARP, as for Edinburgh) with
  - a Scotland-wide low-resolution terrain and land-cover grid (800 km square, 500 m cells),
  - high-resolution patches (30 m terrain, 20 m land cover, Sentinel-2 imagery, roads, buildings, airport
    data) around Edinburgh (existing data, copied), Glasgow and Portmoak.

Usage:  python3 tools/build_scotland.py lo            # Scotland-wide terrain + land cover
        python3 tools/build_scotland.py patch egpf    # Glasgow patch (also: egpm)
        python3 tools/build_scotland.py meta          # world meta.json
Sources as in build_geodata.py (Copernicus DEM, ESA WorldCover, Sentinel-2, Overture/OSM, OurAirports).
"""
import csv, json, math, os, shutil, sys
import numpy as np
from PIL import Image
import rasterio
from rasterio.warp import reproject, Resampling
from rasterio.transform import from_origin
from scipy import ndimage
import shapely.geometry as sg
sys.path.insert(0, os.path.dirname(__file__))
import build_geodata as bg
import fetch_overture as fo
from build_geodata import LOCAL, to_local, to_wgs, dem_urls, wc_urls, write_i16, write_buildings, proj_geom, overview_for

ROOT = bg.ROOT
OUT = os.path.join(ROOT, "public", "data", "scot")
LO = dict(half=400000.0, step=500.0)

PATCHES = {
    "egpf": dict(name="Glasgow Airport", lat=55.8719, lon=-4.4331, elev_ft=26, half=14400.0, img_half=9000.0,
                 ident="EGPF", freq=dict(ATIS=129.2, GND=121.7, TWR=118.8, APP=119.1)),
    "egpm": dict(name="Portmoak (Scottish Gliding Centre)", lat=56.191031, lon=-3.328505, elev_ft=350, half=12480.0, img_half=9000.0,
                 ident="EGPM", freq={}),
}


def grid(cx, cy, half, step):
    n = int(round(2 * half / step)) + 1
    return n, from_origin(cx - half - step / 2, cy + half + step / 2, step, step)


def bbox_wgs(cx, cy, half):
    h = half * 1.02
    xs = [cx - h, cx + h, cx + h, cx - h, cx, cx, cx + h, cx - h]
    ys = [cy - h, cy - h, cy + h, cy + h, cy + h, cy - h, cy, cy]
    lon, lat = to_wgs.transform(xs, ys)
    return min(lat), max(lat), min(lon), max(lon)


def warp(urls, cx, cy, half, step, dtype, resampling, fill, overview=None):
    from rasterio.windows import from_bounds
    n, tf = grid(cx, cy, half, step)
    la0, la1, lo0, lo1 = bbox_wgs(cx, cy, half)
    dst = np.full((n, n), np.nan, dtype=np.float32)
    for url in urls(la0, la1, lo0, lo1):
        try:
            kw = {"overview_level": overview} if overview is not None else {}
            src = rasterio.open(url, **kw)
        except Exception:
            continue
        with src:
            win = from_bounds(lo0, la0, lo1, la1, src.transform).round_offsets().round_lengths()
            win = win.intersection(rasterio.windows.Window(0, 0, src.width, src.height))
            if win.width <= 0 or win.height <= 0:
                continue
            arr = src.read(1, window=win).astype(np.float32)
            if src.nodata is not None:
                arr[arr == src.nodata] = np.nan
            tmp = np.full((n, n), np.nan, dtype=np.float32)
            reproject(source=arr, destination=tmp, src_transform=src.window_transform(win), src_crs=src.crs,
                      dst_transform=tf, dst_crs=LOCAL, resampling=resampling, src_nodata=np.nan, dst_nodata=np.nan)
            m = ~np.isnan(tmp)
            dst[m] = tmp[m]
            print("  read", url.split("/")[-1], int(m.sum()), flush=True)
    dst[np.isnan(dst)] = fill
    return dst.astype(dtype)


def build_lo():
    os.makedirs(OUT, exist_ok=True)
    print("DEM lo", flush=True)
    h = warp(dem_urls, 0, 0, LO["half"], LO["step"], np.float32, Resampling.average, 0.0, overview=overview_for(dict(step=LO["step"]), 30))
    write_i16(os.path.join(OUT, "terrain_lo.bin"), h)
    print("land cover lo", flush=True)
    lc = warp(wc_urls, 0, 0, LO["half"], LO["step"], np.uint8, Resampling.mode, 80, overview=overview_for(dict(step=LO["step"]), 10))
    Image.fromarray(lc.astype(np.uint8), "L").save(os.path.join(OUT, "landcover_lo.png"), optimize=True)
    n = grid(0, 0, LO["half"], LO["step"])[0]
    json.dump(dict(n=n, half=LO["half"], step=LO["step"]), open(os.path.join(OUT, "lo.json"), "w"))
    print("done lo", n)


def runways_for(pid, p):
    if pid == "egpf":
        # OurAirports EGPF 05/23 (09/27 is closed). Elevations ft, displaced thresholds ft.
        r = [x for x in csv.DictReader(open(os.path.join(ROOT, "tools", "cache", "runways.csv"))) if x["airport_ident"] == "EGPF" and x["closed"] == "0"][0]
        return [dict(id="05/23", width_ft=float(r["width_ft"]), surface="asphalt", ends=[
            dict(ident="05", lat=float(r["le_latitude_deg"]), lon=float(r["le_longitude_deg"]), elev_ft=26, displaced_ft=0.0),
            dict(ident="23", lat=float(r["he_latitude_deg"]), lon=float(r["he_longitude_deg"]), elev_ft=21, displaced_ft=980.0)])]
    # Portmoak: launch line along the worn track found in the Sentinel-2 imagery (see PROJECT_STATE update 17)
    return [dict(id="10/28", width_ft=100, surface="grass", ends=[
        dict(ident="10", lat=56.191244, lon=-3.33752, elev_ft=350, displaced_ft=0.0),
        dict(ident="28", lat=56.189224, lon=-3.321826, elev_ft=350, displaced_ft=0.0)])]


def runway_geometry(rws):
    out = []
    for rw in rws:
        a, b = rw["ends"]
        ax, ay = to_local.transform(a["lon"], a["lat"]); bx, by = to_local.transform(b["lon"], b["lat"])
        hdg = (math.degrees(math.atan2(bx - ax, by - ay)) + 360) % 360
        out.append(dict(id=rw["id"], width=rw["width_ft"] * 0.3048, length=math.hypot(bx - ax, by - ay), surface=rw["surface"],
                        ends=[dict(ident=e["ident"], x=x, y=y, elev=e["elev_ft"] * 0.3048, displaced=e["displaced_ft"] * 0.3048, hdgTrue=h)
                              for e, x, y, h in ((a, ax, ay, hdg), (b, bx, by, (hdg + 180) % 360))]))
    return out


def flatten(h, cx, cy, half, step, runways, boundary):
    from shapely import contains_xy
    n = h.shape[0]
    xs = cx - half + np.arange(n) * step
    ys = cy + half - np.arange(n) * step
    X, Y = np.meshgrid(xs, ys)
    smooth = ndimage.gaussian_filter(h.astype(np.float64), sigma=200.0 / step)
    inside = contains_xy(boundary.buffer(150), X, Y)
    dist_out = ndimage.distance_transform_edt(~inside) * step
    w = np.clip(1.0 - dist_out / 300.0, 0, 1); w = w * w * (3 - 2 * w)
    surf = smooth.copy()
    for rw in runways:
        a, b = rw["ends"]
        dx, dy = b["x"] - a["x"], b["y"] - a["y"]; L = math.hypot(dx, dy); ux, uy = dx / L, dy / L
        t = (X - a["x"]) * ux + (Y - a["y"]) * uy
        d = np.abs(-(X - a["x"]) * uy + (Y - a["y"]) * ux)
        prof = a["elev"] + (b["elev"] - a["elev"]) * np.clip(t / L, 0, 1)
        rwm = np.clip((250.0 - d) / 175.0, 0, 1) * np.clip((t + 400) / 300.0, 0, 1) * np.clip((L + 400 - t) / 300.0, 0, 1)
        rwm = rwm * rwm * (3 - 2 * rwm)
        surf = surf * (1 - rwm) + prof * rwm
    return h * (1 - w) + surf * w


def build_patch(pid):
    p = PATCHES[pid]
    out = os.path.join(OUT, pid); os.makedirs(out, exist_ok=True)
    cache = os.path.join(ROOT, "tools", f"cache_{pid}"); os.makedirs(cache, exist_ok=True)
    cx, cy = to_local.transform(p["lon"], p["lat"])
    half = p["half"]
    la0, la1, lo0, lo1 = bbox_wgs(cx, cy, half)
    fo.BBOX = (lo0, la0, lo1, la1)
    # --- OSM via Overture
    def cached(name, make):
        f = os.path.join(cache, name)
        if os.path.exists(f):
            return json.load(open(f))
        d = make(); json.dump(d, open(f, "w"), default=str); return d
    infra = cached("infrastructure.geojson", lambda: fo.fetch("base", "infrastructure", ["id", "subtype", "class", "names"], fo.ds.field("subtype") == "airport"))
    blds = cached("buildings.geojson", lambda: fo.fetch("buildings", "building", ["id", "height", "num_floors", "class", "subtype"]))
    boundary, taxiways, aprons, gates, rwl = None, [], [], [], []
    for f in infra["features"]:
        c = f["properties"]["class"]; g = proj_geom(f["geometry"])
        if not (abs(g.centroid.x - cx) < 6000 and abs(g.centroid.y - cy) < 6000):
            continue
        if c in ("international_airport", "airport") and g.geom_type == "Polygon":
            boundary = g if boundary is None or g.area > boundary.area else boundary
        elif c == "taxiway" and g.geom_type == "LineString":
            taxiways.append([[round(x, 2), round(y, 2)] for x, y in g.coords])
        elif c == "apron" and g.geom_type == "Polygon":
            aprons.append([[round(x, 2), round(y, 2)] for x, y in g.exterior.coords][:-1])
        elif c == "airport_gate" and g.geom_type == "Point":
            gates.append([round(g.x, 2), round(g.y, 2)])
        elif c in ("runway", "stopway") and g.geom_type == "LineString":
            rwl.append(dict(cls=c, pts=[[round(x, 2), round(y, 2)] for x, y in g.coords]))
    runways = runway_geometry(runways_for(pid, p))
    if pid == "egpm" or boundary is None:
        boundary = sg.Point(cx, cy).buffer(900 if pid == "egpm" else 2500)
    if pid == "egpm":
        taxiways, aprons, rwl, gates = [], [], [], []   # only the OSM grass strips exist there; they are not modelled
    # --- terrain and land cover (patch frame)
    print(pid, "DEM", flush=True)
    h = warp(dem_urls, cx, cy, half, 30.0, np.float32, Resampling.bilinear, 0.0)
    h = flatten(h, cx, cy, half, 30.0, runways, boundary)
    write_i16(os.path.join(out, "terrain_hi.bin"), h)
    print(pid, "land cover", flush=True)
    lc = warp(wc_urls, cx, cy, half, 20.0, np.uint8, Resampling.mode, 80, overview=overview_for(dict(step=20.0), 10))
    Image.fromarray(lc.astype(np.uint8), "L").save(os.path.join(out, "landcover_hi.png"), optimize=True)
    # --- buildings
    near = boundary.buffer(250)
    airport_blds = []
    for f in blds["features"]:
        g = proj_geom(f["geometry"])
        if g.geom_type != "Polygon" or not near.intersects(g):
            continue
        q = f["properties"]
        hgt = q.get("height") or (3.2 * float(q["num_floors"]) + 1.0 if q.get("num_floors") else 8.0)
        airport_blds.append(dict(h=round(float(hgt), 1), pts=[[round(x, 2), round(y, 2)] for x, y in sg.polygon.orient(g, 1.0).exterior.coords][:-1]))
    # keep the download light: only buildings within BR metres of the airport (the 3D city is not needed further out)
    BR = 5000.0 if pid == "egpf" else 3500.0
    feats = []
    for f in blds["features"]:
        c = sg.shape(f["geometry"]).centroid
        x, y = to_local.transform(c.x, c.y)
        if math.hypot(x - cx, y - cy) <= BR:
            feats.append(f)
    nb = write_buildings(os.path.join(out, "buildings.bin"), feats, boundary)
    airport = dict(icao=p["ident"], name=p["name"], arp=dict(lat=p["lat"], lon=p["lon"], elev=p["elev_ft"] * 0.3048), runways=runways,
                   runwayLines=rwl, taxiways=taxiways, aprons=aprons, stands=[], gates=gates,
                   boundary=[[round(x, 1), round(y, 1)] for x, y in boundary.exterior.coords][:-1], buildings=airport_blds,
                   ils=[], frequencies=p["freq"], navaids=[])
    if gates:
        from derive_stands import derive
        airport["gates"], airport["stands"] = derive(airport)
        airport["standsJet"] = derive(airport, 20.0)[1]
    else:
        e = runways[0]["ends"][0]; hh = math.radians(e["hdgTrue"])
        airport["stands"] = [[round(e["x"] + math.cos(hh) * 40 + 25, 1), round(e["y"] - math.sin(hh) * 40 + 10, 1), round(e["hdgTrue"], 1)]]
    json.dump(airport, open(os.path.join(out, "airport.json"), "w"), separators=(",", ":"))
    # --- roads
    import pyarrow.fs as pfs, pyarrow.dataset as ds
    fs = pfs.S3FileSystem(anonymous=True, region="us-west-2", proxy_options=os.environ.get("HTTPS_PROXY"))
    d = ds.dataset(f"overturemaps-us-west-2/release/{fo.RELEASE}/theme=transportation/type=segment", filesystem=fs, format="parquet")
    rb = bbox_wgs(cx, cy, p["img_half"])
    flt = ((ds.field("bbox", "xmin") > rb[2]) & (ds.field("bbox", "xmax") < rb[3]) & (ds.field("bbox", "ymin") > rb[0]) & (ds.field("bbox", "ymax") < rb[1]) & (ds.field("subtype") == "road"))
    import shapely.wkb
    keep = {"motorway", "trunk", "primary", "secondary", "tertiary", "residential", "unclassified", "service", "living_street"}
    roads = []
    for row in d.to_table(columns=["class", "geometry"], filter=flt).to_pylist():
        if row["class"] not in keep:
            continue
        g = shapely.wkb.loads(row["geometry"])
        if pid == "egpf" and row["class"] in ("service", "living_street"):
            continue  # keep the Glasgow download light (dense city)
        roads.append([row["class"], [[round(x, 1), round(y, 1)] for x, y in (to_local.transform(lon, lat) for lon, lat in g.coords)]])
    json.dump(roads, open(os.path.join(out, "roads.json"), "w"), separators=(",", ":"))
    print(pid, "buildings", nb, "roads", len(roads), "gates", len(gates), flush=True)
    json.dump(dict(id=pid, cx=cx, cy=cy, half=half, imgHalf=p["img_half"], buildings=nb, icao=p["ident"]), open(os.path.join(out, "patch.json"), "w"))


def build_imagery(pid):
    """Sentinel-2 true colour (16 May 2025) around the patch centre, 6 m/pixel, local frame."""
    p = PATCHES[pid]
    cx, cy = to_local.transform(p["lon"], p["lat"])
    HALF, STEP = p["img_half"], 6.0
    N = int(2 * HALF / STEP)
    tf = from_origin(cx - HALF, cy + HALF, STEP, STEP)
    Bk = "/vsicurl/https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/30"
    scenes = {"egpf": [f"{Bk}/U/UG/2025/5/S2C_30UUG_20250516_0_L2A/TCI.tif", f"{Bk}/U/VG/2025/5/S2C_30UVG_20250516_0_L2A/TCI.tif"],
              "egpm": [f"{Bk}/V/VH/2025/5/S2C_30VVH_20250516_0_L2A/TCI.tif"]}[pid]
    out = np.zeros((3, N, N), np.float32); have = np.zeros((N, N), bool)
    for url in scenes:
        with rasterio.open(url) as src:
            for b in range(3):
                tmp = np.zeros((N, N), np.float32)
                reproject(rasterio.band(src, b + 1), tmp, src_transform=src.transform, src_crs=src.crs, dst_transform=tf, dst_crs=LOCAL,
                          resampling=Resampling.bilinear, src_nodata=0, dst_nodata=0)
                m = (tmp > 0) & ~have
                out[b][m] = tmp[m]
            have |= out[0] > 0
            print(pid, url.split("/")[-2], int(have.sum()), "/", N * N, flush=True)
    img = np.clip(255 * (out / 255.0) ** 0.85 * 1.08, 0, 255).astype(np.uint8)
    Image.fromarray(np.transpose(img, (1, 2, 0)), "RGB").save(os.path.join(OUT, pid, "imagery.jpg"), quality=86, optimize=True)


if __name__ == "__main__":
    what = sys.argv[1]
    if what == "lo":
        build_lo()
    elif what == "patch":
        build_patch(sys.argv[2])
    elif what == "imagery":
        build_imagery(sys.argv[2])
