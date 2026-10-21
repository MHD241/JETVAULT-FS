"""Fetch Overture Maps (OSM-derived, ODbL) road segments within ~8 km of EGPH and
write public/data/egph/roads.json in local metres: [[class, [[x,y],...]], ...]."""
import json, os, sys
import pyarrow.fs as pfs, pyarrow.dataset as ds, shapely.wkb
sys.path.insert(0, os.path.dirname(__file__))
from build_geodata import to_local, OUT
RELEASE = "2026-09-23.0"
BBOX = (-3.51, 55.88, -3.23, 56.02)
KEEP = {"motorway", "trunk", "primary", "secondary", "tertiary", "residential", "unclassified", "service", "living_street"}
fs = pfs.S3FileSystem(anonymous=True, region="us-west-2", proxy_options=os.environ.get("HTTPS_PROXY"))
d = ds.dataset(f"overturemaps-us-west-2/release/{RELEASE}/theme=transportation/type=segment", filesystem=fs, format="parquet")
f = ((ds.field("bbox", "xmin") > BBOX[0]) & (ds.field("bbox", "xmax") < BBOX[2]) & (ds.field("bbox", "ymin") > BBOX[1]) & (ds.field("bbox", "ymax") < BBOX[3]) & (ds.field("subtype") == "road"))
t = d.to_table(columns=["class", "geometry"], filter=f)
out = []
for row in t.to_pylist():
    if row["class"] not in KEEP:
        continue
    g = shapely.wkb.loads(row["geometry"])
    pts = [[round(x, 1), round(y, 1)] for x, y in (to_local.transform(lon, lat) for lon, lat in g.coords)]
    out.append([row["class"], pts])
json.dump(out, open(os.path.join(OUT, "roads.json"), "w"), separators=(",", ":"))
print(len(out), "road segments")
