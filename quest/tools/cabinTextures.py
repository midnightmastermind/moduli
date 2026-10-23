"""Writes the VR cabin's tileable wood textures into the app's res/drawable-nodpi (RoomAnchor's VR room uses them).
  python3 quest/tools/cabinTextures.py
Each texture tiles in both directions, so the room surfaces can repeat it however big the walls are."""
import math
import os
import random

from PIL import Image, ImageDraw, ImageFilter

OUT = os.path.join(os.path.dirname(__file__), "../app/src/main/res/drawable-nodpi")
N = 512


def grain(draw, x0, y0, x1, y1, base, rnd, horizontal=True, lines=26):
    """Wood grain: faint wavy lines along the board, lighter and darker than its base colour."""
    for _ in range(lines):
        shade = rnd.randint(-22, 18)
        col = tuple(max(0, min(255, c + shade)) for c in base)
        if horizontal:
            y = rnd.uniform(y0, y1)
            amp, ph, fr = rnd.uniform(0.5, 2.5), rnd.uniform(0, 6.28), rnd.uniform(0.01, 0.03)
            pts = [(x, y + amp * math.sin(x * fr * 2 * math.pi / 8 + ph)) for x in range(x0, x1 + 1, 4)]
        else:
            x = rnd.uniform(x0, x1)
            amp, ph, fr = rnd.uniform(0.5, 2.5), rnd.uniform(0, 6.28), rnd.uniform(0.01, 0.03)
            pts = [(x + amp * math.sin(y * fr * 2 * math.pi / 8 + ph), y) for y in range(y0, y1 + 1, 4)]
        draw.line(pts, fill=col, width=1)


def logs():
    """Four round logs stacked, lit from above, dark chinking between them, a few knots. Tiles both ways."""
    rnd = random.Random(7)
    img = Image.new("RGB", (N, N))
    d = ImageDraw.Draw(img)
    h = N // 4
    for i in range(4):
        y0 = i * h
        base = (rnd.randint(118, 138), rnd.randint(74, 86), rnd.randint(40, 50))
        for y in range(h):
            t = y / (h - 1)
            # A log is round: light on top, dark toward the bottom.
            k = 0.62 + 0.55 * math.sin(math.pi * t) - 0.18 * t
            col = tuple(int(max(0, min(255, c * k))) for c in base)
            d.line([(0, y0 + y), (N, y0 + y)], fill=col)
        grain(d, 0, y0 + 10, N, y0 + h - 14, base, rnd, horizontal=True, lines=30)
        for _ in range(2):
            kx, ky = rnd.randint(20, N - 20), y0 + rnd.randint(30, h - 40)
            d.ellipse([kx - 7, ky - 5, kx + 7, ky + 5], fill=(70, 42, 22))
            d.ellipse([kx - 3, ky - 2, kx + 3, ky + 2], fill=(50, 30, 15))
        # Chinking (the mortar line) under each log.
        d.rectangle([0, y0 + h - 9, N, y0 + h - 1], fill=(196, 182, 160))
        d.line([(0, y0 + h - 9), (N, y0 + h - 9)], fill=(60, 40, 25), width=2)
    return img.filter(ImageFilter.GaussianBlur(0.6))


def planks(light=False):
    """Six boards across, ends staggered, each its own tone. Ceiling boards are lighter."""
    rnd = random.Random(11 if light else 3)
    img = Image.new("RGB", (N, N))
    d = ImageDraw.Draw(img)
    w = N // 6
    for i in range(6):
        x0 = i * w
        seam = rnd.randint(40, N - 40)
        for (a, b) in ((0, seam), (seam, N)):
            base = (rnd.randint(150, 175), rnd.randint(108, 125), rnd.randint(66, 78)) if light else \
                   (rnd.randint(110, 135), rnd.randint(70, 86), rnd.randint(38, 50))
            d.rectangle([x0, a, x0 + w, b], fill=base)
            grain(d, x0 + 2, a, x0 + w - 2, b, base, rnd, horizontal=False, lines=12)
            d.line([(x0, a), (x0 + w, a)], fill=(45, 28, 15), width=2)
        d.line([(x0, 0), (x0, N)], fill=(40, 25, 14), width=3)
    return img.filter(ImageFilter.GaussianBlur(0.5))


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    logs().save(os.path.join(OUT, "cabin_logs.png"))
    planks().save(os.path.join(OUT, "cabin_floor.png"))
    planks(light=True).save(os.path.join(OUT, "cabin_ceiling.png"))
    print("wrote", sorted(f for f in os.listdir(OUT) if f.startswith("cabin_")))
