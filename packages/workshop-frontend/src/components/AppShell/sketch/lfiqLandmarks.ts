// LFIQ.os Home landmark set. Keeps the Golden Gate, the Bay Bridge and the skyline from the shared
// catalog, swaps the Painted Ladies for the Back9 Trades scene (three Victorians, Back9 flag on the
// middle roof, downtown behind), and adds one Bay Area figure for each of Pursue, Parcel and Watch:
//   - Pursue: a cable car climbing a hill past the flats it is chasing.
//   - Parcel: a stepped block of flats with its lot lines dropped into an assessor block map.
//   - Watch: Alcatraz, the lighthouse sweeping the bay over the cellhouse.
// Paths are normalised [0,1] with y increasing downward; `fitLandmarkInSlot` rescales by bbox.
import { applyHubLandmarkEdits } from "./hubLandmarks";
import { LANDMARK_BUILDERS, arcPoints, lerp } from "./index";

type Pt = [number, number];

const GROUND = 0.9;

/** A dashed line from a to b, as separate short strokes. */
function dashed(a: Pt, b: Pt, dash = 0.016, gap = 0.012): Pt[][] {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const out: Pt[][] = [];
  for (let s = 0; s < len; s += dash + gap) {
    const t0 = s / len;
    const t1 = Math.min(1, (s + dash) / len);
    out.push([
      [lerp(a[0], b[0], t0), lerp(a[1], b[1], t0)],
      [lerp(a[0], b[0], t1), lerp(a[1], b[1], t1)],
    ]);
  }
  return out;
}

function rect(x0: number, y0: number, x1: number, y1: number): Pt[] {
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
    [x0, y0],
  ];
}

// ---------------------------------------------------------------------------
// Back9 Trades: three Painted Ladies with the Back9 flag flying from the middle roof.
// ---------------------------------------------------------------------------
function back9LadiesPaths(): Pt[][] {
  const paths: Pt[][] = [];
  const eave = 0.5;
  const houses = [
    { x0: 0.17, x1: 0.39, apex: 0.33 },
    { x0: 0.39, x1: 0.61, apex: 0.3 },
    { x0: 0.61, x1: 0.83, apex: 0.33 },
  ];

  // Roofline as a function of x, so the towers behind stop where a roof would hide them.
  const roofY = (x: number) => {
    for (const h of houses) {
      if (x < h.x0 - 0.01 || x > h.x1 + 0.01) continue;
      const mid = (h.x0 + h.x1) / 2;
      const half = (h.x1 - h.x0) / 2 + 0.01;
      return lerp(h.apex, eave, Math.abs(x - mid) / half);
    }
    return GROUND;
  };

  // Downtown behind: flat towers plus the pyramid at the left, cut off by the roofs.
  const towers: [number, number, number][] = [
    [0.03, 0.1, 0.36],
    [0.21, 0.27, 0.2],
    [0.29, 0.35, 0.26],
    [0.44, 0.48, 0.17],
    [0.53, 0.57, 0.22],
    [0.66, 0.72, 0.15],
    [0.74, 0.79, 0.24],
    [0.86, 0.95, 0.3],
  ];
  for (const [x0, x1, top] of towers) {
    paths.push([
      [x0, roofY(x0)],
      [x0, top],
      [x1, top],
      [x1, roofY(x1)],
    ]);
    for (let y = top + 0.04; y < Math.min(roofY(x0), roofY(x1)) - 0.02; y += 0.05) {
      paths.push([
        [x0 + 0.008, y],
        [x1 - 0.008, y],
      ]);
    }
  }
  // The pyramid, wide at the base so it reads behind the left house.
  paths.push([
    [0.105, roofY(0.105)],
    [0.15, 0.04],
    [0.195, roofY(0.195)],
  ]);
  paths.push([
    [0.15, 0.06],
    [0.15, roofY(0.15)],
  ]);

  for (const h of houses) {
    const mid = (h.x0 + h.x1) / 2;
    const w = h.x1 - h.x0;
    // Gable and its inner trim.
    paths.push([
      [h.x0 - 0.01, eave],
      [mid, h.apex],
      [h.x1 + 0.01, eave],
    ]);
    paths.push([
      [h.x0 + 0.025, eave - 0.012],
      [mid, h.apex + 0.035],
      [h.x1 - 0.025, eave - 0.012],
      [h.x0 + 0.025, eave - 0.012],
    ]);
    // Attic window inside the gable.
    paths.push(rect(mid - 0.022, eave - 0.085, mid + 0.022, eave - 0.03));
    // Walls, cornice band and frieze.
    paths.push([
      [h.x0, eave],
      [h.x0, GROUND],
    ]);
    paths.push([
      [h.x1, eave],
      [h.x1, GROUND],
    ]);
    paths.push([
      [h.x0, eave + 0.02],
      [h.x1, eave + 0.02],
    ]);
    paths.push([
      [h.x0, 0.63],
      [h.x1, 0.63],
    ]);
    // Upper-floor windows.
    paths.push(rect(h.x0 + w * 0.14, 0.55, h.x0 + w * 0.4, 0.61));
    paths.push(rect(h.x1 - w * 0.4, 0.55, h.x1 - w * 0.14, 0.61));
    // Ground-floor bay window with mullions.
    const bx0 = h.x0 + w * 0.1;
    const bx1 = h.x0 + w * 0.62;
    paths.push([
      [bx0, GROUND - 0.03],
      [bx0, 0.67],
      [bx0 + 0.02, 0.65],
      [bx1 - 0.02, 0.65],
      [bx1, 0.67],
      [bx1, GROUND - 0.03],
    ]);
    paths.push([
      [bx0 + 0.02, 0.65],
      [bx0 + 0.02, GROUND - 0.03],
    ]);
    paths.push([
      [bx1 - 0.02, 0.65],
      [bx1 - 0.02, GROUND - 0.03],
    ]);
    paths.push([
      [bx0, 0.76],
      [bx1, 0.76],
    ]);
    // Front door with stoop.
    paths.push([
      [h.x1 - w * 0.28, GROUND],
      [h.x1 - w * 0.28, 0.72],
      [h.x1 - w * 0.1, 0.72],
      [h.x1 - w * 0.1, GROUND],
    ]);
  }
  paths.push([
    [0.02, GROUND],
    [0.98, GROUND],
  ]);

  // Flagpole on the middle apex and the Back9 flag waving to the right.
  const poleX = 0.5;
  const poleTop = 0.08;
  paths.push([
    [poleX, houses[1].apex],
    [poleX, poleTop],
  ]);
  paths.push(arcPoints(poleX, poleTop - 0.008, 0.008, 0, Math.PI * 2, 10));
  const flagW = 0.15;
  const flagH = 0.1;
  const wave = (t: number) => 0.012 * Math.sin(Math.PI * 2 * t * 0.9) + 0.02 * t;
  const top: Pt[] = [];
  const bottom: Pt[] = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    top.push([poleX + flagW * t, poleTop + 0.01 + wave(t)]);
    bottom.push([poleX + flagW * t, poleTop + 0.01 + flagH + wave(t)]);
  }
  paths.push([...top, ...bottom.toReversed()]);
  // The emblem: a small house in the middle of the flag.
  const ex = poleX + flagW * 0.5;
  const ey = poleTop + 0.01 + flagH * 0.55 + wave(0.5);
  paths.push([
    [ex - 0.022, ey + 0.028],
    [ex - 0.022, ey - 0.006],
    [ex, ey - 0.03],
    [ex + 0.022, ey - 0.006],
    [ex + 0.022, ey + 0.028],
    [ex - 0.022, ey + 0.028],
  ]);
  paths.push(rect(ex - 0.007, ey + 0.004, ex + 0.007, ey + 0.028));

  return paths;
}

// ---------------------------------------------------------------------------
// Pursue: a cable car climbing a San Francisco hill past the flats it is chasing.
// ---------------------------------------------------------------------------
function cableCarPaths(): Pt[][] {
  const paths: Pt[][] = [];
  const a: Pt = [0.02, GROUND];
  const b: Pt = [0.98, 0.64];
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const ux = Math.cos(ang);
  const uy = Math.sin(ang);
  // Local frame on the slope: u along the street, v up off it.
  const at = (s: number, v: number): Pt => [a[0] + ux * s + uy * v, a[1] + uy * s - ux * v];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const slopeY = (x: number) => lerp(a[1], b[1], (x - a[0]) / (b[0] - a[0]));

  // Street, curb and the cable slot between the rails.
  paths.push([at(0, 0), at(len, 0)]);
  paths.push([at(0, -0.035), at(len, -0.035)]);
  paths.push(...dashed(at(0, -0.017), at(len, -0.017), 0.03, 0.02));

  // Flats stepping up the hill on either side of the car: level floors on a sloped street.
  for (const i of [0, 1, 5]) {
    const x0 = 0.04 + i * 0.155;
    const x1 = x0 + 0.145;
    const base = slopeY(x0);
    const roof = base - 0.3;
    paths.push([
      [x0, slopeY(x0) - 0.005],
      [x0, roof],
      [x1, roof],
      [x1, slopeY(x1) - 0.005],
    ]);
    paths.push([
      [x0 - 0.004, roof + 0.02],
      [x1 + 0.004, roof + 0.02],
    ]);
    for (const fy of [roof + 0.07, roof + 0.16]) {
      paths.push(rect(x0 + 0.022, fy, x0 + 0.062, fy + 0.055));
      paths.push(rect(x1 - 0.062, fy, x1 - 0.022, fy + 0.055));
    }
  }

  // The car, riding the slope.
  const s0 = (0.37 - a[0]) / ux;
  const L = 0.4;
  const lift = 0.035;
  const H = 0.19;
  const box = (u0: number, v0: number, u1: number, v1: number): Pt[] => [
    at(s0 + u0, lift + v0),
    at(s0 + u1, lift + v0),
    at(s0 + u1, lift + v1),
    at(s0 + u0, lift + v1),
    at(s0 + u0, lift + v0),
  ];
  // Body, open end platforms and roof with its clerestory.
  paths.push(box(0.04, 0, L - 0.04, H));
  paths.push([at(s0, lift), at(s0 + L, lift)]);
  paths.push([at(s0 - 0.01, lift + H + 0.012), at(s0 + L + 0.01, lift + H + 0.012)]);
  paths.push(box(0.08, H + 0.012, L - 0.08, H + 0.04));
  paths.push([at(s0, lift), at(s0, lift + H + 0.012)]);
  paths.push([at(s0 + L, lift), at(s0 + L, lift + H + 0.012)]);
  // Window row and the dash rail below it.
  for (let i = 0; i < 5; i++) {
    const u = 0.065 + i * 0.05;
    paths.push(box(u, H * 0.5, u + 0.036, H - 0.02));
  }
  paths.push([at(s0 + 0.04, lift + H * 0.42), at(s0 + L - 0.04, lift + H * 0.42)]);
  // Running board and wheels.
  paths.push([at(s0 - 0.02, lift - 0.004), at(s0 + L + 0.02, lift - 0.004)]);
  for (const u of [0.08, L - 0.08]) {
    const c = at(s0 + u, lift * 0.5);
    paths.push(arcPoints(c[0], c[1], 0.017, 0, Math.PI * 2, 14));
  }
  // Grip lever up through the middle of the car.
  paths.push([at(s0 + L * 0.5, lift + 0.01), at(s0 + L * 0.5 + 0.02, lift + H * 0.38)]);

  return paths;
}

// ---------------------------------------------------------------------------
// Parcel: a stepped block of flats with each lot line dropped into the assessor block map below.
// ---------------------------------------------------------------------------
function parcelBlockPaths(): Pt[][] {
  const paths: Pt[][] = [];
  const n = 6;
  const left = 0.05;
  const right = 0.95;
  const w = (right - left) / n;
  const streetAt = (i: number) => lerp(0.56, 0.4, i / n);

  // The sloped street in elevation.
  paths.push([
    [left, streetAt(0)],
    [right, streetAt(n)],
  ]);

  for (let i = 0; i < n; i++) {
    const x0 = left + i * w;
    const x1 = x0 + w;
    const base = Math.max(streetAt(i), streetAt(i + 1));
    const roof = base - (i % 2 === 0 ? 0.3 : 0.27);
    // Each flat sits level, stepping up with the hill.
    paths.push([
      [x0, base],
      [x0, roof],
      [x1, roof],
      [x1, base],
    ]);
    // Cornice and bracket band.
    paths.push([
      [x0 - 0.004, roof + 0.018],
      [x1 + 0.004, roof + 0.018],
    ]);
    // Two-storey bay window column plus a side window per floor.
    const bx0 = x0 + w * 0.12;
    const bx1 = x0 + w * 0.56;
    paths.push([
      [bx0, base - 0.03],
      [bx0, roof + 0.045],
      [bx1, roof + 0.045],
      [bx1, base - 0.03],
    ]);
    const midFloor = (roof + 0.045 + base - 0.03) / 2;
    paths.push([
      [bx0, midFloor],
      [bx1, midFloor],
    ]);
    paths.push(rect(x0 + w * 0.68, roof + 0.06, x0 + w * 0.86, midFloor - 0.02));
    paths.push(rect(x0 + w * 0.68, midFloor + 0.02, x0 + w * 0.86, base - 0.05));
  }

  // The block map: block outline, the rear lot line through the middle and the lot lines.
  const mapTop = 0.68;
  const mapBottom = 0.94;
  paths.push(rect(left, mapTop, right, mapBottom));
  paths.push(...dashed([left, (mapTop + mapBottom) / 2], [right, (mapTop + mapBottom) / 2]));
  for (let i = 1; i < n; i++) {
    const x = left + i * w;
    paths.push([
      [x, mapTop],
      [x, (mapTop + mapBottom) / 2],
    ]);
  }
  // Rear lots are split the other way, as a real block map is.
  for (let i = 1; i < 4; i++) {
    const x = left + (i * (right - left)) / 4;
    paths.push([
      [x, (mapTop + mapBottom) / 2],
      [x, mapBottom],
    ]);
  }
  // Each building's walls carried down to its lot on the map.
  for (let i = 0; i <= n; i++) {
    const x = left + i * w;
    const base = i === n ? streetAt(n) : Math.max(streetAt(i), streetAt(i + 1));
    paths.push(...dashed([x, base + 0.012], [x, mapTop - 0.01], 0.012, 0.01));
  }
  // Lot markers: a small ring in each front lot.
  for (let i = 0; i < n; i++) {
    const cx = left + (i + 0.5) * w;
    paths.push(arcPoints(cx, mapTop + 0.065, 0.012, 0, Math.PI * 2, 10));
  }

  return paths;
}

// ---------------------------------------------------------------------------
// Watch: Alcatraz, the lighthouse sweeping the bay over the cellhouse and water tower.
// ---------------------------------------------------------------------------
function alcatrazPaths(): Pt[][] {
  const paths: Pt[][] = [];

  // Island profile, cliffs to a plateau.
  paths.push([
    [0.04, 0.86],
    [0.12, 0.8],
    [0.18, 0.72],
    [0.26, 0.66],
    [0.7, 0.65],
    [0.78, 0.68],
    [0.84, 0.76],
    [0.9, 0.82],
    [0.97, 0.86],
  ]);
  // Lower terrace and the dock.
  paths.push([
    [0.14, 0.8],
    [0.42, 0.79],
    [0.5, 0.82],
    [0.62, 0.82],
  ]);
  paths.push(rect(0.08, 0.82, 0.24, 0.86));

  // Cellhouse on the plateau with its window rows.
  paths.push(rect(0.3, 0.52, 0.68, 0.65));
  paths.push([
    [0.29, 0.52],
    [0.49, 0.47],
    [0.69, 0.52],
  ]);
  for (let i = 0; i < 12; i++) {
    const x = 0.32 + i * 0.03;
    paths.push([
      [x, 0.55],
      [x, 0.6],
    ]);
  }

  // Water tower on its legs.
  paths.push(rect(0.17, 0.44, 0.25, 0.52));
  paths.push([
    [0.165, 0.44],
    [0.21, 0.41],
    [0.255, 0.44],
  ]);
  paths.push([
    [0.175, 0.52],
    [0.165, 0.68],
  ]);
  paths.push([
    [0.245, 0.52],
    [0.255, 0.66],
  ]);
  paths.push([
    [0.172, 0.58],
    [0.249, 0.6],
  ]);
  paths.push([
    [0.172, 0.6],
    [0.249, 0.58],
  ]);

  // Lighthouse: tapered tower, gallery, lantern room and cap.
  const cx = 0.76;
  paths.push([
    [cx - 0.032, 0.665],
    [cx - 0.02, 0.3],
    [cx + 0.02, 0.3],
    [cx + 0.032, 0.665],
  ]);
  for (const y of [0.4, 0.5, 0.6]) {
    const t = (y - 0.3) / 0.365;
    const hw = lerp(0.02, 0.032, t);
    paths.push([
      [cx - hw, y],
      [cx + hw, y],
    ]);
  }
  paths.push([
    [cx - 0.034, 0.3],
    [cx + 0.034, 0.3],
  ]);
  paths.push([
    [cx - 0.034, 0.285],
    [cx + 0.034, 0.285],
  ]);
  paths.push(rect(cx - 0.018, 0.235, cx + 0.018, 0.285));
  paths.push(arcPoints(cx, 0.235, 0.022, Math.PI, Math.PI * 2, 12));
  paths.push([
    [cx, 0.213],
    [cx, 0.19],
  ]);

  // Beams sweeping out over the bay.
  const lamp: Pt = [cx, 0.26];
  paths.push([lamp, [0.99, 0.18], [0.99, 0.3], lamp]);
  paths.push([lamp, [0.4, 0.16], [0.4, 0.28], lamp]);

  // Water.
  for (const [x0, x1, y] of [
    [0.02, 0.3, 0.9],
    [0.36, 0.62, 0.9],
    [0.68, 0.98, 0.9],
    [0.12, 0.42, 0.94],
    [0.5, 0.86, 0.94],
  ] as const) {
    const wave: Pt[] = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      wave.push([lerp(x0, x1, t), y + 0.006 * Math.sin(t * Math.PI * 4)]);
    }
    paths.push(wave);
  }

  return paths;
}

let applied = false;
/** Idempotently narrow the shared catalog to the LFIQ.os set. Safe across HMR. */
export function applyLfiqLandmarkSet() {
  if (applied) return;
  applied = true;
  applyHubLandmarkEdits();
  const keep = LANDMARK_BUILDERS.filter((d) =>
    ["golden-gate-bridge", "bay-bridge", "sf-skyline"].includes(d.id),
  );
  LANDMARK_BUILDERS.splice(
    0,
    LANDMARK_BUILDERS.length,
    ...keep,
    { id: "back9-ladies", build: back9LadiesPaths },
    { id: "pursue-cable-car", build: cableCarPaths },
    { id: "parcel-block", build: parcelBlockPaths },
    { id: "watch-alcatraz", build: alcatrazPaths },
  );
}
