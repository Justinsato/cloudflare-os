export function polylineLength(pts: [number, number][]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i][0] - pts[i - 1][0];
    const dy = pts[i][1] - pts[i - 1][1];
    len += Math.hypot(dx, dy);
  }
  return len;
}

export function pointAlongPolyline(pts: [number, number][], t: number): [number, number][] {
  if (pts.length < 2) return pts;
  const total = polylineLength(pts);
  if (total <= 0) return [pts[0]];
  const target = Math.max(0, Math.min(1, t)) * total;
  const out: [number, number][] = [pts[0]];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i][0] - pts[i - 1][0];
    const dy = pts[i][1] - pts[i - 1][1];
    const seg = Math.hypot(dx, dy);
    if (acc + seg >= target) {
      const u = seg > 0 ? (target - acc) / seg : 0;
      out.push([pts[i - 1][0] + dx * u, pts[i - 1][1] + dy * u]);
      break;
    }
    acc += seg;
    out.push(pts[i]);
  }
  return out;
}

export function strokePath(ctx: CanvasRenderingContext2D, w: number, h: number, pts: [number, number][]) {
  if (pts.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(pts[0][0] * w, pts[0][1] * h);
  for (let i = 1; i < pts.length; i++) {
    ctx.lineTo(pts[i][0] * w, pts[i][1] * h);
  }
  ctx.stroke();
}
