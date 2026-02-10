import assert from "node:assert/strict";
import { GRID_SIZE } from "../geometry.js";
import { buildBlockTemplates } from "../blocks/index.js";
import { routeDirtyConnections } from "../router.js";
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

function lastTurnDistanceToEndCells(points) {
  if (!Array.isArray(points) || points.length < 3) return 0;
  const end = points[points.length - 1];
  let prevDir = null;
  for (let i = points.length - 2; i >= 0; i -= 1) {
    const a = points[i];
    const b = points[i + 1];
    const dir = a.x === b.x ? "V" : a.y === b.y ? "H" : null;
    if (!dir) continue;
    if (!prevDir) {
      prevDir = dir;
      continue;
    }
    if (dir !== prevDir) {
      const turn = points[i + 1];
      const distPx = Math.abs(end.x - turn.x) + Math.abs(end.y - turn.y);
      return distPx / GRID_SIZE;
    }
  }
  return 0;
}

const diagram = loadDiagramFromYaml("examples/emf.yaml");
const state = {
  blocks: new Map(),
  connections: [],
};

(diagram.blocks || []).forEach((blockData) => {
  const block = materializeBlock(blockData);
  if (block) state.blocks.set(block.id, block);
});

(diagram.connections || []).forEach((conn) => {
  const points = Array.isArray(conn.points)
    ? conn.points.map((pt) => ({ x: Number(pt[0]), y: Number(pt[1]) }))
    : [];
  state.connections.push({
    from: conn.from,
    to: conn.to,
    fromIndex: Number(conn.fromIndex ?? 0),
    toIndex: Number(conn.toIndex ?? 0),
    points,
  });
});

// Repro: move delay block left by 4 grid cells, then run incremental reroute.
const delayBlock = state.blocks.get("b7");
assert.ok(delayBlock, "expected delay block b7");
delayBlock.x -= 4 * GRID_SIZE;

const dirtySet = new Set(
  state.connections.filter((conn) => conn.from === "b7" || conn.to === "b7")
);
routeDirtyConnections(state, 4000, 3000, { x: 0, y: 0 }, dirtySet, 4000);

const delayedInput = state.connections.find((conn) => conn.from === "b2" && conn.to === "b7");
assert.ok(delayedInput, "expected connection b2->b7");
const lastTurnCells = lastTurnDistanceToEndCells(delayedInput.points);
assert.ok(
  lastTurnCells >= 2,
  `expected at least 2-cell end stub for b2->b7 after dirty reroute, got ${lastTurnCells}`
);

console.log("router dirty emf test passed");
