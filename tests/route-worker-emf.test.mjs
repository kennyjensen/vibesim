import assert from "node:assert/strict";
import { GRID_SIZE } from "../geometry.js";
import { buildBlockTemplates } from "../blocks/index.js";
import { routeSnapshot } from "../workers/route-worker.js";
import { loadDiagramFromYaml } from "./codegen-helpers.mjs";

const helpers = {
  GRID_SIZE,
  createSvgElement: () => ({}),
  svgRect: () => ({}),
  svgText: () => ({}),
  renderTeXMath: () => {},
  renderSourcePlot: () => {},
  renderCenteredAxesPlot: () => {},
  renderLabelNode: () => {},
};
const templates = buildBlockTemplates(helpers);

function materializeBlock(blockData) {
  const template = templates[blockData.type];
  if (!template) return null;
  const params = { ...(template.defaultParams || {}), ...(blockData.params || {}) };
  const block = {
    id: blockData.id,
    type: blockData.type,
    x: Number(blockData.x) || 0,
    y: Number(blockData.y) || 0,
    width: template.width,
    height: template.height,
    rotation: Number(blockData.rotation) || 0,
    params,
    ports: [],
    dynamicInputs: null,
    dynamicOutputs: null,
  };
  if (Number.isFinite(Number(params.width)) && Number(params.width) > 0) block.width = Number(params.width);
  if (Number.isFinite(Number(params.height)) && Number(params.height) > 0) block.height = Number(params.height);
  if (typeof template.resize === "function") template.resize(block);
  const inputs = Array.isArray(block.dynamicInputs) ? block.dynamicInputs : (template.inputs || []);
  const outputs = Array.isArray(block.dynamicOutputs) ? block.dynamicOutputs : (template.outputs || []);
  inputs.forEach((port, index) => {
    block.ports.push({ type: "in", index, x: port.x, y: port.y, side: port.side });
  });
  outputs.forEach((port, index) => {
    block.ports.push({ type: "out", index, x: port.x, y: port.y, side: port.side });
  });
  return block;
}

function firstTurnPoint(points) {
  if (!Array.isArray(points) || points.length < 3) return null;
  const first = points[0];
  const second = points[1];
  const d0 = first.x === second.x ? "V" : first.y === second.y ? "H" : null;
  if (!d0) return null;
  for (let i = 1; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    const d = a.x === b.x ? "V" : a.y === b.y ? "H" : null;
    if (d && d !== d0) return a;
  }
  return null;
}

const diagram = loadDiagramFromYaml("examples/emf.yaml");
const blocks = (diagram.blocks || [])
  .map((block) => materializeBlock(block))
  .filter(Boolean);
const connections = (diagram.connections || []).map((conn) => ({
  from: conn.from,
  to: conn.to,
  fromIndex: Number(conn.fromIndex ?? 0),
  toIndex: Number(conn.toIndex ?? 0),
}));
const snapshot = { blocks, connections };
const routes = routeSnapshot(snapshot, 4000, 3000, 2000);

const indexB7 = connections.findIndex((c) => c.from === "b2" && c.to === "b7");
const indexB15 = connections.findIndex((c) => c.from === "b2" && c.to === "b15");
assert.ok(indexB7 >= 0 && indexB15 >= 0, "expected b2->b7 and b2->b15 connections");

const turnB7 = firstTurnPoint(routes[indexB7]);
const turnB15 = firstTurnPoint(routes[indexB15]);
assert.ok(turnB7 && turnB15, "expected both wires to have first turn points");
assert.equal(
  turnB7.x,
  turnB15.x,
  `expected shared first-turn x for b2 branches; got b7=${turnB7.x}, b15=${turnB15.x}`
);

console.log("route worker emf test passed");
