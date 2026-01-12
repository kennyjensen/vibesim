export function simulate({ state, runtimeInput, statusEl }) {
  statusEl.textContent = "Running...";
  const blocks = Array.from(state.blocks.values());
  const scopes = blocks.filter((b) => b.type === "scope");

  if (scopes.length === 0) {
    statusEl.textContent = "Add a Scope block";
    return;
  }

  const inputMap = new Map();
  blocks.forEach((block) => {
    inputMap.set(block.id, Array(block.inputs).fill(null));
  });

  state.connections.forEach((conn) => {
    const inputs = inputMap.get(conn.to);
    if (!inputs) return;
    if (conn.toIndex < inputs.length) inputs[conn.toIndex] = conn.from;
  });

  const dt = 0.01;
  const duration = Math.max(0.1, Number(runtimeInput.value) || 10);
  const samples = Math.floor(duration / dt);
  const time = [];
  const scopeSeries = new Map();
  const integratorState = new Map();
  const scopeConnected = new Map();
  const tfModels = new Map();
  const outputState = new Map();
  const lpfState = new Map();
  const hpfState = new Map();
  const derivativePrev = new Map();
  const pidState = new Map();
  const zohState = new Map();
  const fohState = new Map();
  const dtfState = new Map();
  const backlashState = new Map();

  scopes.forEach((scope) => {
    scopeSeries.set(scope.id, Array(scope.inputs).fill(0).map(() => []));
    const inputs = inputMap.get(scope.id) || [];
    scopeConnected.set(scope.id, inputs.map((fromId) => Boolean(fromId)));
  });

  blocks.forEach((block) => {
    if (block.type === "rate") block.rateState = 0;
    if (block.type === "tf") {
      const model = buildTfModel(block.params.num, block.params.den);
      tfModels.set(block.id, model);
      block.tfState = model ? model.state.slice() : [];
    }
    if (block.type === "lpf") lpfState.set(block.id, 0);
    if (block.type === "hpf") hpfState.set(block.id, 0);
    if (block.type === "derivative") derivativePrev.set(block.id, 0);
    if (block.type === "pid") pidState.set(block.id, { integral: 0, prev: 0 });
    if (block.type === "zoh") zohState.set(block.id, { lastSample: 0, nextTime: 0 });
    if (block.type === "foh") fohState.set(block.id, { prevSample: 0, lastSample: 0, lastTime: 0, nextTime: 0 });
    if (block.type === "dtf") {
      const model = buildDiscreteTf(block.params.num, block.params.den);
      dtfState.set(block.id, { model, xHist: Array(model.num.length).fill(0), yHist: Array(model.den.length - 1).fill(0), nextTime: 0 });
    }
    if (block.type === "backlash") backlashState.set(block.id, 0);
    if (["lpf", "hpf", "derivative", "pid", "zoh", "foh", "dtf", "backlash"].includes(block.type)) {
      outputState.set(block.id, 0);
    }
  });

  for (let i = 0; i <= samples; i += 1) {
    const t = i * dt;
    time.push(t);
    const outputs = new Map();

    blocks.forEach((block) => {
      if (block.type === "constant") {
        outputs.set(block.id, Number(block.params.value) || 0);
      }
      if (block.type === "step") {
        const stepTime = Number(block.params.stepTime) || 0;
        outputs.set(block.id, t >= stepTime ? 1 : 0);
      }
      if (block.type === "ramp") {
        const slope = Number(block.params.slope) || 0;
        const start = Number(block.params.start) || 0;
        outputs.set(block.id, t >= start ? slope * (t - start) : 0);
      }
      if (block.type === "impulse") {
        const timePoint = Number(block.params.time) || 0;
        const amp = Number(block.params.amp) || 0;
        outputs.set(block.id, Math.abs(t - timePoint) <= dt / 2 ? amp / Math.max(dt, 1e-6) : 0);
      }
      if (block.type === "sine") {
        const amp = Number(block.params.amp) || 0;
        const freq = Number(block.params.freq) || 0;
        const phase = Number(block.params.phase) || 0;
        outputs.set(block.id, amp * Math.sin(2 * Math.PI * freq * t + phase));
      }
      if (block.type === "chirp") {
        const amp = Number(block.params.amp) || 0;
        const f0 = Number(block.params.f0) || 0;
        const f1 = Number(block.params.f1) || 0;
        const t1 = Math.max(0.001, Number(block.params.t1) || 1);
        const k = (f1 - f0) / t1;
        const phase = 2 * Math.PI * (f0 * t + 0.5 * k * t * t);
        outputs.set(block.id, amp * Math.sin(phase));
      }
      if (block.type === "noise") {
        const amp = Number(block.params.amp) || 0;
        outputs.set(block.id, amp * (Math.random() * 2 - 1));
      }
      if (block.type === "fileSource") {
        outputs.set(block.id, 0);
      }
      if (block.type === "integrator") {
        const prev = integratorState.get(block.id) || 0;
        outputs.set(block.id, prev);
      }
      if (block.type === "rate") {
        const prev = block.rateState ?? 0;
        outputs.set(block.id, prev);
      }
      if (block.type === "tf") {
        const model = tfModels.get(block.id);
        const prev = block.tfState || model?.state || [];
        const yPrev = model ? outputFromState(model, prev, 0) : 0;
        outputs.set(block.id, yPrev);
      }
      if (["lpf", "hpf", "derivative", "pid", "zoh", "foh", "dtf", "backlash"].includes(block.type)) {
        outputs.set(block.id, outputState.get(block.id) || 0);
      }
    });

    let progress = true;
    while (progress) {
      progress = false;
      blocks.forEach((block) => {
        if (outputs.has(block.id)) return;
        if (["scope", "integrator", "tf", "lpf", "hpf", "derivative", "pid", "zoh", "foh", "dtf", "backlash", "fileSink"].includes(block.type)) return;

        const inputs = inputMap.get(block.id) || [];
        const values = inputs.map((fromId) => (fromId ? outputs.get(fromId) : undefined));
        if (!["sum", "mult", "gain", "saturation"].includes(block.type) && values.some((v) => v === undefined)) return;

        let out = 0;
        if (block.type === "gain") {
          const gainValue = Number(block.params.gain) || 1;
          out = (values[0] || 0) * gainValue;
        } else if (block.type === "sum") {
          const signs = block.params.signs || [];
          out = values.reduce((acc, v, idx) => acc + (v ?? 0) * (signs[idx] ?? 1), 0);
        } else if (block.type === "mult") {
          out = (values[0] ?? 0) * (values[1] ?? 0);
        } else if (block.type === "saturation") {
          const min = Number(block.params.min);
          const max = Number(block.params.max);
          const value = values[0] ?? 0;
          out = Math.max(min, Math.min(max, value));
        }

        outputs.set(block.id, out);
        progress = true;
      });
    }

    scopes.forEach((scope) => {
      const inputs = inputMap.get(scope.id) || [];
      const series = scopeSeries.get(scope.id);
      inputs.forEach((fromId, idx) => {
        const value = fromId ? outputs.get(fromId) : null;
        series[idx].push(value ?? null);
      });
    });

    blocks.forEach((block) => {
      if (block.type !== "integrator") return;
      const inputs = inputMap.get(block.id) || [];
      const fromId = inputs[0];
      const inputVal = fromId ? outputs.get(fromId) : 0;
      const prev = integratorState.get(block.id) || 0;
      if (inputVal !== undefined) {
        integratorState.set(block.id, integrateRK4(prev, inputVal, dt));
      }
    });

    blocks.forEach((block) => {
      if (block.type !== "rate") return;
      const inputs = inputMap.get(block.id) || [];
      const fromId = inputs[0];
      const inputVal = fromId ? outputs.get(fromId) : 0;
      if (inputVal === undefined) return;
      const prev = block.rateState ?? 0;
      const rise = Math.max(0, Number(block.params.rise));
      const fall = Math.max(0, Number(block.params.fall));
      const maxRise = prev + rise * dt;
      const maxFall = prev - fall * dt;
      block.rateState = Math.min(maxRise, Math.max(maxFall, inputVal));
    });

    blocks.forEach((block) => {
      if (block.type !== "tf") return;
      const model = tfModels.get(block.id);
      if (!model) return;
      const inputs = inputMap.get(block.id) || [];
      const fromId = inputs[0];
      const inputVal = fromId ? outputs.get(fromId) : 0;
      if (inputVal === undefined) return;
      block.tfState = integrateTfRK4(model, block.tfState, inputVal, dt);
    });

    blocks.forEach((block) => {
      if (block.type !== "lpf") return;
      const inputs = inputMap.get(block.id) || [];
      const inputVal = inputs[0] ? outputs.get(inputs[0]) : 0;
      const prev = lpfState.get(block.id) || 0;
      const fc = Math.max(0, Number(block.params.cutoff) || 0);
      const wc = 2 * Math.PI * fc;
      const next = prev + dt * wc * ((inputVal ?? 0) - prev);
      lpfState.set(block.id, next);
      outputState.set(block.id, next);
    });

    blocks.forEach((block) => {
      if (block.type !== "hpf") return;
      const inputs = inputMap.get(block.id) || [];
      const inputVal = inputs[0] ? outputs.get(inputs[0]) : 0;
      const prev = hpfState.get(block.id) || 0;
      const fc = Math.max(0, Number(block.params.cutoff) || 0);
      const wc = 2 * Math.PI * fc;
      const next = prev + dt * wc * ((inputVal ?? 0) - prev);
      hpfState.set(block.id, next);
      outputState.set(block.id, (inputVal ?? 0) - next);
    });

    blocks.forEach((block) => {
      if (block.type !== "derivative") return;
      const inputs = inputMap.get(block.id) || [];
      const inputVal = inputs[0] ? outputs.get(inputs[0]) : 0;
      const prev = derivativePrev.get(block.id) ?? 0;
      const out = ((inputVal ?? 0) - prev) / Math.max(dt, 1e-6);
      derivativePrev.set(block.id, inputVal ?? 0);
      outputState.set(block.id, out);
    });

    blocks.forEach((block) => {
      if (block.type !== "pid") return;
      const inputs = inputMap.get(block.id) || [];
      const inputVal = inputs[0] ? outputs.get(inputs[0]) : 0;
      const state = pidState.get(block.id) || { integral: 0, prev: 0 };
      const kp = Number(block.params.kp) || 0;
      const ki = Number(block.params.ki) || 0;
      const kd = Number(block.params.kd) || 0;
      const nextIntegral = state.integral + (inputVal ?? 0) * dt;
      const derivative = ((inputVal ?? 0) - state.prev) / Math.max(dt, 1e-6);
      const out = kp * (inputVal ?? 0) + ki * nextIntegral + kd * derivative;
      pidState.set(block.id, { integral: nextIntegral, prev: inputVal ?? 0 });
      outputState.set(block.id, out);
    });

    blocks.forEach((block) => {
      if (block.type !== "zoh") return;
      const inputs = inputMap.get(block.id) || [];
      const inputVal = inputs[0] ? outputs.get(inputs[0]) : 0;
      const state = zohState.get(block.id);
      const ts = Math.max(0.001, Number(block.params.ts) || dt);
      if (t + 1e-6 >= state.nextTime) {
        state.lastSample = inputVal ?? 0;
        state.nextTime = t + ts;
      }
      outputState.set(block.id, state.lastSample);
    });

    blocks.forEach((block) => {
      if (block.type !== "foh") return;
      const inputs = inputMap.get(block.id) || [];
      const inputVal = inputs[0] ? outputs.get(inputs[0]) : 0;
      const state = fohState.get(block.id);
      const ts = Math.max(0.001, Number(block.params.ts) || dt);
      if (t + 1e-6 >= state.nextTime) {
        state.prevSample = state.lastSample;
        state.lastSample = inputVal ?? 0;
        state.lastTime = t;
        state.nextTime = t + ts;
      }
      const slope = (state.lastSample - state.prevSample) / ts;
      const out = state.lastSample + slope * (t - state.lastTime);
      outputState.set(block.id, out);
    });

    blocks.forEach((block) => {
      if (block.type !== "dtf") return;
      const inputs = inputMap.get(block.id) || [];
      const inputVal = inputs[0] ? outputs.get(inputs[0]) : 0;
      const state = dtfState.get(block.id);
      const ts = Math.max(0.001, Number(block.params.ts) || dt);
      if (t + 1e-6 >= state.nextTime) {
        state.xHist.pop();
        state.xHist.unshift(inputVal ?? 0);
        const y = evalDiscreteTf(state.model, state.xHist, state.yHist);
        state.yHist.pop();
        state.yHist.unshift(y);
        state.nextTime = t + ts;
        outputState.set(block.id, y);
      }
    });

    blocks.forEach((block) => {
      if (block.type !== "backlash") return;
      const inputs = inputMap.get(block.id) || [];
      const inputVal = inputs[0] ? outputs.get(inputs[0]) : 0;
      const width = Math.max(0, Number(block.params.width) || 0);
      const prev = backlashState.get(block.id) || 0;
      let out = prev;
      if ((inputVal ?? 0) > prev + width / 2) out = (inputVal ?? 0) - width / 2;
      if ((inputVal ?? 0) < prev - width / 2) out = (inputVal ?? 0) + width / 2;
      backlashState.set(block.id, out);
      outputState.set(block.id, out);
    });
  }

  scopes.forEach((scope) => {
    drawScope(scope, time, scopeSeries.get(scope.id), scopeConnected.get(scope.id));
  });

  statusEl.textContent = "Done";
}

export function drawScope(scopeBlock, time, series, connected) {
  scopeBlock.scopeData = { time, series, connected };
  renderScope(scopeBlock);
}

export function renderScope(scopeBlock) {
  if (!scopeBlock.scopePaths || !scopeBlock.scopePlot || !scopeBlock.scopeData) return;
  const plot = scopeBlock.scopePlot;
  const plotX = Number(plot.getAttribute("x"));
  const plotY = Number(plot.getAttribute("y"));
  const plotW = Number(plot.getAttribute("width"));
  const plotH = Number(plot.getAttribute("height"));
  const { time, series, connected } = scopeBlock.scopeData;
  const activeSeries = series.filter((_, idx) => (connected ? connected[idx] : true));
  const values = activeSeries.flat().filter((v) => v != null);
  if (values.length === 0) {
    scopeBlock.scopePaths.forEach((path) => path.setAttribute("d", ""));
    return;
  }

  let maxVal = Math.max(...values, 1);
  let minVal = Math.min(...values, -1);
  if (maxVal === minVal) {
    maxVal += 1;
    minVal -= 1;
  }
  const range = maxVal - minVal;

  series.forEach((valuesForSeries, seriesIdx) => {
    if (connected && !connected[seriesIdx]) {
      const pathEl = scopeBlock.scopePaths[seriesIdx];
      if (pathEl) pathEl.setAttribute("d", "");
      return;
    }
    const path = valuesForSeries
      .map((v, i) => {
        if (v == null) return null;
        const x = plotX + (i / (valuesForSeries.length - 1)) * plotW;
        const y = plotY + plotH - ((v - minVal) / range) * plotH;
        return `${i === 0 ? "M" : "L"} ${x} ${y}`;
      })
      .filter(Boolean);
    const pathEl = scopeBlock.scopePaths[seriesIdx];
    if (pathEl) pathEl.setAttribute("d", path.join(" "));
  });

  if (scopeBlock.scopeHoverX == null) return;
  const clampedX = Math.min(plotX + plotW, Math.max(plotX, scopeBlock.scopeHoverX));
  const ratio = (clampedX - plotX) / Math.max(1, plotW);
  const primaryIndex = connected ? connected.findIndex(Boolean) : 0;
  const primary = primaryIndex >= 0 ? series[primaryIndex] : series[0] || [];
  if (primary.length < 2) return;
  const idx = Math.min(primary.length - 1, Math.max(0, Math.round(ratio * (primary.length - 1))));
  const t = time[idx];
  const x = plotX + (idx / (primary.length - 1)) * plotW;

  scopeBlock.scopeCursor?.remove();
  if (scopeBlock.scopeLabels) scopeBlock.scopeLabels.forEach((el) => el.remove());
  if (scopeBlock.scopeDots) scopeBlock.scopeDots.forEach((el) => el.remove());

  const cursor = createSvgElement("line", { x1: x, y1: plotY, x2: x, y2: plotY + plotH, class: "scope-cursor" });

  scopeBlock.group.appendChild(cursor);

  scopeBlock.scopeCursor = cursor;
  scopeBlock.scopeLabels = [];
  scopeBlock.scopeDots = [];

  series.forEach((valuesForSeries, seriesIdx) => {
    if (connected && !connected[seriesIdx]) return;
    const v = valuesForSeries[idx] ?? 0;
    const y = plotY + plotH - ((v - minVal) / range) * plotH;
    const dot = createSvgElement("circle", {
      cx: x,
      cy: y,
      r: 3.5,
      class: `scope-dot scope-dot-${seriesIdx + 1}`,
    });
    const label = createSvgElement(
      "text",
      { x: x + 6, y: y - 6, class: `scope-label scope-label-${seriesIdx + 1}` },
      `t=${t.toFixed(2)} y${seriesIdx + 1}=${v.toFixed(2)}`
    );
    scopeBlock.group.appendChild(dot);
    scopeBlock.group.appendChild(label);
    scopeBlock.scopeDots.push(dot);
    scopeBlock.scopeLabels.push(label);
  });
}

function integrateRK4(state, input, dt) {
  const k1 = input;
  const k2 = input;
  const k3 = input;
  const k4 = input;
  return state + (dt / 6) * (k1 + 2 * k2 + 2 * k3 + k4);
}

function buildTfModel(num, den) {
  const numArr = (num || []).map(Number).filter((v) => Number.isFinite(v));
  const denArr = (den || []).map(Number).filter((v) => Number.isFinite(v));
  if (denArr.length === 0) return null;
  const a0 = denArr[0] || 1;
  const denNorm = denArr.map((v) => v / a0);
  const n = denNorm.length - 1;
  if (n === 0) {
    const gain = (numArr[0] || 0) / a0;
    return { n: 0, A: [], B: [], C: [], D: gain, state: [] };
  }
  const numPadded = Array(n + 1 - numArr.length).fill(0).concat(numArr);
  const a = denNorm.slice(1);
  const b = numPadded.map((v) => v / a0);

  const A = Array.from({ length: n }, (_, i) => {
    const row = Array(n).fill(0);
    if (i < n - 1) row[i + 1] = 1;
    else {
      for (let j = 0; j < n; j += 1) {
        row[j] = -a[n - 1 - j];
      }
    }
    return row;
  });

  const B = Array(n).fill(0);
  B[n - 1] = 1;

  const C = Array(n).fill(0);
  const b0 = b[0] || 0;
  for (let i = 0; i < n; i += 1) {
    const bi = b[i + 1] || 0;
    const ai = a[i] || 0;
    C[n - 1 - i] = bi - ai * b0;
  }

  const D = b0;
  const state = Array(n).fill(0);
  return { n, A, B, C, D, state };
}

function buildDiscreteTf(num, den) {
  const numArr = (num || []).map(Number).filter((v) => Number.isFinite(v));
  const denArr = (den || []).map(Number).filter((v) => Number.isFinite(v));
  const safeDen = denArr.length ? denArr : [1];
  const a0 = safeDen[0] || 1;
  const denNorm = safeDen.map((v) => v / a0);
  const numNorm = (numArr.length ? numArr : [0]).map((v) => v / a0);
  return { num: numNorm, den: denNorm };
}

function evalDiscreteTf(model, xHist, yHist) {
  const num = model.num || [0];
  const den = model.den || [1];
  let y = 0;
  for (let i = 0; i < num.length; i += 1) {
    y += (num[i] || 0) * (xHist[i] || 0);
  }
  for (let i = 1; i < den.length; i += 1) {
    y -= (den[i] || 0) * (yHist[i - 1] || 0);
  }
  return y;
}

function outputFromState(model, state, input) {
  if (model.n === 0) return model.D * input;
  return dot(model.C, state) + model.D * input;
}

function integrateTfRK4(model, state, input, dt) {
  if (model.n === 0) return state;
  const k1 = stateDerivative(model, state, input);
  const k2 = stateDerivative(model, addVec(state, scaleVec(k1, dt / 2)), input);
  const k3 = stateDerivative(model, addVec(state, scaleVec(k2, dt / 2)), input);
  const k4 = stateDerivative(model, addVec(state, scaleVec(k3, dt)), input);
  const sum = addVec(addVec(k1, scaleVec(k2, 2)), addVec(scaleVec(k3, 2), k4));
  return addVec(state, scaleVec(sum, dt / 6));
}

function stateDerivative(model, state, input) {
  const Ax = matVec(model.A, state);
  const Bu = model.B.map((v) => v * input);
  return addVec(Ax, Bu);
}

function matVec(mat, vec) {
  return mat.map((row) => row.reduce((acc, v, i) => acc + v * (vec[i] || 0), 0));
}

function addVec(a, b) {
  return a.map((v, i) => v + (b[i] || 0));
}

function scaleVec(vec, scalar) {
  return vec.map((v) => v * scalar);
}

function dot(a, b) {
  return a.reduce((acc, v, i) => acc + v * (b[i] || 0), 0);
}

function createSvgElement(tag, attrs = {}, text = "") {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  Object.entries(attrs).forEach(([key, value]) => {
    el.setAttribute(key, value);
  });
  if (text) el.textContent = text;
  return el;
}
