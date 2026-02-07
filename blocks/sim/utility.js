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
    if (conn.toIndex >= 0 && conn.toIndex < row.length) row[conn.toIndex] = conn.from;
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
  blocks.forEach((b) => {
    if (b.type !== "labelSink") return;
    const name = String(b.params?.name || "").trim();
    if (!name) return;
    labelSinks.set(name, b.id);
  });

  const blockState = new Map();
  const innerCtx = {
    resolvedParams,
    inputMap,
    labelSinks,
    blockState,
    dt: ctx.dt,
    variables: vars,
    t: 0,
    outputs: new Map(),
  };
  blocks.forEach((b) => {
    const handler = getInnerHandler(b.type);
    if (handler?.init) handler.init(innerCtx, b);
  });

  return {
    blocks,
    inputMap,
    labelSinks,
    blockState,
    resolvedParams,
    inputLookup,
    outputLookup,
    outputs: new Map(),
  };
};

const runSubsystemOutputs = (outerCtx, block, stateData) => {
  const outputs = new Map();
  const innerCtx = {
    resolvedParams: stateData.resolvedParams,
    inputMap: stateData.inputMap,
    labelSinks: stateData.labelSinks,
    blockState: stateData.blockState,
    dt: outerCtx.dt,
    variables: outerCtx.variables,
    t: outerCtx.t,
    outputs,
  };

  const inValues = getInputValues(outerCtx, block);
  const applyExternalInputs = () => {
    stateData.inputLookup.forEach((idx, blockId) => {
      outputs.set(blockId, inValues[idx] ?? 0);
    });
  };
  applyExternalInputs();

  stateData.blocks.forEach((innerBlock) => {
    if (stateData.inputLookup.has(innerBlock.id)) return;
    const handler = getInnerHandler(innerBlock.type);
    if (handler?.output) handler.output(innerCtx, innerBlock);
  });

  let progress = true;
  let iter = 0;
  while (progress && iter < 50) {
    iter += 1;
    progress = false;
    if (resolveLabelSourcesOnce(stateData.blocks, outputs, stateData.inputMap, stateData.labelSinks)) progress = true;
    applyExternalInputs();
    stateData.blocks.forEach((innerBlock) => {
      if (stateData.inputLookup.has(innerBlock.id)) return;
      const handler = getInnerHandler(innerBlock.type);
      if (!handler?.algebraic) return;
      const result = handler.algebraic(innerCtx, innerBlock);
      if (result?.updated) progress = true;
    });
    if (resolveLabelSourcesOnce(stateData.blocks, outputs, stateData.inputMap, stateData.labelSinks)) progress = true;
    applyExternalInputs();
  }

  stateData.outputs = outputs;
  let out = 0;
  const getExternalOutputValue = (blockId) => {
    if (outputs.has(blockId)) return outputs.get(blockId) ?? 0;
    const sinkInputs = stateData.inputMap.get(blockId) || [];
    const fromId = sinkInputs[0];
    if (!fromId) return 0;
    return outputs.get(fromId) ?? 0;
  };
  const outputPairs = Array.from(stateData.outputLookup.entries()).sort((a, b) => a[1] - b[1]);
  if (outputPairs.length) {
    const firstId = outputPairs[0][0];
    out = getExternalOutputValue(firstId);
  }
  return out;
};

const advanceSubsystemState = (outerCtx, stateData) => {
  const innerCtx = {
    resolvedParams: stateData.resolvedParams,
    inputMap: stateData.inputMap,
    labelSinks: stateData.labelSinks,
    blockState: stateData.blockState,
    dt: outerCtx.dt,
    variables: outerCtx.variables,
    t: outerCtx.t,
    outputs: stateData.outputs || new Map(),
  };
  stateData.blocks.forEach((innerBlock) => {
    const handler = getInnerHandler(innerBlock.type);
    if (handler?.afterStep) handler.afterStep(innerCtx, innerBlock);
  });
  stateData.blocks.forEach((innerBlock) => {
    const handler = getInnerHandler(innerBlock.type);
    if (handler?.update) handler.update(innerCtx, innerBlock);
  });
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
        if (!ctx.outputs.has(fromId)) return { has: false, value: fallback };
        return { has: true, value: values[idx] ?? fallback };
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
      ctx.blockState.set(block.id, state);
    },
    output: (ctx, block) => {
      const state = ctx.blockState.get(block.id);
      const subsystemState = state?.subsystem;
      if (!subsystemState) {
        ctx.outputs.set(block.id, 0);
        return;
      }
      const out = runSubsystemOutputs(ctx, block, subsystemState);
      ctx.outputs.set(block.id, out);
    },
    algebraic: (ctx, block) => {
      const state = ctx.blockState.get(block.id);
      const subsystemState = state?.subsystem;
      if (!subsystemState) return null;
      const out = runSubsystemOutputs(ctx, block, subsystemState);
      const prev = ctx.outputs.get(block.id);
      ctx.outputs.set(block.id, out);
      return { updated: prev !== out && !(Number.isNaN(prev) && Number.isNaN(out)) };
    },
    update: (ctx, block) => {
      const state = ctx.blockState.get(block.id);
      const subsystemState = state?.subsystem;
      if (!subsystemState) return;
      advanceSubsystemState(ctx, subsystemState);
    },
  },
};
