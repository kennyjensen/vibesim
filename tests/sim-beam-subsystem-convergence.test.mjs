import assert from "node:assert/strict";
import { loadDiagramFromYaml } from "./codegen-helpers.mjs";
import { simHandlers, resolveLabelSourcesOnce } from "../blocks/sim/index.js";
import { evalExpression } from "../utils/expr.js";

const diagram = loadDiagramFromYaml("examples/beam.yaml");
const blocks = Array.isArray(diagram.blocks) ? diagram.blocks : [];
const connections = Array.isArray(diagram.connections) ? diagram.connections : [];
const variables = diagram.variables || { pi: Math.PI, e: Math.E };
const dt = Number(diagram.sampleTime) || 0.01;
const duration = Math.min(0.2, Number(diagram.runtime) || 0.2);
const samples = Math.floor(duration / dt);

const inputCounts = new Map(blocks.map((b) => [b.id, 0]));
const outputCounts = new Map(blocks.map((b) => [b.id, 0]));
connections.forEach((conn) => {
  if (inputCounts.has(conn.to)) {
    inputCounts.set(conn.to, Math.max(inputCounts.get(conn.to), Number(conn.toIndex ?? 0) + 1));
  }
  if (outputCounts.has(conn.from)) {
    outputCounts.set(conn.from, Math.max(outputCounts.get(conn.from), Number(conn.fromIndex ?? 0) + 1));
  }
});

const sourceKey = (fromId, fromIndex) => {
  const idx = Number(fromIndex ?? 0);
  return idx > 0 ? `${fromId}:${idx}` : fromId;
};

const blockObjects = blocks.map((block) => ({
  ...block,
  params: { ...(block.params || {}) },
  inputs: inputCounts.get(block.id) || 0,
  outputs: outputCounts.get(block.id) || 1,
}));

const inputMap = new Map();
blockObjects.forEach((block) => {
  inputMap.set(block.id, Array(block.inputs).fill(null));
});
connections.forEach((conn) => {
  const inputs = inputMap.get(conn.to);
  if (!inputs) return;
  if (conn.toIndex >= 0 && conn.toIndex < inputs.length) {
    inputs[conn.toIndex] = sourceKey(conn.from, conn.fromIndex);
  }
});

const resolveParam = (value, block, key) => {
  if (block.type === "labelSource" || block.type === "labelSink") {
    if (key === "name" || key === "isExternalPort") return value;
  }
  if (block.type === "switch" && key === "condition") return value;
  if (block.type === "subsystem" && (key === "name" || key === "externalInputs" || key === "externalOutputs" || key === "subsystem")) {
    return value;
  }
  if (key === "signs") return value;
  if (Array.isArray(value)) {
    return value.map((v) => {
      const out = evalExpression(v, variables);
      return Number.isFinite(out) ? out : 0;
    });
  }
  const out = evalExpression(value, variables);
  return Number.isFinite(out) ? out : 0;
};

const resolvedParams = new Map();
blockObjects.forEach((block) => {
  const resolved = {};
  Object.entries(block.params || {}).forEach(([key, value]) => {
    resolved[key] = resolveParam(value, block, key);
  });
  resolvedParams.set(block.id, resolved);
});

const labelSinks = new Map();
const blockState = new Map();
const ctx = { resolvedParams, inputMap, labelSinks, blockState, dt, variables };

blockObjects.forEach((block) => {
  const handler = simHandlers[block.type];
  if (handler?.init) handler.init(ctx, block);
});

const outputBlocks = blockObjects.filter((block) => Boolean(simHandlers[block.type]?.output));
const algebraicBlocks = blockObjects.filter((block) => Boolean(simHandlers[block.type]?.algebraic));
const afterStepBlocks = blockObjects.filter((block) => Boolean(simHandlers[block.type]?.afterStep));
const updateBlocks = blockObjects.filter((block) => Boolean(simHandlers[block.type]?.update));
const hasLabelResolution = blockObjects.some((b) => b.type === "labelSource" || b.type === "labelSink");
const labelSourceBlocks = hasLabelResolution ? blockObjects.filter((b) => b.type === "labelSource") : [];

for (let i = 0; i <= samples; i += 1) {
  ctx.t = i * dt;
  ctx.outputs = new Map();

  outputBlocks.forEach((block) => {
    simHandlers[block.type].output(ctx, block);
  });

  let progress = true;
  let iter = 0;
  const maxIter = 50;
  while (progress && iter < maxIter) {
    iter += 1;
    progress = false;
    if (hasLabelResolution && resolveLabelSourcesOnce(labelSourceBlocks, ctx.outputs, inputMap, labelSinks)) {
      progress = true;
    }
    algebraicBlocks.forEach((block) => {
      const result = simHandlers[block.type].algebraic(ctx, block);
      if (result?.updated) progress = true;
    });
    if (hasLabelResolution && resolveLabelSourcesOnce(labelSourceBlocks, ctx.outputs, inputMap, labelSinks)) {
      progress = true;
    }
  }

  afterStepBlocks.forEach((block) => {
    simHandlers[block.type].afterStep(ctx, block);
  });
  updateBlocks.forEach((block) => {
    simHandlers[block.type].update(ctx, block);
  });
}

const subsystemStates = blockObjects
  .filter((block) => block.type === "subsystem")
  .map((block) => blockState.get(block.id)?.subsystem)
  .filter(Boolean);

assert.ok(subsystemStates.length > 0, "expected beam example to include subsystem states");
subsystemStates.forEach((subsystemState, idx) => {
  assert.equal(
    subsystemState.hitMaxIterations,
    false,
    `subsystem ${idx} should not hit max algebraic iterations`
  );
  assert.ok(
    (subsystemState.lastSolveIterations || 0) < 50,
    `subsystem ${idx} should converge before max iterations`
  );
});

console.log("beam subsystem convergence test passed");
