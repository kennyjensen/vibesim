import assert from "node:assert/strict";
import { GRID_SIZE } from "../geometry.js";
import { buildBlockTemplates } from "../blocks/index.js";
import { routeAllConnections, analyzeConnectionGeometry } from "../router.js";
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

const diagram = loadDiagramFromYaml("tests/bad_cross2.yaml");
const state = {
  blocks: new Map(),
  connections: [],
};

(diagram.blocks || []).forEach((blockData) => {
  const block = materializeBlock(blockData);
  if (block) state.blocks.set(block.id, block);
});

(diagram.connections || []).forEach((conn) => {
  state.connections.push({
    from: conn.from,
    to: conn.to,
    fromIndex: Number(conn.fromIndex ?? 0),
    toIndex: Number(conn.toIndex ?? 0),
    points: Array.isArray(conn.points)
      ? conn.points.map((pt) => ({ x: Number(pt[0]), y: Number(pt[1]) }))
      : [],
  });
});

routeAllConnections(state, 4000, 3000, { x: 0, y: 0 }, 5000);

const analysis = analyzeConnectionGeometry(state.connections, { ignoreSharedPorts: true });
assert.equal(
  analysis.totals.overlaps,
  0,
  `expected no non-shared wire overlaps after full route, got ${analysis.totals.overlaps}`
);

console.log("router bad_cross2 overlap test passed");
