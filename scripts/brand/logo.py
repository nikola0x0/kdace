# Builds web/public/brand/logo.svg (dissolving) and logo-clean.svg: a spade whose top is a rounded three-point crown.
import math, sys
from PIL import Image, ImageDraw
OUT = sys.argv[1]
def bayer(n):
    if n == 1: return [[0]]
    b = bayer(n // 2); m = n // 2
    return [[4 * b[y % m][x % m] + [[0, 2], [3, 1]][y // m][x // m] for x in range(n)] for y in range(n)]
B8 = bayer(8)
def bez(p0, p1, p2, p3, n=60):
    return [((1-t)**3*p0[0]+3*(1-t)**2*t*p1[0]+3*(1-t)*t**2*p2[0]+t**3*p3[0], (1-t)**3*p0[1]+3*(1-t)**2*t*p1[1]+3*(1-t)*t**2*p2[1]+t**3*p3[1]) for t in [i/n for i in range(1, n+1)]]
def qbez(a, c, b, n=16):
    return [((1-t)**2*a[0]+2*(1-t)*t*c[0]+t**2*b[0], (1-t)**2*a[1]+2*(1-t)*t*c[1]+t**2*b[1]) for t in [i/n for i in range(n+1)]]
def toward(a, b, d):
    L = math.dist(a, b); return (a[0]+(b[0]-a[0])*d/L, a[1]+(b[1]-a[1])*d/L)
def rounded(prev, v, nxt, r):
    return qbez(toward(v, prev, r), v, toward(v, nxt, r))
# Left half, top centre going anticlockwise; the right half is its mirror, so the shape is exactly symmetric.
peakC, valley, peakL = (50, 3), (38.5, 27), (26, 14)
side = bez(peakL, (20, 30), (8, 42), (8, 62)) + bez((8, 62), (8, 80), (32, 86), (44, 73)) + [(36, 96)]
left = rounded((61.5, 27), peakC, valley, 10)[len(rounded((61.5, 27), peakC, valley, 10))//2:]  # right half of the centre cap
left += rounded(peakC, valley, peakL, 4)
# Round the outer peak: from 9 units down the valley edge to the first side point 9 units away, so nothing overshoots.
k = next(i for i, q in enumerate(side) if math.dist(q, peakL) >= 9)
left += qbez(toward(peakL, valley, 9), peakL, side[k])
left += side[k+1:]
right = [(100 - x, y) for x, y in reversed(left)]
P = left + right
def area(poly): return abs(sum(a[0]*b[1]-b[0]*a[1] for a, b in zip(poly, poly[1:]+poly[:1]))) / 2
def clip(poly, x0, y0, x1, y1):
    def edge(pts, inside, inter):
        out = []
        for i in range(len(pts)):
            a, b = pts[i-1], pts[i]
            if inside(b):
                if not inside(a): out.append(inter(a, b))
                out.append(b)
            elif inside(a): out.append(inter(a, b))
        return out
    ix = lambda a, b, x: (x, a[1] + (x-a[0]) / (b[0]-a[0]) * (b[1]-a[1]))
    iy = lambda a, b, y: (a[0] + (y-a[1]) / (b[1]-a[1]) * (b[0]-a[0]), y)
    p = poly
    for ins, it in ((lambda q: q[0] >= x0, lambda a, b: ix(a, b, x0)), (lambda q: q[0] <= x1, lambda a, b: ix(a, b, x1)),
                    (lambda q: q[1] >= y0, lambda a, b: iy(a, b, y0)), (lambda q: q[1] <= y1, lambda a, b: iy(a, b, y1))):
        if not p: break
        p = edge(p, ins, it)
    return p
f = lambda v: f"{v:.3f}".rstrip("0").rstrip(".")
path = lambda poly: "M" + "L".join(f"{f(x)} {f(y)}" for x, y in poly) + "Z"
n = 64; s = 100 / n; CUTROW = 30; CUT = CUTROW * s
parts = [path(clip(P, 0, 0, 100, CUT))]
kept = []
# Below the cut everything is whole square pixels (a cell counts only if it is almost fully inside the outline), and cells near the
# outline dissolve sooner than the middle, so the curved edges clear away first instead of lingering as a rim.
inside = lambda i, j: 0 <= i < n and 0 <= j < n and (lambda c: bool(c) and area(c) >= 0.9 * s * s)(clip(P, i*s, j*s, (i+1)*s, (j+1)*s))
for j in range(CUTROW, n):
    for i in range(n):
        if not inside(i, j): continue
        ring = [inside(i+dx, j+dy) for dx in range(-2, 3) for dy in range(-2, 3) if dx or dy]
        edge = 1 - sum(ring) / len(ring)                     # 0 deep inside, larger near the outline
        m = ((j + .5 - CUTROW) / (n - CUTROW - 4)) ** 1.6 * (1 + 3.5 * edge)
        if m >= (B8[j % 8][i % 8] + .5) / 64: continue
        kept.append((i, j, [(i*s, j*s), ((i+1)*s, j*s), ((i+1)*s, (j+1)*s), (i*s, (j+1)*s)], True))
runs = {}
for i, j, c, full in kept:
    if full: runs.setdefault(j, []).append(i)
    else: parts.append(path(c))
for j, xs in runs.items():
    xs.sort(); a = b = xs[0]
    for x in xs[1:] + [None]:
        if x is not None and x == b + 1: b = x; continue
        parts.append(f"M{f(a*s)} {f(j*s)}H{f((b+1)*s)}V{f((j+1)*s)}H{f(a*s)}Z")
        if x is not None: a = b = x
open(f"{OUT}/logo.svg", "w").write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill="#fff" d="{"".join(parts)}"/></svg>')
open(f"{OUT}/logo-clean.svg", "w").write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill="#fff" d="{path(P)}"/></svg>')
S = 8; img = Image.new("L", (200*S, 100*S), 255); dr = ImageDraw.Draw(img)
dr.polygon([(x*S, y*S) for x, y in clip(P, 0, 0, 100, CUT)], fill=0)
for i, j, c, full in kept: dr.polygon([(x*S, y*S) for x, y in c], fill=0)
dr.polygon([((x+100)*S, y*S) for x, y in P], fill=0)
img.save(sys.argv[2])
