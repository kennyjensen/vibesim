import assert from "node:assert/strict";
import { buildPathWithHops } from "../render.js";

function hSeg(x0, x1, y) {
  return {
    orientation: "H",
    a: { x: x0, y },
    b: { x: x1, y },
    minX: Math.min(x0, x1),
    maxX: Math.max(x0, x1),
    y,
    isStub: false,
  };
}

function vSeg(x, y0, y1) {
  return {
    orientation: "V",
    a: { x, y: y0 },
    b: { x, y: y1 },
    minY: Math.min(y0, y1),
    maxY: Math.max(y0, y1),
    x,
    isStub: false,
  };
}

{
  const claims = new Set();
  const horizontal = hSeg(0, 100, 20);
  const vertical = vSeg(50, 0, 100);

  const d1 = buildPathWithHops([horizontal], [vertical], claims);
  assert.ok(d1.includes(" a "), "first crossing should create a hop");

  const d2 = buildPathWithHops([vertical], [horizontal], claims);
  assert.ok(!d2.includes(" a "), "second crossing at same point should not create another hop");
}

console.log("render hop tests passed");

