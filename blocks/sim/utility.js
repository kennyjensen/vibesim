import { getInputValues } from "./helpers.js";

const conditionTrue = (condition, input, threshold) => {
  if (condition === "gt") return input > threshold;
  if (condition === "ne") return input !== threshold;
  return input >= threshold;
};

export const utilitySimHandlers = {
  switch: {
    algebraic: (ctx, block) => {
      const values = getInputValues(ctx, block);
      const inputs = ctx.inputMap.get(block.id) || [];
      let missing = false;
      const resolved = [0, 1, 2].map((idx) => {
        const fromId = inputs[idx];
        if (!fromId) return 0;
        if (!ctx.outputs.has(fromId)) {
          missing = true;
          return 0;
        }
        return values[idx] ?? 0;
      });
      if (missing) return null;

      const params = ctx.resolvedParams.get(block.id) || {};
      const condition = String(params.condition || "ge");
      const threshold = Number(params.threshold);
      const thresholdValue = Number.isFinite(threshold) ? threshold : 0;
      const condInput = resolved[1] ?? 0;
      const out = conditionTrue(condition, condInput, thresholdValue) ? (resolved[0] ?? 0) : (resolved[2] ?? 0);
      const prev = ctx.outputs.get(block.id);
      ctx.outputs.set(block.id, out);
      return { updated: prev !== out && !(Number.isNaN(prev) && Number.isNaN(out)) };
    },
  },
};
