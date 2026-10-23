"""Fetch Overture Maps (OSM-derived, ODbL) airport infrastructure and buildings
around Edinburgh Airport into tools/cache/*.geojson.

Usage: python3 tools/fetch_overture.py
"""
import json, os, sys
import pyarrow.fs as pfs, pyarrow.dataset as ds
import shapely.wkb, shapely.geometry

RELEASE = "2026-09-23.0"
REGION = os.environ.get("AIRPORT", "egph")
BBOX = (-3.47, 55.90, -3.27, 56.00) if REGION == "egph" else (-3.47, 56.12, -3.19, 56.26)  # lon_min, lat_min, lon_max, lat_max
OUT = os.path.join(os.path.dirname(__file__), "cache" if REGION == "egph" else f"cache_{REGION}")

fs = pfs.S3FileSystem(anonymous=True, region="us-west-2", proxy_options=os.environ.get("HTTPS_PROXY"))

def fetch(theme, typ, columns, extra_filter=None):
    path = f"overturemaps-us-west-2/release/{RELEASE}/theme={theme}/type={typ}"
    d = ds.dataset(path, filesystem=fs, format="parquet")
    f = ((ds.field("bbox", "xmin") > BBOX[0]) & (ds.field("bbox", "xmax") < BBOX[2]) &
         (ds.field("bbox", "ymin") > BBOX[1]) & (ds.field("bbox", "ymax") < BBOX[3]))
    if extra_filter is not None:
        f = f & extra_filter
    t = d.to_table(columns=columns + ["geometry"], filter=f)
    feats = []
    for row in t.to_pylist():
        g = shapely.wkb.loads(row.pop("geometry"))
        feats.append({"type": "Feature", "properties": row, "geometry": shapely.geometry.mapping(g)})
    return {"type": "FeatureCollection", "features": feats}

if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    which = sys.argv[1:] or ["infrastructure", "buildings", "water"]
    if "infrastructure" in which:
        fc = fetch("base", "infrastructure", ["id", "subtype", "class", "names"],
                   ds.field("subtype") == "airport")
        json.dump(fc, open(os.path.join(OUT, "infrastructure.geojson"), "w"), default=str)
        print("infrastructure", len(fc["features"]))
    if "buildings" in which:
        fc = fetch("buildings", "building", ["id", "height", "num_floors", "class", "subtype"])
        json.dump(fc, open(os.path.join(OUT, "buildings.geojson"), "w"), default=str)
        print("buildings", len(fc["features"]))
    if "water" in which:
        fc = fetch("base", "water", ["id", "subtype", "class"])
        json.dump(fc, open(os.path.join(OUT, "water.geojson"), "w"), default=str)
        print("water", len(fc["features"]))
