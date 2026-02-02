import {
  buildTfModel,
  integrateRK4,
  integrateTfRK4,
  outputFromState,
  getInputValue,
  getBlockState,
} from "./helpers.js";

export const continuousSimHandlers = {
  integrator: {
    init: (ctx, block) => {
      const params = ctx.resolvedParams.get(block.id) || {};
      const state = getBlockState(ctx, block);
      state.integrator = Number(params.initial) || 0;
    },
    output: (ctx, block) => {
      const state = getBlockState(ctx, block);
      const prev = state.integrator ?? 0;
      ctx.outputs.set(block.id, prev);
    },
    update: (ctx, block) => {
      const inputVal = getInputValue(ctx, block, 0, 0);
      const state = getBlockState(ctx, block);
      const prev = state.integrator ?? 0;
      state.integrator = integrateRK4(prev, inputVal ?? 0, ctx.dt);
    },
  },
  tf: {
    init: (ctx, block) => {
      const params = ctx.resolvedParams.get(block.id) || {};
      const model = buildTfModel(params.num, params.den);
      const state = getBlockState(ctx, block);
      state.tfModel = model;
      state.tfState = model ? model.state.slice() : [];
    },
    output: (ctx, block) => {
      const state = getBlockState(ctx, block);
      const model = state.tfModel;
      const prev = state.tfState || model?.state || [];
      const inputVal = getInputValue(ctx, block, 0, 0);
      const yPrev = model ? outputFromState(model, prev, inputVal ?? 0) : 0;
      ctx.outputs.set(block.id, yPrev);
    },
    algebraic: (ctx, block) => {
      const state = getBlockState(ctx, block);
      const model = state.tfModel;
      if (!model || model.n !== 0) return null;
      const inputVal = getInputValue(ctx, block, 0, 0);
      const out = outputFromState(model, model.state || [], inputVal ?? 0);
      const prev = ctx.outputs.get(block.id);
      ctx.outputs.set(block.id, out);
      return { updated: prev !== out && !(Number.isNaN(prev) && Number.isNaN(out)) };
    },
    update: (ctx, block) => {
      const state = getBlockState(ctx, block);
      const model = state.tfModel;
      if (!model) return;
      const inputVal = getInputValue(ctx, block, 0, 0);
      state.tfState = integrateTfRK4(model, state.tfState, inputVal ?? 0, ctx.dt);
    },
  },
  delay: {
    init: (ctx, block) => {
      const params = ctx.resolvedParams.get(block.id) || {};
      const delaySamples = Math.max(0, Number(params.delay || 0) / ctx.dt);
      const steps = Math.max(1, Math.ceil(delaySamples) + 1);
      const len = Math.max(2, steps + 1);
      const state = getBlockState(ctx, block);
      state.delayBuffer = Array(len).fill(0);
      state.delayIndex = 0;
      state.delaySamples = delaySamples;
    },
    output: (ctx, block) => {
      const state = getBlockState(ctx, block);
      const buf = state.delayBuffer;
      const len = buf?.length || 0;
      if (!buf || len < 2) {
        ctx.outputs.set(block.id, 0);
        return;
      }
      let delaySamples = Number(state.delaySamples || 0);
      if (delaySamples < 0) delaySamples = 0;
      let d0 = Math.floor(delaySamples);
      let frac = delaySamples - d0;
      if (d0 > len - 2) {
        d0 = len - 2;
        frac = 1.0;
      }
      const base = state.delayIndex || 0;
      let i0 = base - d0;
      let i1 = base - d0 - 1;
      while (i0 < 0) i0 += len;
      while (i1 < 0) i1 += len;
      const s0 = buf[i0 % len] ?? 0;
      const s1 = buf[i1 % len] ?? 0;
      const out = s0 * (1 - frac) + s1 * frac;
      ctx.outputs.set(block.id, out);
    },
    update: (ctx, block) => {
      const state = getBlockState(ctx, block);
      if (!state.delayBuffer) return;
      const len = state.delayBuffer.length || 0;
      if (len < 1) return;
      const inputVal = getInputValue(ctx, block, 0, 0);
      const base = state.delayIndex || 0;
      state.delayBuffer[base] = inputVal ?? 0;
      state.delayIndex = (base + 1) % len;
    },
  },
  stateSpace: {
    init: (ctx, block) => {
      const state = getBlockState(ctx, block);
      state.stateSpaceX = 0;
      state.output = 0;
    },
    output: (ctx, block) => {
      const state = getBlockState(ctx, block);
      ctx.outputs.set(block.id, state.output ?? 0);
    },
    update: (ctx, block) => {
      const params = ctx.resolvedParams.get(block.id) || {};
      const inputVal = getInputValue(ctx, block, 0, 0);
      const state = getBlockState(ctx, block);
      const prev = state.stateSpaceX ?? 0;
      const A = Number(params.A) || 0;
      const B = Number(params.B) || 0;
      const C = Number(params.C) || 0;
      const D = Number(params.D) || 0;
      const xNext = prev + ctx.dt * (A * prev + B * (inputVal ?? 0));
      state.stateSpaceX = xNext;
      const y = C * xNext + D * (inputVal ?? 0);
      state.output = y;
    },
  },
  lpf: {
    init: (ctx, block) => {
      const state = getBlockState(ctx, block);
      state.lpf = 0;
      state.output = 0;
    },
    output: (ctx, block) => {
      const state = getBlockState(ctx, block);
      ctx.outputs.set(block.id, state.output ?? 0);
    },
    update: (ctx, block) => {
      const params = ctx.resolvedParams.get(block.id) || {};
      const inputVal = getInputValue(ctx, block, 0, 0);
      const state = getBlockState(ctx, block);
      const prev = state.lpf ?? 0;
      const fc = Math.max(0, Number(params.cutoff) || 0);
      const wc = 2 * Math.PI * fc;
      const next = prev + ctx.dt * wc * ((inputVal ?? 0) - prev);
      state.lpf = next;
      state.output = next;
    },
  },
  hpf: {
    init: (ctx, block) => {
      const state = getBlockState(ctx, block);
      state.hpf = 0;
      state.output = 0;
    },
    output: (ctx, block) => {
      const state = getBlockState(ctx, block);
      ctx.outputs.set(block.id, state.output ?? 0);
    },
    update: (ctx, block) => {
      const params = ctx.resolvedParams.get(block.id) || {};
      const inputVal = getInputValue(ctx, block, 0, 0);
      const state = getBlockState(ctx, block);
      const prev = state.hpf ?? 0;
      const fc = Math.max(0, Number(params.cutoff) || 0);
      const wc = 2 * Math.PI * fc;
      const next = prev + ctx.dt * wc * ((inputVal ?? 0) - prev);
      state.hpf = next;
      state.output = (inputVal ?? 0) - next;
    },
  },
  derivative: {
    init: (ctx, block) => {
      const state = getBlockState(ctx, block);
      state.derPrev = 0;
      state.output = 0;
    },
    output: (ctx, block) => {
      const state = getBlockState(ctx, block);
      ctx.outputs.set(block.id, state.output ?? 0);
    },
    update: (ctx, block) => {
      const inputVal = getInputValue(ctx, block, 0, 0);
      const state = getBlockState(ctx, block);
      const prev = state.derPrev ?? 0;
      const out = ((inputVal ?? 0) - prev) / Math.max(ctx.dt, 1e-6);
      state.derPrev = inputVal ?? 0;
      state.output = out;
    },
  },
  pid: {
    init: (ctx, block) => {
      const state = getBlockState(ctx, block);
      state.pid = { integral: 0, prev: 0 };
      state.output = 0;
    },
    output: (ctx, block) => {
      const state = getBlockState(ctx, block);
      ctx.outputs.set(block.id, state.output ?? 0);
    },
    update: (ctx, block) => {
      const params = ctx.resolvedParams.get(block.id) || {};
      const inputVal = getInputValue(ctx, block, 0, 0);
      const state = getBlockState(ctx, block);
      const pid = state.pid || { integral: 0, prev: 0 };
      const kp = Number(params.kp) || 0;
      const ki = Number(params.ki) || 0;
      const kd = Number(params.kd) || 0;
      const nextIntegral = pid.integral + (inputVal ?? 0) * ctx.dt;
      const derivative = ((inputVal ?? 0) - pid.prev) / Math.max(ctx.dt, 1e-6);
      const out = kp * (inputVal ?? 0) + ki * nextIntegral + kd * derivative;
      state.pid = { integral: nextIntegral, prev: inputVal ?? 0 };
      state.output = out;
    },
  },
};
