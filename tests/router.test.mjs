import assert from "node:assert/strict";
import { GRID_SIZE, routeOrthogonal } from "../geometry.js";

function pointsToDirs(points) {
  const dirs = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    if (a.x === b.x && a.y === b.y) continue;
    dirs.push(a.x === b.x ? "V" : "H");
  }
  return dirs;
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

const width = 200;
const height = 200;

runTest("straight line with no penalties stays straight", () => {
  const from = { x: 0, y: 0 };
  const to = { x: 6 * GRID_SIZE, y: 0 };
  const path = routeOrthogonal(from, to, [], width, height);
  assert.ok(path, "expected a path");
  const ys = new Set(path.map((p) => p.y));
  assert.equal(ys.size, 1);
});

runTest("high penalty forces detour", () => {
  const from = { x: 0, y: 0 };
  const to = { x: 6 * GRID_SIZE, y: 0 };
  const penaltyFn = (x, y) => (y === 0 && x > 0 && x < 6 ? 1000 : 0);
  const path = routeOrthogonal(from, to, [], width, height, penaltyFn);
  assert.ok(path, "expected a path");
  const ys = new Set(path.map((p) => p.y));
  assert.ok(ys.size > 1, "expected a detour away from y=0");
});

runTest("turn penalty reduces unnecessary turns", () => {
  const from = { x: 0, y: 0 };
  const to = { x: 5 * GRID_SIZE, y: 5 * GRID_SIZE };
  const path = routeOrthogonal(from, to, [], width, height, null, 20);
  assert.ok(path, "expected a path");
  const dirs = pointsToDirs(path);
  const turns = dirs.filter((dir, idx) => idx > 0 && dir !== dirs[idx - 1]).length;
  assert.ok(turns <= 1, `expected at most 1 turn, got ${turns}`);
});

runTest("obstacle blocks direct path", () => {
  const from = { x: 0, y: 0 };
  const to = { x: 6 * GRID_SIZE, y: 0 };
  const obstacles = [{ left: GRID_SIZE * 2, right: GRID_SIZE * 4, top: -GRID_SIZE, bottom: GRID_SIZE }];
  const path = routeOrthogonal(from, to, obstacles, width, height);
  assert.ok(path, "expected a path");
  const ys = new Set(path.map((p) => p.y));
  assert.ok(ys.size > 1, "expected a detour around obstacle");
});

