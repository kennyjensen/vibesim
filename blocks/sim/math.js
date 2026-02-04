import { getInputValues } from "./helpers.js";

export const mathSimHandlers = {
  gain: {
    algebraic: (ctx, block) => {
      const params = ctx.resolvedParams.get(block.id) || {};
      const values = getInputValues(ctx, block);
      if (values[0] === undefined) return null;
      const rawGain = Number(params.gain);
      const gainValue = Number.isFinite(rawGain) ? rawGain : 1;
      const out = (values[0] ?? 0) * gainValue;
      const prev = ctx.outputs.get(block.id);
      ctx.outputs.set(block.id, out);
      return { updated: prev !== out && !(Number.isNaN(prev) && Number.isNaN(out)) };
    },
  },
  sum: {
    algebraic: (ctx, block) => {
      const values = getInputValues(ctx, block);
      const inputs = ctx.inputMap.get(block.id) || [];
      const signs = block.params.signs || [];
      let missing = false;
      const resolved = inputs.map((fromId, idx) => {
        if (!fromId) return 0;
        if (!ctx.outputs.has(fromId)) {
          missing = true;
          return 0;
        }
        return values[idx] ?? 0;
      });
      if (missing) return null;
      const out = resolved.reduce((acc, v, idx) => acc + v * (signs[idx] ?? 1), 0);
      const prev = ctx.outputs.get(block.id);
      ctx.outputs.set(block.id, out);
      return { updated: prev !== out && !(Number.isNaN(prev) && Number.isNaN(out)) };
    },
  },
  mult: {
    algebraic: (ctx, block) => {
      const values = getInputValues(ctx, block);
      const inputs = ctx.inputMap.get(block.id) || [];
      let missing = false;
      const resolved = inputs.map((fromId, idx) => {
        if (!fromId) return 1;
        if (!ctx.outputs.has(fromId)) {
          missing = true;
          return 1;
        }
        return values[idx] ?? 1;
      });
      if (missing) return null;
      const out = resolved.reduce((acc, v) => acc * v, 1);
      const prev = ctx.outputs.get(block.id);
      ctx.outputs.set(block.id, out);
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
};
