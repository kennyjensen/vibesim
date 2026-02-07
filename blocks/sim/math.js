import { getInputValues } from "./helpers.js";
import { evalExpression } from "../../utils/expr.js";

const getPrevOutput = (ctx, blockId, fallback) => {
  const upstreamState = ctx.blockState?.get(blockId);
  if (upstreamState && Number.isFinite(upstreamState.output)) return upstreamState.output;
  return fallback;
};

const readInputWithFallback = (ctx, inputs, values, idx, fallback) => {
  const fromId = inputs[idx];
  if (!fromId) return fallback;
  if (ctx.outputs.has(fromId)) return values[idx] ?? fallback;
  return getPrevOutput(ctx, fromId, fallback);
};

export const mathSimHandlers = {
  gain: {
    init: (ctx, block) => {
      const state = ctx.blockState.get(block.id) || {};
      if (!Number.isFinite(state.output)) state.output = 0;
      ctx.blockState.set(block.id, state);
    },
    algebraic: (ctx, block) => {
      const params = ctx.resolvedParams.get(block.id) || {};
      const values = getInputValues(ctx, block);
      const inputs = ctx.inputMap.get(block.id) || [];
      const inputVal = readInputWithFallback(ctx, inputs, values, 0, 0);
      const rawGain = Number(params.gain);
      const gainValue = Number.isFinite(rawGain) ? rawGain : 1;
      const out = inputVal * gainValue;
      const prev = ctx.outputs.get(block.id);
      ctx.outputs.set(block.id, out);
      const state = ctx.blockState.get(block.id) || {};
      state.output = out;
      ctx.blockState.set(block.id, state);
      return { updated: prev !== out && !(Number.isNaN(prev) && Number.isNaN(out)) };
    },
  },
  sum: {
    init: (ctx, block) => {
      const state = ctx.blockState.get(block.id) || {};
      if (!Number.isFinite(state.output)) state.output = 0;
      ctx.blockState.set(block.id, state);
    },
    algebraic: (ctx, block) => {
      const values = getInputValues(ctx, block);
      const inputs = ctx.inputMap.get(block.id) || [];
      const signs = block.params.signs || [];
      const resolved = inputs.map((fromId, idx) => {
        if (!fromId) return 0;
        return readInputWithFallback(ctx, inputs, values, idx, 0);
      });
      const out = resolved.reduce((acc, v, idx) => acc + v * (signs[idx] ?? 1), 0);
      const prev = ctx.outputs.get(block.id);
      ctx.outputs.set(block.id, out);
      const state = ctx.blockState.get(block.id) || {};
      state.output = out;
      ctx.blockState.set(block.id, state);
      return { updated: prev !== out && !(Number.isNaN(prev) && Number.isNaN(out)) };
    },
  },
  mult: {
    init: (ctx, block) => {
      const state = ctx.blockState.get(block.id) || {};
      if (!Number.isFinite(state.output)) state.output = 1;
      ctx.blockState.set(block.id, state);
    },
    algebraic: (ctx, block) => {
      const values = getInputValues(ctx, block);
      const inputs = ctx.inputMap.get(block.id) || [];
      const resolved = inputs.map((fromId, idx) => {
        if (!fromId) return 1;
        return readInputWithFallback(ctx, inputs, values, idx, 1);
      });
      const out = resolved.reduce((acc, v) => acc * v, 1);
      const prev = ctx.outputs.get(block.id);
      ctx.outputs.set(block.id, out);
      const state = ctx.blockState.get(block.id) || {};
      state.output = out;
      ctx.blockState.set(block.id, state);
      return { updated: prev !== out && !(Number.isNaN(prev) && Number.isNaN(out)) };
    },
  },
  abs: {
    algebraic: (ctx, block) => {
      const values = getInputValues(ctx, block);
      if (values[0] === undefined) return null;
      const out = Math.abs(values[0] ?? 0);
      const prev = ctx.outputs.get(block.id);
      ctx.outputs.set(block.id, out);
      return { updated: prev !== out && !(Number.isNaN(prev) && Number.isNaN(out)) };
    },
  },
  min: {
    algebraic: (ctx, block) => {
      const values = getInputValues(ctx, block);
      if (values[0] === undefined || values[1] === undefined) return null;
      const out = Math.min(values[0] ?? 0, values[1] ?? 0);
      const prev = ctx.outputs.get(block.id);
      ctx.outputs.set(block.id, out);
      return { updated: prev !== out && !(Number.isNaN(prev) && Number.isNaN(out)) };
    },
  },
  max: {
    algebraic: (ctx, block) => {
      const values = getInputValues(ctx, block);
      if (values[0] === undefined || values[1] === undefined) return null;
      const out = Math.max(values[0] ?? 0, values[1] ?? 0);
      const prev = ctx.outputs.get(block.id);
      ctx.outputs.set(block.id, out);
      return { updated: prev !== out && !(Number.isNaN(prev) && Number.isNaN(out)) };
    },
  },
  userFunc: {
    algebraic: (ctx, block) => {
      const values = getInputValues(ctx, block);
      if (values[0] === undefined) return null;
      const params = ctx.resolvedParams.get(block.id) || {};
      const expr = String(params.expr ?? "u");
      const vars = { ...(ctx.variables || {}), u: values[0] ?? 0 };
      const out = evalExpression(expr, vars);
      if (!Number.isFinite(out)) return null;
      const prev = ctx.outputs.get(block.id);
      ctx.outputs.set(block.id, out);
      return { updated: prev !== out && !(Number.isNaN(prev) && Number.isNaN(out)) };
    },
  },
};
