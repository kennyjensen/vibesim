import assert from "node:assert/strict";
import { loadDiagramFromYaml } from "./codegen-helpers.mjs";
import { simHandlers, resolveLabelSourcesOnce } from "../blocks/sim/index.js";
import { evalExpression } from "../utils/expr.js";

const sourceKey = (fromId, fromIndex) => {
  const idx = Number(fromIndex ?? 0);
  return idx > 0 ? `${fromId}:${idx}` : fromId;
};

const sourceBlockIdFromKey = (key) => {
  if (typeof key !== "string" || !key) return null;
  const splitIdx = key.indexOf(":");
  return splitIdx >= 0 ? key.slice(0, splitIdx) : key;
};

const buildAlgebraicPlan = (algebraicBlocks, inputMap) => {
  const byId = new Map();
  algebraicBlocks.forEach((entry) => byId.set(entry.block.id, entry));
  if (byId.size === 0) return { ordered: [], hasCycle: false };

  const indegree = new Map();
  const outEdges = new Map();
  byId.forEach((_, id) => {
    indegree.set(id, 0);
    outEdges.set(id, new Set());
  });

  byId.forEach((_, targetId) => {
    const inputs = inputMap.get(targetId) || [];
    inputs.forEach((srcKey) => {
      const srcId = sourceBlockIdFromKey(srcKey);
      if (!srcId || !byId.has(srcId) || srcId === targetId) return;
      const edges = outEdges.get(srcId);
      if (edges.has(targetId)) return;
      edges.add(targetId);
      indegree.set(targetId, (indegree.get(targetId) || 0) + 1);
    });
  });

  const queue = [];
  indegree.forEach((deg, id) => {
    if (deg === 0) queue.push(id);
  });
  const ordered = [];
  let readIdx = 0;
  while (readIdx < queue.length) {
    const id = queue[readIdx];
    readIdx += 1;
    ordered.push(byId.get(id));
    outEdges.get(id).forEach((neighbor) => {
      const next = (indegree.get(neighbor) || 0) - 1;
      indegree.set(neighbor, next);
      if (next === 0) queue.push(neighbor);
    });
  }
  const hasCycle = ordered.length !== byId.size;
  return { ordered: hasCycle ? algebraicBlocks : ordered, hasCycle };
};

const resolveParam = (value, block, key, variables) => {
  if (block.type === "labelSource" || block.type === "labelSink") {
    if (key === "name" || key === "isExternalPort") return value;
  }
  if (block.type === "switch" && key === "condition") return value;
  if (
    block.type === "subsystem" &&
    (key === "name" || key === "externalInputs" || key === "externalOutputs" || key === "subsystem")
  ) {
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

const runBeamSimulation = (diagram, mode = "optimized") => {
  const blocks = Array.isArray(diagram.blocks) ? diagram.blocks : [];
  const connections = Array.isArray(diagram.connections) ? diagram.connections : [];
  const variables = diagram.variables || { pi: Math.PI, e: Math.E };
  const dt = Number(diagram.sampleTime) || 0.01;
  const configuredRuntime = Number(diagram.runtime) || 0;
  const duration = Math.min(configuredRuntime, 40);
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

  const blockObjects = blocks.map((block) => ({
    ...block,
    params: { ...(block.params || {}) },
    inputs: inputCounts.get(block.id) || 0,
    outputs: Math.max(1, outputCounts.get(block.id) || 0),
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

  const resolvedParams = new Map();
  blockObjects.forEach((block) => {
    const resolved = {};
    Object.entries(block.params || {}).forEach(([key, value]) => {
      resolved[key] = resolveParam(value, block, key, variables);
    });
    resolvedParams.set(block.id, resolved);
  });

  const handlers = blockObjects.map((block) => ({ block, handler: simHandlers[block.type] }));
  const initBlocks = handlers.filter(({ handler }) => Boolean(handler?.init));
  const outputBlocks = handlers.filter(({ handler }) => Boolean(handler?.output));
  const algebraicBlocks = handlers.filter(({ handler }) => Boolean(handler?.algebraic));
  const afterStepBlocks = handlers.filter(({ handler }) => Boolean(handler?.afterStep));
  const updateBlocks = handlers.filter(({ handler }) => Boolean(handler?.update));
  const hasLabelResolution = blockObjects.some((b) => b.type === "labelSource" || b.type === "labelSink");
  const labelSourceBlocks = hasLabelResolution ? blockObjects.filter((b) => b.type === "labelSource") : [];
  const algebraicPlan = buildAlgebraicPlan(algebraicBlocks, inputMap);

  const ctx = {
    resolvedParams,
    inputMap,
    labelSinks: new Map(),
    blockState: new Map(),
    dt,
    variables,
  };

  initBlocks.forEach(({ block, handler }) => handler.init(ctx, block));

  for (let i = 0; i <= samples; i += 1) {
    ctx.t = i * dt;
    ctx.outputs = new Map();

    outputBlocks.forEach(({ block, handler }) => handler.output(ctx, block));

    const resolveLabelSources = () =>
      resolveLabelSourcesOnce(labelSourceBlocks, ctx.outputs, inputMap, ctx.labelSinks);

    if (mode === "optimized" && !hasLabelResolution && !algebraicPlan.hasCycle) {
      algebraicPlan.ordered.forEach(({ block, handler }) => {
        handler.algebraic(ctx, block);
      });
    } else {
      let progress = true;
      let iter = 0;
      const maxIter = 50;
      while (progress && iter < maxIter) {
        iter += 1;
        progress = false;
        if (hasLabelResolution && resolveLabelSources()) progress = true;
        algebraicPlan.ordered.forEach(({ block, handler }) => {
          const result = handler.algebraic(ctx, block);
          if (result?.updated) progress = true;
        });
        if (hasLabelResolution && resolveLabelSources()) progress = true;
      }
      assert.ok(!progress, "beam algebraic solve should converge");
    }

    afterStepBlocks.forEach(({ block, handler }) => handler.afterStep(ctx, block));
    updateBlocks.forEach(({ block, handler }) => handler.update(ctx, block));
  }

  const scopeBlocks = blockObjects.filter((b) => b.type === "scope");
  let maxScopeSpan = 0;
  scopeBlocks.forEach((scope) => {
    const state = ctx.blockState.get(scope.id);
    if (!state?.scopeSeries) return;
    state.scopeSeries.forEach((series) => {
      const finite = series.filter((v) => v != null && Number.isFinite(v));
      if (!finite.length) return;
      const minVal = Math.min(...finite);
      const maxVal = Math.max(...finite);
      maxScopeSpan = Math.max(maxScopeSpan, maxVal - minVal);
    });
  });

  return { maxScopeSpan };
};

const diagram = loadDiagramFromYaml("examples/beam.yaml");
const configuredRuntime = Number(diagram.runtime);
assert.ok(configuredRuntime >= 40, `beam runtime should be long enough for visible dynamics; got ${configuredRuntime}`);

const optimized = runBeamSimulation(diagram, "optimized");
const reference = runBeamSimulation(diagram, "reference");

assert.ok(optimized.maxScopeSpan > 0.1, `beam scope span too small: ${optimized.maxScopeSpan}`);
assert.ok(reference.maxScopeSpan > 0.1, `beam reference scope span too small: ${reference.maxScopeSpan}`);
assert.ok(
  Math.abs(optimized.maxScopeSpan - reference.maxScopeSpan) < 1e-9,
  `optimized/reference span mismatch: ${optimized.maxScopeSpan} vs ${reference.maxScopeSpan}`
);

console.log("beam dynamics regression test passed");
