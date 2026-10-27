"""Builds the ⚙ / 🗑 / "Sure?" buttons beside each piece's grab bar as small textured models (assets/office/menu_*.glb).
  python3 quest/tools/menuButtons.py

They were Compose panels: the headset's cursor hid on them and their clicks never arrived (user, 2026-10-27). As
models they are drawn and hit like the grab bar, the cursor stays on them, and OfficeActivity.pressMenuButton acts on
a trigger press from the controller's own ray.

Each is a flat quad facing -Z (where a panel's face was), centred on the origin, sized like the panels it replaces:
⚙ 0.09 x 0.09 m, 🗑 / "Sure?" 0.15 x 0.09 m. Unlit, so it reads the same in any light."""
import io
import json
import os
import struct

from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(__file__), "../app/src/main/assets/office")
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
BG = (40, 44, 52, 255)
EDGE = (120, 128, 140, 255)


def face(w_px, h_px, draw_fn, bg=BG):
    im = Image.new("RGBA", (w_px, h_px), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([2, 2, w_px - 3, h_px - 3], radius=h_px // 5, fill=bg, outline=EDGE, width=4)
    draw_fn(d, w_px, h_px)
    buf = io.BytesIO(); im.save(buf, "PNG"); return buf.getvalue()


def gear(d, w, h):
    f = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", int(h * 0.72))
    d.text((w / 2, h / 2), "⚙", font=f, fill=(235, 238, 242), anchor="mm")


def trash(d, w, h):
    # A bin: lid with a handle, a tapered body with three ribs.
    cx, s = w / 2, h
    col = (235, 238, 242)
    d.rectangle([cx - s * 0.24, s * 0.22, cx + s * 0.24, s * 0.28], fill=col)
    d.rectangle([cx - s * 0.07, s * 0.15, cx + s * 0.07, s * 0.22], outline=col, width=4)
    d.polygon([(cx - s * 0.2, s * 0.32), (cx + s * 0.2, s * 0.32), (cx + s * 0.16, s * 0.82), (cx - s * 0.16, s * 0.82)], fill=col)
    for k in (-0.08, 0, 0.08):
        d.line([cx + s * k, s * 0.4, cx + s * k * 0.85, s * 0.74], fill=BG, width=5)


def sure(d, w, h):
    f = ImageFont.truetype(FONT, int(h * 0.38))
    d.text((w / 2, h / 2), "Sure?", font=f, fill=(255, 255, 255), anchor="mm")


def quad_glb(png, wm, hm, path):
    hw, hh = wm / 2, hm / 2
    # Facing -Z: seen from -Z, the viewer's right is -X, so u grows toward -X.
    pos = [hw, hh, 0, -hw, hh, 0, -hw, -hh, 0, hw, -hh, 0]
    uv = [0, 0, 1, 0, 1, 1, 0, 1]
    idx = [0, 2, 1, 0, 3, 2]
    def pad(b, fill=b"\x00"): return b + fill * ((4 - len(b) % 4) % 4)
    blobs = [struct.pack("<12f", *pos), struct.pack("<8f", *uv), struct.pack("<6I", *idx), png]
    views, chunks, off = [], [], 0
    for b, tgt in zip(blobs, (34962, 34962, 34963, None)):
        v = {"buffer": 0, "byteOffset": off, "byteLength": len(b)}
        if tgt: v["target"] = tgt
        views.append(v); b = pad(b); chunks.append(b); off += len(b)
    bin_chunk = b"".join(chunks)
    gltf = {
        "asset": {"version": "2.0", "generator": "moduli menuButtons.py"},
        "extensionsUsed": ["KHR_materials_unlit"],
        "scene": 0, "scenes": [{"nodes": [0]}], "nodes": [{"mesh": 0}],
        "meshes": [{"primitives": [{"attributes": {"POSITION": 0, "TEXCOORD_0": 1}, "indices": 2, "material": 0}]}],
        "materials": [{"pbrMetallicRoughness": {"baseColorTexture": {"index": 0}, "metallicFactor": 0},
                       "alphaMode": "MASK", "alphaCutoff": 0.5, "doubleSided": True,
                       "extensions": {"KHR_materials_unlit": {}}}],
        "textures": [{"source": 0, "sampler": 0}],
        "samplers": [{"magFilter": 9729, "minFilter": 9987, "wrapS": 33071, "wrapT": 33071}],
        "images": [{"bufferView": 3, "mimeType": "image/png"}],
        "accessors": [
            {"bufferView": 0, "componentType": 5126, "count": 4, "type": "VEC3", "min": [-hw, -hh, 0], "max": [hw, hh, 0]},
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
    os.makedirs(OUT, exist_ok=True)
    quad_glb(face(128, 128, gear), 0.09, 0.09, os.path.join(OUT, "menu_gear.glb"))
    quad_glb(face(212, 128, trash), 0.15, 0.09, os.path.join(OUT, "menu_trash.glb"))
    quad_glb(face(212, 128, sure, bg=(170, 40, 40, 255)), 0.15, 0.09, os.path.join(OUT, "menu_sure.glb"))
    print("wrote menu_gear.glb, menu_trash.glb, menu_sure.glb")
