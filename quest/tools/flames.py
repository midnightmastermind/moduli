"""Builds the fireplace's moving flames: assets/office/flame-0.glb .. flame-2.glb, soft flame shapes on quads.
  python3 quest/tools/flames.py

User, 2026-10-27: "id like a fireplace that moves". OfficeActivity.animateFlames sets them in the firebox and makes
each flicker and sway every frame. Each is a quad facing +Z with its origin at the bottom centre, unlit and blended,
so it glows the same in any light."""
import io
import json
import math
import os
import random
import struct

from PIL import Image, ImageFilter

OUT = os.path.join(os.path.dirname(__file__), "../app/src/main/assets/office")


def flame_png(seed, w=128, h=256):
    rnd = random.Random(seed)
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    px = im.load()
    lean = rnd.uniform(-0.12, 0.12)
    for y in range(h):
        t = 1 - y / (h - 1)                      # 0 at the bottom, 1 at the tip
        width = (0.46 * math.sin(math.pi * min(1, (t + 0.08)) ** 0.7) * (1 - t) ** 0.35)
        cx = 0.5 + lean * t * t + 0.03 * math.sin(t * 9 + seed)
        for x in range(w):
            u = x / (w - 1)
            d = abs(u - cx) / max(width, 1e-3)
            if d >= 1:
                continue
            core = (1 - d) ** 1.4 * (1 - t) ** 0.25
            # White-yellow core, orange edges, red at the tip.
            r = 255
            g = int(80 + 170 * core * (1 - 0.5 * t))
            b = int(20 + 140 * max(0, core - 0.55) * (1 - t))
            a = int(255 * min(1, (1 - d) ** 0.8 * (1 - t ** 3) * 1.4))
            px[x, y] = (r, max(0, min(255, g)), max(0, min(255, b)), max(0, min(255, a)))
    im = im.filter(ImageFilter.GaussianBlur(2.2))
    buf = io.BytesIO(); im.save(buf, "PNG"); return buf.getvalue()


def quad_glb(png, wm, hm, path):
    hw = wm / 2
    # Facing +Z, origin at the bottom centre.
    pos = [-hw, 0, 0, hw, 0, 0, hw, hm, 0, -hw, hm, 0]
    uv = [0, 1, 1, 1, 1, 0, 0, 0]
    idx = [0, 1, 2, 0, 2, 3]
    def pad(b, fill=b"\x00"): return b + fill * ((4 - len(b) % 4) % 4)
    blobs = [struct.pack("<12f", *pos), struct.pack("<8f", *uv), struct.pack("<6I", *idx), png]
    views, chunks, off = [], [], 0
    for b, tgt in zip(blobs, (34962, 34962, 34963, None)):
        v = {"buffer": 0, "byteOffset": off, "byteLength": len(b)}
        if tgt: v["target"] = tgt
        views.append(v); b = pad(b); chunks.append(b); off += len(b)
    bin_chunk = b"".join(chunks)
    gltf = {
        "asset": {"version": "2.0", "generator": "moduli flames.py"},
        "extensionsUsed": ["KHR_materials_unlit"],
        "scene": 0, "scenes": [{"nodes": [0]}], "nodes": [{"mesh": 0}],
        "meshes": [{"primitives": [{"attributes": {"POSITION": 0, "TEXCOORD_0": 1}, "indices": 2, "material": 0}]}],
        "materials": [{"pbrMetallicRoughness": {"baseColorTexture": {"index": 0}, "metallicFactor": 0},
                       "alphaMode": "BLEND", "doubleSided": True, "extensions": {"KHR_materials_unlit": {}}}],
        "textures": [{"source": 0, "sampler": 0}],
        "samplers": [{"magFilter": 9729, "minFilter": 9987, "wrapS": 33071, "wrapT": 33071}],
        "images": [{"bufferView": 3, "mimeType": "image/png"}],
        "accessors": [
            {"bufferView": 0, "componentType": 5126, "count": 4, "type": "VEC3", "min": [-hw, 0, 0], "max": [hw, hm, 0]},
            {"bufferView": 1, "componentType": 5126, "count": 4, "type": "VEC2"},
            {"bufferView": 2, "componentType": 5125, "count": 6, "type": "SCALAR"},
        ],
        "bufferViews": views, "buffers": [{"byteLength": len(bin_chunk)}],
    }
    js = pad(json.dumps(gltf, separators=(",", ":")).encode(), b" ")
    out = struct.pack("<4sII", b"glTF", 2, 12 + 8 + len(js) + 8 + len(bin_chunk))
    out += struct.pack("<I4s", len(js), b"JSON") + js + struct.pack("<I4s", len(bin_chunk), b"BIN\x00") + bin_chunk
    open(path, "wb").write(out)


if __name__ == "__main__":
    for i, (w, h) in enumerate([(0.16, 0.30), (0.13, 0.24), (0.11, 0.19)]):
        quad_glb(flame_png(i * 7 + 3), w, h, os.path.join(OUT, f"flame-{i}.glb"))
    print("wrote flame-0..2.glb")
