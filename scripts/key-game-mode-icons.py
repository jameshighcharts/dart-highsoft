#!/usr/bin/env python3
"""
Key AI-generated game-mode icons (JPEGs with a *painted* checkerboard instead
of an alpha channel) onto real transparency.

Default: process every scripts/assets/game-mode-icons/<name>.jpg and write
public/game-icons/<name>.png, a 512x512 square with the icon centred on a
transparent canvas (the picker and home tiles downscale from there).

    python3 scripts/key-game-mode-icons.py               # all sources
    python3 scripts/key-game-mode-icons.py killer.jpg    # one source, slug from filename
    python3 scripts/key-game-mode-icons.py path/to/x.jpg x01   # explicit slug

Two things make a naive "remove the grey" pass fail on these images:

  * the generator's checkerboard is not a perfect lattice - the grid lines are
    globally regular, but there are blob-shaped regions where the light/dark
    parity flips, and intermediate-grey seams between them;
  * the icons are frosted glass with the checkerboard visibly showing through,
    i.e. they are genuinely semi-transparent, and so are the neon glows.

So this is a real two-background matte:

  1. Fit the grid (sub-pixel period and phase in x and y) from the cell edges
     in the empty margins.
  2. Classify every grid cell as light / dark / unknown from its interior
     pixels. Unknown cells (under an icon) get a parity from the visible
     checker structure when that is decisive, otherwise by propagating
     alternation from known cells.
  3. Triangulation matting (Smith & Blinn): the same foreground sits over two
     known backgrounds in adjacent cells, so
         I_light - I_dark = (1 - alpha) * (B_light - B_dark)
     gives alpha from the *local* contrast between light and dark cells,
     independent of the foreground colour.
  4. Pixels far from both greys are forced opaque, a coarse-scale estimate
     lifts texture-induced dips inside solid paint, verified-clean background
     cells are forced to zero.
  5. Un-premultiply the colour against B so the glow keeps its true hue.

Requires: pillow, numpy, scipy (pip install --user pillow numpy scipy)
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[1]
SRC_DIR = ROOT / "scripts" / "assets" / "game-mode-icons"
OUT_DIR = ROOT / "public" / "game-icons"

# Output names follow the GameType keys used by the app (see NewGameOptions).
ICON_LABELS: dict[str, str] = {
    "x01": "X01",
    "cricket": "Cricket",
    "killer": "Killer",
    "shanghai": "Shanghai",
    "around_the_clock": "Around the Clock",
    "bengt": "Bengt",
}

SQUARE_SIZE = 512
MARGIN = 24  # px of empty checkerboard around the sheet used for calibration


def load(path: Path) -> np.ndarray:
    return np.asarray(Image.open(path).convert("RGB"), dtype=np.float64)


def margin_ring(shape: tuple[int, int], m: int = MARGIN) -> np.ndarray:
    h, w = shape
    ring = np.zeros((h, w), bool)
    ring[:m, :] = ring[-m:, :] = True
    ring[:, :m] = ring[:, -m:] = True
    return ring


def smoothstep(x: np.ndarray, lo: float, hi: float) -> np.ndarray:
    t = np.clip((x - lo) / (hi - lo), 0.0, 1.0)
    return t * t * (3 - 2 * t)


# --------------------------------------------------------------------------- #
# 1. Grid fit
# --------------------------------------------------------------------------- #
def _fit_edges(grad_profile: np.ndarray) -> tuple[float, float]:
    """Fit edge positions = phase + k*period to the peaks of a gradient profile."""
    thr = grad_profile.max() * 0.35
    peaks = [
        i for i in range(1, len(grad_profile) - 1)
        if grad_profile[i] > thr and grad_profile[i] >= grad_profile[i - 1] and grad_profile[i] > grad_profile[i + 1]
    ]
    pos = []
    for i in peaks:  # parabolic sub-pixel refinement
        a, b, c = grad_profile[i - 1], grad_profile[i], grad_profile[i + 1]
        denom = a - 2 * b + c
        pos.append(i + (0.5 * (a - c) / denom if denom != 0 else 0.0))
    pos = np.array(pos)
    diffs = np.diff(pos)
    med = float(np.median(diffs))
    # Every edge is present in the empty margins, so consecutive peaks are
    # consecutive edges. (The median gap alone rounds to a whole pixel and
    # drifts over a hundred cells.)
    if not np.all((diffs > 0.6 * med) & (diffs < 1.4 * med)):
        raise SystemExit("checkerboard edge detection found a missing/extra edge in the margins")
    k = np.arange(len(pos), dtype=float)
    A = np.vstack([np.ones_like(k), k]).T
    phase, period = np.linalg.lstsq(A, pos, rcond=None)[0]
    resid = np.abs(A @ np.array([phase, period]) - pos).max()
    if resid > 1.5:
        raise SystemExit(f"checkerboard grid fit is poor (max residual {resid:.2f}px)")
    return float(period), float(phase % period)


def fit_grid(img: np.ndarray) -> dict:
    lum = img.mean(axis=2)
    strips_h = np.vstack([lum[:MARGIN, :], lum[-MARGIN:, :]])
    strips_v = np.hstack([lum[:, :MARGIN], lum[:, -MARGIN:]])
    gx = np.abs(np.diff(strips_h, axis=1)).sum(axis=0)
    gy = np.abs(np.diff(strips_v, axis=0)).sum(axis=1)
    period_x, phase_x = _fit_edges(gx)
    period_y, phase_y = _fit_edges(gy)
    # np.diff places the edge between i and i+1 -> edge is at i+1 in pixel space
    return {
        "period_x": period_x,
        "phase_x": (phase_x + 1) % period_x,
        "period_y": period_y,
        "phase_y": (phase_y + 1) % period_y,
    }


# --------------------------------------------------------------------------- #
# 2. Per-cell background model
# --------------------------------------------------------------------------- #
def cell_indices(shape: tuple[int, int], g: dict) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Per-pixel (cell row, cell col) plus distance to the nearest cell edge."""
    h, w = shape
    fx = (np.arange(w) + 0.5 - g["phase_x"]) / g["period_x"]
    fy = (np.arange(h) + 0.5 - g["phase_y"]) / g["period_y"]
    cx = np.floor(fx).astype(int)
    cy = np.floor(fy).astype(int)
    dx = np.minimum(fx - cx, cx + 1 - fx) * g["period_x"]
    dy = np.minimum(fy - cy, cy + 1 - fy) * g["period_y"]
    edge_dist = np.minimum(dy[:, None], dx[None, :])
    return cy[:, None].repeat(w, 1), cx[None, :].repeat(h, 0), edge_dist


def build_background(img: np.ndarray, g: dict) -> tuple[np.ndarray, np.ndarray, dict]:
    """Return (B rgb model, per-pixel 'is light cell' float coverage, stats)."""
    h, w, _ = img.shape
    lum = img.mean(axis=2)
    sat = img.max(axis=2) - img.min(axis=2)
    cy, cx, edge_dist = cell_indices((h, w), g)
    cy -= cy.min()
    cx -= cx.min()
    n_rows, n_cols = cy.max() + 1, cx.max() + 1
    flat_id = cy * n_cols + cx
    n_cells = n_rows * n_cols

    interior = edge_dist > 2.0  # stay clear of the JPEG-blurred cell borders

    # Grey levels from the margins (robust to a few edge pixels).
    ring = margin_ring((h, w)) & interior & (sat < 10)
    vals = lum[ring]
    lo, hi = np.percentile(vals, [10, 90])
    for _ in range(20):
        assign = np.abs(vals - lo) < np.abs(vals - hi)
        lo, hi = vals[assign].mean(), vals[~assign].mean()
    g_dark, g_light = float(lo), float(hi)
    tol = (g_light - g_dark) * 0.18

    # Per-cell interior median luminance / mean saturation.
    ids = flat_id[interior]
    cell_med = np.full(n_cells, np.nan)
    cell_sat = np.full(n_cells, np.nan)
    order = np.argsort(ids, kind="stable")
    ids_sorted = ids[order]
    lum_sorted = lum[interior][order]
    sat_sorted = sat[interior][order]
    bounds = np.flatnonzero(np.diff(ids_sorted)) + 1
    cell_spread = np.full(n_cells, np.nan)  # 90th pct |lum - median| inside the cell
    for cid, l_chunk, s_chunk in zip(
        np.split(ids_sorted, bounds), np.split(lum_sorted, bounds), np.split(sat_sorted, bounds)
    ):
        med = np.median(l_chunk)
        cell_med[cid[0]] = med
        cell_sat[cid[0]] = s_chunk.mean()
        cell_spread[cid[0]] = np.percentile(np.abs(l_chunk - med), 90)
    cell_med = cell_med.reshape(n_rows, n_cols)
    cell_sat = cell_sat.reshape(n_rows, n_cols)
    cell_spread = cell_spread.reshape(n_rows, n_cols)

    # Known cells: neutral and sitting on one of the two greys.
    known_light = (np.abs(cell_med - g_light) < tol) & (cell_sat < 12)
    known_dark = (np.abs(cell_med - g_dark) < tol) & (cell_sat < 12)
    parity = np.full((n_rows, n_cols), np.nan)  # 1 = light, 0 = dark
    parity[known_light] = 1.0
    parity[known_dark] = 0.0

    # Unknown cells under glass: the checker still shows through with reduced
    # contrast, so a cell brighter than its 4 neighbours is a light cell. This
    # is what makes the model survive the generator's parity defects.
    # Only trust this where a real checker structure is visible: the cell is
    # flat, differs from its 4-neighbours, and at least 3 of those neighbours
    # differ from *their* surroundings in the opposite direction. Plain
    # texture inside an opaque icon fails that test and falls through to
    # propagation, which is unbiased with respect to the paint.
    padded = np.pad(cell_med, 1, mode="edge")
    neigh = (padded[:-2, 1:-1] + padded[2:, 1:-1] + padded[1:-1, :-2] + padded[1:-1, 2:]) / 4
    rel = cell_med - neigh
    rel_p = np.pad(rel, 1, mode="constant", constant_values=0.0)
    sign = np.sign(rel)
    opposite = sum(
        (np.sign(n) == -sign) & (np.abs(n) > 1.5)
        for n in (rel_p[:-2, 1:-1], rel_p[2:, 1:-1], rel_p[1:-1, :-2], rel_p[1:-1, 2:])
    )
    decisive = np.isnan(parity) & (np.abs(rel) > 2.5) & (opposite >= 3) & (cell_spread < 12)
    parity[decisive] = (rel[decisive] > 0).astype(float)
    n_relative = int(decisive.sum())

    # Whatever is left (opaque paint, flat glass) alternates from neighbours.
    n_propagated = 0
    for _ in range(max(n_rows, n_cols)):
        unknown = np.isnan(parity)
        if not unknown.any():
            break
        padded = np.pad(parity, 1, mode="constant", constant_values=np.nan)
        votes = np.stack([
            1 - padded[:-2, 1:-1], 1 - padded[2:, 1:-1], 1 - padded[1:-1, :-2], 1 - padded[1:-1, 2:]
        ])
        have = ~np.isnan(votes)
        cnt = have.sum(axis=0)
        mean_vote = np.where(cnt > 0, np.nansum(votes, axis=0) / np.maximum(cnt, 1), np.nan)
        fill = unknown & (cnt > 0)
        parity[fill] = (mean_vote[fill] >= 0.5).astype(float)
        n_propagated += int(fill.sum())
    parity = np.nan_to_num(parity, nan=0.0)

    # Cells that are unmistakably untouched background: flat, neutral, and
    # grey. Along its parity-defect seams the generator painted a *third*,
    # intermediate grey, so "grey" means anywhere between the two checker
    # levels, not only on them. Alpha is forced to zero in these cells, which
    # removes the residue the matte otherwise leaves on the seams. A glow that
    # shifts a cell by only a few levels is lost with it, which is below what
    # the eye picks up on a JPEG anyway.
    in_range = (cell_med > g_dark - 8) & (cell_med < g_light + 8)
    clean_cell = in_range & (cell_sat < 8) & (cell_spread < 8)
    # ...and reachable from the sheet's margin through other clean cells, so a
    # grey patch *inside* an icon is never mistaken for background.
    lab, _ = ndimage.label(clean_cell)
    border_labels = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    clean_cell &= np.isin(lab, border_labels[border_labels > 0])
    clean_px = clean_cell[cy, cx]

    # Rasterise with 4x supersampling so cell borders are anti-aliased the
    # same way the JPEG shows them.
    ss = 4
    offs = (np.arange(ss) + 0.5) / ss
    light_cov = np.zeros((h, w))
    for oy in offs:
        cyy = np.floor((np.arange(h) + oy - g["phase_y"]) / g["period_y"]).astype(int)
        cyy = np.clip(cyy - cyy.min(), 0, n_rows - 1)
        for ox in offs:
            cxx = np.floor((np.arange(w) + ox - g["phase_x"]) / g["period_x"]).astype(int)
            cxx = np.clip(cxx - cxx.min(), 0, n_cols - 1)
            light_cov += parity[cyy[:, None], cxx[None, :]]
    light_cov /= ss * ss
    bg = light_cov * g_light + (1 - light_cov) * g_dark
    bg = ndimage.gaussian_filter(bg, sigma=0.8)

    stats = {
        "grey_dark": round(g_dark, 2),
        "grey_light": round(g_light, 2),
        "cells": [int(n_rows), int(n_cols)],
        "cells_known": int(known_light.sum() + known_dark.sum()),
        "cells_from_relative_brightness": n_relative,
        "cells_propagated": n_propagated,
        "cells_clean_background": int(clean_cell.sum()),
        "margin_residual": round(float(np.abs(lum - bg)[margin_ring((h, w))].mean()), 2),
    }
    return np.repeat(bg[:, :, None], 3, axis=2), light_cov, clean_px, stats


# --------------------------------------------------------------------------- #
# 3-5. Matte
# --------------------------------------------------------------------------- #
def matte(
    img: np.ndarray, bg: np.ndarray, light_cov: np.ndarray, clean_px: np.ndarray, g: dict, stats: dict
) -> tuple[np.ndarray, np.ndarray]:
    h, w, _ = img.shape
    g_dark, g_light = stats["grey_dark"], stats["grey_light"]
    _, _, edge_dist = cell_indices((h, w), g)
    interior = edge_dist > 1.5

    w_light = (light_cov > 0.999) & interior
    w_dark = (light_cov < 0.001) & interior

    def triangulate(sigma: float) -> tuple[np.ndarray, np.ndarray]:
        """Alpha from the light/dark cell contrast surviving in a sigma-wide
        neighbourhood, plus the sample support of the weaker parity."""

        def local_mean(weights: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
            den = ndimage.gaussian_filter(weights.astype(float), sigma)
            num = np.stack([ndimage.gaussian_filter(img[..., c] * weights, sigma) for c in range(3)], axis=-1)
            return num / np.maximum(den, 1e-6)[..., None], den

        m_light, d_light = local_mean(w_light)
        m_dark, d_dark = local_mean(w_dark)
        # The light/dark contrast that survives is (1 - alpha). Per channel; a
        # coloured glow is transparent in one channel and dense in another, so
        # the densest channel is the alpha.
        contrast = (m_light - m_dark) / (g_light - g_dark)
        a = np.clip(1.0 - contrast.min(axis=2), 0.0, 1.0)
        # JPEG noise dead-zone: clean background comes out at alpha ~0.03-0.06.
        a = np.clip((a - 0.06) / 0.94, 0.0, 1.0)
        return a, np.minimum(d_light, d_dark)

    # Fine scale (~half a cell) is the resolution limit of two-background
    # matting on this checker; the icons are displayed at 2-7x downscale so a
    # ~6px alpha ramp is invisible. Texture inside opaque paint aliases into
    # the fine estimate as random dips, so a coarse estimate is used purely to
    # confirm "this neighbourhood is solid" and lift those dips; it is clipped
    # so it never adds alpha around edges or inside glass.
    a_fine, support = triangulate(g["period_x"] * 0.55)
    a_coarse, _ = triangulate(g["period_x"] * 1.3)
    a_tri = np.maximum(a_fine, smoothstep(a_coarse, 0.6, 0.95))
    # In the faint glow the fine estimate has too few samples per parity and
    # scallops at the cell frequency; glows are smooth by nature, so hand that
    # regime to the coarse estimate.
    t_edge = smoothstep(np.maximum(a_fine, a_coarse), 0.3, 0.7)
    a_tri = a_coarse * (1 - t_edge) + a_tri * t_edge

    # Opaque floor. Anything this far from BOTH greys cannot be a veil over
    # the checker, whatever its neighbourhood says. The thresholds are high
    # enough that even 70%-dense white glass does not trip it, because any
    # per-pixel test on semi-transparent paint is checker-dependent.
    to_dark = np.abs(img - g_dark).max(axis=2)
    to_light = np.abs(img - g_light).max(axis=2)
    a_floor = smoothstep(np.minimum(to_dark, to_light), 110.0, 170.0)

    alpha = np.where(support > 0.05, np.maximum(a_tri, a_floor), a_floor)
    # Clean-background gate, softened over ~a cell so the outer edge of the
    # glow fades out instead of stepping down cell by cell.
    keep = 1.0 - ndimage.gaussian_filter(clean_px.astype(float), g["period_x"] * 0.7)
    alpha = alpha * smoothstep(keep, 0.15, 0.85)

    # The alpha ramp at solid edges still carries a residual modulation at the
    # checker frequency (a scalloped rim with dark dots once composited).
    # Smooth the transition zone over half a cell; the solid interior and the
    # clear background are left untouched. At 64-256px display sizes this
    # ~4px softening of an 800px icon is invisible.
    alpha_smooth = ndimage.gaussian_filter(alpha, g["period_x"] * 0.5)
    t_interior = smoothstep(alpha_smooth, 0.85, 0.97)
    alpha = alpha_smooth * (1 - t_interior) + alpha * t_interior

    # Speckle: kill tiny islands.
    solid = alpha > 0.25
    lab, n = ndimage.label(solid)
    if n:
        sizes = ndimage.sum(solid, lab, range(1, n + 1))
        kill = np.isin(lab, np.flatnonzero(sizes < 60) + 1)
        alpha = np.where(kill, 0.0, alpha)

    # Un-premultiply: img = a*F + (1-a)*B  ->  F = (img - (1-a)*B) / a
    a3 = alpha[:, :, None]
    fg = (img - (1 - a3) * bg) / np.clip(a3, 0.03, 1.0)
    fg = np.clip(fg, 0, 255)
    # Small alpha errors turn into large colour errors after the division and
    # show up as a faint checker in the halo. Glow colour is smooth, so under
    # low alpha use the colour averaged across both parities.
    fg_smooth = np.stack([ndimage.gaussian_filter(fg[..., c], g["period_x"] * 0.6) for c in range(3)], axis=-1)
    t_solid = smoothstep(alpha, 0.5, 0.85)[..., None]
    fg = fg_smooth * (1 - t_solid) + fg * t_solid
    # Meaningless colour under ~zero alpha: borrow the nearest real colour so
    # bilinear filtering in the browser does not bleed grey into the edges.
    clear = alpha < 0.02
    if clear.any():
        idx = ndimage.distance_transform_edt(clear, return_distances=False, return_indices=True)
        fg[clear] = fg[idx[0], idx[1]][clear]
    return fg, alpha


# --------------------------------------------------------------------------- #
# 6. Split + export
# --------------------------------------------------------------------------- #
def find_icons(alpha: np.ndarray, expected: int) -> list[tuple[int, int, int, int]]:
    presence = alpha > 0.2
    for grow in (30, 45, 60, 80):
        lab, n = ndimage.label(ndimage.binary_dilation(presence, iterations=grow))
        if n == expected:
            break
    if n != expected:
        raise SystemExit(f"expected {expected} icon clusters, found {n}")
    glow = alpha > 0.01
    boxes = []
    for i in range(1, n + 1):
        ys, xs = np.nonzero((lab == i) & glow)
        boxes.append((int(ys.min()), int(ys.max()) + 1, int(xs.min()), int(xs.max()) + 1))
    centres = [((y0 + y1) / 2, (x0 + x1) / 2) for (y0, y1, x0, x1) in boxes]
    row_gap = alpha.shape[0] * 0.25
    order = sorted(range(n), key=lambda i: (round(centres[i][0] / row_gap), centres[i][1]))
    return [boxes[i] for i in order]


def to_rgba(fg: np.ndarray, alpha: np.ndarray) -> Image.Image:
    return Image.fromarray(np.dstack([fg, alpha * 255.0]).round().astype(np.uint8))


def square(im: Image.Image, size: int, pad_frac: float = 0.04) -> Image.Image:
    side = int(max(im.size) * (1 + 2 * pad_frac))
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(im, ((side - im.width) // 2, (side - im.height) // 2))
    return canvas.resize((size, size), Image.LANCZOS)


def key_file(src: Path, slug: str) -> None:
    img = load(src)
    h, w, _ = img.shape
    grid = fit_grid(img)
    bg, light_cov, clean_px, stats = build_background(img, grid)
    fg, alpha = matte(img, bg, light_cov, clean_px, grid, stats)
    (y0, y1, x0, x1) = find_icons(alpha, expected=1)[0]
    pad = 6
    y0, x0 = max(0, y0 - pad), max(0, x0 - pad)
    y1, x1 = min(h, y1 + pad), min(w, x1 + pad)
    icon = to_rgba(fg[y0:y1, x0:x1], alpha[y0:y1, x0:x1])
    out = OUT_DIR / f"{slug}.png"
    square(icon, SQUARE_SIZE).save(out, optimize=True)
    print(
        f"{ICON_LABELS.get(slug, slug):18s} {src.name}: crop {x1-x0}x{y1-y0} at ({x0},{y0}), "
        f"greys {stats['grey_dark']}/{stats['grey_light']}, margin residual {stats['margin_residual']} -> {out.relative_to(ROOT)}"
    )


def main(argv: list[str]) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    if not argv:
        jobs = [(p, p.stem) for p in sorted(SRC_DIR.glob("*.jpg"))]
        if not jobs:
            raise SystemExit(f"no sources in {SRC_DIR}")
    else:
        src = Path(argv[0]).expanduser()
        if not src.exists() and (SRC_DIR / argv[0]).exists():
            src = SRC_DIR / argv[0]
        jobs = [(src, argv[1] if len(argv) > 1 else src.stem)]
    for src, slug in jobs:
        key_file(src, slug)


if __name__ == "__main__":
    main(sys.argv[1:])
