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

const buildTfModel = (numArr, denArr) => {
  const { trimmed: numNorm } = normalizePoly(numArr);
  const { trimmed: denNorm, allZero: denAllZero } = normalizePoly(denArr);
  if (denAllZero) return null;
  const a0 = denNorm[0] || 1;
  const denScaled = denNorm.map((v) => v / a0);
  const n = denNorm.length - 1;
  if (n === 0) {
    const gain = (numNorm[0] || 0) / a0;
    return { n: 0, A: [], B: [], C: [], D: gain };
  }
  const numPadded = Array(n + 1 - numNorm.length).fill(0).concat(numNorm);
  const a = denScaled.slice(1);
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
  return { n, A, B, C, D };
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
  const order = blocks.map((block) => block.id);

  const stateInit = [];
  blocks.forEach((block) => {
    const id = sanitizeId(block.id);
    const params = block.params || {};
    stateInit.push(`state["out_${id}"] = 0.0`);
    if (block.type === "integrator") stateInit.push(`state["int_${id}"] = 0.0`);
    if (block.type === "derivative") {
      stateInit.push(`state["der_prev_${id}"] = 0.0`);
      stateInit.push(`state["der_out_${id}"] = 0.0`);
    }
    if (block.type === "rate") stateInit.push(`state["rate_${id}"] = 0.0`);
    if (block.type === "backlash") stateInit.push(`state["backlash_${id}"] = 0.0`);
    if (block.type === "lpf") stateInit.push(`state["lpf_${id}"] = 0.0`);
    if (block.type === "hpf") {
      stateInit.push(`state["hpf_${id}"] = 0.0`);
      stateInit.push(`state["hpf_out_${id}"] = 0.0`);
    }
    if (block.type === "pid") {
      stateInit.push(`state["pid_int_${id}"] = 0.0`);
      stateInit.push(`state["pid_prev_${id}"] = 0.0`);
      stateInit.push(`state["pid_out_${id}"] = 0.0`);
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
      const steps = Math.max(1, Math.round(resolveNumeric(params.delay, variables) / Number(sampleTime || 0.01)));
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
      const num = parseList(params.num, variables);
      const den = parseList(params.den, variables);
      const model = buildTfModel(num, den);
      const n = model?.n ?? 0;
      stateInit.push(`state["tf_x_${id}"] = [0.0] * ${n}`);
      stateInit.push(`state["tf_out_${id}"] = 0.0`);
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

  const lines = [];
  lines.push("# Generated by Vibesim");
  lines.push("import math");
  lines.push("");
  Object.entries(variables).forEach(([name, value]) => {
    const cname = sanitizeId(name.startsWith("\\") ? name.slice(1) : name);
    lines.push(`${cname} = ${Number(value) || 0}`);
  });
  if (Object.keys(variables).length) lines.push("");
  lines.push("def init_model_state():");
  lines.push("    state = {}");
  stateInit.forEach((line) => lines.push(`    ${line}`));
  lines.push("    return state");
  lines.push("");
  lines.push("def run_step_internal(state, inputs, outputs, t, dt=None):");
  lines.push(`    dt = ${resolveNumeric(sampleTime, variables) || 0.01} if dt is None else dt`);
  lines.push("    out = {}");

  const outputLines = [];
  const updateLines = [];
  const algebraicLines = [];
  const labelResolveLines = [];
  const labelSinkLines = [];

  order.forEach((id) => {
    const block = byId.get(id);
    if (!block) return;
    const bid = sanitizeId(block.id);
    const params = block.params || {};
    const type = block.type;
    const in0 = getInputExpr(block.id, 0, type === "mult" ? "1.0" : "0.0");
    const in1 = getInputExpr(block.id, 1, type === "mult" ? "1.0" : "0.0");
    const in2 = getInputExpr(block.id, 2, type === "mult" ? "1.0" : "0.0");
    const inputsForBlock = inputs.get(block.id) || [];

    if (type === "labelSource") {
      const name = getLabelName(block);
      const sinkId = labelSinkByName.get(name);
      if (sinkId) {
        const sinkInputs = inputs.get(sinkId) || [];
        const fromId = sinkInputs[0];
        if (fromId) {
          labelResolveLines.push(`if "${sanitizeId(fromId)}" in out:`);
          labelResolveLines.push(`    prev = out.get("${bid}")`);
          labelResolveLines.push(`    out["${bid}"] = out.get("${sanitizeId(fromId)}", 0.0)`);
          labelResolveLines.push(`    if prev != out["${bid}"]: updated = True`);
        } else {
          labelResolveLines.push(`prev = out.get("${bid}")`);
          labelResolveLines.push(`out["${bid}"] = 0.0`);
          labelResolveLines.push(`if prev != out["${bid}"]: updated = True`);
        }
      } else {
        labelResolveLines.push(`prev = out.get("${bid}")`);
        labelResolveLines.push(`out["${bid}"] = 0.0`);
        labelResolveLines.push(`if prev != out["${bid}"]: updated = True`);
      }
      outputLines.push(`out["${bid}"] = 0.0`);
      return;
    }

    if (type === "labelSink") {
      const name = getLabelName(block);
      labelSinkLines.push(`out["${bid}"] = ${in0}`);
      labelSinkLines.push(`if outputs is not None: outputs["${name}"] = out["${bid}"]`);
      return;
    }

    if (type === "gain") {
      const fromId = inputsForBlock[0];
      if (fromId) {
        algebraicLines.push(`if "${sanitizeId(fromId)}" in out:`);
        algebraicLines.push(`    prev = out.get("${bid}")`);
        algebraicLines.push(`    out["${bid}"] = out.get("${sanitizeId(fromId)}", 0.0) * ${resolveNumeric(params.gain, variables)}`);
        algebraicLines.push(`    if prev != out["${bid}"]: updated = True`);
      }
      return;
    }

    if (type === "sum") {
      const signs = params.signs || [];
      const checks = [];
      const terms = [0, 1, 2].map((i) => {
        const fromId = inputsForBlock[i];
        const sign = signs[i] == null ? 1 : Number(signs[i]) || 1;
        if (fromId) {
          checks.push(`if "${sanitizeId(fromId)}" not in out: missing = True`);
          return `out.get("${sanitizeId(fromId)}", 0.0) * ${sign}`;
        }
        return `0.0`;
      });
      algebraicLines.push("missing = False");
      checks.forEach((line) => algebraicLines.push(line));
      algebraicLines.push("if not missing:");
      algebraicLines.push(`    prev = out.get("${bid}")`);
      algebraicLines.push(`    out["${bid}"] = ${terms.join(" + ")}`);
      algebraicLines.push(`    if prev != out["${bid}"]: updated = True`);
      return;
    }

    if (type === "mult") {
      const missingChecks = [];
      const factors = [0, 1, 2].map((i) => {
        const fromId = inputsForBlock[i];
        if (!fromId) {
          missingChecks.push("missing = True");
          return "1.0";
        }
        missingChecks.push(`if "${sanitizeId(fromId)}" not in out: missing = True`);
        return `out.get("${sanitizeId(fromId)}", 1.0)`;
      });
      algebraicLines.push("missing = False");
      missingChecks.forEach((line) => algebraicLines.push(line));
      algebraicLines.push("if not missing:");
      algebraicLines.push(`    prev = out.get("${bid}")`);
      algebraicLines.push(`    out["${bid}"] = ${factors.join(" * ")}`);
      algebraicLines.push(`    if prev != out["${bid}"]: updated = True`);
      return;
    }

    if (type === "saturation") {
      const fromId = inputsForBlock[0];
      if (fromId) {
        algebraicLines.push(`if "${sanitizeId(fromId)}" in out:`);
        algebraicLines.push(`    prev = out.get("${bid}")`);
        algebraicLines.push(`    v = out.get("${sanitizeId(fromId)}", 0.0)`);
        algebraicLines.push(`    v = min(${resolveNumeric(params.max, variables)}, max(${resolveNumeric(params.min, variables)}, v))`);
        algebraicLines.push(`    out["${bid}"] = v`);
        algebraicLines.push(`    if prev != out["${bid}"]: updated = True`);
      }
      return;
    }

    if (type === "tf") {
      const num = parseList(params.num, variables);
      const den = parseList(params.den, variables);
      const model = buildTfModel(num, den);
      const n = model?.n ?? 0;
      const A = model?.A ?? [];
      const B = model?.B ?? [];
      const C = model?.C ?? [];
      const D = model?.D ?? 0;
      if (n === 0) {
        algebraicLines.push(`prev = out.get("${bid}")`);
        algebraicLines.push(`out["${bid}"] = ${D} * (${in0})`);
        algebraicLines.push(`if prev != out["${bid}"]: updated = True`);
        return;
      }
      outputLines.push(`x = state["tf_x_${bid}"]`);
      outputLines.push(`C = ${JSON.stringify(C)}`);
      outputLines.push(`out["${bid}"] = ${D} * (${in0}) + sum(C[i] * x[i] for i in range(${n}))`);
      updateLines.push(`x = state["tf_x_${bid}"]`);
      updateLines.push(`A = ${JSON.stringify(A)}`);
      updateLines.push(`B = ${JSON.stringify(B)}`);
      updateLines.push(`k1 = [sum(A[i][j] * x[j] for j in range(${n})) + B[i] * (${in0}) for i in range(${n})]`);
      updateLines.push(`x2 = [x[i] + 0.5 * dt * k1[i] for i in range(${n})]`);
      updateLines.push(`k2 = [sum(A[i][j] * x2[j] for j in range(${n})) + B[i] * (${in0}) for i in range(${n})]`);
      updateLines.push(`x3 = [x[i] + 0.5 * dt * k2[i] for i in range(${n})]`);
      updateLines.push(`k3 = [sum(A[i][j] * x3[j] for j in range(${n})) + B[i] * (${in0}) for i in range(${n})]`);
      updateLines.push(`x4 = [x[i] + dt * k3[i] for i in range(${n})]`);
      updateLines.push(`k4 = [sum(A[i][j] * x4[j] for j in range(${n})) + B[i] * (${in0}) for i in range(${n})]`);
      updateLines.push(`for i in range(${n}): x[i] += (dt / 6.0) * (k1[i] + 2.0 * k2[i] + 2.0 * k3[i] + k4[i])`);
      updateLines.push(`state["tf_x_${bid}"] = x`);
      return;
    }

    if (type === "constant") {
      outputLines.push(`out["${bid}"] = ${resolveNumeric(params.value, variables)}`);
      return;
    }
    if (type === "step") {
      outputLines.push(`out["${bid}"] = 1.0 if t >= ${resolveNumeric(params.stepTime, variables)} else 0.0`);
      return;
    }
    if (type === "ramp") {
      const start = resolveNumeric(params.start, variables);
      const slope = resolveNumeric(params.slope, variables);
      outputLines.push(`out["${bid}"] = (t - ${start}) * ${slope} if t >= ${start} else 0.0`);
      return;
    }
    if (type === "impulse") {
      outputLines.push(`out["${bid}"] = (${resolveNumeric(params.amp, variables)} / max(dt, 1e-6)) if abs(t - ${resolveNumeric(params.time, variables)}) <= dt * 0.5 else 0.0`);
      return;
    }
    if (type === "sine") {
      outputLines.push(`out["${bid}"] = ${resolveNumeric(params.amp, variables)} * math.sin(2.0 * math.pi * ${resolveNumeric(params.freq, variables)} * t + ${resolveNumeric(params.phase, variables)})`);
      return;
    }
    if (type === "chirp") {
      const f0 = resolveNumeric(params.f0, variables);
      const f1 = resolveNumeric(params.f1, variables);
      const t1 = Math.max(0.001, resolveNumeric(params.t1, variables) || 1);
      outputLines.push(`k = (${f1} - ${f0}) / ${t1}`);
      outputLines.push(`out["${bid}"] = ${resolveNumeric(params.amp, variables)} * math.sin(2.0 * math.pi * (${f0} * t + 0.5 * k * t * t))`);
      return;
    }
    if (type === "noise") {
      outputLines.push(`state["rng_${bid}"] = (1664525 * state["rng_${bid}"] + 1013904223) & 0xFFFFFFFF`);
      outputLines.push(`out["${bid}"] = ${resolveNumeric(params.amp, variables)} * ((state["rng_${bid}"] / 4294967295.0) * 2.0 - 1.0)`);
      return;
    }
    if (type === "fileSource") {
      outputLines.push(`out["${bid}"] = 0.0  # TODO: file source`);
      return;
    }
    if (type === "integrator") {
      outputLines.push(`out["${bid}"] = state["int_${bid}"]`);
      updateLines.push(`state["int_${bid}"] += (${in0}) * dt`);
      return;
    }
    if (type === "derivative") {
      outputLines.push(`out["${bid}"] = state["der_out_${bid}"]`);
      updateLines.push(`state["der_out_${bid}"] = (${in0} - state["der_prev_${bid}"]) / max(dt, 1e-6)`);
      updateLines.push(`state["der_prev_${bid}"] = ${in0}`);
      return;
    }
    if (type === "delay") {
      outputLines.push(`buf = state["delay_buf_${bid}"]`);
      outputLines.push(`idx = state["delay_idx_${bid}"]`);
      outputLines.push(`out["${bid}"] = buf[idx]`);
      updateLines.push(`buf = state["delay_buf_${bid}"]`);
      updateLines.push(`idx = state["delay_idx_${bid}"]`);
      updateLines.push(`buf[idx] = ${in0}`);
      updateLines.push(`state["delay_idx_${bid}"] = (idx + 1) % len(buf)`);
      return;
    }
    if (type === "ddelay") {
      const steps = Math.max(1, Math.round(resolveNumeric(params.steps, variables) || 1));
      const ts = Math.max(0.001, resolveNumeric(params.ts, variables) || 0.1);
      outputLines.push(`out["${bid}"] = state["ddelay_last_${bid}"]`);
      updateLines.push(`if t + 1e-6 >= state["ddelay_next_${bid}"]:`); 
      updateLines.push(`    buf = state["ddelay_buf_${bid}"]`);
      updateLines.push(`    for i in range(${steps - 1}): buf[i] = buf[i + 1]`);
      updateLines.push(`    buf[${steps - 1}] = ${in0}`);
      updateLines.push(`    state["ddelay_last_${bid}"] = buf[0]`);
      updateLines.push(`    state["ddelay_next_${bid}"] = t + ${ts}`);
      return;
    }
    if (type === "rate") {
      const rise = Math.max(0, resolveNumeric(params.rise, variables));
      const fall = Math.max(0, resolveNumeric(params.fall, variables));
      outputLines.push(`out["${bid}"] = state["rate_${bid}"]`);
      updateLines.push(`v = ${in0}`);
      updateLines.push(`max_rise = state["rate_${bid}"] + ${rise} * dt`);
      updateLines.push(`max_fall = state["rate_${bid}"] - ${fall} * dt`);
      updateLines.push(`if v > max_rise: v = max_rise`);
      updateLines.push(`if v < max_fall: v = max_fall`);
      updateLines.push(`state["rate_${bid}"] = v`);
      return;
    }
    if (type === "backlash") {
      const width = Math.max(0, resolveNumeric(params.width, variables));
      outputLines.push(`out["${bid}"] = state["backlash_${bid}"]`);
      updateLines.push(`v = ${in0}`);
      updateLines.push(`if v > state["backlash_${bid}"] + ${width} / 2.0: state["backlash_${bid}"] = v - ${width} / 2.0`);
      updateLines.push(`if v < state["backlash_${bid}"] - ${width} / 2.0: state["backlash_${bid}"] = v + ${width} / 2.0`);
      return;
    }
    if (type === "lpf") {
      const fc = Math.max(0, resolveNumeric(params.cutoff, variables));
      outputLines.push(`out["${bid}"] = state["lpf_${bid}"]`);
      updateLines.push(`state["lpf_${bid}"] += dt * (2.0 * math.pi * ${fc}) * (${in0} - state["lpf_${bid}"])`);
      return;
    }
    if (type === "hpf") {
      const fc = Math.max(0, resolveNumeric(params.cutoff, variables));
      outputLines.push(`out["${bid}"] = state["hpf_out_${bid}"]`);
      updateLines.push(`state["hpf_${bid}"] += dt * (2.0 * math.pi * ${fc}) * (${in0} - state["hpf_${bid}"])`);
      updateLines.push(`state["hpf_out_${bid}"] = ${in0} - state["hpf_${bid}"]`);
      return;
    }
    if (type === "pid") {
      const kp = resolveNumeric(params.kp, variables);
      const ki = resolveNumeric(params.ki, variables);
      const kd = resolveNumeric(params.kd, variables);
      outputLines.push(`out["${bid}"] = state["pid_out_${bid}"]`);
      updateLines.push(`v = ${in0}`);
      updateLines.push(`state["pid_int_${bid}"] += v * dt`);
      updateLines.push(`deriv = (v - state["pid_prev_${bid}"]) / max(dt, 1e-6)`);
      updateLines.push(`state["pid_out_${bid}"] = ${kp} * v + ${ki} * state["pid_int_${bid}"] + ${kd} * deriv`);
      updateLines.push(`state["pid_prev_${bid}"] = v`);
      return;
    }
    if (type === "zoh") {
      const ts = Math.max(0.001, resolveNumeric(params.ts, variables) || resolveNumeric(sampleTime, variables));
      outputLines.push(`out["${bid}"] = state["zoh_last_${bid}"]`);
      updateLines.push(`if t + 1e-6 >= state["zoh_next_${bid}"]:`); 
      updateLines.push(`    state["zoh_last_${bid}"] = ${in0}`);
      updateLines.push(`    state["zoh_next_${bid}"] = t + ${ts}`);
      return;
    }
    if (type === "foh") {
      const ts = Math.max(0.001, resolveNumeric(params.ts, variables) || resolveNumeric(sampleTime, variables));
      outputLines.push(`out["${bid}"] = state["foh_out_${bid}"]`);
      updateLines.push(`slope = (state["foh_last_${bid}"] - state["foh_prev_${bid}"]) / ${ts}`);
      updateLines.push(`state["foh_out_${bid}"] = state["foh_last_${bid}"] + slope * (t - state["foh_last_t_${bid}"])`);
      updateLines.push(`if t + 1e-6 >= state["foh_next_${bid}"]:`); 
      updateLines.push(`    state["foh_prev_${bid}"] = state["foh_last_${bid}"]`);
      updateLines.push(`    state["foh_last_${bid}"] = ${in0}`);
      updateLines.push(`    state["foh_last_t_${bid}"] = t`);
      updateLines.push(`    state["foh_next_${bid}"] = t + ${ts}`);
      return;
    }
    if (type === "dtf") {
      const ts = Math.max(0.001, resolveNumeric(params.ts, variables) || resolveNumeric(sampleTime, variables));
      outputLines.push(`out["${bid}"] = state["dtf_y_${bid}"][0] if state["dtf_y_${bid}"] else 0.0`);
      updateLines.push(`if t + 1e-6 >= state["dtf_next_${bid}"]:`); 
      updateLines.push(`    xhist = state["dtf_x_${bid}"]`);
      updateLines.push(`    yhist = state["dtf_y_${bid}"]`);
      updateLines.push(`    num = state["dtf_num_${bid}"]`);
      updateLines.push(`    den = state["dtf_den_${bid}"]`);
      updateLines.push(`    for i in range(len(xhist) - 1, 0, -1): xhist[i] = xhist[i - 1]`);
      updateLines.push(`    xhist[0] = ${in0}`);
      updateLines.push(`    y = 0.0`);
      updateLines.push(`    for i in range(len(num)): y += num[i] * xhist[i]`);
      updateLines.push(`    for i in range(1, len(den)): y -= den[i] * yhist[i - 1]`);
      updateLines.push(`    if yhist:`);
      updateLines.push(`        for i in range(len(yhist) - 1, 0, -1): yhist[i] = yhist[i - 1]`);
      updateLines.push(`        yhist[0] = y`);
      updateLines.push(`    state["dtf_next_${bid}"] = t + ${ts}`);
      return;
    }
    if (type === "stateSpace") {
      const A = resolveNumeric(params.A, variables);
      const B = resolveNumeric(params.B, variables);
      const C = resolveNumeric(params.C, variables);
      const D = resolveNumeric(params.D, variables);
      outputLines.push(`out["${bid}"] = state["ss_out_${bid}"]`);
      updateLines.push(`state["ss_x_${bid}"] += dt * (${A} * state["ss_x_${bid}"] + ${B} * (${in0}))`);
      updateLines.push(`state["ss_out_${bid}"] = ${C} * state["ss_x_${bid}"] + ${D} * (${in0})`);
      return;
    }
    if (type === "dstateSpace") {
      const A = resolveNumeric(params.A, variables);
      const B = resolveNumeric(params.B, variables);
      const C = resolveNumeric(params.C, variables);
      const D = resolveNumeric(params.D, variables);
      const ts = Math.max(0.001, resolveNumeric(params.ts, variables) || resolveNumeric(sampleTime, variables));
      outputLines.push(`out["${bid}"] = state["dss_last_${bid}"]`);
      updateLines.push(`if t + 1e-6 >= state["dss_next_${bid}"]:`); 
      updateLines.push(`    state["dss_x_${bid}"] = ${A} * state["dss_x_${bid}"] + ${B} * (${in0})`);
      updateLines.push(`    state["dss_last_${bid}"] = ${C} * state["dss_x_${bid}"] + ${D} * (${in0})`);
      updateLines.push(`    state["dss_next_${bid}"] = t + ${ts}`);
      return;
    }
    if (type === "scope" || type === "fileSink") {
      outputLines.push(`out["${bid}"] = ${in0}`);
      return;
    }

    outputLines.push(`out["${bid}"] = 0.0  # TODO: ${type}`);
  });

  outputLines.forEach((line) => lines.push(`    ${line}`));
  lines.push("    for _ in range(50):");
  lines.push("        updated = False");
  labelResolveLines.forEach((line) => lines.push(`        ${line}`));
  algebraicLines.forEach((line) => lines.push(`        ${line}`));
  lines.push("        if not updated:");
  lines.push("            break");
  labelSinkLines.forEach((line) => lines.push(`    ${line}`));
  updateLines.forEach((line) => lines.push(`    ${line}`));
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
