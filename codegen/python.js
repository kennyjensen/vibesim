const sanitizeId = (id) => String(id).replace(/[^a-zA-Z0-9_]/g, "_");

const replaceLatexVars = (expr) =>
  String(expr || "").replace(/\\[A-Za-z]+/g, (match) => match.slice(1));

const evalExpression = (expr, variables) => {
  if (typeof expr === "number") return expr;
  if (expr == null) return NaN;
  const trimmed = replaceLatexVars(expr).trim();
  if (!trimmed) return NaN;
  const direct = Number(trimmed);
  if (Number.isFinite(direct)) return direct;
  try {
    const names = Object.keys(variables || {});
    const values = Object.values(variables || {});
    const fn = Function(...names, "Math", `"use strict"; return (${trimmed});`);
    const result = fn(...values, Math);
    return Number.isFinite(result) ? result : NaN;
  } catch {
    return NaN;
  }
};

const getLabelName = (block) => sanitizeId(block.params?.name || block.id);

const buildUniqueLabelList = (blocks) => {
  const list = [];
  const map = new Map();
  blocks.forEach((block) => {
    const name = getLabelName(block);
    if (!map.has(name)) {
      map.set(name, list.length);
      list.push(name);
    }
  });
  return { list, map };
};

const resolveNumeric = (value, variables) => {
  if (value == null) return 0;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value).trim();
  if (!text) return 0;
  const direct = Number(text);
  if (Number.isFinite(direct)) return direct;
  const merged = { pi: Math.PI, e: Math.E, ...(variables || {}) };
  if (Object.prototype.hasOwnProperty.call(merged, text)) {
    return Number(merged[text]) || 0;
  }
  const stripped = text.startsWith("\\") ? text.slice(1) : text;
  if (Object.prototype.hasOwnProperty.call(merged, stripped)) {
    return Number(merged[stripped]) || 0;
  }
  const evaluated = evalExpression(text, merged);
  return Number.isFinite(evaluated) ? evaluated : 0;
};

const normalizePoly = (values) => {
  const arr = (values || []).map((v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  });
  let idx = 0;
  while (idx < arr.length - 1 && Math.abs(arr[idx]) < 1e-12) idx += 1;
  const trimmed = arr.length ? arr.slice(idx) : [0];
  const allZero = trimmed.every((v) => Math.abs(v) < 1e-12);
  return { trimmed: allZero ? [0] : trimmed, allZero };
};

const polyAdd = (a, b) => {
  const out = Array(Math.max(a.length, b.length)).fill(0);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = (a[i] || 0) + (b[i] || 0);
  }
  return out;
};

const polyScale = (a, k) => a.map((v) => v * k);

const polyMul = (a, b) => {
  const out = Array(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i += 1) {
    for (let j = 0; j < b.length; j += 1) {
      out[i + j] += a[i] * b[j];
    }
  }
  return out;
};

const polyPow = (base, exp) => {
  let out = [1];
  for (let i = 0; i < exp; i += 1) out = polyMul(out, base);
  return out;
};

const tustinDiscretize = (numArr, denArr, dt) => {
  const { trimmed: numTrim } = normalizePoly(numArr);
  const { trimmed: denTrim, allZero: denAllZero } = normalizePoly(denArr);
  if (denAllZero) return { b: [0], a: [1] };
  let num = numTrim.slice();
  let den = denTrim.slice();
  let n = den.length - 1;
  const m = num.length - 1;
  if (m > n) {
    const pad = m - n;
    den = Array(pad).fill(0).concat(den);
    n = m;
  }
  if (num.length < n + 1) num = Array(n + 1 - num.length).fill(0).concat(num);
  const k = 2 / Math.max(dt, 1e-6);
  const baseP = [1, -1];
  const baseM = [1, 1];
  let numZ = Array(n + 1).fill(0);
  let denZ = Array(n + 1).fill(0);
  for (let i = 0; i <= n; i += 1) {
    const p = n - i;
    const scale = Math.pow(k, p);
    const poly = polyMul(polyPow(baseP, p), polyPow(baseM, n - p));
    numZ = polyAdd(numZ, polyScale(poly, (num[i] || 0) * scale));
    denZ = polyAdd(denZ, polyScale(poly, (den[i] || 0) * scale));
  }
  const a0 = denZ[0] || 1;
  return {
    b: numZ.map((v) => v / a0),
    a: denZ.map((v) => v / a0),
  };
};

const parseList = (value, variables) => {
  if (Array.isArray(value)) {
    return value.map((v) => resolveNumeric(v, variables));
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean)
      .map((v) => resolveNumeric(v, variables));
  }
  return [];
};

const buildExecutionOrder = (blocks, connections, extraEdges = []) => {
  const ids = blocks.map((b) => b.id);
  const indeg = new Map(ids.map((id) => [id, 0]));
  const adj = new Map(ids.map((id) => [id, []]));
  [...connections, ...extraEdges].forEach((conn) => {
    if (!adj.has(conn.from) || !adj.has(conn.to)) return;
    adj.get(conn.from).push(conn.to);
    indeg.set(conn.to, (indeg.get(conn.to) || 0) + 1);
  });
  const queue = ids.filter((id) => (indeg.get(id) || 0) === 0);
  const order = [];
  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    (adj.get(id) || []).forEach((to) => {
      indeg.set(to, (indeg.get(to) || 0) - 1);
      if ((indeg.get(to) || 0) === 0) queue.push(to);
    });
  }
  ids.forEach((id) => {
    if (!order.includes(id)) order.push(id);
  });
  return order;
};

export const generatePython = (diagram, { sampleTime = 0.01, includeMain = true } = {}) => {
  const blocks = diagram.blocks || [];
  const connections = diagram.connections || [];
  const variables = diagram.variables || {};
  const defaultDuration = Number(diagram.runtime);
  const mainDuration = Number.isFinite(defaultDuration) && defaultDuration > 0 ? defaultDuration : 10.0;
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const inputs = new Map(blocks.map((b) => [b.id, []]));
  connections.forEach((conn) => {
    const list = inputs.get(conn.to) || [];
    list[conn.toIndex ?? 0] = conn.from;
    inputs.set(conn.to, list);
  });

  const labelSources = blocks.filter((b) => b.type === "labelSource");
  const labelSinks = blocks.filter((b) => b.type === "labelSink");
  const labelSinkByName = new Map();
  labelSinks.forEach((b) => {
    const name = getLabelName(b);
    labelSinkByName.set(name, b.id);
  });
  const externalLabelSources = labelSources.filter((b) => !labelSinkByName.has(getLabelName(b)));
  const { list: inputNames } = buildUniqueLabelList(externalLabelSources);
  const { list: outputNames } = buildUniqueLabelList(labelSinks);
  const extraEdges = [];
  labelSources.forEach((block) => {
    const name = getLabelName(block);
    const sinkId = labelSinkByName.get(name);
    if (!sinkId) return;
    const fromId = (inputs.get(sinkId) || [])[0];
    if (fromId) extraEdges.push({ from: fromId, to: block.id });
  });
  const order = buildExecutionOrder(blocks, connections, extraEdges);

  const stateInit = [];
  const constLines = [];
  const helperLines = [];
  const dtVal = resolveNumeric(sampleTime, variables) || 0.01;
  const pidBlocks = [];
  const tfBlocks = [];
  const lpfBlocks = [];
  const hpfBlocks = [];
  const delayBlocks = [];
  const hasSaturation = blocks.some((block) => block.type === "saturation");
  blocks.forEach((block) => {
    const id = sanitizeId(block.id);
    const params = block.params || {};
    if (block.type === "integrator") {
      stateInit.push(`state["int_${id}"] = ${resolveNumeric(params.initial, variables)}`);
    }
    if (block.type === "derivative") {
      stateInit.push(`state["der_prev_${id}"] = 0.0`);
    }
    if (block.type === "rate") stateInit.push(`state["rate_${id}"] = 0.0`);
    if (block.type === "backlash") stateInit.push(`state["backlash_${id}"] = 0.0`);
    if (block.type === "lpf") {
      lpfBlocks.push({ block, id });
      stateInit.push(`state["lpf_x1_${id}"] = 0.0`);
      stateInit.push(`state["lpf_y1_${id}"] = 0.0`);
    }
    if (block.type === "hpf") {
      hpfBlocks.push({ block, id });
      stateInit.push(`state["hpf_x1_${id}"] = 0.0`);
      stateInit.push(`state["hpf_y1_${id}"] = 0.0`);
    }
    if (block.type === "pid") {
      pidBlocks.push({ block, id });
      stateInit.push(`state["pid_${id}"] = {"integ": 0.0, "prev": 0.0}`);
    }
    if (block.type === "zoh") {
      stateInit.push(`state["zoh_last_${id}"] = 0.0`);
      stateInit.push(`state["zoh_next_${id}"] = 0.0`);
    }
    if (block.type === "foh") {
      stateInit.push(`state["foh_prev_${id}"] = 0.0`);
      stateInit.push(`state["foh_last_${id}"] = 0.0`);
      stateInit.push(`state["foh_last_t_${id}"] = 0.0`);
      stateInit.push(`state["foh_next_${id}"] = 0.0`);
      stateInit.push(`state["foh_out_${id}"] = 0.0`);
    }
    if (block.type === "delay") {
      const delaySamples = Math.max(0, resolveNumeric(params.delay, variables) / Number(sampleTime || 0.01));
      const steps = Math.max(1, Math.ceil(delaySamples) + 1);
      delayBlocks.push({ id, steps, delaySamples });
      stateInit.push(`state["delay_buf_${id}"] = [0.0] * ${steps + 1}`);
      stateInit.push(`state["delay_idx_${id}"] = 0`);
    }
    if (block.type === "ddelay") {
      const steps = Math.max(1, Math.round(resolveNumeric(params.steps, variables) || 1));
      stateInit.push(`state["ddelay_buf_${id}"] = [0.0] * ${steps}`);
      stateInit.push(`state["ddelay_next_${id}"] = 0.0`);
      stateInit.push(`state["ddelay_last_${id}"] = 0.0`);
    }
    if (block.type === "stateSpace") {
      stateInit.push(`state["ss_x_${id}"] = 0.0`);
      stateInit.push(`state["ss_out_${id}"] = 0.0`);
    }
    if (block.type === "dstateSpace") {
      stateInit.push(`state["dss_x_${id}"] = 0.0`);
      stateInit.push(`state["dss_next_${id}"] = 0.0`);
      stateInit.push(`state["dss_last_${id}"] = 0.0`);
    }
    if (block.type === "dtf") {
      const num = parseList(params.num, variables);
      const den = parseList(params.den, variables);
      stateInit.push(`state["dtf_num_${id}"] = ${JSON.stringify(num.length ? num : [0])}`);
      stateInit.push(`state["dtf_den_${id}"] = ${JSON.stringify(den.length ? den : [1])}`);
      stateInit.push(`state["dtf_x_${id}"] = [0.0] * ${Math.max(1, num.length)}`);
      stateInit.push(`state["dtf_y_${id}"] = [0.0] * ${Math.max(0, den.length - 1)}`);
      stateInit.push(`state["dtf_next_${id}"] = 0.0`);
    }
    if (block.type === "tf") {
      tfBlocks.push({ block, id });
      const num = parseList(params.num, variables);
      const den = parseList(params.den, variables);
      const { b, a } = tustinDiscretize(num, den, dtVal);
      const n = Math.max(0, a.length - 1);
      tfBlocks[tfBlocks.length - 1].params = { b, a, n };
      stateInit.push(`state["tf_${id}"] = {"x": [0.0] * (MAX_DIM + 1), "y": [0.0] * MAX_DIM}`);
    }
    if (block.type === "noise") {
      stateInit.push(`state["rng_${id}"] = 1`);
    }
  });

  const getInputExpr = (blockId, idx, fallback = "0.0") => {
    const from = (inputs.get(blockId) || [])[idx];
    if (!from) return fallback;
    return `out.get("${sanitizeId(from)}", ${fallback})`;
  };

  const isSimpleExpr = (expr) => {
    const trimmed = String(expr || "").trim();
    if (!trimmed) return false;
    if (/^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(trimmed)) return true;
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed);
  };

  const wrapExpr = (expr) => (isSimpleExpr(expr) ? expr : `(${expr})`);

  const maxTfOrder = Math.max(
    1,
    ...tfBlocks.map((item) => Math.max(0, item.params?.n ?? 0))
  );
  constLines.push(`MAX_DIM = ${maxTfOrder}`);

  lpfBlocks.forEach(({ block, id }) => {
    const params = block.params || {};
    const fc = Math.max(0, resolveNumeric(params.cutoff, variables));
    const { b, a } = tustinDiscretize([2 * Math.PI * fc], [1, 2 * Math.PI * fc], dtVal);
    constLines.push(`LPF_COEFF_${id} = {"b0": ${b[0] || 0}, "b1": ${b[1] || 0}, "a1": ${a[1] || 0}}`);
  });

  hpfBlocks.forEach(({ block, id }) => {
    const params = block.params || {};
    const fc = Math.max(0, resolveNumeric(params.cutoff, variables));
    const { b, a } = tustinDiscretize([1, 0], [1, 2 * Math.PI * fc], dtVal);
    constLines.push(`HPF_COEFF_${id} = {"b0": ${b[0] || 0}, "b1": ${b[1] || 0}, "a1": ${a[1] || 0}}`);
  });

  const lines = [];
  lines.push("# Generated by Vibesim");
  lines.push("import math");
  if (hasSaturation) lines.push("import numpy as np");
  lines.push("");
  Object.entries(variables).forEach(([name, value]) => {
    const cname = sanitizeId(name.startsWith("\\") ? name.slice(1) : name);
    lines.push(`${cname} = ${Number(value) || 0}`);
  });
  if (Object.keys(variables).length) lines.push("");
  constLines.forEach((line) => lines.push(line));
  if (constLines.length) lines.push("");
  if (pidBlocks.length) {
    lines.push("def pid_step(params, state, u, dt):");
    lines.push("    state['integ'] += u * dt");
    lines.push("    deriv = (u - state['prev']) / max(dt, 1e-6)");
    lines.push("    state['prev'] = u");
    lines.push("    return params['kp'] * u + params['ki'] * state['integ'] + params['kd'] * deriv");
    lines.push("");
    pidBlocks.forEach(({ block, id }) => {
      const params = block.params || {};
      const kp = resolveNumeric(params.kp, variables);
      const ki = resolveNumeric(params.ki, variables);
      const kd = resolveNumeric(params.kd, variables);
      lines.push(`PID_PARAMS_${id} = {"kp": ${kp}, "ki": ${ki}, "kd": ${kd}}`);
    });
    lines.push("");
  }
  if (tfBlocks.length) {
    tfBlocks.forEach(({ id, params }) => {
      const b = (params?.b || []).slice();
      const a = (params?.a || []).slice();
      const n = Math.max(0, params?.n ?? 0);
      const bPad = Array(maxTfOrder + 1).fill(0);
      const aPad = Array(maxTfOrder + 1).fill(0);
      for (let i = 0; i <= n; i += 1) {
        bPad[i] = b[i] || 0;
        aPad[i] = a[i] || 0;
      }
      lines.push(`TF_PARAMS_${id} = {"n": ${n}, "b": ${JSON.stringify(bPad)}, "a": ${JSON.stringify(aPad)}}`);
    });
    lines.push("");
    lines.push("def tf_step(params, state, u):");
    lines.push("    n = params['n']");
    lines.push("    b = params['b']");
    lines.push("    a = params['a']");
    lines.push("    x = state['x']");
    lines.push("    y = state['y']");
    lines.push("    for i in range(n, 0, -1):");
    lines.push("        x[i] = x[i - 1]");
    lines.push("    x[0] = u");
    lines.push("    y0 = 0.0");
    lines.push("    for i in range(n + 1):");
    lines.push("        y0 += b[i] * x[i]");
    lines.push("    for i in range(1, n + 1):");
    lines.push("        y0 -= a[i] * y[i - 1]");
    lines.push("    if n > 0:");
    lines.push("        for i in range(n - 1, 0, -1):");
    lines.push("            y[i] = y[i - 1]");
    lines.push("        y[0] = y0");
    lines.push("    state['x'] = x");
    lines.push("    state['y'] = y");
    lines.push("    return y0");
    lines.push("");
  }
  if (delayBlocks.length) {
    lines.push("def delay_step(buf, idx, delay_samples, u):");
    lines.push("    if delay_samples < 0.0:");
    lines.push("        delay_samples = 0.0");
    lines.push("    n = len(buf)");
    lines.push("    if n < 2:");
    lines.push("        buf[idx % max(1, n)] = u");
    lines.push("        return 0.0, idx");
    lines.push("    d0 = int(delay_samples)");
    lines.push("    frac = delay_samples - d0");
    lines.push("    if d0 > n - 2:");
    lines.push("        d0 = n - 2");
    lines.push("        frac = 1.0");
    lines.push("    i0 = idx - d0");
    lines.push("    i1 = idx - d0 - 1");
    lines.push("    s0 = buf[i0 % n]");
    lines.push("    s1 = buf[i1 % n]");
    lines.push("    y = s0 * (1.0 - frac) + s1 * frac");
    lines.push("    buf[idx] = u");
    lines.push("    idx = (idx + 1) % n");
    lines.push("    return y, idx");
    lines.push("");
  }
  lines.push("def init_model_state():");
  lines.push("    state = {}");
  stateInit.forEach((line) => lines.push(`    ${line}`));
  lines.push("    return state");
  lines.push("");
  lines.push("def run_step_internal(state, inputs, outputs, t, dt=None):");
  lines.push(`    dt = ${dtVal} if dt is None else dt`);
  lines.push("    out = {}");

  order.forEach((id) => {
    const block = byId.get(id);
    if (!block) return;
    const bid = sanitizeId(block.id);
    const params = block.params || {};
    const type = block.type;
    const in0 = getInputExpr(block.id, 0, type === "mult" ? "1.0" : "0.0");
    const in1 = getInputExpr(block.id, 1, type === "mult" ? "1.0" : "0.0");
    const in2 = getInputExpr(block.id, 2, type === "mult" ? "1.0" : "0.0");
    const in0Expr = wrapExpr(in0);
    const in1Expr = wrapExpr(in1);
    const in2Expr = wrapExpr(in2);
    const inputsForBlock = inputs.get(block.id) || [];

    if (type === "labelSource") {
      const name = getLabelName(block);
      const sinkId = labelSinkByName.get(name);
      const sinkInputs = sinkId ? inputs.get(sinkId) || [] : [];
      const fromId = sinkInputs[0];
      if (sinkId) {
        lines.push(`    out["${bid}"] = out.get("${sanitizeId(fromId)}", 0.0) if "${sanitizeId(fromId)}" in out else 0.0`);
      } else {
        lines.push(`    out["${bid}"] = inputs.get("${name}", 0.0)`);
      }
      return;
    }

    if (type === "labelSink") {
      const name = getLabelName(block);
      lines.push(`    out["${bid}"] = ${in0Expr}`);
      lines.push(`    if outputs is not None: outputs["${name}"] = out["${bid}"]`);
      return;
    }

    if (type === "gain") {
      lines.push(`    out["${bid}"] = ${in0Expr} * ${resolveNumeric(params.gain, variables)}`);
      return;
    }

    if (type === "sum") {
      const signs = params.signs || [];
      const terms = [];
      [0, 1, 2].forEach((i) => {
        const from = inputsForBlock[i];
        if (!from) return;
        const sign = signs[i] == null ? 1 : Number(signs[i]) || 1;
        const expr = wrapExpr(`out.get("${sanitizeId(from)}", 0.0)`);
        if (sign === 1) terms.push(expr);
        else if (sign === -1) terms.push(`-${expr}`);
        else terms.push(`${expr} * ${sign}`);
      });
      if (!terms.length) terms.push("0.0");
      lines.push(`    out["${bid}"] = ${terms.join(" + ")}`);
      return;
    }

    if (type === "mult") {
      lines.push(`    out["${bid}"] = ${in0Expr} * ${in1Expr} * ${in2Expr}`);
      return;
    }
    if (type === "abs") {
      lines.push(`    out["${bid}"] = abs(${in0Expr})`);
      return;
    }
    if (type === "min") {
      lines.push(`    out["${bid}"] = min(${in0Expr}, ${in1Expr})`);
      return;
    }
    if (type === "max") {
      lines.push(`    out["${bid}"] = max(${in0Expr}, ${in1Expr})`);
      return;
    }

    if (type === "saturation") {
      lines.push(`    out["${bid}"] = np.clip(${in0Expr}, ${resolveNumeric(params.min, variables)}, ${resolveNumeric(params.max, variables)})`);
      return;
    }

    if (type === "tf") {
      lines.push(`    out["${bid}"] = tf_step(TF_PARAMS_${bid}, state["tf_${bid}"], ${in0Expr})`);
      return;
    }

    if (type === "constant") {
      lines.push(`    out["${bid}"] = ${resolveNumeric(params.value, variables)}`);
      return;
    }
    if (type === "step") {
      lines.push(`    out["${bid}"] = 1.0 if t >= ${resolveNumeric(params.stepTime, variables)} else 0.0`);
      return;
    }
    if (type === "ramp") {
      const start = resolveNumeric(params.start, variables);
      const slope = resolveNumeric(params.slope, variables);
      lines.push(`    out["${bid}"] = (t - ${start}) * ${slope} if t >= ${start} else 0.0`);
      return;
    }
    if (type === "impulse") {
      lines.push(`    out["${bid}"] = (${resolveNumeric(params.amp, variables)} / max(dt, 1e-6)) if abs(t - ${resolveNumeric(params.time, variables)}) <= dt * 0.5 else 0.0`);
      return;
    }
    if (type === "sine") {
      lines.push(`    out["${bid}"] = ${resolveNumeric(params.amp, variables)} * math.sin(2.0 * math.pi * ${resolveNumeric(params.freq, variables)} * t + ${resolveNumeric(params.phase, variables)})`);
      return;
    }
    if (type === "chirp") {
      const f0 = resolveNumeric(params.f0, variables);
      const f1 = resolveNumeric(params.f1, variables);
      const t1 = Math.max(0.001, resolveNumeric(params.t1, variables) || 1);
      lines.push(`    k = (${f1} - ${f0}) / ${t1}`);
      lines.push(`    out["${bid}"] = ${resolveNumeric(params.amp, variables)} * math.sin(2.0 * math.pi * (${f0} * t + 0.5 * k * t * t))`);
      return;
    }
    if (type === "noise") {
      lines.push(`    state["rng_${bid}"] = (1664525 * state["rng_${bid}"] + 1013904223) & 0xFFFFFFFF`);
      lines.push(`    out["${bid}"] = ${resolveNumeric(params.amp, variables)} * ((state["rng_${bid}"] / 4294967295.0) * 2.0 - 1.0)`);
      return;
    }
    if (type === "fileSource") {
      lines.push(`    out["${bid}"] = 0.0  # TODO: file source`);
      return;
    }
    if (type === "integrator") {
      lines.push(`    state["int_${bid}"] += ${in0Expr} * dt`);
      lines.push(`    out["${bid}"] = state["int_${bid}"]`);
      return;
    }
    if (type === "derivative") {
      lines.push(`    out["${bid}"] = (${in0Expr} - state["der_prev_${bid}"]) / max(dt, 1e-6)`);
      lines.push(`    state["der_prev_${bid}"] = ${in0Expr}`);
      return;
    }
    if (type === "delay") {
      const delayInfo = delayBlocks.find((item) => item.id === bid);
      const delaySamples = delayInfo?.delaySamples ?? 0;
      lines.push(`    buf = state["delay_buf_${bid}"]`);
      lines.push(`    idx = state["delay_idx_${bid}"]`);
      lines.push(`    out["${bid}"], idx = delay_step(buf, idx, ${delaySamples}, ${in0Expr})`);
      lines.push(`    state["delay_idx_${bid}"] = idx`);
      return;
    }
    if (type === "ddelay") {
      const steps = Math.max(1, Math.round(resolveNumeric(params.steps, variables) || 1));
      const ts = Math.max(0.001, resolveNumeric(params.ts, variables) || 0.1);
      lines.push(`    out["${bid}"] = state["ddelay_last_${bid}"]`);
      lines.push(`    if t + 1e-6 >= state["ddelay_next_${bid}"]:`); 
      lines.push(`        buf = state["ddelay_buf_${bid}"]`);
      lines.push(`        for i in range(${steps - 1}): buf[i] = buf[i + 1]`);
      lines.push(`        buf[${steps - 1}] = ${in0Expr}`);
      lines.push(`        state["ddelay_last_${bid}"] = buf[0]`);
      lines.push(`        state["ddelay_next_${bid}"] = t + ${ts}`);
      return;
    }
    if (type === "rate") {
      const rise = Math.max(0, resolveNumeric(params.rise, variables));
      const fall = Math.max(0, resolveNumeric(params.fall, variables));
      lines.push(`    v = ${in0Expr}`);
      lines.push(`    max_rise = state["rate_${bid}"] + ${rise} * dt`);
      lines.push(`    max_fall = state["rate_${bid}"] - ${fall} * dt`);
      lines.push(`    if v > max_rise: v = max_rise`);
      lines.push(`    if v < max_fall: v = max_fall`);
      lines.push(`    state["rate_${bid}"] = v`);
      lines.push(`    out["${bid}"] = v`);
      return;
    }
    if (type === "backlash") {
      const width = Math.max(0, resolveNumeric(params.width, variables));
      lines.push(`    v = ${in0Expr}`);
      lines.push(`    if v > state["backlash_${bid}"] + ${width} / 2.0: state["backlash_${bid}"] = v - ${width} / 2.0`);
      lines.push(`    if v < state["backlash_${bid}"] - ${width} / 2.0: state["backlash_${bid}"] = v + ${width} / 2.0`);
      lines.push(`    out["${bid}"] = state["backlash_${bid}"]`);
      return;
    }
    if (type === "lpf") {
      lines.push(`    coeff = LPF_COEFF_${bid}`);
      lines.push(`    y = coeff["b0"] * ${in0Expr} + coeff["b1"] * state["lpf_x1_${bid}"] - coeff["a1"] * state["lpf_y1_${bid}"]`);
      lines.push(`    state["lpf_x1_${bid}"] = ${in0Expr}`);
      lines.push(`    state["lpf_y1_${bid}"] = y`);
      lines.push(`    out["${bid}"] = y`);
      return;
    }
    if (type === "hpf") {
      lines.push(`    coeff = HPF_COEFF_${bid}`);
      lines.push(`    y = coeff["b0"] * ${in0Expr} + coeff["b1"] * state["hpf_x1_${bid}"] - coeff["a1"] * state["hpf_y1_${bid}"]`);
      lines.push(`    state["hpf_x1_${bid}"] = ${in0Expr}`);
      lines.push(`    state["hpf_y1_${bid}"] = y`);
      lines.push(`    out["${bid}"] = y`);
      return;
    }
    if (type === "pid") {
      const kp = resolveNumeric(params.kp, variables);
      const ki = resolveNumeric(params.ki, variables);
      const kd = resolveNumeric(params.kd, variables);
      lines.push(`    out["${bid}"] = pid_step(PID_PARAMS_${bid}, state["pid_${bid}"], ${in0Expr}, dt)`);
      return;
    }
    if (type === "zoh") {
      const ts = Math.max(0.001, resolveNumeric(params.ts, variables) || resolveNumeric(sampleTime, variables));
      lines.push(`    out["${bid}"] = state["zoh_last_${bid}"]`);
      lines.push(`    if t + 1e-6 >= state["zoh_next_${bid}"]:`); 
      lines.push(`        state["zoh_last_${bid}"] = ${in0Expr}`);
      lines.push(`        state["zoh_next_${bid}"] = t + ${ts}`);
      return;
    }
    if (type === "foh") {
      const ts = Math.max(0.001, resolveNumeric(params.ts, variables) || resolveNumeric(sampleTime, variables));
      lines.push(`    slope = (state["foh_last_${bid}"] - state["foh_prev_${bid}"]) / ${ts}`);
      lines.push(`    state["foh_out_${bid}"] = state["foh_last_${bid}"] + slope * (t - state["foh_last_t_${bid}"])`);
      lines.push(`    out["${bid}"] = state["foh_out_${bid}"]`);
      lines.push(`    if t + 1e-6 >= state["foh_next_${bid}"]:`); 
      lines.push(`        state["foh_prev_${bid}"] = state["foh_last_${bid}"]`);
      lines.push(`        state["foh_last_${bid}"] = ${in0Expr}`);
      lines.push(`        state["foh_last_t_${bid}"] = t`);
      lines.push(`        state["foh_next_${bid}"] = t + ${ts}`);
      return;
    }
    if (type === "dtf") {
      const ts = Math.max(0.001, resolveNumeric(params.ts, variables) || resolveNumeric(sampleTime, variables));
      lines.push(`    out["${bid}"] = state["dtf_y_${bid}"][0] if state["dtf_y_${bid}"] else 0.0`);
      lines.push(`    if t + 1e-6 >= state["dtf_next_${bid}"]:`); 
      lines.push(`        xhist = state["dtf_x_${bid}"]`);
      lines.push(`        yhist = state["dtf_y_${bid}"]`);
      lines.push(`        num = state["dtf_num_${bid}"]`);
      lines.push(`        den = state["dtf_den_${bid}"]`);
      lines.push(`        for i in range(len(xhist) - 1, 0, -1): xhist[i] = xhist[i - 1]`);
      lines.push(`        xhist[0] = ${in0Expr}`);
      lines.push(`        y = 0.0`);
      lines.push(`        for i in range(len(num)): y += num[i] * xhist[i]`);
      lines.push(`        for i in range(1, len(den)): y -= den[i] * yhist[i - 1]`);
      lines.push(`        if yhist:`);
      lines.push(`            for i in range(len(yhist) - 1, 0, -1): yhist[i] = yhist[i - 1]`);
      lines.push(`            yhist[0] = y`);
      lines.push(`        state["dtf_next_${bid}"] = t + ${ts}`);
      return;
    }
    if (type === "stateSpace") {
      const A = resolveNumeric(params.A, variables);
      const B = resolveNumeric(params.B, variables);
      const C = resolveNumeric(params.C, variables);
      const D = resolveNumeric(params.D, variables);
      lines.push(`    state["ss_x_${bid}"] += dt * (${A} * state["ss_x_${bid}"] + ${B} * ${in0Expr})`);
      lines.push(`    out["${bid}"] = ${C} * state["ss_x_${bid}"] + ${D} * ${in0Expr}`);
      return;
    }
    if (type === "dstateSpace") {
      const A = resolveNumeric(params.A, variables);
      const B = resolveNumeric(params.B, variables);
      const C = resolveNumeric(params.C, variables);
      const D = resolveNumeric(params.D, variables);
      const ts = Math.max(0.001, resolveNumeric(params.ts, variables) || resolveNumeric(sampleTime, variables));
      lines.push(`    out["${bid}"] = state["dss_last_${bid}"]`);
      lines.push(`    if t + 1e-6 >= state["dss_next_${bid}"]:`); 
      lines.push(`        state["dss_x_${bid}"] = ${A} * state["dss_x_${bid}"] + ${B} * ${in0Expr}`);
      lines.push(`        state["dss_last_${bid}"] = ${C} * state["dss_x_${bid}"] + ${D} * ${in0Expr}`);
      lines.push(`        state["dss_next_${bid}"] = t + ${ts}`);
      return;
    }
    if (type === "scope" || type === "fileSink") {
      lines.push(`    out["${bid}"] = ${in0Expr}`);
      return;
    }

    lines.push(`    out["${bid}"] = 0.0  # TODO: ${type}`);
  });

  lines.push("    return out");
  lines.push("");
  lines.push("def run_step(state, inputs=None, outputs=None, t=0.0, dt=None):");
  lines.push("    return run_step_internal(state, inputs or {}, outputs, t, dt)");
  lines.push("");
  if (includeMain) {
    lines.push("def _read_input_csv(path):");
    lines.push("    import csv");
    lines.push("    if not path:");
    lines.push("        return [], []");
    lines.push("    with open(path, newline='') as f:");
    lines.push("        reader = csv.DictReader(f)");
    lines.push("        times = []");
    lines.push("        rows = []");
    lines.push("        for row in reader:");
    lines.push("            t = float(row.get('t', row.get('time', 0.0)) or 0.0)");
    lines.push("            vals = {}");
    inputNames.forEach((name) => {
      lines.push(`            vals["${name}"] = float(row.get("${name}", 0.0) or 0.0)`);
    });
    if (!inputNames.length) {
      lines.push("            vals['_unused'] = 0.0");
    }
    lines.push("            times.append(t)");
    lines.push("            rows.append(vals)");
    lines.push("    return times, rows");
    lines.push("");
    lines.push("def _write_output_header(writer):");
    lines.push("    header = ['t']");
    outputNames.forEach((name) => {
      lines.push(`    header.append("${name}")`);
    });
    if (!outputNames.length) {
      lines.push("    header.append('_unused')");
    }
    lines.push("    writer.writerow(header)");
    lines.push("");
    lines.push("def main(argv=None):");
    lines.push("    import argparse, sys, csv");
    lines.push("    parser = argparse.ArgumentParser()");
    lines.push(`    parser.add_argument('-t', type=float, default=${mainDuration})`);
    lines.push("    parser.add_argument('-i', dest='input', default=None)");
    lines.push("    parser.add_argument('-o', dest='output', default=None)");
    lines.push("    args = parser.parse_args(argv)");
    lines.push(`    dt = ${resolveNumeric(sampleTime, variables) || 0.01}`);
    lines.push("    state = init_model_state()");
    lines.push("    times, rows = _read_input_csv(args.input)");
    lines.push("    idx = 0");
    lines.push("    out_f = open(args.output, 'w', newline='') if args.output else sys.stdout");
    lines.push("    writer = csv.writer(out_f)");
    lines.push("    _write_output_header(writer)");
    lines.push("    t = 0.0");
    lines.push("    while t <= args.t + 1e-9:");
    lines.push("        if times:");
    lines.push("            while idx + 1 < len(times) and times[idx + 1] <= t:");
    lines.push("                idx += 1");
    lines.push("            inputs = rows[idx]");
    lines.push("        else:");
    lines.push("            inputs = {}");
    lines.push("        outputs = {}");
    lines.push("        run_step(state, inputs, outputs, t)");
    lines.push("        row = [f'{t:.6f}']");
    outputNames.forEach((name) => {
      lines.push(`        row.append(f\"{outputs.get('${name}', 0.0):.6f}\")`);
    });
    if (!outputNames.length) {
      lines.push("        row.append('0.000000')");
    }
    lines.push("        writer.writerow(row)");
    lines.push("        t += dt");
    lines.push("    if args.output: out_f.close()");
    lines.push("");
    lines.push("if __name__ == '__main__':");
    lines.push("    main()");
    lines.push("");
  }
  return lines.join("\n");
};
