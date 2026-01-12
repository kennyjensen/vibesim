import assert from "node:assert/strict";
import {
  GRID_SIZE,
  KEEP_OUT,
  expandRect,
  segmentHitsRect,
  snap,
  segmentLengthStats,
  routeOrthogonal,
} from "../geometry.js";
import { routeAllConnections } from "../router.js";

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

function makeBlock(id, type, x, y, width, height, ports) {
  return {
    id,
    type,
    x,
    y,
    width,
    height,
    ports,
  };
}

function bounds(block) {
  return expandRect(
    {
      left: block.x,
      right: block.x + block.width,
      top: block.y,
      bottom: block.y + block.height,
    },
    KEEP_OUT
  );
}

function boundsWithPorts(block) {
  const PORT_RADIUS = 6;
  let left = block.x;
  let right = block.x + block.width;
  let top = block.y;
  let bottom = block.y + block.height;
  block.ports.forEach((port) => {
    const cx = block.x + port.x;
    const cy = block.y + port.y;
    left = Math.min(left, cx - PORT_RADIUS);
    right = Math.max(right, cx + PORT_RADIUS);
    top = Math.min(top, cy - PORT_RADIUS);
    bottom = Math.max(bottom, cy + PORT_RADIUS);
  });
  return { left, right, top, bottom };
}

function pointsToSegments(points) {
  const segments = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    if (a.x === b.x && a.y === b.y) continue;
    segments.push({ a, b });
  }
  return segments;
}

function countTurns(points) {
  let turns = 0;
  let prevDir = null;
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    if (a.x === b.x && a.y === b.y) continue;
    const dir = a.x === b.x ? "V" : a.y === b.y ? "H" : null;
    if (!dir) continue;
    if (prevDir && dir !== prevDir) turns += 1;
    prevDir = dir;
  }
  return turns;
}

function segmentsIntersect(a, b) {
  const aH = a.a.y === a.b.y;
  const bH = b.a.y === b.b.y;
  if (aH && bH) return false;
  if (!aH && !bH) return false;
  const h = aH ? a : b;
  const v = aH ? b : a;
  const hx1 = Math.min(h.a.x, h.b.x);
  const hx2 = Math.max(h.a.x, h.b.x);
  const vy1 = Math.min(v.a.y, v.b.y);
  const vy2 = Math.max(v.a.y, v.b.y);
  const ix = v.a.x;
  const iy = h.a.y;
  return ix > hx1 && ix < hx2 && iy > vy1 && iy < vy2;
}

runTest("loop feedback avoids blocks and stays orthogonal", () => {
  const blocks = new Map();
  const step = makeBlock("b1", "step", 40, 120, 140, 70, [
    { x: 140, y: 35, side: "right", type: "out", index: 0 },
  ]);
  const sum = makeBlock("b2", "sum", 240, 120, 40, 40, [
    { x: 0, y: 20, side: "left", type: "in", index: 0 },
    { x: 20, y: 0, side: "top", type: "in", index: 1 },
    { x: 20, y: 40, side: "bottom", type: "in", index: 2 },
    { x: 40, y: 20, side: "right", type: "out", index: 0 },
  ]);
  const integrator = makeBlock("b3", "integrator", 360, 110, 90, 60, [
    { x: 0, y: 30, side: "left", type: "in", index: 0 },
    { x: 90, y: 30, side: "right", type: "out", index: 0 },
  ]);
  blocks.set(step.id, step);
  blocks.set(sum.id, sum);
  blocks.set(integrator.id, integrator);

  const state = {
    blocks,
    connections: [
      { from: step.id, to: sum.id, toIndex: 0, path: {}, points: [] },
      { from: sum.id, to: integrator.id, toIndex: 0, path: {}, points: [] },
      { from: integrator.id, to: sum.id, toIndex: 2, path: {}, points: [] },
    ],
  };

  routeAllConnections(state, 800, 600, { x: 0, y: 0 });

  const blockBounds = new Map([
    [step.id, bounds(step)],
    [sum.id, bounds(sum)],
    [integrator.id, bounds(integrator)],
  ]);

  state.connections.forEach((conn) => {
    const fromId = conn.from;
    const toId = conn.to;
    const segments = pointsToSegments(conn.points);
    segments.forEach((seg) => {
      assert.ok(
        seg.a.x === seg.b.x || seg.a.y === seg.b.y,
        "segment must be orthogonal"
      );
      blockBounds.forEach((rect, blockId) => {
        if (blockId === fromId || blockId === toId) return;
        const hits = segmentHitsRect(seg.a, seg.b, rect);
        assert.equal(hits, false, `segment crosses block ${blockId}`);
      });
    });
    for (let i = 0; i < segments.length; i += 1) {
      for (let j = i + 2; j < segments.length; j += 1) {
        assert.equal(segmentsIntersect(segments[i], segments[j]), false, "self-cross detected");
      }
    }
  });
});

runTest("overlapping routes find alternate path", () => {
  const blocks = new Map();
  const step = makeBlock("b1", "step", 1880, 1540, 140, 70, [
    { x: 140, y: 35, side: "right", type: "out", index: 0 },
  ]);
  const integrator = makeBlock("b2", "integrator", 2160, 1520, 90, 60, [
    { x: 0, y: 30, side: "left", type: "in", index: 0 },
    { x: 90, y: 30, side: "right", type: "out", index: 0 },
  ]);
  const gain = makeBlock("b3", "gain", 2130, 1400, 92, 80, [
    { x: 0, y: 40, side: "left", type: "in", index: 0 },
    { x: 92, y: 40, side: "right", type: "out", index: 0 },
  ]);
  const sum = makeBlock("b4", "sum", 2080, 1530, 40, 40, [
    { x: 0, y: 20, side: "left", type: "in", index: 0 },
    { x: 20, y: 0, side: "top", type: "in", index: 1 },
    { x: 20, y: 40, side: "bottom", type: "in", index: 2 },
    { x: 40, y: 20, side: "right", type: "out", index: 0 },
  ]);
  const scope = makeBlock("b5", "scope", 2000, 1760, 220, 140, [
    { x: 0, y: 50, side: "left", type: "in", index: 0 },
    { x: 0, y: 70, side: "left", type: "in", index: 1 },
    { x: 0, y: 90, side: "left", type: "in", index: 2 },
  ]);
  blocks.set(step.id, step);
  blocks.set(integrator.id, integrator);
  blocks.set(gain.id, gain);
  blocks.set(sum.id, sum);
  blocks.set(scope.id, scope);

  const state = {
    blocks,
    connections: [
      { from: step.id, to: sum.id, toIndex: 0, fromIndex: 0, path: {}, points: [] },
      { from: sum.id, to: integrator.id, toIndex: 0, fromIndex: 0, path: {}, points: [] },
      { from: integrator.id, to: gain.id, toIndex: 0, fromIndex: 0, path: {}, points: [] },
      { from: gain.id, to: sum.id, toIndex: 1, fromIndex: 0, path: {}, points: [] },
      { from: integrator.id, to: scope.id, toIndex: 0, fromIndex: 0, path: {}, points: [] },
      { from: step.id, to: scope.id, toIndex: 1, fromIndex: 0, path: {}, points: [] },
    ],
  };

  routeAllConnections(state, 3000, 2200, { x: 0, y: 0 }, 100, true);

  const conns = state.connections;
  const segs = conns.map((conn) => pointsToSegments(conn.points));
  const overlaps = segmentsOverlap(segs[4], segs[5]);
  assert.equal(overlaps, false, "expected separate routes to scope inputs");
});

runTest("snapshot overlap regression", () => {
  const blocks = new Map();
  const step = makeBlock("b1", "step", 1910, 1360, 140, 70, [
    { x: 140, y: 35, side: "right", type: "out", index: 0 },
  ]);
  const integrator = makeBlock("b2", "integrator", 2180, 1380, 90, 60, [
    { x: 0, y: 30, side: "left", type: "in", index: 0 },
    { x: 90, y: 30, side: "right", type: "out", index: 0 },
  ]);
  const gain = makeBlock("b3", "gain", 2140, 1250, 92, 80, [
    { x: 0, y: 40, side: "left", type: "in", index: 0 },
    { x: 92, y: 40, side: "right", type: "out", index: 0 },
  ]);
  const sum = makeBlock("b4", "sum", 2100, 1370, 40, 40, [
    { x: 0, y: 20, side: "left", type: "in", index: 0 },
    { x: 20, y: 0, side: "top", type: "in", index: 1 },
    { x: 20, y: 40, side: "bottom", type: "in", index: 2 },
    { x: 40, y: 20, side: "right", type: "out", index: 0 },
  ]);
  const scope = makeBlock("b5", "scope", 2190, 1550, 220, 140, [
    { x: 0, y: 50, side: "left", type: "in", index: 0 },
    { x: 0, y: 70, side: "left", type: "in", index: 1 },
    { x: 0, y: 90, side: "left", type: "in", index: 2 },
  ]);
  blocks.set(step.id, step);
  blocks.set(integrator.id, integrator);
  blocks.set(gain.id, gain);
  blocks.set(sum.id, sum);
  blocks.set(scope.id, scope);

  const state = {
    blocks,
    connections: [
      { from: step.id, to: sum.id, toIndex: 0, fromIndex: 0, path: {}, points: [] },
      { from: sum.id, to: integrator.id, toIndex: 0, fromIndex: 0, path: {}, points: [] },
      { from: integrator.id, to: gain.id, toIndex: 0, fromIndex: 0, path: {}, points: [] },
      { from: gain.id, to: sum.id, toIndex: 1, fromIndex: 0, path: {}, points: [] },
      { from: integrator.id, to: scope.id, toIndex: 0, fromIndex: 0, path: {}, points: [] },
      { from: step.id, to: scope.id, toIndex: 1, fromIndex: 0, path: {}, points: [] },
    ],
  };

  routeAllConnections(state, 3000, 2200, { x: 0, y: 0 });

  const connA = state.connections[4];
  const connB = state.connections[5];
  const aSegs = pointsToSegments(connA.points);
  const bSegs = pointsToSegments(connB.points);
  const overlap = segmentsOverlap(aSegs, bSegs);
  if (overlap) {
    console.log("b2->b5 points", connA.points);
    console.log("b1->b5 points", connB.points);
  }
  assert.equal(overlap, false, "expected separate routes to scope inputs");
});

runTest("avoid extra turns on b3->b4", () => {
  const blocks = new Map();
  const b1 = makeBlock("b1", "step", 1860, 1400, 140, 70, [
    { x: 140, y: 35, side: "right", type: "out", index: 0 },
  ]);
  const b2 = makeBlock("b2", "integrator", 2180, 1410, 90, 60, [
    { x: 0, y: 30, side: "left", type: "in", index: 0 },
    { x: 90, y: 30, side: "right", type: "out", index: 0 },
  ]);
  const b3 = makeBlock("b3", "gain", 2150, 1300, 92, 80, [
    { x: 0, y: 40, side: "left", type: "in", index: 0 },
    { x: 92, y: 40, side: "right", type: "out", index: 0 },
  ]);
  const b4 = makeBlock("b4", "sum", 2070, 1420, 40, 40, [
    { x: 0, y: 20, side: "left", type: "in", index: 0 },
    { x: 20, y: 0, side: "top", type: "in", index: 1 },
    { x: 20, y: 40, side: "bottom", type: "in", index: 2 },
    { x: 40, y: 20, side: "right", type: "out", index: 0 },
  ]);
  const b5 = makeBlock("b5", "scope", 2220, 1510, 220, 140, [
    { x: 0, y: 50, side: "left", type: "in", index: 0 },
    { x: 0, y: 70, side: "left", type: "in", index: 1 },
    { x: 0, y: 90, side: "left", type: "in", index: 2 },
  ]);
  blocks.set(b1.id, b1);
  blocks.set(b2.id, b2);
  blocks.set(b3.id, b3);
  blocks.set(b4.id, b4);
  blocks.set(b5.id, b5);

  const state = {
    blocks,
    connections: [
      { from: b1.id, to: b4.id, toIndex: 0, fromIndex: 0, path: {}, points: [] },
      { from: b4.id, to: b2.id, toIndex: 0, fromIndex: 0, path: {}, points: [] },
      { from: b2.id, to: b3.id, toIndex: 0, fromIndex: 0, path: {}, points: [] },
      { from: b3.id, to: b4.id, toIndex: 1, fromIndex: 0, path: {}, points: [] },
      { from: b2.id, to: b5.id, toIndex: 0, fromIndex: 0, path: {}, points: [] },
      { from: b4.id, to: b5.id, toIndex: 1, fromIndex: 0, path: {}, points: [] },
      { from: b1.id, to: b5.id, toIndex: 2, fromIndex: 0, path: {}, points: [] },
    ],
  };

  routeAllConnections(state, 3000, 2200, { x: 0, y: 0 });

  const target = state.connections.find((c) => c.from === b3.id && c.to === b4.id);
  const segs = pointsToSegments(target.points);
  console.log("b3->b4 points", target.points);
  const dirs = segs.map((seg) => (seg.a.x === seg.b.x ? "V" : "H"));
  const turns = dirs.filter((dir, idx) => idx > 0 && dir !== dirs[idx - 1]).length;
  // Right-to-top ports require an extra turn because of the fixed port stubs and keepouts.
  assert.ok(turns <= 3, `expected <=3 turns, got ${turns}`);
});
runTest("scope entry stays outside body and enters from left", () => {
  const blocks = new Map();
  const b1 = makeBlock("b1", "constant", 1790, 1510, 120, 60, [
    { x: 120, y: 30, side: "right", type: "out", index: 0 },
  ]);
  const b2 = makeBlock("b2", "gain", 1970, 1480, 92, 80, [
    { x: 0, y: 40, side: "left", type: "in", index: 0 },
    { x: 92, y: 40, side: "right", type: "out", index: 0 },
  ]);
  const b3 = makeBlock("b3", "constant", 1810, 1620, 120, 60, [
    { x: 120, y: 30, side: "right", type: "out", index: 0 },
  ]);
  const b5 = makeBlock("b5", "scope", 2080, 1580, 220, 140, [
    { x: 0, y: 50, side: "left", type: "in", index: 0 },
    { x: 0, y: 70, side: "left", type: "in", index: 1 },
    { x: 0, y: 90, side: "left", type: "in", index: 2 },
  ]);
  blocks.set(b1.id, b1);
  blocks.set(b2.id, b2);
  blocks.set(b3.id, b3);
  blocks.set(b5.id, b5);

  const state = {
    blocks,
    connections: [
      { from: b1.id, to: b2.id, toIndex: 0, fromIndex: 0, path: {}, points: [] },
      { from: b2.id, to: b5.id, toIndex: 0, fromIndex: 0, path: {}, points: [] },
      { from: b3.id, to: b5.id, toIndex: 1, fromIndex: 0, path: {}, points: [] },
      { from: b1.id, to: b5.id, toIndex: 2, fromIndex: 0, path: {}, points: [] },
    ],
  };

  routeAllConnections(state, 3000, 2200, { x: 0, y: 0 });

  const scopeRect = {
    left: b5.x,
    right: b5.x + b5.width,
    top: b5.y,
    bottom: b5.y + b5.height,
  };

  state.connections.forEach((conn) => {
    if (conn.to !== b5.id) return;
    const segments = pointsToSegments(conn.points);
    const port = b5.ports.find((p) => p.type === "in" && p.index === conn.toIndex);
    const portX = b5.x + port.x;
    const portY = b5.y + port.y;
    segments.forEach((seg, idx) => {
      if (idx === segments.length - 1) return;
      const hits = segmentHitsRect(seg.a, seg.b, scopeRect);
      assert.equal(hits, false, "segment should not pass through scope body");
    });
    const last = segments[segments.length - 1];
    assert.equal(last.a.y, last.b.y, "last segment should be horizontal");
    assert.equal(last.b.x, portX, "last segment should end at port x");
    assert.equal(last.b.y, portY, "last segment should end at port y");
  });
});

runTest("b3->b4 stays orthogonal without extra turns", () => {
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
  blocks.set(b1.id, b1);
  blocks.set(b2.id, b2);
  blocks.set(b3.id, b3);
  blocks.set(b4.id, b4);

  const state = {
    blocks,
    connections: [
      { from: b1.id, to: b4.id, toIndex: 0, fromIndex: 0, path: {}, points: [] },
      { from: b2.id, to: b3.id, toIndex: 0, fromIndex: 0, path: {}, points: [] },
      { from: b3.id, to: b4.id, toIndex: 1, fromIndex: 0, path: {}, points: [] },
      { from: b4.id, to: b2.id, toIndex: 0, fromIndex: 0, path: {}, points: [] },
    ],
  };

  routeAllConnections(state, 3000, 2200, { x: 0, y: 0 });

  const target = state.connections.find((c) => c.from === b3.id && c.to === b4.id);
  const segs = pointsToSegments(target.points);
  segs.forEach((seg) => {
    assert.ok(seg.a.x === seg.b.x || seg.a.y === seg.b.y, "segment must be orthogonal");
  });
  assert.ok(countTurns(target.points) <= 5, "b3->b4 should avoid excessive turns");
});

runTest("ports leave and enter with one-grid outward stubs", () => {
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
  blocks.set(b1.id, b1);
  blocks.set(b2.id, b2);
  blocks.set(b3.id, b3);
  blocks.set(b4.id, b4);

  const state = {
    blocks,
    connections: [
      { from: b1.id, to: b4.id, toIndex: 0, fromIndex: 0, path: {}, points: [] },
      { from: b2.id, to: b3.id, toIndex: 0, fromIndex: 0, path: {}, points: [] },
      { from: b3.id, to: b4.id, toIndex: 1, fromIndex: 0, path: {}, points: [] },
      { from: b4.id, to: b2.id, toIndex: 0, fromIndex: 0, path: {}, points: [] },
    ],
  };

  routeAllConnections(state, 3000, 2200, { x: 0, y: 0 });

  const conn = state.connections.find((c) => c.from === b3.id && c.to === b4.id);
  const start = conn.points[0];
  const next = conn.points[1];
  assert.equal(start.y, next.y, "start stub should be horizontal from right-side port");
  assert.ok(next.x >= start.x + GRID_SIZE, "start stub should move outward by at least one grid");
  const last = conn.points[conn.points.length - 1];
  const prev = conn.points[conn.points.length - 2];
  assert.equal(prev.x, last.x, "end stub should be vertical into top port");
  assert.ok(prev.y <= last.y - GRID_SIZE, "end stub should be at least one grid");
});

runTest("avoids extra turns on b1->b5 in snapshot", () => {
  const blocks = new Map();
  blocks.set(
    "b1",
    makeBlock("b1", "step", 1900, 1520, 140, 70, [
      { x: 140, y: 35, side: "right", type: "out", index: 0 },
    ])
  );
  blocks.set(
    "b2",
    makeBlock("b2", "integrator", 2200, 1530, 90, 60, [
      { x: 0, y: 30, side: "left", type: "in", index: 0 },
      { x: 90, y: 30, side: "right", type: "out", index: 0 },
    ])
  );
  blocks.set(
    "b3",
    makeBlock("b3", "gain", 2200, 1390, 92, 80, [
      { x: 0, y: 40, side: "left", type: "in", index: 0 },
      { x: 92, y: 40, side: "right", type: "out", index: 0 },
    ])
  );
  blocks.set(
    "b4",
    makeBlock("b4", "sum", 2110, 1520, 40, 40, [
      { x: 0, y: 20, side: "left", type: "in", index: 0 },
      { x: 20, y: 0, side: "top", type: "in", index: 1 },
      { x: 20, y: 40, side: "bottom", type: "in", index: 2 },
      { x: 40, y: 20, side: "right", type: "out", index: 0 },
    ])
  );
  blocks.set(
    "b5",
    makeBlock("b5", "scope", 2150, 1640, 220, 140, [
      { x: 0, y: 50, side: "left", type: "in", index: 0 },
      { x: 0, y: 70, side: "left", type: "in", index: 1 },
      { x: 0, y: 90, side: "left", type: "in", index: 2 },
    ])
  );

  const state = {
    blocks,
    connections: [
      { from: "b1", to: "b4", toIndex: 0, fromIndex: 0, path: {}, points: [] },
      { from: "b4", to: "b2", toIndex: 0, fromIndex: 0, path: {}, points: [] },
      { from: "b2", to: "b3", toIndex: 0, fromIndex: 0, path: {}, points: [] },
      { from: "b3", to: "b4", toIndex: 1, fromIndex: 0, path: {}, points: [] },
      { from: "b1", to: "b5", toIndex: 0, fromIndex: 0, path: {}, points: [] },
    ],
  };

  routeAllConnections(state, 4000, 3000, { x: 0, y: 0 });
  const b1b5 = state.connections.find((c) => c.from === "b1" && c.to === "b5");
  assert.ok(b1b5, "b1->b5 connection present");
  assert.equal(countTurns(b1b5.points), 2, "b1->b5 should be 2 turns");
});

runTest("segment stats count turn-separated lengths", () => {
  const blocks = new Map();
  blocks.set(
    "b1",
    makeBlock("b1", "step", 1870, 1490, 140, 70, [
      { x: 140, y: 35, side: "right", type: "out", index: 0 },
    ])
  );
  blocks.set(
    "b5",
    makeBlock("b5", "sum", 2050, 1530, 40, 40, [
      { x: 0, y: 20, side: "left", type: "in", index: 0 },
      { x: 20, y: 0, side: "top", type: "in", index: 1 },
      { x: 20, y: 40, side: "bottom", type: "in", index: 2 },
      { x: 40, y: 20, side: "right", type: "out", index: 0 },
    ])
  );

  const state = {
    blocks,
    connections: [
      { from: "b1", to: "b5", toIndex: 0, fromIndex: 0, path: {}, points: [] },
    ],
  };

  routeAllConnections(state, 4000, 3000, { x: 0, y: 0 });
  const conn = state.connections[0];
  const stats = segmentLengthStats(conn.points);
  assert.equal(stats.length, 60, "total length should be 60");
  assert.equal(stats.seg1, 1, "one 1-grid segment");
  assert.equal(stats.seg2, 1, "one 2-grid segment");
});

runTest("short segment penalty prefers longer detour", () => {
  const start = { x: 0, y: 20 };
  const end = { x: 100, y: 20 };
  const obstacles = [
    { left: 40, right: 60, top: 10, bottom: 40 },
  ];
  const path = routeOrthogonal(
    start,
    end,
    obstacles,
    200,
    200,
    null,
    0,
    200,
    null,
    null,
    null,
    "s",
    null
  );
  const maxY = Math.max(...path.map((pt) => pt.y));
  assert.ok(maxY >= 50, "route should take longer detour to avoid short segments");
});


runTest("snapshot enforces strict port directions", () => {
  const blocks = new Map();
  const b1 = makeBlock("b1", "step", 1870, 1410, 140, 70, [
    { x: 140, y: 35, side: "right", type: "out", index: 0 },
  ]);
  const b2 = makeBlock("b2", "integrator", 2170, 1410, 90, 60, [
    { x: 0, y: 30, side: "left", type: "in", index: 0 },
    { x: 90, y: 30, side: "right", type: "out", index: 0 },
  ]);
  const b3 = makeBlock("b3", "gain", 2170, 1280, 92, 80, [
    { x: 0, y: 40, side: "left", type: "in", index: 0 },
    { x: 92, y: 40, side: "right", type: "out", index: 0 },
  ]);
  const b4 = makeBlock("b4", "sum", 2090, 1420, 40, 40, [
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
  blocks.set(b1.id, b1);
  blocks.set(b2.id, b2);
  blocks.set(b3.id, b3);
  blocks.set(b4.id, b4);
  blocks.set(b5.id, b5);

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
  assertPortStubs(state);
});

runTest("snapshot avoids wire overlaps", () => {
  const blocks = new Map();
  const b1 = makeBlock("b1", "step", 1880, 1370, 140, 70, [
    { x: 140, y: 35, side: "right", type: "out", index: 0 },
  ]);
  const b2 = makeBlock("b2", "integrator", 2210, 1380, 90, 60, [
    { x: 0, y: 30, side: "left", type: "in", index: 0 },
    { x: 90, y: 30, side: "right", type: "out", index: 0 },
  ]);
  const b3 = makeBlock("b3", "gain", 2190, 1280, 92, 80, [
    { x: 0, y: 40, side: "left", type: "in", index: 0 },
    { x: 92, y: 40, side: "right", type: "out", index: 0 },
  ]);
  const b4 = makeBlock("b4", "sum", 2110, 1390, 40, 40, [
    { x: 0, y: 20, side: "left", type: "in", index: 0 },
    { x: 20, y: 0, side: "top", type: "in", index: 1 },
    { x: 20, y: 40, side: "bottom", type: "in", index: 2 },
    { x: 40, y: 20, side: "right", type: "out", index: 0 },
  ]);
  const b5 = makeBlock("b5", "scope", 2210, 1510, 220, 140, [
    { x: 0, y: 50, side: "left", type: "in", index: 0 },
    { x: 0, y: 70, side: "left", type: "in", index: 1 },
    { x: 0, y: 90, side: "left", type: "in", index: 2 },
  ]);
  blocks.set(b1.id, b1);
  blocks.set(b2.id, b2);
  blocks.set(b3.id, b3);
  blocks.set(b4.id, b4);
  blocks.set(b5.id, b5);

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
  assert.equal(overlapsExceptSamePort(state.connections), false, "expected no overlaps across wires");
});

runTest("snapshot avoids diagonals on port-lane routes", () => {
  const blocks = new Map();
  const b1 = makeBlock("b1", "step", 1860, 1460, 140, 70, [
    { x: 140, y: 35, side: "right", type: "out", index: 0 },
  ]);
  const b2 = makeBlock("b2", "integrator", 2190, 1490, 90, 60, [
    { x: 0, y: 30, side: "left", type: "in", index: 0 },
    { x: 90, y: 30, side: "right", type: "out", index: 0 },
  ]);
  const b3 = makeBlock("b3", "gain", 2150, 1310, 92, 80, [
    { x: 0, y: 40, side: "left", type: "in", index: 0 },
    { x: 92, y: 40, side: "right", type: "out", index: 0 },
  ]);
  const b4 = makeBlock("b4", "sum", 2070, 1460, 40, 40, [
    { x: 0, y: 20, side: "left", type: "in", index: 0 },
    { x: 20, y: 0, side: "top", type: "in", index: 1 },
    { x: 20, y: 40, side: "bottom", type: "in", index: 2 },
    { x: 40, y: 20, side: "right", type: "out", index: 0 },
  ]);
  const b5 = makeBlock("b5", "scope", 2150, 1600, 220, 140, [
    { x: 0, y: 50, side: "left", type: "in", index: 0 },
    { x: 0, y: 70, side: "left", type: "in", index: 1 },
    { x: 0, y: 90, side: "left", type: "in", index: 2 },
  ]);
  blocks.set(b1.id, b1);
  blocks.set(b2.id, b2);
  blocks.set(b3.id, b3);
  blocks.set(b4.id, b4);
  blocks.set(b5.id, b5);

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

  state.connections.forEach((conn) => {
    const segments = pointsToSegments(conn.points);
    segments.forEach((seg) => {
      assert.ok(seg.a.x === seg.b.x || seg.a.y === seg.b.y, "segment must be orthogonal");
    });
  });
});

function segmentsOverlap(aSegs, bSegs) {
  for (let i = 0; i < aSegs.length; i += 1) {
    const a = aSegs[i];
    const aH = a.a.y === a.b.y;
    for (let j = 0; j < bSegs.length; j += 1) {
      const b = bSegs[j];
      const bH = b.a.y === b.b.y;
      if (aH !== bH) continue;
      if (aH) {
        if (a.a.y !== b.a.y) continue;
        const a1 = Math.min(a.a.x, a.b.x);
        const a2 = Math.max(a.a.x, a.b.x);
        const b1 = Math.min(b.a.x, b.b.x);
        const b2 = Math.max(b.a.x, b.b.x);
        if (Math.max(a1, b1) <= Math.min(a2, b2)) return true;
      } else {
        if (a.a.x !== b.a.x) continue;
        const a1 = Math.min(a.a.y, a.b.y);
        const a2 = Math.max(a.a.y, a.b.y);
        const b1 = Math.min(b.a.y, b.b.y);
        const b2 = Math.max(b.a.y, b.b.y);
        if (Math.max(a1, b1) <= Math.min(a2, b2)) return true;
      }
    }
  }
  return false;
}

function overlapsExceptSamePort(connections) {
  const segs = connections.map((conn) => pointsToSegments(conn.points));
  for (let i = 0; i < connections.length; i += 1) {
    for (let j = i + 1; j < connections.length; j += 1) {
      const a = connections[i];
      const b = connections[j];
      const sharedFrom = a.from === b.from && (a.fromIndex ?? 0) === (b.fromIndex ?? 0);
      const sharedTo = a.to === b.to && a.toIndex === b.toIndex;
      if (sharedFrom || sharedTo) continue;
      if (segmentsOverlap(segs[i], segs[j])) return true;
    }
  }
  return false;
}

function assertPortStubs(state) {
  state.connections.forEach((conn) => {
    const fromBlock = state.blocks.get(conn.from);
    const toBlock = state.blocks.get(conn.to);
    const fromIndex = conn.fromIndex ?? 0;
    const fromPort = fromBlock.ports.find((p) => p.type === "out" && p.index === fromIndex);
    const toPort = toBlock.ports.find((p) => p.type === "in" && p.index === conn.toIndex);
    const fromPos = { x: snap(fromBlock.x + fromPort.x), y: snap(fromBlock.y + fromPort.y) };
    const toPos = { x: snap(toBlock.x + toPort.x), y: snap(toBlock.y + toPort.y) };
    const points = conn.points;
    assert.equal(points[0].x, fromPos.x, "start port x mismatch");
    assert.equal(points[0].y, fromPos.y, "start port y mismatch");
    assert.equal(points[points.length - 1].x, toPos.x, "end port x mismatch");
    assert.equal(points[points.length - 1].y, toPos.y, "end port y mismatch");
    const next = points[1];
    const prev = points[points.length - 2];
    if (fromPort.side === "right") {
      assert.equal(next.y, fromPos.y, "right port should leave horizontally");
      assert.ok(next.x >= fromPos.x + GRID_SIZE, "right port should move outward");
    } else if (fromPort.side === "left") {
      assert.equal(next.y, fromPos.y, "left port should leave horizontally");
      assert.ok(next.x <= fromPos.x - GRID_SIZE, "left port should move outward");
    } else if (fromPort.side === "top") {
      assert.equal(next.x, fromPos.x, "top port should leave vertically");
      assert.ok(next.y <= fromPos.y - GRID_SIZE, "top port should move outward");
    } else if (fromPort.side === "bottom") {
      assert.equal(next.x, fromPos.x, "bottom port should leave vertically");
      assert.ok(next.y >= fromPos.y + GRID_SIZE, "bottom port should move outward");
    }
    if (toPort.side === "right") {
      assert.equal(prev.y, toPos.y, "right port should enter horizontally");
      assert.ok(prev.x >= toPos.x + GRID_SIZE, "right port should move outward");
    } else if (toPort.side === "left") {
      assert.equal(prev.y, toPos.y, "left port should enter horizontally");
      assert.ok(prev.x <= toPos.x - GRID_SIZE, "left port should move outward");
    } else if (toPort.side === "top") {
      assert.equal(prev.x, toPos.x, "top port should enter vertically");
      assert.ok(prev.y <= toPos.y - GRID_SIZE, "top port should move outward");
    } else if (toPort.side === "bottom") {
      assert.equal(prev.x, toPos.x, "bottom port should enter vertically");
      assert.ok(prev.y >= toPos.y + GRID_SIZE, "bottom port should move outward");
    }
  });
}
