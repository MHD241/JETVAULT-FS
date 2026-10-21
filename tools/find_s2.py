"""List Sentinel-2 L2A scenes (AWS open data, Copernicus licence) for MGRS 30UVG and
print the clearest ones by scene cloud cover."""
import json, re, sys, urllib.request
B = "https://sentinel-cogs.s3.us-west-2.amazonaws.com"
def ls(prefix):
    x = urllib.request.urlopen(f"{B}/?list-type=2&prefix={prefix}&delimiter=/", timeout=30).read().decode()
    return re.findall(r"<Prefix>([^<]*)</Prefix>", x)[1:]
res = []
for y in [2022, 2023, 2024, 2025]:
    for m in [4, 5, 6, 7, 8, 9]:
        for sc in ls(f"sentinel-s2-l2a-cogs/30/U/VG/{y}/{m}/"):
            name = sc.rstrip("/").split("/")[-1]
            try:
                j = json.load(urllib.request.urlopen(f"{B}/{sc}{name}.json", timeout=30))
                cc = j["properties"].get("eo:cloud_cover")
                res.append((cc, sc))
            except Exception as e:
                pass
res.sort()
for r in res[:12]: print(r)
