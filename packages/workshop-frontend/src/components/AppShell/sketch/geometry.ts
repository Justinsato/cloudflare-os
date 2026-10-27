export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function lerp2(a: [number, number], b: [number, number], t: number): [number, number] {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
}

export function suspensionCablePoints(
  x0: number,
  yTop: number,
  x1: number,
  yTopR: number,
  sag: number,
  steps: number,
): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = lerp(x0, x1, t);
    const blend = lerp(yTop, yTopR, t);
    const dip = sag * Math.sin(Math.PI * t) ** 2;
    out.push([x, blend + dip]);
  }
  return out;
}

export function cableYAtX(
  x: number,
  xL: number,
  yL: number,
  xR: number,
  yR: number,
  sag: number,
): number {
  if (xR <= xL) return yL;
  if (x <= xL) return yL;
  if (x >= xR) return yR;
  const t = (x - xL) / (xR - xL);
  const blend = lerp(yL, yR, t);
  return blend + sag * Math.sin(Math.PI * t) ** 2;
}

export function deckYAtX(x: number, x0: number, y0: number, x1: number, y1: number): number {
  if (x1 <= x0) return y0;
  const t = (x - x0) / (x1 - x0);
  return lerp(y0, y1, Math.max(0, Math.min(1, t)));
}

export function arcPoints(cx: number, cy: number, r: number, a0: number, a1: number, steps: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const a = a0 + (a1 - a0) * (i / steps);
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return out;
}
