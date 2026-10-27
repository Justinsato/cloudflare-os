// Hub-local fork of `sf-landmark-sketch`'s runSfSketchAnimation.
//
// Why a fork: the published animator draws exactly one stroke at a time and has
// no hook for either injecting a custom figure or drawing several strokes at
// once. The Hub needs both — a large custom landmark (Oracle Park) that would
// take too long one-line-at-a-time, so it draws up to N strokes per tick.
//
// Based on the package's animator with two Hub behaviours: `linesPerTick(id)`
// controls how many strokes grow simultaneously for a figure, and every figure
// draws in the same total time (see FIGURE_DRAW_UNITS). The Salesforce Tower is
// etched like every other figure — no post-draw dancer flourish, so its total
// on-screen time matches the rest.
import {
  buildLandmarkCycle,
  pointAlongPolyline,
  strokePath,
} from "./index";

export const DEFAULT_PROGRESS_PER_MS = 0.00038;
export const DEFAULT_PAUSE_AFTER_MS = 520;
// Every figure is drawn in the same wall-clock time regardless of how many
// strokes it has or how many draw per tick. We scale the per-tick progress rate
// by the figure's batch count, so total draw time ≈ FIGURE_DRAW_UNITS /
// progressPerMs is constant across figures (≈ 6.6s at the default speed, the
// same duration a one-stroke-at-a-time figure had before). The global speed
// slider still scales all figures together.
const FIGURE_DRAW_UNITS = 2.5;

type Pt = [number, number];
type Landmark = { id: string; paths: Pt[][] };

export type RunHubSketchOptions = {
  onCycleShake?: () => void;
  progressPerMs?: number;
  getProgressPerMs?: () => number;
  getAdvanceToken?: () => number;
  onFigureChange?: (info: { id: string; index: number }) => void;
  pauseAfterMs?: number;
  strokeStyle?: string;
  lineWidth?: number;
  resizeRoot?: Element | null;
  /** How many strokes draw at once for a given figure id (default 1). */
  linesPerTick?: (id: string) => number;
};

export function runHubSketchAnimation(
  canvas: HTMLCanvasElement,
  options: RunHubSketchOptions = {},
): () => void {
  const {
    onCycleShake,
    progressPerMs = DEFAULT_PROGRESS_PER_MS,
    getProgressPerMs,
    getAdvanceToken,
    onFigureChange,
    pauseAfterMs = DEFAULT_PAUSE_AFTER_MS,
    strokeStyle = "rgba(45, 56, 42, 0.26)",
    lineWidth = 1.38,
    resizeRoot,
    linesPerTick,
  } = options;
  const resolveProgressPerMs = getProgressPerMs ?? (() => progressPerMs);
  const resolveLinesPerTick = (id: string) => Math.max(1, Math.round(linesPerTick?.(id) ?? 1));
  // Progress advances one full stroke-batch per (FIGURE_DRAW_UNITS / batches) of
  // the base rate, so a figure with more batches draws each batch proportionally
  // faster and every figure finishes in the same total time. See FIGURE_DRAW_UNITS.
  const figureRateScale = (pathCount: number, batch: number) =>
    Math.max(1, Math.ceil(pathCount / batch)) / FIGURE_DRAW_UNITS;
  let cancelled = false;
  const reduceMotion =
    typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

  const paintStatic = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    ctx.clearRect(0, 0, w, h);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(45, 56, 42, 0.28)";
    ctx.lineWidth = 1.35;
    ctx.globalAlpha = 0.62;
    const cycle = buildLandmarkCycle(null) as Landmark[];
    for (const lm of cycle) {
      for (const path of lm.paths) strokePath(ctx, w, h, path);
    }
    ctx.globalAlpha = 1;
  };

  let rafId = 0;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const startAnimated = () => {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let cycle = buildLandmarkCycle(null) as Landmark[];
    let figureIndex = 0;
    let pathIdx = 0;
    let progress = 0;
    let last = performance.now();
    let lastAdvanceToken = getAdvanceToken?.() ?? 0;

    const emitFigure = () => {
      const lm = cycle[figureIndex];
      if (lm) onFigureChange?.({ id: lm.id, index: figureIndex });
    };

    const scheduleFigure = (w: number, h: number, delta: number) => {
      onCycleShake?.();
      ctx.clearRect(0, 0, w, h);
      timeoutId = setTimeout(() => {
        if (cancelled) return;
        const len = cycle.length;
        const raw = figureIndex + delta;
        if (raw < 0 || raw >= len || Math.abs(delta) !== 1) {
          cycle = buildLandmarkCycle(cycle) as Landmark[];
        }
        figureIndex = ((raw % len) + len) % len;
        pathIdx = 0;
        progress = 0;
        last = performance.now();
        emitFigure();
        rafId = requestAnimationFrame(frame);
      }, pauseAfterMs);
    };

    const frame = (now: number) => {
      if (cancelled) return;
      const dt = now - last;
      last = now;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w < 32 || h < 32) {
        rafId = requestAnimationFrame(frame);
        return;
      }
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      const cur = cycle[figureIndex];
      const batch = resolveLinesPerTick(cur.id);
      progress += resolveProgressPerMs() * dt * figureRateScale(cur.paths.length, batch);
      ctx.clearRect(0, 0, w, h);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = strokeStyle;
      ctx.lineWidth = lineWidth;

      const advanceToken = getAdvanceToken?.() ?? lastAdvanceToken;
      if (advanceToken !== lastAdvanceToken) {
        const delta = advanceToken - lastAdvanceToken;
        lastAdvanceToken = advanceToken;
        scheduleFigure(w, h, delta);
        return;
      }

      // Strokes already completed, then the active batch of up to N strokes that
      // grow together this tick. (`batch` computed above for the rate scale.)
      for (let pi = 0; pi < pathIdx; pi++) strokePath(ctx, w, h, cur.paths[pi]);
      for (let k = 0; k < batch; k++) {
        const p = cur.paths[pathIdx + k];
        if (p && p.length >= 2) strokePath(ctx, w, h, pointAlongPolyline(p, progress) as Pt[]);
      }

      // Carry the leftover progress past 1 into the next batch instead of
      // discarding it. Resetting to 0 rounded every batch up to a whole frame,
      // and that per-batch rounding accumulated differently per figure (a ~13%
      // spread in total draw time). Carrying the remainder makes total frames
      // depend only on the speed, so every figure finishes in the same time.
      while (progress >= 1) {
        progress -= 1;
        pathIdx += batch;
        if (pathIdx >= cur.paths.length) {
          pathIdx = 0;
          scheduleFigure(w, h, 1);
          return;
        }
      }
      rafId = requestAnimationFrame(frame);
    };

    emitFigure();
    rafId = requestAnimationFrame(frame);
  };

  const syncSizeAndPaint = () => {
    if (cancelled) return;
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w < 32 || h < 32) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cancelAnimationFrame(rafId);
    if (reduceMotion) {
      paintStatic(ctx, w, h);
    } else {
      if (timeoutId) clearTimeout(timeoutId);
      startAnimated();
    }
  };

  const roRoot = resizeRoot ?? canvas.parentElement;
  const ro = roRoot ? new ResizeObserver(syncSizeAndPaint) : null;
  if (ro && roRoot) ro.observe(roRoot);
  syncSizeAndPaint();

  return () => {
    cancelled = true;
    ro?.disconnect();
    cancelAnimationFrame(rafId);
    if (timeoutId) clearTimeout(timeoutId);
  };
}
