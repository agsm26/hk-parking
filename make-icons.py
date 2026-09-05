#!/usr/bin/env python3
"""Draw the home-screen icons for 搵車位 / Car Park HK. Run by hand when the icon changes:

    python3 make-icons.py

Pure Python (zlib only), same approach as the Control Center hub: draw at 4x and
average down so the curves are smooth. A white P on the app's blue, because a
parking sign is what a driver looks for on a crowded home screen.
"""
import struct, zlib

SS = 4
BLUE = (31, 112, 235, 255)     # the app's accent
WHITE = (255, 255, 255, 255)

class Canvas:
    def __init__(self, size):
        self.size = size
        self.px = bytearray(size * size * 4)
    def blend(self, x, y, c):
        if not (0 <= x < self.size and 0 <= y < self.size): return
        i = (y * self.size + x) * 4
        sa = c[3] / 255.0
        if sa >= 1: self.px[i:i+4] = bytes(c); return
        da = self.px[i+3] / 255.0; oa = sa + da * (1 - sa)
        if oa <= 0: return
        for k in range(3):
            self.px[i+k] = int((c[k] * sa + self.px[i+k] * da * (1 - sa)) / oa + 0.5)
        self.px[i+3] = int(oa * 255 + 0.5)
    def rounded_rect(self, x0, y0, w, h, r, c):
        for y in range(int(y0), int(y0 + h)):
            for x in range(int(x0), int(x0 + w)):
                dx = max(x0 + r - x - 0.5, x + 0.5 - (x0 + w - r), 0); dy = max(y0 + r - y - 0.5, y + 0.5 - (y0 + h - r), 0)
                if dx * dx + dy * dy <= r * r: self.blend(x, y, c)
    def disc(self, cx, cy, r, c):
        for y in range(int(cy - r) - 1, int(cy + r) + 2):
            for x in range(int(cx - r) - 1, int(cx + r) + 2):
                if (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r: self.blend(x, y, c)
    def downsample(self, f):
        out = Canvas(self.size // f)
        for y in range(out.size):
            for x in range(out.size):
                acc = [0, 0, 0, 0]
                for yy in range(f):
                    for xx in range(f):
                        i = ((y * f + yy) * self.size + (x * f + xx)) * 4
                        a = self.px[i+3]
                        acc[0] += self.px[i] * a; acc[1] += self.px[i+1] * a; acc[2] += self.px[i+2] * a; acc[3] += a
                j = (y * out.size + x) * 4
                if acc[3]:
                    out.px[j] = acc[0] // acc[3]; out.px[j+1] = acc[1] // acc[3]; out.px[j+2] = acc[2] // acc[3]; out.px[j+3] = acc[3] // (f * f)
        return out

def write_png(path, cv):
    raw = b"".join(b"\x00" + bytes(cv.px[y * cv.size * 4:(y + 1) * cv.size * 4]) for y in range(cv.size))
    def chunk(tag, data): return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xffffffff)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", cv.size, cv.size, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    open(path, "wb").write(png); print(path, cv.size)

def draw(size, corner_ratio, maskable=False):
    S = size * SS; cv = Canvas(S)
    cv.rounded_rect(0, 0, S, S, S * corner_ratio, BLUE)
    # A "P": a stem and a bowl. The bowl is a ring whose left edge coincides with
    # the stem's left edge and whose hole sits entirely to the right of the stem,
    # so drawing ring then stem gives a proper letterform with no masking.
    inset = 0.10 if maskable else 0.0
    def u(v): return S * (inset + v * (1 - 2 * inset))
    def w(v): return S * v * (1 - 2 * inset)
    stem_x, stem_w = u(0.29), w(0.13)
    R, r = w(0.215), w(0.085)
    cx, cy = stem_x + stem_w + r, u(0.39)
    top, bottom = cy - R, u(0.81)
    cv.disc(cx, cy, R, WHITE)
    cv.disc(cx, cy, r, BLUE)
    cv.rounded_rect(stem_x, top, stem_w, bottom - top, stem_w * 0.15, WHITE)
    return cv.downsample(SS)

if __name__ == "__main__":
    write_png("icons/icon-192.png", draw(192, 0.22))
    write_png("icons/icon-512.png", draw(512, 0.22))
    write_png("icons/icon-maskable-512.png", draw(512, 0.0, maskable=True))
    write_png("icons/apple-touch-icon.png", draw(180, 0.0))
