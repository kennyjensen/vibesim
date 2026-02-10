import assert from "node:assert/strict";
import { loadDiagramFromYaml } from "./codegen-helpers.mjs";
import { normalizeConnectionJunctions } from "../router.js";

function parsePoints(value) {
  if (Array.isArray(value)) {
    return value
      .map((pt) => {
        if (Array.isArray(pt) && pt.length >= 2) return { x: Number(pt[0]), y: Number(pt[1]) };
        if (pt && typeof pt === "object") return { x: Number(pt.x), y: Number(pt.y) };
        return null;
      })
      .filter((pt) => pt && Number.isFinite(pt.x) && Number.isFinite(pt.y));
  }
  if (typeof value === "string") {
    const matches = [...value.matchAll(/\[\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\]/g)];
    return matches.map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
  }
  return [];
}

function firstTurn(points) {
  if (!Array.isArray(points) || points.length < 3) return null;
  let firstDir = null;
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    const dir = a.x === b.x ? "V" : a.y === b.y ? "H" : null;
    if (!dir) continue;
    if (!firstDir) {
      firstDir = dir;
      continue;
    }
    if (dir !== firstDir) return { point: points[i], firstDir };
  }
  return null;
}

const diagram = loadDiagramFromYaml("examples/trapezoid.yaml");
const connections = (diagram.connections || []).map((conn) => ({
  from: conn.from,
  to: conn.to,
  fromIndex: Number(conn.fromIndex ?? 0),
  toIndex: Number(conn.toIndex ?? 0),
  points: parsePoints(conn.points),
}));

const b13ToB12 = connections.find((c) => c.from === "b13" && c.to === "b12");
const b13ToB25 = connections.find((c) => c.from === "b13" && c.to === "b25");
assert.ok(b13ToB12 && b13ToB25, "expected b13->b12 and b13->b25 in trapezoid example");
const beforeB12 = firstTurn(b13ToB12.points);
const beforeB25 = firstTurn(b13ToB25.points);
assert.ok(beforeB12 && beforeB25, "expected first turns before normalization");
assert.notEqual(
  beforeB12.point.x,
  beforeB25.point.x,
  "expected trapezoid fixture to contain near tee/turn offset before normalization"
);

normalizeConnectionJunctions(connections);

const afterB12 = firstTurn(b13ToB12.points);
const afterB25 = firstTurn(b13ToB25.points);
assert.ok(afterB12 && afterB25, "expected first turns after normalization");
assert.equal(
  afterB12.point.x,
  afterB25.point.x,
  `expected tee+turn to collapse to one branch column; got ${afterB12.point.x} vs ${afterB25.point.x}`
);

console.log("router trapezoid junction normalization test passed");
