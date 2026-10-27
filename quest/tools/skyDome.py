"""Builds assets/office/skydome.glb: an inside-out sphere with a 360° photo on it, unlit (KHR_materials_unlit).
  python3 quest/tools/skyDome.py <equirect.jpg> [--yaw DEG]

The photo is Poly Haven's "Joburg Central Sunset" (CC0), tonemapped JPG resized to 4096x2048:
  https://polyhaven.com/a/sunset_jhbcentral
RoomAnchor shows it in VR mode outside the apartment's windows. Built as one of the app's own models because the SDK's
built-in meshes did not show on the headset (GrabHandle.kt). --yaw turns the view about the vertical axis (degrees).

glTF frame: +Y up. A direction (x, y, z) samples the photo at u = 0.5 + atan2(x, -z) / 2pi, v = acos(y) / pi, so
the photo's centre column is straight ahead along -Z before the yaw."""
import json
import math
import os
import struct
import sys

OUT = os.path.join(os.path.dirname(__file__), "../app/src/main/assets/office/skydome.glb")
RADIUS = 120.0
SEG_U, SEG_V = 96, 48


def build(jpg_path, yaw_deg=0.0):
    yaw = math.radians(yaw_deg)
    pos, uv, idx = [], [], []
    for j in range(SEG_V + 1):
        v = j / SEG_V
        theta = v * math.pi                      # 0 at the top
        for i in range(SEG_U + 1):
            u = i / SEG_U
            phi = (u - 0.5) * 2 * math.pi + yaw  # longitude
            x = math.sin(theta) * math.sin(phi)
            y = math.cos(theta)
            z = -math.sin(theta) * math.cos(phi)
            pos += [x * RADIUS, y * RADIUS, z * RADIUS]
            uv += [u, v]
    row = SEG_U + 1
    for j in range(SEG_V):
        for i in range(SEG_U):
            a, b, c, d = j * row + i, j * row + i + 1, (j + 1) * row + i, (j + 1) * row + i + 1
            # Wound to face INWARD (seen from the centre).
            idx += [a, b, c, b, d, c]
    img = open(jpg_path, "rb").read()

    def pad(b, fill=b"\x00"):
        return b + fill * ((4 - len(b) % 4) % 4)
    pos_b = struct.pack(f"<{len(pos)}f", *pos)
    uv_b = struct.pack(f"<{len(uv)}f", *uv)
    idx_b = struct.pack(f"<{len(idx)}I", *idx)
    chunks, views, off = [], [], 0
    for blob, target in ((pos_b, 34962), (uv_b, 34962), (idx_b, 34963), (img, None)):
        v = {"buffer": 0, "byteOffset": off, "byteLength": len(blob)}
        if target: v["target"] = target
        views.append(v)
        blob = pad(blob)
        chunks.append(blob); off += len(blob)
    bin_chunk = b"".join(chunks)
    n = len(pos) // 3
    xs, ys, zs = pos[0::3], pos[1::3], pos[2::3]
    gltf = {
        "asset": {"version": "2.0", "generator": "moduli skyDome.py"},
        "extensionsUsed": ["KHR_materials_unlit"],
        "scene": 0, "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, "name": "skydome"}],
        "meshes": [{"primitives": [{"attributes": {"POSITION": 0, "TEXCOORD_0": 1}, "indices": 2, "material": 0}]}],
        "materials": [{
            "name": "sky",
            "pbrMetallicRoughness": {"baseColorTexture": {"index": 0}, "metallicFactor": 0, "roughnessFactor": 1},
            "extensions": {"KHR_materials_unlit": {}},
            "doubleSided": True,
        }],
        "textures": [{"source": 0, "sampler": 0}],
        "samplers": [{"magFilter": 9729, "minFilter": 9987, "wrapS": 10497, "wrapT": 33071}],
        "images": [{"bufferView": 3, "mimeType": "image/jpeg"}],
        "accessors": [
            {"bufferView": 0, "componentType": 5126, "count": n, "type": "VEC3",
             "min": [min(xs), min(ys), min(zs)], "max": [max(xs), max(ys), max(zs)]},
            {"bufferView": 1, "componentType": 5126, "count": n, "type": "VEC2"},
            {"bufferView": 2, "componentType": 5125, "count": len(idx), "type": "SCALAR"},
        ],
        "bufferViews": views,
        "buffers": [{"byteLength": len(bin_chunk)}],
    }
    js = pad(json.dumps(gltf, separators=(",", ":")).encode(), b" ")
    total = 12 + 8 + len(js) + 8 + len(bin_chunk)
    out = struct.pack("<4sII", b"glTF", 2, total)
    out += struct.pack("<I4s", len(js), b"JSON") + js
    out += struct.pack("<I4s", len(bin_chunk), b"BIN\x00") + bin_chunk
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    open(OUT, "wb").write(out)
    print(f"wrote {OUT} ({len(out) // 1024} KB, {n} vertices)")


if __name__ == "__main__":
    args = sys.argv[1:]
    yaw = 0.0
    if "--yaw" in args:
        k = args.index("--yaw"); yaw = float(args[k + 1]); del args[k:k + 2]
    build(args[0], yaw)
