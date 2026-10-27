// Hub-specific edits to the shared SF landmark catalog.
//
// The `sf-landmark-sketch` package exposes `LANDMARK_BUILDERS` (a live array the
// animator reads each cycle), so we mutate it once at import time to:
//   - drop Coit Tower from the rotation and add Oracle Park (the ballpark), and
//   - give the Transamerica Pyramid and Salesforce Tower a flanking skyline of
//     nearby office buildings so each reads as a downtown scene, not a lone
//     tower. Every building sits on one shared ground line at the bottom of the
//     figure, so the etch grounds cleanly right above the brick wall.
import { LANDMARK_BUILDERS, arcPoints, lerp } from "./index";

type Pt = [number, number];

/**
 * Oracle Park — a stylised etch of the ballpark seen from behind home plate:
 * diamond + outfield walls opening toward the viewer, grandstand rims, upper
 * deck / horizon tiers, and the centre scoreboard tower. Normalised [0,1] with
 * y increasing downward; sized to fill most of the frame like the other figures.
 */
export function oracleParkPaths(): Pt[][] {
  const paths: Pt[][] = [];

  // Upper-deck / horizon tiers behind the field — long, slightly sagging sweeps.
  for (const y of [0.1, 0.135, 0.17]) {
    paths.push([
      [0.06, y],
      [0.5, y - 0.016],
      [0.94, y],
    ]);
  }

  // Grandstand rims sweeping down from the upper deck to the field corners.
  paths.push([
    [0.06, 0.2],
    [0.17, 0.3],
    [0.31, 0.4],
    [0.44, 0.47],
  ]);
  paths.push([
    [0.94, 0.22],
    [0.83, 0.31],
    [0.69, 0.4],
    [0.56, 0.47],
  ]);

  // Outer field wall — rounded polygon opening toward home plate (front).
  paths.push([
    [0.5, 0.94],
    [0.24, 0.66],
    [0.2, 0.52],
    [0.3, 0.44],
    [0.5, 0.415],
    [0.7, 0.44],
    [0.8, 0.52],
    [0.76, 0.66],
    [0.5, 0.94],
  ]);
  // Inner grass edge, just inside the wall.
  paths.push([
    [0.5, 0.88],
    [0.3, 0.65],
    [0.27, 0.54],
    [0.35, 0.47],
    [0.5, 0.45],
    [0.65, 0.47],
    [0.73, 0.54],
    [0.7, 0.65],
    [0.5, 0.88],
  ]);

  // Foul lines run straight out from home plate along the base lines to the
  // outfield corners, hugging the field edge (they pass through third/first base).
  paths.push([
    [0.5, 0.86],
    [0.395, 0.735],
    [0.24, 0.655],
  ]);
  paths.push([
    [0.5, 0.86],
    [0.605, 0.735],
    [0.76, 0.655],
  ]);

  // Infield diamond (rotated square: home / first / second / third).
  paths.push([
    [0.5, 0.83],
    [0.605, 0.735],
    [0.5, 0.655],
    [0.395, 0.735],
    [0.5, 0.83],
  ]);
  // Pitcher's mound.
  const mound: Pt[] = [];
  for (let i = 0; i <= 16; i++) {
    const a = (Math.PI * 2 * i) / 16;
    mound.push([0.5 + Math.cos(a) * 0.022, 0.745 + Math.sin(a) * 0.014]);
  }
  paths.push(mound);
  // Home plate notch.
  paths.push([
    [0.475, 0.85],
    [0.5, 0.866],
    [0.525, 0.85],
  ]);

  // Centre scoreboard tower.
  paths.push([
    [0.44, 0.415],
    [0.44, 0.375],
    [0.56, 0.375],
    [0.56, 0.415],
  ]); // base platform
  paths.push([
    [0.445, 0.375],
    [0.445, 0.26],
    [0.555, 0.26],
    [0.555, 0.375],
  ]); // main board box
  paths.push([
    [0.46, 0.355],
    [0.46, 0.285],
    [0.54, 0.285],
    [0.54, 0.355],
  ]); // inner screen
  paths.push([
    [0.44, 0.375],
    [0.42, 0.3],
    [0.42, 0.22],
    [0.435, 0.22],
  ]); // left post
  paths.push([
    [0.56, 0.375],
    [0.58, 0.3],
    [0.58, 0.22],
    [0.565, 0.22],
  ]); // right post
  // Crown arch + dome.
  const arch: Pt[] = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    const a = Math.PI * (1 - t);
    arch.push([0.5 + Math.cos(a) * 0.055, 0.235 - Math.sin(a) * 0.03]);
  }
  paths.push(arch);
  const dome: Pt[] = [];
  for (let i = 0; i <= 14; i++) {
    const a = (Math.PI * 2 * i) / 14;
    dome.push([0.5 + Math.cos(a) * 0.018, 0.246 + Math.sin(a) * 0.012]);
  }
  paths.push(dome);

  // Outfield wall ridge line tying the far stands to the wall top.
  paths.push([
    [0.2, 0.52],
    [0.5, 0.415],
    [0.8, 0.52],
  ]);

  return paths;
}

// ---------------------------------------------------------------------------
// Skyline neighbours — flat-topped office blocks that flank the hero tower so
// the figure reads as a downtown skyline. Each block is an outline that sits on
// the shared ground line plus a couple of window bands. The ground line is the
// lowest thing drawn, so the whole scene grounds cleanly just above the wall.
// ---------------------------------------------------------------------------
const SKYLINE_GROUND_Y = 0.9;

/** One office block: outline (up-left, across-top, down-right, along-base) plus
 *  evenly spaced window bands. `topY` is the roofline (smaller = taller). */
function officeBlock(x0: number, x1: number, topY: number, floors = 3): Pt[][] {
  const g = SKYLINE_GROUND_Y;
  const paths: Pt[][] = [
    [
      [x0, g],
      [x0, topY],
      [x1, topY],
      [x1, g],
    ],
  ];
  const inset = (x1 - x0) * 0.16;
  for (let i = 1; i <= floors; i++) {
    const y = topY + ((g - topY) * i) / (floors + 1);
    paths.push([
      [x0 + inset, y],
      [x1 - inset, y],
    ]);
  }
  return paths;
}

/** Build a skyline row from [x0, x1, roofY] specs, then a single ground line
 *  running under the whole scene. */
function skylineRow(specs: [number, number, number][]): Pt[][] {
  const paths: Pt[][] = [];
  for (const [x0, x1, topY] of specs) paths.push(...officeBlock(x0, x1, topY));
  paths.push([
    [0.02, SKYLINE_GROUND_Y],
    [0.98, SKYLINE_GROUND_Y],
  ]);
  return paths;
}

// Neighbours are kept shorter than each hero tower so the landmark still leads.
const PYRAMID_SKYLINE: [number, number, number][] = [
  [0.05, 0.135, 0.7],
  [0.145, 0.225, 0.63],
  [0.235, 0.315, 0.73],
  [0.325, 0.4, 0.67],
  [0.6, 0.675, 0.68],
  [0.685, 0.765, 0.74],
  [0.775, 0.85, 0.62],
  [0.86, 0.95, 0.71],
];
const SALESFORCE_SKYLINE: [number, number, number][] = [
  [0.04, 0.13, 0.68],
  [0.14, 0.22, 0.62],
  [0.23, 0.31, 0.73],
  [0.32, 0.4, 0.66],
  [0.6, 0.68, 0.67],
  [0.69, 0.77, 0.74],
  [0.78, 0.86, 0.62],
  [0.87, 0.96, 0.71],
];

/** Transamerica Pyramid + a flanking office skyline (Hub override of the
 *  package's lone-pyramid figure). Tower geometry matches the package; the two
 *  original foreground boxes are replaced by the fuller skyline. */
function hubTransamericaPaths(): Pt[][] {
  const paths: Pt[][] = [];
  // Enlarged: a taller apex and a wider base so the pyramid dominates its
  // skyline instead of reading as just another tower in the row.
  const apex: Pt = [0.5, 0.05];
  const crownBaseY = 0.138;
  const bodyBaseY = 0.858;
  const leftBase: Pt = [0.35, bodyBaseY];
  const rightBase: Pt = [0.65, bodyBaseY];

  paths.push([apex, [0.49, crownBaseY], leftBase, rightBase, [0.51, crownBaseY], apex]);
  paths.push([
    [0.5, apex[1] + 0.008],
    [0.5, bodyBaseY],
  ]);

  const nBands = 22;
  for (let i = 0; i < nBands; i++) {
    const t = i / (nBands - 1);
    const y = lerp(crownBaseY + 0.022, bodyBaseY - 0.02, t);
    const leftX = lerp(0.492, 0.358, t);
    const rightX = lerp(0.508, 0.642, t);
    paths.push([
      [leftX, y],
      [rightX, y],
    ]);
  }

  paths.push([
    [0.462, 0.27],
    [0.4, bodyBaseY],
  ]);
  paths.push([
    [0.538, 0.27],
    [0.6, bodyBaseY],
  ]);

  paths.push(...skylineRow(PYRAMID_SKYLINE));
  return paths;
}

/** Salesforce Tower + a flanking office skyline (Hub override). Tower geometry
 *  matches the package; the original foreground boxes give way to the skyline. */
function hubSalesforcePaths(): Pt[][] {
  const cx = 0.5;
  const yTop = 0.118;
  const yBottom = 0.892;
  const n = 72;
  const rightSide: Pt[] = [];
  const leftSide: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const y = lerp(yTop, yBottom, t);
    const width = 0.034 + 0.082 * Math.sin((Math.PI / 2) * t) ** 1.22;
    rightSide.push([cx + width, y]);
    leftSide.push([cx - width, y]);
  }
  const crown = arcPoints(cx, yTop, 0.034, Math.PI, 0, 28);
  const outline = [...crown, ...rightSide.slice(1), ...leftSide.toReversed(), crown[0]];

  const paths: Pt[][] = [outline];
  const stripeCount = 30;
  for (let i = 0; i < stripeCount; i++) {
    const t = i / (stripeCount - 1);
    const y = lerp(yTop + 0.018, yBottom - 0.022, t);
    const width = 0.028 + 0.077 * Math.sin((Math.PI / 2) * t) ** 1.18;
    paths.push([
      [cx - width * 0.93, y],
      [cx + width * 0.93, y],
    ]);
  }

  paths.push([
    [cx - 0.018, yTop + 0.015],
    [cx - 0.049, yBottom],
  ]);
  paths.push([
    [cx + 0.018, yTop + 0.015],
    [cx + 0.049, yBottom],
  ]);

  paths.push(...skylineRow(SALESFORCE_SKYLINE));
  return paths;
}

let applied = false;
/** Idempotently apply the Hub catalog edits. Safe across HMR. */
export function applyHubLandmarkEdits() {
  if (applied) return;
  applied = true;

  // Swap Coit Tower out and Oracle Park in.
  const coit = LANDMARK_BUILDERS.findIndex((d) => d.id === "coit-tower");
  if (coit !== -1) {
    LANDMARK_BUILDERS.splice(coit, 1, { id: "oracle-park", build: oracleParkPaths });
  } else if (!LANDMARK_BUILDERS.some((d) => d.id === "oracle-park")) {
    LANDMARK_BUILDERS.push({ id: "oracle-park", build: oracleParkPaths });
  }

  // Replace the lone pyramid / Salesforce figures with their skyline versions.
  const pyramid = LANDMARK_BUILDERS.findIndex((d) => d.id === "transamerica-pyramid");
  if (pyramid !== -1) {
    LANDMARK_BUILDERS[pyramid] = { id: "transamerica-pyramid", build: hubTransamericaPaths };
  }
  const salesforce = LANDMARK_BUILDERS.findIndex((d) => d.id === "salesforce-tower");
  if (salesforce !== -1) {
    LANDMARK_BUILDERS[salesforce] = { id: "salesforce-tower", build: hubSalesforcePaths };
  }
}
