"""Generates the Fitora app icon set (coral progress ring + white F on the hero teal).

Usage (from mobile/):  python3 scripts/generate-app-icon.py
Needs Pillow. Writes into assets/images/ and assets/fitora/brand-mark.png.
Colors mirror lib/theme.ts (hero gradient, nutrition coral).
"""
import math, os, sys
from PIL import Image, ImageDraw, ImageFilter, ImageChops

SS = 4  # supersample
TEAL_A, TEAL_B = (15, 118, 110), (10, 58, 55)       # hero gradient #0f766e -> #0a3a37
CORAL_A, CORAL_B = (238, 78, 52), (255, 182, 158)   # coral #ee4e34 -> soft #ffb69e (bright head)

def lerp(a, b, t): return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))

def background(n, glow=True):
    im = Image.new("RGB", (n, n))
    px = im.load()
    for y in range(n):
        for x in range(n):
            px[x, y] = lerp(TEAL_A, TEAL_B, (x + y) / (2 * (n - 1)))
    if glow:  # soft light-teal sheen top-left (coral over dark teal reads as brown)
        g = Image.new("L", (n, n), 0)
        ImageDraw.Draw(g).ellipse((-n * 0.45, -n * 0.45, n * 0.55, n * 0.55), fill=90)
        g = g.filter(ImageFilter.GaussianBlur(n * 0.14))
        im = Image.composite(Image.new("RGB", (n, n), (45, 160, 146)), im, g)
    return im

def mark(n, scale=1.0, mono=False):
    """Ring + F on transparent, at size n. scale shrinks content around centre (adaptive safe zone)."""
    N = n * SS
    c = N / 2
    R = N * 0.315 * scale          # ring centre-line radius
    W = N * 0.075 * scale          # ring stroke
    layer = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    box = (c - R - W / 2, c - R - W / 2, c + R + W / 2, c + R + W / 2)
    # track
    track = (255, 255, 255, 60) if not mono else (255, 255, 255, 90)
    d.ellipse(box, outline=track, width=int(W))
    # progress arc: 300 degrees from 12 o'clock, coral gradient, round caps
    start, sweep, steps = -90, 285, 600
    for i in range(steps + 1):
        t = i / steps
        ang = math.radians(start + sweep * t)
        x, y = c + R * math.cos(ang), c + R * math.sin(ang)
        col = (255, 255, 255, 255) if mono else lerp(CORAL_A, CORAL_B, t) + (255,)
        d.ellipse((x - W / 2, y - W / 2, x + W / 2, y + W / 2), fill=col)
    # F, geometric with rounded corners, optically centred (nudged right)
    s = scale
    stem_w, h = N * 0.085 * s, N * 0.30 * s
    top_len, mid_len, bar_h = N * 0.20 * s, N * 0.155 * s, N * 0.075 * s
    left = c - N * 0.075 * s
    top = c - h / 2
    r = int(N * 0.022 * s)
    white = (255, 255, 255, 255)
    d.rounded_rectangle((left, top, left + stem_w, top + h), radius=r, fill=white)
    d.rounded_rectangle((left, top, left + top_len, top + bar_h), radius=r, fill=white)
    my = top + h * 0.43
    d.rounded_rectangle((left, my, left + mid_len, my + bar_h), radius=r, fill=white)
    return layer.resize((n, n), Image.LANCZOS)

def full_icon(n, rounded=False):
    bg = background(n).convert("RGBA")
    bg.alpha_composite(mark(n))
    if rounded:
        m = Image.new("L", (n * SS, n * SS), 0)
        ImageDraw.Draw(m).rounded_rectangle((0, 0, n * SS - 1, n * SS - 1), radius=int(n * SS * 0.225), fill=255)
        bg.putalpha(m.resize((n, n), Image.LANCZOS))
    return bg

root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets")
out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(root, "images")
brand_dir = out if len(sys.argv) > 1 else os.path.join(root, "fitora")
full_icon(1024).convert("RGB").save(f"{out}/icon.png")                       # iOS + default: opaque, full-bleed
mark(1024, scale=0.8).save(f"{out}/adaptive-icon.png")                       # Android foreground, inside safe zone
background(1024, glow=True).save(f"{out}/adaptive-background.png")           # Android background layer
mark(1024, scale=0.8, mono=True).save(f"{out}/adaptive-monochrome.png")      # Android 13 themed icon
full_icon(512, rounded=True).save(f"{out}/splash-icon.png")
full_icon(48, rounded=True).save(f"{out}/favicon.png")
full_icon(152, rounded=True).save(f"{brand_dir}/brand-mark.png")                    # welcome screen logo
print("done")
