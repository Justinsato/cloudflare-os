import { arcPoints, cableYAtX, deckYAtX, lerp, suspensionCablePoints } from "./geometry";

function goldenGatePaths(): [number, number][][] {
  const paths: [number, number][][] = [];
  const deckL: [number, number] = [0.16, 0.79];
  const deckR: [number, number] = [0.95, 0.67];
  const deckTop: [number, number][] = [];
  const deckBottom: [number, number][] = [];
  for (let i = 0; i <= 84; i++) {
    const t = i / 84;
    const x = lerp(deckL[0], deckR[0], t);
    const y = lerp(deckL[1], deckR[1], t);
    deckTop.push([x, y - 0.009]);
    deckBottom.push([x, y + 0.016]);
  }
  paths.push(deckTop, deckBottom);

  const nearTowerShell: [number, number][] = [
    [0.335, 0.985],
    [0.335, 0.206],
    [0.385, 0.194],
    [0.385, 0.953],
    [0.335, 0.985],
  ];
  const nearTowerInner: [number, number][] = [
    [0.347, 0.958],
    [0.347, 0.234],
    [0.373, 0.226],
    [0.373, 0.936],
    [0.347, 0.958],
  ];
  const farTowerShell: [number, number][] = [
    [0.79, 0.865],
    [0.79, 0.365],
    [0.827, 0.355],
    [0.827, 0.848],
    [0.79, 0.865],
  ];
  const farTowerInner: [number, number][] = [
    [0.799, 0.852],
    [0.799, 0.389],
    [0.818, 0.382],
    [0.818, 0.838],
    [0.799, 0.852],
  ];
  paths.push(nearTowerShell, nearTowerInner, farTowerShell, farTowerInner);

  for (const y of [0.304, 0.41, 0.515, 0.625, 0.738, 0.856]) {
    paths.push([
      [0.352, y],
      [0.368, y - 0.002],
    ]);
  }
  for (const y of [0.445, 0.562, 0.686, 0.804]) {
    paths.push([
      [0.803, y],
      [0.814, y - 0.002],
    ]);
  }

  const xCap1 = 0.36;
  const yCap1 = 0.194;
  const xCap2 = 0.809;
  const yCap2 = 0.355;
  paths.push(suspensionCablePoints(0.03, 0.6, xCap1, yCap1, 0.2, 34));
  paths.push(suspensionCablePoints(xCap1, yCap1, xCap2, yCap2, 0.39, 92));
  paths.push(suspensionCablePoints(xCap2, yCap2, 0.97, 0.67, 0.13, 34));
  paths.push(suspensionCablePoints(xCap1, yCap1 + 0.02, xCap2, yCap2 + 0.018, 0.372, 86));

  for (let i = 0; i <= 28; i++) {
    const t = i / 28;
    const x = lerp(0.08, 0.92, t);
    const yc = cableYAtX(x, xCap1, yCap1, xCap2, yCap2, 0.39);
    const yd = deckYAtX(x, deckL[0], deckL[1], deckR[0], deckR[1]) - 0.009;
    paths.push([
      [x, yc],
      [x, yd],
    ]);
  }

  const truss: [number, number][] = [];
  for (let i = 0; i <= 26; i++) {
    const t = i / 26;
    const x = lerp(deckL[0], deckR[0], t);
    const yTop = lerp(deckL[1], deckR[1], t) + 0.002;
    const yBot = yTop + 0.014;
    if (i === 0) truss.push([x, yBot]);
    truss.push([x, yTop]);
    if (i < 26) {
      const x2 = lerp(deckL[0], deckR[0], (i + 1) / 26);
      const yTop2 = lerp(deckL[1], deckR[1], (i + 1) / 26) + 0.002;
      truss.push([x2, yBot]);
      truss.push([x2, yTop2]);
    }
  }
  paths.push(truss);

  paths.push([
    [0.015, 0.955],
    [0.12, 0.944],
    [0.24, 0.95],
    [0.36, 0.946],
    [0.5, 0.952],
  ]);
  paths.push([
    [0.63, 0.942],
    [0.79, 0.938],
    [0.97, 0.946],
  ]);

  return paths;
}

function paintedLadiesPaths(): [number, number][][] {
  const paths: [number, number][][] = [];
  const streetY = 0.898;
  const baseY = 0.81;

  type HouseSpec = {
    x0: number;
    x1: number;
    roofY: number;
    corniceY: number;
    style: "turret" | "gable";
    skew: number;
  };

  const houses: HouseSpec[] = [
    { x0: 0.06, x1: 0.19, roofY: 0.53, corniceY: 0.635, style: "turret", skew: -0.004 },
    { x0: 0.19, x1: 0.325, roofY: 0.515, corniceY: 0.62, style: "gable", skew: -0.003 },
    { x0: 0.325, x1: 0.455, roofY: 0.505, corniceY: 0.615, style: "gable", skew: -0.0015 },
    { x0: 0.455, x1: 0.59, roofY: 0.495, corniceY: 0.61, style: "gable", skew: 0.0005 },
    { x0: 0.59, x1: 0.74, roofY: 0.49, corniceY: 0.608, style: "gable", skew: 0.0025 },
    { x0: 0.74, x1: 0.93, roofY: 0.505, corniceY: 0.622, style: "gable", skew: 0.0045 },
  ];

  // Rear skyline silhouette visible behind roofs.
  paths.push([
    [0.03, 0.46],
    [0.08, 0.45],
    [0.08, 0.39],
    [0.11, 0.39],
    [0.11, 0.45],
    [0.19, 0.45],
    [0.24, 0.44],
    [0.29, 0.445],
    [0.29, 0.41],
    [0.315, 0.41],
    [0.315, 0.445],
    [0.37, 0.447],
    [0.43, 0.441],
    [0.43, 0.4],
    [0.465, 0.4],
    [0.465, 0.441],
    [0.54, 0.446],
    [0.59, 0.443],
    [0.59, 0.405],
    [0.62, 0.405],
    [0.62, 0.443],
    [0.71, 0.447],
    [0.71, 0.42],
    [0.75, 0.42],
    [0.75, 0.448],
    [0.86, 0.452],
    [0.91, 0.447],
  ]);

  // Top tree line behind houses.
  paths.push([
    [0.02, 0.49],
    [0.07, 0.47],
    [0.14, 0.48],
    [0.2, 0.465],
    [0.28, 0.478],
    [0.35, 0.462],
    [0.43, 0.476],
    [0.5, 0.465],
    [0.58, 0.478],
    [0.66, 0.468],
    [0.74, 0.481],
    [0.83, 0.472],
    [0.94, 0.485],
  ]);

  for (const house of houses) {
    const { x0, x1, roofY, corniceY, style, skew } = house;
    const xm = (x0 + x1) * 0.5 + skew;
    const left = x0 + 0.006 + skew;
    const right = x1 - 0.006 + skew;

    if (style === "turret") {
      const turretX = x0 + (x1 - x0) * 0.28 + skew;
      const overhangL = left - 0.008;
      const overhangR = right + 0.01;
      paths.push([
        [left, baseY],
        [left, corniceY],
        [turretX - 0.03, corniceY - 0.002],
        [turretX - 0.02, roofY + 0.05],
        [turretX, roofY + 0.012],
        [turretX + 0.02, roofY + 0.05],
        [turretX + 0.03, corniceY - 0.002],
        [right, corniceY + 0.004],
        [right, baseY],
      ]);
      paths.push(arcPoints(turretX, roofY + 0.012, 0.012, Math.PI * 1.02, Math.PI * 1.98, 18));
      // Add fuller roof mass so coverage extends across facade width.
      paths.push([
        [overhangL, corniceY + 0.01],
        [turretX - 0.04, corniceY + 0.008],
        [turretX - 0.026, roofY + 0.06],
        [turretX, roofY + 0.018],
        [turretX + 0.026, roofY + 0.06],
        [turretX + 0.05, corniceY + 0.01],
        [overhangR, corniceY + 0.014],
      ]);
      paths.push([
        [overhangL + 0.01, corniceY + 0.024],
        [turretX - 0.028, corniceY + 0.022],
        [turretX, roofY + 0.04],
        [turretX + 0.03, corniceY + 0.023],
        [overhangR - 0.012, corniceY + 0.026],
      ]);
      paths.push([
        [turretX - 0.042, corniceY + 0.011],
        [turretX + 0.038, corniceY + 0.013],
      ]);
    } else {
      const overhangL = left - 0.01;
      const overhangR = right + 0.01;
      paths.push([
        [left, baseY],
        [left, corniceY + 0.004],
        [xm - 0.03, corniceY + 0.004],
        [xm - 0.018, roofY + 0.04],
        [xm, roofY],
        [xm + 0.018, roofY + 0.04],
        [xm + 0.03, corniceY + 0.004],
        [right, corniceY + 0.004],
        [right, baseY],
      ]);
      // Broader roof planes: outer roof edge + inner break line.
      paths.push([
        [overhangL, corniceY + 0.01],
        [xm - 0.044, corniceY + 0.01],
        [xm - 0.022, roofY + 0.052],
        [xm, roofY + 0.018],
        [xm + 0.022, roofY + 0.052],
        [xm + 0.048, corniceY + 0.01],
        [overhangR, corniceY + 0.012],
      ]);
      paths.push([
        [overhangL + 0.012, corniceY + 0.024],
        [xm - 0.03, corniceY + 0.022],
        [xm, roofY + 0.036],
        [xm + 0.032, corniceY + 0.022],
        [overhangR - 0.012, corniceY + 0.024],
      ]);
      paths.push([
        [xm - 0.016, roofY + 0.03],
        [xm + 0.016, roofY + 0.03],
      ]);
      // Eave edge to visually cap the full house width.
      paths.push([
        [overhangL + 0.004, corniceY + 0.011],
        [overhangR - 0.004, corniceY + 0.013],
      ]);
    }

    // Cornice and floor belt.
    paths.push([
      [left + 0.003, corniceY + 0.02],
      [right - 0.003, corniceY + 0.02],
    ]);
    paths.push([
      [left + 0.01, 0.72],
      [right - 0.01, 0.72],
    ]);

    // Upper paired windows.
    const u1 = x0 + (x1 - x0) * 0.34 + skew;
    const u2 = x0 + (x1 - x0) * 0.66 + skew;
    for (const wx of [u1, u2]) {
      paths.push([
        [wx - 0.013, 0.72],
        [wx - 0.013, 0.67],
      ]);
      paths.push(arcPoints(wx, 0.668, 0.013, Math.PI, Math.PI * 2, 14));
      paths.push([
        [wx + 0.013, 0.668],
        [wx + 0.013, 0.72],
      ]);
      paths.push([
        [wx - 0.01, 0.696],
        [wx + 0.01, 0.696],
      ]);
    }

    // Lower arched opening + door.
    const doorX = x0 + (x1 - x0) * 0.52 + skew;
    paths.push([
      [doorX - 0.015, baseY],
      [doorX - 0.015, 0.748],
    ]);
    paths.push(arcPoints(doorX, 0.748, 0.015, Math.PI, Math.PI * 2, 14));
    paths.push([
      [doorX + 0.015, 0.748],
      [doorX + 0.015, baseY],
    ]);

    // Stoop rails.
    paths.push([
      [doorX - 0.038, streetY - 0.01],
      [doorX - 0.019, baseY + 0.002],
    ]);
    paths.push([
      [doorX + 0.038, streetY - 0.012],
      [doorX + 0.019, baseY + 0.002],
    ]);
  }

  // Street-level trees in front of row.
  const trees = [
    { x: 0.16, r: 0.038 },
    { x: 0.3, r: 0.034 },
    { x: 0.44, r: 0.036 },
    { x: 0.58, r: 0.034 },
    { x: 0.73, r: 0.036 },
    { x: 0.86, r: 0.034 },
  ];
  for (const t of trees) {
    paths.push(arcPoints(t.x, 0.845, t.r, Math.PI * 1.04, Math.PI * 1.96, 22));
    paths.push([
      [t.x - 0.008, 0.865],
      [t.x - 0.004, streetY - 0.006],
      [t.x + 0.004, streetY - 0.007],
      [t.x + 0.008, 0.865],
    ]);
  }

  // Foreground curb/road curves from reference.
  paths.push([
    [0.01, 0.918],
    [0.19, 0.905],
    [0.41, 0.916],
    [0.66, 0.907],
    [0.98, 0.918],
  ]);
  paths.push([
    [0.02, 0.966],
    [0.14, 0.962],
    [0.22, 0.948],
    [0.3, 0.962],
  ]);
  paths.push([
    [0.8, 0.962],
    [0.89, 0.952],
    [0.97, 0.966],
  ]);

  return paths;
}

function coitPaths(): [number, number][][] {
  const cx = 0.5;
  const shaftBottom = 0.79;
  const shaftTop = 0.33;
  const wBottom = 0.108;
  const wTop = 0.074;

  const paths: [number, number][][] = [];

  const basePlinth: [number, number][] = [
    [cx - 0.17, 0.94],
    [cx - 0.17, 0.89],
    [cx - 0.138, 0.874],
    [cx + 0.138, 0.874],
    [cx + 0.17, 0.89],
    [cx + 0.17, 0.94],
    [cx - 0.17, 0.94],
  ];
  const pedestal: [number, number][] = [
    [cx - 0.135, 0.875],
    [cx - 0.122, 0.84],
    [cx - 0.112, 0.815],
    [cx + 0.112, 0.815],
    [cx + 0.122, 0.84],
    [cx + 0.135, 0.875],
  ];
  const shaftOutline: [number, number][] = [
    [cx - wBottom, shaftBottom],
    [cx - wTop, shaftTop],
    [cx + wTop, shaftTop],
    [cx + wBottom, shaftBottom],
    [cx - wBottom, shaftBottom],
  ];
  paths.push(basePlinth, pedestal, shaftOutline);

  const flutes = [-0.078, -0.058, -0.038, -0.018, 0.002, 0.022, 0.042, 0.062, 0.078];
  for (const dx of flutes) {
    const x0 = cx + dx;
    const tilt = dx * 0.02;
    paths.push([
      [x0 - tilt, shaftBottom - 0.01],
      [x0 + tilt * 0.25, shaftTop + 0.015],
    ]);
  }

  paths.push(arcPoints(cx, 0.326, 0.094, Math.PI * 1.03, Math.PI * 1.97, 44));
  paths.push(arcPoints(cx, 0.352, 0.104, Math.PI * 1.03, Math.PI * 1.97, 44));

  const drumBottom = 0.318;
  const drumTop = 0.205;
  const drumWBot = 0.089;
  const drumWTop = 0.071;
  const drum: [number, number][] = [
    [cx - drumWBot, drumBottom],
    [cx - drumWTop, drumTop],
    [cx + drumWTop, drumTop],
    [cx + drumWBot, drumBottom],
    [cx - drumWBot, drumBottom],
  ];
  paths.push(drum);
  paths.push(arcPoints(cx, drumTop + 0.002, drumWTop, Math.PI * 1.05, Math.PI * 1.95, 28));

  const archCenters = [cx - 0.046, cx - 0.018, cx + 0.01, cx + 0.038];
  for (const ax of archCenters) {
    paths.push([
      [ax - 0.008, 0.284],
      [ax - 0.008, 0.248],
    ]);
    paths.push(arcPoints(ax, 0.247, 0.008, Math.PI, Math.PI * 2, 18));
    paths.push([
      [ax + 0.008, 0.247],
      [ax + 0.008, 0.284],
    ]);
  }

  paths.push([
    [cx - 0.017, drumTop + 0.004],
    [cx - 0.017, 0.165],
    [cx + 0.017, 0.165],
    [cx + 0.017, drumTop + 0.004],
  ]);
  paths.push(arcPoints(cx, 0.164, 0.017, Math.PI, Math.PI * 2, 20));

  paths.push([
    [cx, 0.148],
    [cx - 0.006, 0.116],
    [cx, 0.084],
    [cx + 0.006, 0.116],
    [cx, 0.148],
  ]);
  paths.push([
    [cx, 0.086],
    [cx, 0.063],
  ]);

  paths.push([
    [0.16, 0.886],
    [0.24, 0.867],
    [0.31, 0.855],
    [0.37, 0.86],
  ]);
  paths.push([
    [0.63, 0.86],
    [0.72, 0.854],
    [0.79, 0.866],
    [0.88, 0.856],
  ]);

  return paths;
}

function transamericaPaths(): [number, number][][] {
  const paths: [number, number][][] = [];
  const apex: [number, number] = [0.5, 0.065];
  const crownBaseY = 0.138;
  const bodyBaseY = 0.838;
  const leftBase: [number, number] = [0.392, bodyBaseY];
  const rightBase: [number, number] = [0.608, bodyBaseY];

  const outline: [number, number][] = [
    apex,
    [0.492, crownBaseY],
    leftBase,
    rightBase,
    [0.508, crownBaseY],
    apex,
  ];
  paths.push(outline);

  paths.push([
    [0.5, apex[1] + 0.008],
    [0.5, bodyBaseY],
  ]);

  const nBands = 22;
  for (let i = 0; i < nBands; i++) {
    const t = i / (nBands - 1);
    const y = lerp(crownBaseY + 0.022, bodyBaseY - 0.02, t);
    const leftX = lerp(0.494, 0.402, t);
    const rightX = lerp(0.506, 0.598, t);
    paths.push([
      [leftX, y],
      [rightX, y],
    ]);
  }

  paths.push([
    [0.468, 0.27],
    [0.438, bodyBaseY],
  ]);
  paths.push([
    [0.532, 0.27],
    [0.562, bodyBaseY],
  ]);

  paths.push([
    [0.08, 0.898],
    [0.2, 0.898],
    [0.2, 0.75],
    [0.28, 0.75],
    [0.28, 0.898],
  ]);
  paths.push([
    [0.72, 0.898],
    [0.72, 0.75],
    [0.8, 0.75],
    [0.8, 0.898],
    [0.92, 0.898],
  ]);
  paths.push([
    [0.03, 0.89],
    [0.22, 0.875],
    [0.5, 0.89],
    [0.78, 0.878],
    [0.97, 0.892],
  ]);

  return paths;
}

function salesforcePaths(): [number, number][][] {
  const cx = 0.5;
  const yTop = 0.118;
  const yBottom = 0.892;
  const n = 72;
  const rightSide: [number, number][] = [];
  const leftSide: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const y = lerp(yTop, yBottom, t);
    const width = 0.034 + 0.082 * Math.sin((Math.PI / 2) * t) ** 1.22;
    rightSide.push([cx + width, y]);
    leftSide.push([cx - width, y]);
  }
  const crown = arcPoints(cx, yTop, 0.034, Math.PI, 0, 28);
  const outline = [...crown, ...rightSide.slice(1), ...leftSide.toReversed(), crown[0]];

  const paths: [number, number][][] = [outline];
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

  paths.push([
    [0.08, 0.9],
    [0.19, 0.9],
    [0.19, 0.78],
    [0.27, 0.78],
    [0.27, 0.9],
  ]);
  paths.push([
    [0.73, 0.9],
    [0.73, 0.79],
    [0.81, 0.79],
    [0.81, 0.9],
    [0.92, 0.9],
  ]);
  paths.push([
    [0.03, 0.905],
    [0.22, 0.894],
    [0.5, 0.906],
    [0.77, 0.896],
    [0.97, 0.907],
  ]);

  return paths;
}

function westSuspensionTower(cx: number, deckY: number, w: number, topY: number): [number, number][][] {
  const xL = cx - w * 0.5;
  const xR = cx + w * 0.5;
  const shell: [number, number][] = [
    [xL, deckY],
    [xR, deckY],
    [xR - w * 0.08, topY],
    [xL + w * 0.08, topY],
    [xL, deckY],
  ];
  const mid = (xL + xR) * 0.5;
  const xBrace: [number, number][][] = [
    [
      [xL + w * 0.06, deckY - 0.02],
      [xR - w * 0.06, topY + 0.04],
    ],
    [
      [xR - w * 0.06, deckY - 0.02],
      [xL + w * 0.06, topY + 0.04],
    ],
    [
      [mid - w * 0.12, deckY - 0.12],
      [mid + w * 0.12, topY + 0.12],
    ],
    [
      [mid + w * 0.12, deckY - 0.12],
      [mid - w * 0.12, topY + 0.12],
    ],
  ];
  return [shell, ...xBrace];
}

function bayBridgePaths(): [number, number][][] {
  const paths: [number, number][][] = [];
  // Deck edges (slight perspective rise to the right).
  const deckX0 = 0.04;
  const deckX1 = 0.98;
  const deckTopL = 0.64;
  const deckTopR = 0.665;
  const deckDepth = 0.038;
  const deckTop: [number, number][] = [];
  const deckBot: [number, number][] = [];
  for (let i = 0; i <= 96; i++) {
    const t = i / 96;
    const x = lerp(deckX0, deckX1, t);
    const y = lerp(deckTopL, deckTopR, t);
    deckTop.push([x, y]);
    deckBot.push([x, y + deckDepth]);
  }
  paths.push(deckTop, deckBot);

  // West suspension towers (rear then main/front).
  const rearTowerX = 0.16;
  const rearDeckY = deckYAtX(rearTowerX, deckX0, deckTopL, deckX1, deckTopR);
  const rearTopY = 0.41;
  paths.push(...westSuspensionTower(rearTowerX, rearDeckY + 0.004, 0.05, rearTopY));

  const mainTowerX = 0.37;
  const mainDeckY = deckYAtX(mainTowerX, deckX0, deckTopL, deckX1, deckTopR);
  const mainTopY = 0.22;
  paths.push(...westSuspensionTower(mainTowerX, mainDeckY + 0.006, 0.074, mainTopY));

  // Main suspension cable profile exactly across west spans.
  const capRearX = rearTowerX;
  const capRearY = rearTopY - 0.02;
  const capMainX = mainTowerX;
  const capMainY = mainTopY - 0.02;
  const westAnchorX = 0.05;
  const westAnchorY = 0.66;
  const eastSaddleX = 0.57;
  const eastSaddleY = deckYAtX(eastSaddleX, deckX0, deckTopL, deckX1, deckTopR) - 0.05;

  paths.push(suspensionCablePoints(westAnchorX, westAnchorY, capRearX, capRearY, 0.09, 34));
  paths.push(suspensionCablePoints(capRearX, capRearY, capMainX, capMainY, 0.24, 58));
  paths.push(suspensionCablePoints(capMainX, capMainY, eastSaddleX, eastSaddleY, 0.115, 38));

  // Secondary cable stroke.
  paths.push(suspensionCablePoints(capRearX, capRearY + 0.012, capMainX, capMainY + 0.012, 0.224, 48));

  // Vertical hangers terminate on deck top only (no overshoot).
  for (let i = 0; i <= 17; i++) {
    const t = i / 17;
    const x = lerp(0.09, 0.54, t);
    const yDeck = deckYAtX(x, deckX0, deckTopL, deckX1, deckTopR);
    const yCable =
      x <= capMainX
        ? cableYAtX(x, capRearX, capRearY, capMainX, capMainY, 0.24)
        : cableYAtX(x, capMainX, capMainY, eastSaddleX, eastSaddleY, 0.115);
    paths.push([
      [x, yCable],
      [x, yDeck],
    ]);
  }

  // Deck truss (all diagonals kept within deck envelope).
  const truss: [number, number][] = [];
  const nPanels = 36;
  for (let i = 0; i <= nPanels; i++) {
    const t = i / nPanels;
    const x = lerp(deckX0, deckX1, t);
    const yT = deckYAtX(x, deckX0, deckTopL, deckX1, deckTopR) + 0.008;
    const yB = yT + (deckDepth - 0.014);
    if (i === 0) truss.push([x, yB]);
    truss.push([x, yT]);
    if (i < nPanels) {
      const x2 = lerp(deckX0, deckX1, (i + 1) / nPanels);
      const yT2 = deckYAtX(x2, deckX0, deckTopL, deckX1, deckTopR) + 0.008;
      truss.push([x2, yB]);
      truss.push([x2, yT2]);
    }
  }
  paths.push(truss);

  // East cable-stayed pylon.
  const eastPylonX = 0.79;
  const eastDeckY = deckYAtX(eastPylonX, deckX0, deckTopL, deckX1, deckTopR);
  const pylonTopY = 0.045;
  paths.push([
    [eastPylonX - 0.012, eastDeckY + 0.004],
    [eastPylonX - 0.008, pylonTopY],
    [eastPylonX + 0.008, pylonTopY],
    [eastPylonX + 0.012, eastDeckY + 0.004],
  ]);
  paths.push([
    [eastPylonX, pylonTopY],
    [eastPylonX, eastDeckY + 0.004],
  ]);

  // Fan cables constrained to deck-top connection points.
  const fanAttach = [0.59, 0.62, 0.65, 0.68, 0.71, 0.74, 0.77, 0.82, 0.86, 0.9, 0.94, 0.97];
  for (const x of fanAttach) {
    const yDeck = deckYAtX(x, deckX0, deckTopL, deckX1, deckTopR);
    paths.push([
      [eastPylonX, pylonTopY + 0.01],
      [x, yDeck],
    ]);
  }

  // Waterline and distant shoreline.
  paths.push([
    [0.03, 0.74],
    [0.14, 0.738],
    [0.24, 0.742],
    [0.36, 0.737],
    [0.48, 0.744],
    [0.62, 0.739],
    [0.76, 0.745],
    [0.93, 0.741],
  ]);
  paths.push([
    [0.12, 0.86],
    [0.2, 0.852],
    [0.3, 0.86],
  ]);
  paths.push([
    [0.7, 0.858],
    [0.83, 0.85],
    [0.96, 0.861],
  ]);

  return paths;
}

function sfSkylinePaths(): [number, number][][] {
  const paths: [number, number][][] = [];

  const skyline: [number, number][] = [
    [0.02, 0.908],
    [0.045, 0.908], [0.045, 0.777], [0.071, 0.777], [0.071, 0.908],
    [0.082, 0.908], [0.082, 0.736], [0.116, 0.736], [0.116, 0.908],
    [0.132, 0.908], [0.132, 0.804], [0.165, 0.804], [0.165, 0.908],
    [0.183, 0.908], [0.183, 0.742], [0.213, 0.742], [0.213, 0.908],
    [0.23, 0.908], [0.23, 0.79], [0.258, 0.79], [0.258, 0.908],
    [0.272, 0.908], [0.272, 0.73], [0.306, 0.73], [0.306, 0.908],
    [0.322, 0.908], [0.322, 0.765], [0.35, 0.765], [0.35, 0.908],
    [0.366, 0.908], [0.366, 0.562], [0.383, 0.366], [0.401, 0.562], [0.401, 0.908],
    [0.417, 0.908], [0.417, 0.714], [0.45, 0.714], [0.45, 0.908],
    [0.466, 0.908], [0.466, 0.748], [0.496, 0.748], [0.496, 0.908],
    [0.512, 0.908], [0.512, 0.69], [0.555, 0.69], [0.555, 0.908],
    [0.57, 0.908], [0.57, 0.646], [0.613, 0.646], [0.613, 0.908],
    [0.628, 0.908], [0.628, 0.79], [0.665, 0.79], [0.665, 0.908],
    [0.68, 0.908], [0.68, 0.705], [0.721, 0.705], [0.721, 0.908],
    [0.735, 0.908], [0.735, 0.678], [0.776, 0.678], [0.776, 0.908],
    [0.792, 0.908], [0.792, 0.162], [0.814, 0.162], [0.814, 0.908],
    [0.831, 0.908], [0.831, 0.688], [0.865, 0.688], [0.865, 0.908],
    [0.88, 0.908], [0.88, 0.732], [0.912, 0.732], [0.912, 0.908],
    [0.928, 0.908], [0.928, 0.66], [0.962, 0.66], [0.962, 0.908],
    [0.978, 0.908],
  ];
  paths.push(skyline);

  // Soft bay horizon line behind lower buildings.
  paths.push([
    [0.02, 0.872],
    [0.1, 0.866],
    [0.18, 0.87],
    [0.28, 0.864],
    [0.37, 0.871],
    [0.46, 0.863],
    [0.56, 0.87],
    [0.66, 0.864],
    [0.76, 0.872],
    [0.86, 0.865],
    [0.98, 0.872],
  ]);

  // Transamerica internal ribs.
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    const y = lerp(0.39, 0.88, t);
    const l = lerp(0.383, 0.37, t);
    const r = lerp(0.383, 0.396, t);
    paths.push([
      [l, y],
      [r, y],
    ]);
  }

  // Salesforce crown bands for readability.
  for (let i = 0; i < 8; i++) {
    const y = 0.19 + i * 0.055;
    paths.push([
      [0.794, y],
      [0.812, y],
    ]);
  }

  // Foreground blocks in front of skyline.
  paths.push([
    [0.04, 0.938], [0.13, 0.938], [0.13, 0.87], [0.18, 0.87], [0.18, 0.938], [0.28, 0.938],
  ]);
  paths.push([
    [0.56, 0.938], [0.65, 0.938], [0.65, 0.885], [0.705, 0.885], [0.705, 0.938], [0.77, 0.938],
  ]);

  paths.push([
    [0.01, 0.94],
    [0.2, 0.93],
    [0.39, 0.945],
    [0.6, 0.934],
    [0.8, 0.942],
    [0.99, 0.936],
  ]);

  paths.push([
    [0.18, 0.9],
    [0.24, 0.905],
    [0.29, 0.89],
    [0.35, 0.9],
  ]);
  paths.push([
    [0.86, 0.91],
    [0.9, 0.9],
    [0.94, 0.91],
  ]);

  return paths;
}

function ferryPaths(): [number, number][][] {
  const paths: [number, number][][] = [];
  const base = 0.94;
  const towerCx = 0.5;

  // Long base platform and bay horizon.
  paths.push([
    [0.11, base],
    [0.89, base],
  ]);
  paths.push([
    [0.08, 0.9],
    [0.2, 0.896],
    [0.35, 0.902],
    [0.5, 0.898],
    [0.66, 0.904],
    [0.82, 0.897],
    [0.93, 0.902],
  ]);

  // East/west wings with arched openings.
  const wingL: [number, number][] = [
    [0.16, base],
    [0.16, 0.79],
    [0.25, 0.765],
    [0.33, 0.79],
    [0.33, base],
  ];
  const wingR: [number, number][] = [
    [0.67, base],
    [0.67, 0.79],
    [0.75, 0.765],
    [0.84, 0.79],
    [0.84, base],
  ];
  paths.push(wingL, wingR);

  // Main nave roof and facade.
  const naveRoof: [number, number][] = [
    [0.33, 0.79],
    [0.37, 0.74],
    [0.5, 0.69],
    [0.63, 0.74],
    [0.67, 0.79],
  ];
  const naveBody: [number, number][] = [
    [0.35, base],
    [0.35, 0.79],
    [0.65, 0.79],
    [0.65, base],
  ];
  paths.push(naveRoof, naveBody);

  // Central clock tower silhouette.
  const tower: [number, number][] = [
    [0.41, base],
    [0.41, 0.79],
    [0.435, 0.72],
    [0.435, 0.53],
    [0.452, 0.39],
    [towerCx, 0.295],
    [0.548, 0.39],
    [0.565, 0.53],
    [0.565, 0.72],
    [0.59, 0.79],
    [0.59, base],
  ];
  paths.push(tower);

  // Tower vertical faces and ledges.
  paths.push([
    [0.455, 0.76],
    [0.455, 0.36],
  ]);
  paths.push([
    [0.545, 0.76],
    [0.545, 0.36],
  ]);
  for (const y of [0.72, 0.665, 0.61, 0.555, 0.5, 0.445]) {
    paths.push([
      [0.455, y],
      [0.545, y],
    ]);
  }

  // Clock face + hands.
  const clockCx = towerCx;
  const clockCy = 0.485;
  const clockR = 0.055;
  paths.push(arcPoints(clockCx, clockCy, clockR, 0, Math.PI * 2, 44));
  paths.push([
    [clockCx, clockCy],
    [clockCx, clockCy - 0.027],
  ]);
  paths.push([
    [clockCx, clockCy],
    [clockCx + 0.02, clockCy],
  ]);

  // Ground-floor arches across wings and nave.
  const archCenters = [0.205, 0.245, 0.285, 0.395, 0.43, 0.465, 0.535, 0.57, 0.605, 0.715, 0.755, 0.795];
  for (const ax of archCenters) {
    paths.push([
      [ax - 0.012, base],
      [ax - 0.012, 0.875],
    ]);
    paths.push(arcPoints(ax, 0.875, 0.012, Math.PI, Math.PI * 2, 14));
    paths.push([
      [ax + 0.012, 0.875],
      [ax + 0.012, base],
    ]);
  }

  // Roof ridge detail + cupola finial.
  paths.push([
    [0.475, 0.32],
    [0.5, 0.287],
    [0.525, 0.32],
  ]);
  paths.push([
    [0.5, 0.287],
    [0.5, 0.257],
  ]);

  return paths;
}

export const LANDMARK_BUILDERS: { id: string; build: () => [number, number][][] }[] = [
  { id: "golden-gate-bridge", build: goldenGatePaths },
  { id: "painted-ladies", build: paintedLadiesPaths },
  { id: "coit-tower", build: coitPaths },
  { id: "transamerica-pyramid", build: transamericaPaths },
  { id: "salesforce-tower", build: salesforcePaths },
  { id: "bay-bridge", build: bayBridgePaths },
  { id: "sf-skyline", build: sfSkylinePaths },
  { id: "ferry-building", build: ferryPaths },
];
