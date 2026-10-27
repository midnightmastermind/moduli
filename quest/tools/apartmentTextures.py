"""Writes the VR apartment's surfaces into the app's res/drawable-nodpi (RoomAnchor's VR room uses them).
  python3 quest/tools/apartmentTextures.py

VR mode turns the scanned room into a high-rise apartment: every wall becomes floor-to-ceiling windows (the city at
sunset is outside, quest/tools/skyDome.py), the floor light oak, the ceiling plain white.

apartment_window.png is drawn for ONE wall, bottom to top (RoomAnchor maps it with repeatV = 1): a plaster band with
a baseboard, a stone sill at about waist height, then window frames to the ceiling. The glass is fully transparent
(alpha 0) — the wall material is MASKED, so the frames are solid and the panes are open, with no sorting problems.
It repeats across the wall (repeatU), one bay per repeat, so the outer frame edges meet the next bay's."""
import math
import os
import random

from PIL import Image, ImageDraw, ImageFilter

OUT = os.path.join(os.path.dirname(__file__), "../app/src/main/res/drawable-nodpi")

W, H = 512, 1024            # one window bay; H spans the whole wall height
SILL = 0.34                 # fraction of the wall height below the glass (~0.85m on a 2.5m wall)
FRAME = (38, 38, 42)        # dark bronze aluminium
FRAME_HI = (70, 68, 66)


def window():
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    rnd = random.Random(7)
    sill_y = int(H * (1 - SILL))
    # Plaster below the sill, with a little noise so it is not a flat colour.
    for y in range(sill_y, H):
        for x in range(0, W, 2):
            n = rnd.randint(-5, 5)
            c = (226 + n, 222 + n, 214 + n, 255)
            d.point((x, y), fill=c); d.point((x + 1, y), fill=c)
    # Baseboard.
    d.rectangle([0, H - 34, W, H], fill=(244, 242, 238, 255))
    d.line([0, H - 34, W, H - 34], fill=(205, 200, 192, 255), width=2)
    # Stone sill with a lit front edge and a shadow under it.
    d.rectangle([0, sill_y - 14, W, sill_y + 10], fill=(214, 210, 202, 255))
    d.line([0, sill_y - 14, W, sill_y - 14], fill=(240, 238, 232, 255), width=3)
    d.rectangle([0, sill_y + 10, W, sill_y + 18], fill=(170, 164, 154, 255))
    # Frames: outer verticals at both edges (half each, so two bays meet as one mullion), a head at the ceiling,
    # a bottom rail on the sill and a transom a third of the way down.
    top = 0
    bottom = sill_y - 14
    def bar(x0, y0, x1, y1):
        d.rectangle([x0, y0, x1, y1], fill=FRAME + (255,))
        d.line([x0, y0, x0, y1] if x1 - x0 < y1 - y0 else [x0, y0, x1, y0], fill=FRAME_HI + (255,), width=2)
    bar(0, top, 13, bottom)
    bar(W - 14, top, W, bottom)
    bar(0, top, W, top + 22)
    bar(0, bottom - 24, W, bottom)
    transom = top + int((bottom - top) * 0.22)
    bar(0, transom, W, transom + 14)
    im.save(os.path.join(OUT, "apartment_window.png"))


def floor():
    """Light oak planks, tileable."""
    n = 512
    im = Image.new("RGB", (n, n))
    d = ImageDraw.Draw(im)
    rnd = random.Random(3)
    rows, pw = 6, n // 6
    for r in range(rows):
        off = rnd.randint(0, n)
        x = -off
        while x < n:
            ln = rnd.randint(200, 360)
            base = (rnd.randint(178, 196), rnd.randint(140, 156), rnd.randint(98, 112))
            for xx in (x, x + n):
                d.rectangle([xx, r * pw, xx + ln, (r + 1) * pw], fill=base)
                for _ in range(22):
                    y = rnd.uniform(r * pw + 2, (r + 1) * pw - 2)
                    sh = rnd.randint(-16, 10)
                    col = tuple(max(0, min(255, c + sh)) for c in base)
                    amp, ph = rnd.uniform(0.4, 1.6), rnd.uniform(0, 6.3)
                    pts = [(t, y + amp * math.sin(t / 40 + ph)) for t in range(int(xx), int(xx + ln), 6)]
                    d.line(pts, fill=col, width=1)
                d.line([xx, r * pw, xx, (r + 1) * pw], fill=(120, 92, 62), width=2)
            x += ln
        d.line([0, r * pw, n, r * pw], fill=(126, 96, 64), width=2)
    im = im.filter(ImageFilter.GaussianBlur(0.6))
    im.save(os.path.join(OUT, "apartment_floor.png"))


def ceiling():
    n = 256
    im = Image.new("RGB", (n, n))
    rnd = random.Random(5)
    px = im.load()
    for y in range(n):
        for x in range(n):
            v = 238 + rnd.randint(-4, 3)
            px[x, y] = (v, v, v - 3)
    im = im.filter(ImageFilter.GaussianBlur(0.8))
    im.save(os.path.join(OUT, "apartment_ceiling.png"))


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    window(); floor(); ceiling()
    print("wrote apartment_window.png, apartment_floor.png, apartment_ceiling.png")
