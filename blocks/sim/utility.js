import { getInputValues } from "./helpers.js";
import { sourceSimHandlers, resolveLabelSourcesOnce } from "./source.js";
import { mathSimHandlers } from "./math.js";
import { nonlinearSimHandlers } from "./nonlinear.js";
import { continuousSimHandlers } from "./continuous.js";
import { discreteSimHandlers } from "./discrete.js";
import { sinkSimHandlers } from "./sink.js";
import { evalExpression } from "../../utils/expr.js";

const conditionTrue = (condition, input, threshold) => {
  if (condition === "gt") return input > threshold;
  if (condition === "ne") return input !== threshold;
  return input >= threshold;
};

const getPrevOutput = (ctx, blockId, fallback) => {
  const upstreamState = ctx.blockState?.get(blockId);
  if (upstreamState && Number.isFinite(upstreamState.output)) return upstreamState.output;
  return fallback;
};

const innerHandlers = {
  ...sourceSimHandlers,
  ...mathSimHandlers,
  ...nonlinearSimHandlers,
  ...continuousSimHandlers,
  ...discreteSimHandlers,
  ...sinkSimHandlers,
};

const getInnerHandler = (type) => {
  if (type === "switch" || type === "subsystem") return utilitySimHandlers[type];
  return innerHandlers[type];
};

const deepClone = (value) => JSON.parse(JSON.stringify(value));
const sourceKey = (fromId, fromIndex) => {
  const idx = Number(fromIndex ?? 0);
  return idx > 0 ? `${fromId}:${idx}` : fromId;
};

const sourceBlockIdFromKey = (key) => {
  if (typeof key !== "string" || !key) return null;
  const splitIdx = key.indexOf(":");
  return splitIdx >= 0 ? key.slice(0, splitIdx) : key;
};

const hasValueChanged = (prev, next) =>
  prev !== next && !(Number.isNaN(prev) && Number.isNaN(next));

const readInputStrict = (ctx, inputs, idx, fallback) => {
  const fromId = inputs[idx];
  if (!fromId) return { has: true, value: fallback };
  if (!ctx.outputs.has(fromId)) return { has: false, value: fallback };
  const value = ctx.outputs.get(fromId);
  if (value === undefined || value === null || Number.isNaN(value)) return { has: false, value: fallback };
  return { has: true, value };
};

const runCompiledAlgebraic = (ctx, compiled) => {
  if (!compiled) return null;
  if (compiled.kind === "gain") {
    const input = readInputStrict(ctx, compiled.inputs, 0, 0);
    if (!input.has) return null;
    const out = input.value * compiled.gain;
    const prev = ctx.outputs.get(compiled.id);
    ctx.outputs.set(compiled.id, out);
    const state = ctx.blockState.get(compiled.id);
    if (state) state.output = out;
    else ctx.blockState.set(compiled.id, { output: out });
    return { updated: hasValueChanged(prev, out) };
  }
  if (compiled.kind === "sum") {
    let out = 0;
    for (let i = 0; i < compiled.inputs.length; i += 1) {
      const input = readInputStrict(ctx, compiled.inputs, i, 0);
      if (!input.has) return null;
      out += input.value * (compiled.signs[i] ?? 1);
    }
    const prev = ctx.outputs.get(compiled.id);
    ctx.outputs.set(compiled.id, out);
    const state = ctx.blockState.get(compiled.id);
    if (state) state.output = out;
    else ctx.blockState.set(compiled.id, { output: out });
    return { updated: hasValueChanged(prev, out) };
  }
  return null;
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

const inferPortCounts = (blocks, connections) => {
  const inMap = new Map(blocks.map((b) => [b.id, 0]));
  const outMap = new Map(blocks.map((b) => [b.id, 0]));
  (connections || []).forEach((conn) => {
    if (inMap.has(conn.to)) inMap.set(conn.to, Math.max(inMap.get(conn.to), Number(conn.toIndex ?? 0) + 1));
    if (outMap.has(conn.from)) outMap.set(conn.from, Math.max(outMap.get(conn.from), Number(conn.fromIndex ?? 0) + 1));
  });
  return { inMap, outMap };
};

const resolveInnerParam = (value, block, key, variables) => {
  if (block.type === "labelSource" || block.type === "labelSink") {
    if (key === "name" || key === "isExternalPort") return value;
  }
  if (block.type === "subsystem") {
    if (key === "name" || key === "externalInputs" || key === "externalOutputs" || key === "subsystem") {
      return value;
    }
  }
  if (block.type === "userFunc" && key === "expr") return value;
  if (block.type === "switch" && key === "condition") return value;
  if (key === "signs") return value;
  if (Array.isArray(value)) {
    return value.map((v) => {
      const out = evalExpression(v, variables);
      return Number.isNaN(out) ? 0 : out;
    });
  }
  const out = evalExpression(value, variables);
  return Number.isNaN(out) ? 0 : out;
};

const buildSubsystemState = (ctx, block, spec) => {
  const rawBlocks = Array.isArray(spec?.blocks) ? spec.blocks : [];
  const rawConnections = Array.isArray(spec?.connections) ? spec.connections : [];
  const blocks = rawBlocks.map((item) => ({
    id: item.id,
    type: item.type,
    params: deepClone(item.params || {}),
  }));
  const connections = rawConnections.map((item) => ({
    from: item.from,
    to: item.to,
    fromIndex: Number(item.fromIndex ?? 0),
    toIndex: Number(item.toIndex ?? 0),
  }));

  const blockMap = new Map(blocks.map((b) => [b.id, b]));
  const { inMap, outMap } = inferPortCounts(blocks, connections);
  blocks.forEach((b) => {
    b.inputs = Math.max(1, inMap.get(b.id) || 0);
    b.outputs = Math.max(1, outMap.get(b.id) || 0);
  });

  const inputMap = new Map();
  blocks.forEach((b) => {
    inputMap.set(b.id, Array(b.inputs).fill(null));
  });
  connections.forEach((conn) => {
    const row = inputMap.get(conn.to);
    if (!row) return;
    if (conn.toIndex >= 0 && conn.toIndex < row.length) {
      row[conn.toIndex] = sourceKey(conn.from, conn.fromIndex);
    }
  });

  const resolvedParams = new Map();
  const vars = ctx.variables || {};
  blocks.forEach((b) => {
    const resolved = {};
    Object.entries(b.params || {}).forEach(([key, value]) => {
      resolved[key] = resolveInnerParam(value, b, key, vars);
    });
    resolvedParams.set(b.id, resolved);
  });

  const inputLookup = new Map();
  const outputLookup = new Map();
  (spec.externalInputs || []).forEach((entry, idx) => {
    if (entry?.id && blockMap.has(entry.id)) inputLookup.set(entry.id, idx);
  });
  (spec.externalOutputs || []).forEach((entry, idx) => {
    if (entry?.id && blockMap.has(entry.id)) outputLookup.set(entry.id, idx);
  });

  const labelSinks = new Map();
  const labelSourceBlocks = [];
  blocks.forEach((b) => {
    if (b.type === "labelSource") labelSourceBlocks.push(b);
    if (b.type !== "labelSink") return;
    const name = String(b.params?.name || "").trim();
    if (!name) return;
    labelSinks.set(name, b.id);
  });
  const hasAnyLabelBlocks = blocks.some((b) => b.type === "labelSource" || b.type === "labelSink");
  // Keep full runtime label resolution for correctness on complex subsystem models.
  const runtimeInputMap = inputMap;
  const hasLabelResolution = hasAnyLabelBlocks;

  const nonExternal = blocks.filter((b) => !inputLookup.has(b.id));
  const initBlocks = [];
  const outputBlocks = [];
  const algebraicBlocks = [];
  const afterStepBlocks = [];
  const updateBlocks = [];
  const compiledAlgebraicById = new Map();

  const blockState = new Map();
  const outputs = new Map();
  const innerCtx = {
    resolvedParams,
    inputMap: runtimeInputMap,
    labelSinks,
    blockState,
    dt: ctx.dt,
    variables: vars,
    t: 0,
    outputs,
  };
  blocks.forEach((b) => {
    const handler = getInnerHandler(b.type);
    if (!handler) return;
    if (handler.init) initBlocks.push({ block: b, handler });
    if (handler.afterStep) afterStepBlocks.push({ block: b, handler });
    if (handler.update) updateBlocks.push({ block: b, handler });
  });
  nonExternal.forEach((b) => {
    const handler = getInnerHandler(b.type);
    if (!handler) return;
    if (handler.output) outputBlocks.push({ block: b, handler });
    if (handler.algebraic) {
      algebraicBlocks.push({ block: b, handler });
      if (b.type === "gain") {
        const params = resolvedParams.get(b.id) || {};
        const rawGain = Number(params.gain);
        compiledAlgebraicById.set(b.id, {
          kind: "gain",
          id: b.id,
          inputs: runtimeInputMap.get(b.id) || [],
          gain: Number.isFinite(rawGain) ? rawGain : 1,
        });
      } else if (b.type === "sum") {
        const signs = Array.isArray(b.params?.signs)
          ? b.params.signs.map((v) => {
              const n = Number(v);
              return Number.isFinite(n) ? n : 1;
            })
          : [];
        compiledAlgebraicById.set(b.id, {
          kind: "sum",
          id: b.id,
          inputs: runtimeInputMap.get(b.id) || [],
          signs,
        });
      }
    }
  });
  initBlocks.forEach(({ block: innerBlock, handler }) => handler.init(innerCtx, innerBlock));

  const outputByIndex = [];
  outputLookup.forEach((idx, id) => {
    outputByIndex[idx] = id;
  });
  const inputLookupEntries = Array.from(inputLookup.entries());
  const algebraicPlan = buildAlgebraicPlan(algebraicBlocks, runtimeInputMap);

  return {
    blocks,
    inputMap: runtimeInputMap,
    labelSinks,
    blockState,
    resolvedParams,
    inputLookup,
    outputLookup,
    outputByIndex,
    inputLookupEntries,
    hasLabelResolution,
    labelSourceBlocks,
    outputBlocks,
    algebraicBlocks,
    compiledAlgebraicById,
    algebraicPlan,
    afterStepBlocks,
    updateBlocks,
    outputs,
    innerCtx,
  };
};

const runSubsystemOutputs = (outerCtx, block, stateData, inValues) => {
  const outputs = stateData.outputs;
  outputs.clear();
  const innerCtx = stateData.innerCtx;
  innerCtx.dt = outerCtx.dt;
  innerCtx.variables = outerCtx.variables;
  innerCtx.t = outerCtx.t;
  innerCtx.outputs = outputs;

  const inputValues = Array.isArray(inValues) ? inValues : getInputValues(outerCtx, block);
  const applyExternalInputs = () => {
    stateData.inputLookupEntries.forEach(([blockId, idx]) => {
      outputs.set(blockId, inputValues[idx] ?? 0);
    });
  };
  applyExternalInputs();

  stateData.outputBlocks.forEach(({ block: innerBlock, handler }) => handler.output(innerCtx, innerBlock));

  if (stateData.hasLabelResolution || stateData.algebraicPlan.ordered.length > 0) {
    if (!stateData.hasLabelResolution && !stateData.algebraicPlan.hasCycle) {
      stateData.algebraicPlan.ordered.forEach(({ block: innerBlock, handler }) => {
        handler.algebraic(innerCtx, innerBlock);
      });
    } else {
      let progress = true;
      let iter = 0;
      const maxIter = 50;
      while (progress && iter < 50) {
        iter += 1;
        progress = false;
        if (stateData.hasLabelResolution && resolveLabelSourcesOnce(stateData.labelSourceBlocks, outputs, stateData.inputMap, stateData.labelSinks)) progress = true;
        applyExternalInputs();
        stateData.algebraicPlan.ordered.forEach(({ block: innerBlock, handler }) => {
          const result = handler.algebraic(innerCtx, innerBlock);
          if (result?.updated) progress = true;
        });
        if (stateData.hasLabelResolution && resolveLabelSourcesOnce(stateData.labelSourceBlocks, outputs, stateData.inputMap, stateData.labelSinks)) progress = true;
        applyExternalInputs();
      }
      stateData.lastSolveIterations = iter;
      stateData.hitMaxIterations = Boolean(progress && iter >= maxIter);
    }
  }

  let out = 0;
  const externalValues = [];
  const getExternalOutputValue = (blockId) => {
    if (outputs.has(blockId)) return outputs.get(blockId) ?? 0;
    const sinkInputs = stateData.inputMap.get(blockId) || [];
    const fromId = sinkInputs[0];
    if (!fromId) return 0;
    return outputs.get(fromId) ?? 0;
  };
  if (stateData.outputByIndex.length) {
    stateData.outputByIndex.forEach((id, idx) => {
      if (!id) return;
      externalValues[idx] = getExternalOutputValue(id);
    });
    out = externalValues[0] ?? 0;
  }
  return { primary: out, values: externalValues };
};

const advanceSubsystemState = (outerCtx, stateData) => {
  const innerCtx = stateData.innerCtx;
  innerCtx.dt = outerCtx.dt;
  innerCtx.variables = outerCtx.variables;
  innerCtx.t = outerCtx.t;
  innerCtx.outputs = stateData.outputs || innerCtx.outputs;
  stateData.afterStepBlocks.forEach(({ block: innerBlock, handler }) => handler.afterStep(innerCtx, innerBlock));
  stateData.updateBlocks.forEach(({ block: innerBlock, handler }) => handler.update(innerCtx, innerBlock));
};

export const utilitySimHandlers = {
  switch: {
    init: (ctx, block) => {
      const state = ctx.blockState.get(block.id) || {};
      if (!Number.isFinite(state.output)) state.output = 0;
      ctx.blockState.set(block.id, state);
    },
    algebraic: (ctx, block) => {
      const values = getInputValues(ctx, block);
      const inputs = ctx.inputMap.get(block.id) || [];
      const state = ctx.blockState.get(block.id) || {};
      const prevOutput = Number.isFinite(state.output) ? state.output : 0;
      const readInput = (idx, fallback = 0) => {
        const fromId = inputs[idx];
        if (!fromId) return { has: true, value: fallback };
        if (!ctx.outputs.has(fromId)) {
          return { has: true, value: getPrevOutput(ctx, fromId, fallback) };
        }
        return { has: true, value: values[idx] ?? getPrevOutput(ctx, fromId, fallback) };
      };
      const top = readInput(0, 0);
      const cond = readInput(1, 0);
      const bottom = readInput(2, 0);

      const params = ctx.resolvedParams.get(block.id) || {};
      const condition = String(params.condition || "ge");
      const threshold = Number(params.threshold);
      const thresholdValue = Number.isFinite(threshold) ? threshold : 0;
      let out = prevOutput;
      if (cond.has) {
        const takeTop = conditionTrue(condition, cond.value ?? 0, thresholdValue);
        if (takeTop && top.has) out = top.value ?? 0;
        else if (!takeTop && bottom.has) out = bottom.value ?? 0;
        else if (top.has) out = top.value ?? 0;
        else if (bottom.has) out = bottom.value ?? 0;
      } else if (bottom.has) {
        out = bottom.value ?? 0;
      } else if (top.has) {
        out = top.value ?? 0;
      }

      const prev = ctx.outputs.get(block.id);
      ctx.outputs.set(block.id, out);
      state.output = out;
      ctx.blockState.set(block.id, state);
      return { updated: prev !== out && !(Number.isNaN(prev) && Number.isNaN(out)) };
    },
  },
  subsystem: {
    init: (ctx, block) => {
      const params = ctx.resolvedParams.get(block.id) || {};
      const spec = params.subsystem;
      if (!spec || typeof spec !== "object") return;
      const state = ctx.blockState.get(block.id) || {};
      state.subsystem = buildSubsystemState(ctx, block, spec);
      state.subsystemLast = { primary: 0, values: [] };
      ctx.blockState.set(block.id, state);
    },
    output: (ctx, block) => {
      const state = ctx.blockState.get(block.id);
      const subsystemState = state?.subsystem;
      if (!subsystemState) {
        ctx.outputs.set(block.id, 0);
        return;
      }
      const last = state.subsystemLast || { primary: 0, values: [] };
      ctx.outputs.set(block.id, last.primary ?? 0);
      (last.values || []).forEach((value, idx) => {
        if (idx <= 0) return;
        ctx.outputs.set(`${block.id}:${idx}`, value ?? 0);
      });
    },
    algebraic: (ctx, block) => {
      const state = ctx.blockState.get(block.id);
      const subsystemState = state?.subsystem;
      if (!subsystemState) return null;
      const inValues = getInputValues(ctx, block);
      const result = runSubsystemOutputs(ctx, block, subsystemState, inValues);
      const prevPrimary = ctx.outputs.get(block.id);
      const prevSecondary = (result.values || []).map((_, idx) =>
        idx <= 0 ? undefined : ctx.outputs.get(`${block.id}:${idx}`)
      );
      ctx.outputs.set(block.id, result.primary);
      (result.values || []).forEach((value, idx) => {
        if (idx <= 0) return;
        ctx.outputs.set(`${block.id}:${idx}`, value ?? 0);
      });
      const primaryChanged =
        prevPrimary !== result.primary &&
        !(Number.isNaN(prevPrimary) && Number.isNaN(result.primary));
      let secondaryChanged = false;
      (result.values || []).forEach((value, idx) => {
        if (secondaryChanged || idx <= 0) return;
        const prev = prevSecondary[idx];
        if (prev !== value && !(Number.isNaN(prev) && Number.isNaN(value))) secondaryChanged = true;
      });
      state.subsystemLast = {
        primary: result.primary ?? 0,
        values: Array.isArray(result.values) ? result.values.slice() : [],
      };
      ctx.blockState.set(block.id, state);
      return {
        updated: primaryChanged || secondaryChanged,
      };
    },
    update: (ctx, block) => {
      const state = ctx.blockState.get(block.id);
      const subsystemState = state?.subsystem;
      if (!subsystemState) return;
      advanceSubsystemState(ctx, subsystemState);
    },
  },
};
