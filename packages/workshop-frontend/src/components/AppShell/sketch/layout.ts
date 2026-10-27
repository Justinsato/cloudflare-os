import { LANDMARK_BUILDERS } from "./landmarks";
import type { SketchLandmark } from "./types";

export const MARGIN = 0.028;
export const MIN_CENTROID_MOVE = 0.1;
/** Minimum max(width,height) of each figure on the full canvas (normalized 0–1). */
export const MIN_LANDMARK_MAJOR_SPAN = 1 / 3;
const SLOT_GUTTER = 0.024;

export type NormalizedRect = { x0: number; y0: number; x1: number; y1: number };

export function flattenPaths(paths: [number, number][][]): [number, number][] {
  const out: [number, number][] = [];
  for (const p of paths) out.push(...p);
  return out;
}

export function polyCentroid(pts: [number, number][]): [number, number] {
  let sx = 0;
  let sy = 0;
  for (const [x, y] of pts) {
    sx += x;
    sy += y;
  }
  const n = pts.length;
  return [sx / n, sy / n];
}

export function polyExtentsFromCentroid(pts: [number, number][], mx: number, my: number) {
  let l = 0;
  let r = 0;
  let t = 0;
  let b = 0;
  for (const [x, y] of pts) {
    l = Math.max(l, mx - x);
    r = Math.max(r, x - mx);
    t = Math.max(t, my - y);
    b = Math.max(b, y - my);
  }
  return { l, r, t, b };
}

export function clampPts(pts: [number, number][], lo = 0.02, hi = 0.98): [number, number][] {
  return pts.map(([x, y]) => [Math.min(hi, Math.max(lo, x)), Math.min(hi, Math.max(lo, y))]);
}

export function translateLandmarkPaths(
  paths: [number, number][][],
  targetCx: number,
  targetCy: number,
): [number, number][][] {
  const flat = flattenPaths(paths);
  const [mx, my] = polyCentroid(flat);
  const dx = targetCx - mx;
  const dy = targetCy - my;
  return paths.map((path) => clampPts(path.map(([x, y]) => [x + dx, y + dy])));
}

export function placeLandmarkPathsForCycle(
  paths: [number, number][][],
  prevCentroid: [number, number] | null,
): [number, number][][] {
  const flat = flattenPaths(paths);
  const [mx, my] = polyCentroid(flat);
  const { l, r, t, b } = polyExtentsFromCentroid(flat, mx, my);
  const minCx = MARGIN + l;
  const maxCx = 1 - MARGIN - r;
  const minCy = MARGIN + t;
  const maxCy = 1 - MARGIN - b;
  const spanX = Math.max(0.0005, maxCx - minCx);
  const spanY = Math.max(0.0005, maxCy - minCy);

  for (let attempt = 0; attempt < 32; attempt++) {
    const cx = minCx + Math.random() * spanX;
    const cy = minCy + Math.random() * spanY;
    if (prevCentroid) {
      const d = Math.hypot(cx - prevCentroid[0], cy - prevCentroid[1]);
      if (d < MIN_CENTROID_MOVE && attempt < 31) continue;
    }
    return translateLandmarkPaths(paths, cx, cy);
  }
  return translateLandmarkPaths(paths, (minCx + maxCx) * 0.5, (minCy + maxCy) * 0.5);
}

export function buildLandmarkCycle(prev: SketchLandmark[] | null): SketchLandmark[] {
  return LANDMARK_BUILDERS.map((def, i) => {
    const template = def.build();
    const prevC =
      prev?.[i] && prev[i].paths.length > 0 ? polyCentroid(flattenPaths(prev[i].paths)) : null;
    return { id: def.id, paths: placeLandmarkPathsForCycle(template, prevC) };
  });
}

function bboxOfFlattened(paths: [number, number][][]): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
} {
  const flat = flattenPaths(paths);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of flat) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const w = Math.max(maxX - minX, 1e-8);
  const h = Math.max(maxY - minY, 1e-8);
  return { minX, maxX, minY, maxY, w, h, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}

/** Uniform scale + center so bbox fits inside `slot` and max(w,h) ≥ `minMajorSpan` when geometrically possible. */
export function fitLandmarkInSlot(
  templatePaths: [number, number][][],
  slot: NormalizedRect,
  minMajorSpan = MIN_LANDMARK_MAJOR_SPAN,
): [number, number][][] {
  const inset = 0.012;
  const sx0 = slot.x0 + inset;
  const sy0 = slot.y0 + inset;
  const sx1 = slot.x1 - inset;
  const sy1 = slot.y1 - inset;
  const slotW = Math.max(0.02, sx1 - sx0);
  const slotH = Math.max(0.02, sy1 - sy0);
  const slotCx = (sx0 + sx1) / 2;
  const slotCy = (sy0 + sy1) / 2;

  const { w: bw, h: bh, cx: tcx, cy: tcy } = bboxOfFlattened(templatePaths);
  const major = Math.max(bw, bh);
  const sFit = Math.min(slotW / bw, slotH / bh);
  const sMin = minMajorSpan / major;
  const s = Math.min(sFit, Math.max(sMin, 0));

  const mapPath = (path: [number, number][]): [number, number][] =>
    clampPts(
      path.map(([x, y]) => [slotCx + (x - tcx) * s, slotCy + (y - tcy) * s]),
    );

  return templatePaths.map(mapPath);
}

function slotRectsLR(): [NormalizedRect, NormalizedRect] {
  const m = MARGIN;
  const g = SLOT_GUTTER * 0.5;
  const left: NormalizedRect = { x0: m, y0: m, x1: 0.5 - g, y1: 1 - m };
  const right: NormalizedRect = { x0: 0.5 + g, y0: m, x1: 1 - m, y1: 1 - m };
  return [left, right];
}

function slotRectsTB(): [NormalizedRect, NormalizedRect] {
  const m = MARGIN;
  const g = SLOT_GUTTER * 0.5;
  const top: NormalizedRect = { x0: m, y0: m, x1: 1 - m, y1: 0.5 - g };
  const bottom: NormalizedRect = { x0: m, y0: 0.5 + g, x1: 1 - m, y1: 1 - m };
  return [top, bottom];
}

/** Average width/height of template bbox; used to pick L/R vs T/B split for the pair. */
function meanTemplateAspect(builds: [() => [number, number][][], () => [number, number][][]]): number {
  let sum = 0;
  for (const b of builds) {
    const box = bboxOfFlattened(b());
    sum += box.w / box.h;
  }
  return sum / builds.length;
}

function pickTwoDistinctIndices(n: number): [number, number] {
  const a = Math.floor(Math.random() * n);
  let b = Math.floor(Math.random() * (n - 1));
  if (b >= a) b += 1;
  return [a, b];
}

export type TwoFigureRound = {
  pair: [SketchLandmark, SketchLandmark];
  split: "lr" | "tb";
};

/**
 * Two landmarks scaled into side-by-side or stacked slots (never more than two).
 * Split: left/right when templates are taller-than-wide on average; else top/bottom.
 */
export function buildTwoFigureRound(): TwoFigureRound {
  const n = LANDMARK_BUILDERS.length;
  const [ia, ib] = pickTwoDistinctIndices(n);
  const defA = LANDMARK_BUILDERS[ia];
  const defB = LANDMARK_BUILDERS[ib];
  const rawA = defA.build();
  const rawB = defB.build();
  const ar = meanTemplateAspect([() => rawA, () => rawB]);
  const useLR = ar <= 1;
  const split: "lr" | "tb" = useLR ? "lr" : "tb";
  const [slot0, slot1] = useLR ? slotRectsLR() : slotRectsTB();

  return {
    split,
    pair: [
      { id: defA.id, paths: fitLandmarkInSlot(rawA, slot0) },
      { id: defB.id, paths: fitLandmarkInSlot(rawB, slot1) },
    ],
  };
}
