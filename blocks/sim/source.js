import { getBlockState, getInputValue } from "./helpers.js";

export const resolveLabelSourcesOnce = (labelSourceBlocks, outputs, inputMap, labelSinks) => {
  let changed = false;
  labelSourceBlocks.forEach((block) => {
    if (!block || block.type !== "labelSource") return;
    if (block.params?.isExternalPort === true) return;
    const name = String(block.params.name || "").trim();
    let nextVal = 0;
    if (name) {
      const sinkId = labelSinks.get(name);
      if (!sinkId) {
        nextVal = 0;
      } else {
        const sinkInputs = inputMap.get(sinkId) || [];
        const fromId = sinkInputs[0];
        if (!fromId) {
          nextVal = 0;
        } else if (!outputs.has(fromId)) {
          return;
        } else {
          nextVal = outputs.get(fromId) ?? 0;
        }
      }
    }
    const prev = outputs.get(block.id);
    outputs.set(block.id, nextVal);
    if (prev !== nextVal && !(Number.isNaN(prev) && Number.isNaN(nextVal))) {
      changed = true;
    }
  });
  return changed;
};

export const sourceSimHandlers = {
  constant: {
    output: (ctx, block) => {
      const params = ctx.resolvedParams.get(block.id) || {};
      ctx.outputs.set(block.id, Number(params.value) || 0);
    },
  },
  step: {
    output: (ctx, block) => {
      const params = ctx.resolvedParams.get(block.id) || {};
      const stepTime = Number(params.stepTime) || 0;
      ctx.outputs.set(block.id, ctx.t >= stepTime ? 1 : 0);
    },
  },
  ramp: {
    output: (ctx, block) => {
      const params = ctx.resolvedParams.get(block.id) || {};
      const slope = Number(params.slope) || 0;
      const start = Number(params.start) || 0;
      ctx.outputs.set(block.id, ctx.t >= start ? slope * (ctx.t - start) : 0);
    },
  },
  impulse: {
    output: (ctx, block) => {
      const params = ctx.resolvedParams.get(block.id) || {};
      const timePoint = Number(params.time) || 0;
      const amp = Number(params.amp) || 0;
      const out = Math.abs(ctx.t - timePoint) <= ctx.dt / 2 ? amp / Math.max(ctx.dt, 1e-6) : 0;
      ctx.outputs.set(block.id, out);
    },
  },
  sine: {
    output: (ctx, block) => {
      const params = ctx.resolvedParams.get(block.id) || {};
      const amp = Number(params.amp) || 0;
      const freq = Number(params.freq) || 0;
      const phase = Number(params.phase) || 0;
      ctx.outputs.set(block.id, amp * Math.sin(2 * Math.PI * freq * ctx.t + phase));
    },
  },
  chirp: {
    output: (ctx, block) => {
      const params = ctx.resolvedParams.get(block.id) || {};
      const amp = Number(params.amp) || 0;
      const f0 = Number(params.f0) || 0;
      const f1 = Number(params.f1) || 0;
      const t1 = Math.max(0.001, Number(params.t1) || 1);
      const k = (f1 - f0) / t1;
      const phase = 2 * Math.PI * (f0 * ctx.t + 0.5 * k * ctx.t * ctx.t);
      ctx.outputs.set(block.id, amp * Math.sin(phase));
    },
  },
  noise: {
    output: (ctx, block) => {
      const params = ctx.resolvedParams.get(block.id) || {};
      const amp = Number(params.amp) || 0;
      ctx.outputs.set(block.id, amp * (Math.random() * 2 - 1));
    },
  },
  fileSource: {
    init: (ctx, block) => {
      const params = ctx.resolvedParams.get(block.id) || {};
      const times = Array.isArray(params.times) ? params.times : [];
      const values = Array.isArray(params.values) ? params.values : [];
      const data = times.length ? { times, values } : null;
      const state = getBlockState(ctx, block);
      state.fileSource = { data, idx: 0 };
    },
    output: (ctx, block) => {
      const state = getBlockState(ctx, block);
      if (!state.fileSource?.data) {
        ctx.outputs.set(block.id, 0);
      } else {
        const { times, values } = state.fileSource;
        while (state.fileSource.idx + 1 < times.length && times[state.fileSource.idx + 1] <= ctx.t) {
          state.fileSource.idx += 1;
        }
        const value = values[state.fileSource.idx] ?? 0;
        ctx.outputs.set(block.id, value);
      }
    },
  },
  labelSource: {
    output: (ctx, block) => {
      const val = getInputValue(ctx, block, 0, 0);
      ctx.outputs.set(block.id, val);
    },
  },
};
