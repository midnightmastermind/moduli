"""Paints the VR window's outdoor view into the app's assets (office/window_view.jpg).
  python3 quest/tools/windowView.py"""
import math
import os
import random

from PIL import Image, ImageDraw, ImageFilter

OUT = os.path.join(os.path.dirname(__file__), "../app/src/main/assets/office/window_view.jpg")
W, H = 1200, 900


def mix(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def ridge(rnd, base, amp, freq):
    ph = [rnd.uniform(0, 6.28) for _ in range(3)]
    return [base + amp * (0.55 * math.sin(x * freq + ph[0]) + 0.3 * math.sin(x * freq * 2.3 + ph[1])
                          + 0.15 * math.sin(x * freq * 5.1 + ph[2])) for x in range(W + 1)]


def main():
    rnd = random.Random(5)
    img = Image.new("RGB", (W, H))
    d = ImageDraw.Draw(img)
    for y in range(H):  # sky: deep blue at the top to warm haze at the horizon
        d.line([(0, y), (W, y)], fill=mix((92, 140, 196), (238, 214, 180), min(1, y / (H * 0.62))))
    d.ellipse([820, 150, 920, 250], fill=(255, 238, 200))
    img = img.filter(ImageFilter.GaussianBlur(1))
    d = ImageDraw.Draw(img)
    for base, amp, freq, col in ((520, 70, 0.006, (146, 160, 186)), (590, 55, 0.009, (104, 122, 140)),
                                 (660, 40, 0.013, (70, 92, 84))):
        r = ridge(rnd, base, amp, freq)
        d.polygon([(0, H)] + [(x, r[x]) for x in range(0, W + 1, 4)] + [(W, H)], fill=col)
    d.rectangle([0, 760, W, H], fill=(86, 118, 66))  # meadow
    for _ in range(26):  # pines along the meadow edge
        x, h = rnd.randint(0, W), rnd.randint(90, 190)
        y = 770 + rnd.randint(0, 40)
        col = (28 + rnd.randint(0, 15), 58 + rnd.randint(0, 20), 40)
        d.polygon([(x, y - h), (x - h * 0.28, y), (x + h * 0.28, y)], fill=col)
        d.rectangle([x - 4, y, x + 4, y + 14], fill=(70, 48, 30))
    img.save(OUT, quality=88)
    print("wrote", OUT)


if __name__ == "__main__":
    main()
