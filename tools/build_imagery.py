"""Sentinel-2 true-colour imagery around EGPH (Copernicus Sentinel data 2025, processed
by ESA; open licence, attribution required). Reprojects the TCI product of tiles 30UVG
and 30VVH (same overpass, 16 May 2025, <0.01 % cloud) onto the local grid and writes
public/data/egph/imagery.jpg covering +/-12 km at 6 m/pixel."""
import os, sys, numpy as np, rasterio
from rasterio.warp import reproject, Resampling
from rasterio.transform import from_origin
from PIL import Image
sys.path.insert(0, os.path.dirname(__file__))
from build_geodata import LOCAL, OUT
HALF, STEP = 12000.0, 6.0
N = int(2 * HALF / STEP)
tf = from_origin(-HALF, HALF, STEP, STEP)
B = "/vsicurl/https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/30"
scenes = [f"{B}/U/VG/2025/5/S2C_30UVG_20250516_0_L2A/TCI.tif", f"{B}/V/VH/2025/5/S2C_30VVH_20250516_0_L2A/TCI.tif"]
out = np.zeros((3, N, N), np.float32)
have = np.zeros((N, N), bool)
for url in scenes:
    with rasterio.open(url) as src:
        for b in range(3):
            tmp = np.zeros((N, N), np.float32)
            reproject(rasterio.band(src, b + 1), tmp, src_transform=src.transform, src_crs=src.crs, dst_transform=tf, dst_crs=LOCAL,
                      resampling=Resampling.bilinear, src_nodata=0, dst_nodata=0)
            m = (tmp > 0) & ~have
            out[b][m] = tmp[m]
        have |= out[0] > 0
        print(url.split('/')[-2], int(have.sum()), "/", N * N)
# mild tone curve: TCI is a linear stretch of reflectance, lift the shadows a little
img = np.clip(255 * (out / 255.0) ** 0.85 * 1.08, 0, 255).astype(np.uint8)
Image.fromarray(np.transpose(img, (1, 2, 0)), "RGB").save(os.path.join(OUT, "imagery.jpg"), quality=86, optimize=True)
print("written", os.path.getsize(os.path.join(OUT, "imagery.jpg")) // 1024, "KB")
