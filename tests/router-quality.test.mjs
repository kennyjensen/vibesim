import assert from "node:assert/strict";
import { routeAllConnections, analyzeConnectionGeometry } from "../router.js";
import { GRID_SIZE } from "../geometry.js";

function makeBlock(id, type, x, y, width, height, ports) {
  return { id, type, x, y, width, height, ports };
}

function turns(points) {
  let t = 0;
  let prev = null;
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    const dir = a.x === b.x ? "V" : a.y === b.y ? "H" : null;
    if (!dir) continue;
    if (prev && prev !== dir) t += 1;
    prev = dir;
  }
  return t;
}

function runTest(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`fail - ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}


runTest("quality: complex loop avoids self-cross and parallel overlap", () => {
  const blocks = new Map();
  const b1 = makeBlock("b1", "step", 1900, 1410, 140, 70, [
    { x: 140, y: 35, side: "right", type: "out", index: 0 },
  ]);
  const b2 = makeBlock("b2", "integrator", 2260, 1410, 90, 60, [
    { x: 0, y: 30, side: "left", type: "in", index: 0 },
    { x: 90, y: 30, side: "right", type: "out", index: 0 },
  ]);
  const b3 = makeBlock("b3", "gain", 2210, 1270, 92, 80, [
    { x: 0, y: 40, side: "left", type: "in", index: 0 },
    { x: 92, y: 40, side: "right", type: "out", index: 0 },
  ]);
  const b4 = makeBlock("b4", "sum", 2130, 1420, 40, 40, [
    { x: 0, y: 20, side: "left", type: "in", index: 0 },
    { x: 20, y: 0, side: "top", type: "in", index: 1 },
    { x: 20, y: 40, side: "bottom", type: "in", index: 2 },
    { x: 40, y: 20, side: "right", type: "out", index: 0 },
  ]);
  const b5 = makeBlock("b5", "scope", 2160, 1550, 220, 140, [
    { x: 0, y: 50, side: "left", type: "in", index: 0 },
    { x: 0, y: 70, side: "left", type: "in", index: 1 },
    { x: 0, y: 90, side: "left", type: "in", index: 2 },
  ]);
  [b1, b2, b3, b4, b5].forEach((b) => blocks.set(b.id, b));

  const state = {
    blocks,
    connections: [
      { from: b1.id, to: b4.id, toIndex: 0, fromIndex: 0, path: {}, points: [] },
      { from: b4.id, to: b2.id, toIndex: 0, fromIndex: 0, path: {}, points: [] },
      { from: b2.id, to: b3.id, toIndex: 0, fromIndex: 0, path: {}, points: [] },
      { from: b3.id, to: b4.id, toIndex: 1, fromIndex: 0, path: {}, points: [] },
      { from: b1.id, to: b5.id, toIndex: 0, fromIndex: 0, path: {}, points: [] },
      { from: b4.id, to: b5.id, toIndex: 1, fromIndex: 0, path: {}, points: [] },
      { from: b2.id, to: b5.id, toIndex: 2, fromIndex: 0, path: {}, points: [] },
    ],
  };

  routeAllConnections(state, 3000, 2200, { x: 0, y: 0 });

  const analysis = analyzeConnectionGeometry(state.connections, { ignoreSharedPorts: true });
  assert.equal(analysis.totals.nonOrthogonal, 0);
  assert.equal(analysis.totals.selfCrosses, 0);
  assert.equal(analysis.totals.overlaps, 0);
});

runTest("quality: unobstructed direct connection stays zero-turn", () => {
  const blocks = new Map();
  const src = makeBlock("src", "step", 100, 100, 80, 60, [
    { x: 80, y: 30, side: "right", type: "out", index: 0 },
  ]);
  const dst = makeBlock("dst", "scope", 350, 100, 120, 100, [
    { x: 0, y: 30, side: "left", type: "in", index: 0 },
  ]);
  blocks.set(src.id, src);
  blocks.set(dst.id, dst);
  const state = {
    blocks,
    connections: [{ from: "src", to: "dst", fromIndex: 0, toIndex: 0, path: {}, points: [] }],
  };
  routeAllConnections(state, 900, 600, { x: 0, y: 0 });
  assert.equal(turns(state.connections[0].points), 0);
});

runTest("quality: simple detour does not over-bend", () => {
  const blocks = new Map();
  const src = makeBlock("src", "step", 100, 200, 80, 60, [
    { x: 80, y: 30, side: "right", type: "out", index: 0 },
  ]);
  const obst = makeBlock("ob", "gain", 220, 180, 92, 80, [
    { x: 0, y: 40, side: "left", type: "in", index: 0 },
    { x: 92, y: 40, side: "right", type: "out", index: 0 },
  ]);
  const dst = makeBlock("dst", "scope", 420, 200, 120, 100, [
    { x: 0, y: 30, side: "left", type: "in", index: 0 },
  ]);
  [src, obst, dst].forEach((b) => blocks.set(b.id, b));
  const state = {
    blocks,
    connections: [{ from: "src", to: "dst", fromIndex: 0, toIndex: 0, path: {}, points: [] }],
  };
  routeAllConnections(state, 1000, 700, { x: 0, y: 0 });
  assert.ok(turns(state.connections[0].points) <= 6);
});

runTest("quality: shared source wires remain orthogonal", () => {
  const blocks = new Map();
  const src = makeBlock("src", "step", 200, 220, 80, 60, [
    { x: 80, y: 30, side: "right", type: "out", index: 0 },
  ]);
  const dstA = makeBlock("dstA", "scope", 460, 180, 120, 100, [
    { x: 0, y: 30, side: "left", type: "in", index: 0 },
  ]);
  const dstB = makeBlock("dstB", "scope", 460, 300, 120, 100, [
    { x: 0, y: 30, side: "left", type: "in", index: 0 },
  ]);
  [src, dstA, dstB].forEach((b) => blocks.set(b.id, b));
  const state = {
    blocks,
    connections: [
      { from: "src", to: "dstA", fromIndex: 0, toIndex: 0, path: {}, points: [] },
      { from: "src", to: "dstB", fromIndex: 0, toIndex: 0, path: {}, points: [] },
    ],
  };

  routeAllConnections(state, 1000, 800, { x: 0, y: 0 });

  const analysis = analyzeConnectionGeometry(state.connections, { ignoreSharedPorts: true });
  assert.equal(analysis.totals.nonOrthogonal, 0);
  const turnsAt = (pts) => {
    if (!Array.isArray(pts) || pts.length < 3) return null;
    const d0 = pts[0].y === pts[1].y ? "H" : pts[0].x === pts[1].x ? "V" : null;
    for (let i = 1; i < pts.length - 1; i += 1) {
      const d = pts[i].y === pts[i + 1].y ? "H" : pts[i].x === pts[i + 1].x ? "V" : null;
      if (d && d0 && d !== d0) return pts[i];
    }
    return null;
  };
  const tA = turnsAt(state.connections[0].points);
  const tB = turnsAt(state.connections[1].points);
  assert.ok(tA && tB, "expected both branch wires to have a first turn");
  assert.equal(tA.x, tB.x, "shared source branch turns should consolidate to one x-coordinate");
});

runTest("quality: prefers at least 2-cell straight stubs at ports", () => {
  const blocks = new Map();
  const src = makeBlock("src", "step", 120, 220, 80, 60, [
    { x: 80, y: 30, side: "right", type: "out", index: 0 },
  ]);
  const dst = makeBlock("dst", "scope", 400, 140, 120, 100, [
    { x: 0, y: 30, side: "left", type: "in", index: 0 },
  ]);
  [src, dst].forEach((b) => blocks.set(b.id, b));
  const state = {
    blocks,
    connections: [{ from: "src", to: "dst", fromIndex: 0, toIndex: 0, path: {}, points: [] }],
  };

  routeAllConnections(state, 900, 600, { x: 0, y: 0 });
  const pts = state.connections[0].points || [];
  assert.ok(pts.length >= 4, "expected routed polyline");

  let firstTurnPoint = null;
  let firstDir = null;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const a = pts[i];
    const b = pts[i + 1];
    const dir = a.y === b.y ? "H" : a.x === b.x ? "V" : null;
    if (!dir) continue;
    if (!firstDir) {
      firstDir = dir;
      continue;
    }
    if (dir !== firstDir) {
      firstTurnPoint = pts[i];
      break;
    }
  }
  assert.ok(firstTurnPoint, "expected a turn in routed path");
  const srcPt = pts[0];
  const firstTurnCells =
    (Math.abs(firstTurnPoint.x - srcPt.x) + Math.abs(firstTurnPoint.y - srcPt.y)) / GRID_SIZE;
  assert.ok(firstTurnCells >= 2, "first turn should be at least 2 cells away from source");
});
