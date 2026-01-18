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

const buildDiscreteTf = (numArr, denArr) => {
  const { trimmed: numNorm } = normalizePoly(numArr);
  const { trimmed: denNorm, allZero: denAllZero } = normalizePoly(denArr);
  const safeDen = denAllZero ? [1] : denNorm;
  const a0 = safeDen[0] || 1;
  return {
    num: (numNorm.length ? numNorm : [0]).map((v) => v / a0),
    den: safeDen.map((v) => v / a0),
  };
};

export const generateC = (diagram, { sampleTime = 0.01, includeMain = true } = {}) => {
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
  const labelSourceMappings = labelSources.map((block) => {
    const name = getLabelName(block);
    const sinkId = labelSinkByName.get(name);
    const sinkInput = sinkId ? (inputs.get(sinkId) || [])[0] : null;
    return {
      id: block.id,
      name,
      sinkId,
      sinkInput,
    };
  });
  const extraEdges = [];
  labelSources.forEach((block) => {
    const name = getLabelName(block);
    const sinkId = labelSinkByName.get(name);
    if (!sinkId) return;
    const fromId = (inputs.get(sinkId) || [])[0];
    if (fromId) extraEdges.push({ from: fromId, to: block.id });
  });
  const order = blocks.map((block) => block.id);

  const stateDecls = [];
  const initLines = [];
  const constLines = [];

  const addState = (name, init = "0.0", type = "double") => {
    stateDecls.push(`${type} ${name};`);
    initLines.push(`  s->${name} = ${init};`);
  };

  blocks.forEach((block) => {
    const id = sanitizeId(block.id);
    const params = block.params || {};
    if (block.type === "integrator") addState(`int_${id}`);
    if (block.type === "derivative") {
      addState(`der_prev_${id}`);
      addState(`der_out_${id}`);
    }
    if (block.type === "rate") addState(`rate_${id}`);
    if (block.type === "backlash") addState(`backlash_${id}`);
    if (block.type === "lpf") addState(`lpf_${id}`);
    if (block.type === "hpf") {
      addState(`hpf_${id}`);
      addState(`hpf_out_${id}`);
    }
    if (block.type === "pid") {
      addState(`pid_int_${id}`);
      addState(`pid_prev_${id}`);
      addState(`pid_out_${id}`);
    }
    if (block.type === "zoh") {
      addState(`zoh_last_${id}`);
      addState(`zoh_next_${id}`);
    }
    if (block.type === "foh") {
      addState(`foh_prev_${id}`);
      addState(`foh_last_${id}`);
      addState(`foh_last_t_${id}`);
      addState(`foh_next_${id}`);
      addState(`foh_out_${id}`);
    }
    if (block.type === "delay") {
      const steps = Math.max(1, Math.round(resolveNumeric(params.delay, variables) / Number(sampleTime || 0.01)));
      stateDecls.push(`double delay_buf_${id}[${steps + 1}];`);
      addState(`delay_idx_${id}`, "0", "int");
      initLines.push(`  for (int i = 0; i < ${steps + 1}; i++) s->delay_buf_${id}[i] = 0.0;`);
    }
    if (block.type === "ddelay") {
      const steps = Math.max(1, Math.round(resolveNumeric(params.steps, variables) || 1));
      stateDecls.push(`double ddelay_buf_${id}[${steps}];`);
      addState(`ddelay_next_${id}`, "0.0");
      addState(`ddelay_last_${id}`, "0.0");
      initLines.push(`  for (int i = 0; i < ${steps}; i++) s->ddelay_buf_${id}[i] = 0.0;`);
    }
    if (block.type === "stateSpace") {
      addState(`ss_x_${id}`);
      addState(`ss_out_${id}`);
    }
    if (block.type === "dstateSpace") {
      addState(`dss_x_${id}`);
      addState(`dss_next_${id}`);
      addState(`dss_last_${id}`);
    }
    if (block.type === "tf") {
      const num = parseList(params.num, variables);
      const den = parseList(params.den, variables);
      const model = buildTfModel(num, den);
      if (model) {
        constLines.push(`static const int tf_n_${id} = ${model.n};`);
        if (model.n > 0) {
          constLines.push(`static const double tf_A_${id}[${model.n}][${model.n}] = {${model.A.map((row) => `{${row.join(", ")}}`).join(", ")}};`);
          constLines.push(`static const double tf_B_${id}[${model.n}] = {${model.B.join(", ")}};`);
          constLines.push(`static const double tf_C_${id}[${model.n}] = {${model.C.join(", ")}};`);
        }
        constLines.push(`static const double tf_D_${id} = ${model.D};`);
        if (model.n > 0) {
          stateDecls.push(`double tf_x_${id}[${model.n}];`);
          initLines.push(`  for (int i = 0; i < ${model.n}; i++) s->tf_x_${id}[i] = 0.0;`);
        }
        addState(`tf_out_${id}`);
      }
    }
    if (block.type === "dtf") {
      const num = parseList(params.num, variables);
      const den = parseList(params.den, variables);
      const model = buildDiscreteTf(num, den);
      constLines.push(`static const int dtf_num_${id}_n = ${model.num.length};`);
      constLines.push(`static const int dtf_den_${id}_n = ${model.den.length};`);
      constLines.push(`static const double dtf_num_${id}[${model.num.length}] = {${model.num.join(", ")}};`);
      constLines.push(`static const double dtf_den_${id}[${model.den.length}] = {${model.den.join(", ")}};`);
      stateDecls.push(`double dtf_x_${id}[${model.num.length}];`);
      stateDecls.push(`double dtf_y_${id}[${Math.max(0, model.den.length - 1)}];`);
      addState(`dtf_next_${id}`);
      initLines.push(`  for (int i = 0; i < ${model.num.length}; i++) s->dtf_x_${id}[i] = 0.0;`);
      initLines.push(`  for (int i = 0; i < ${Math.max(0, model.den.length - 1)}; i++) s->dtf_y_${id}[i] = 0.0;`);
    }
    if (block.type === "noise") {
      stateDecls.push("unsigned int rng_state;");
      initLines.push("  s->rng_state = 1u;");
    }
  });

  const outDecls = blocks.map((b) => `double out_${sanitizeId(b.id)};`);
  const getInputExpr = (blockId, idx, fallback = "0.0") => {
    const from = (inputs.get(blockId) || [])[idx];
    if (!from) return fallback;
    const fid = sanitizeId(from);
    return `(valid_${fid} ? s->out_${fid} : ${fallback})`;
  };

  const lines = [];
  lines.push("/* Generated by Vibesim */");
  lines.push("#include <math.h>");
  lines.push("#include <stdint.h>");
  if (includeMain) {
    lines.push("#include <stdio.h>");
    lines.push("#include <stdlib.h>");
    lines.push("#include <string.h>");
  }
  lines.push("");
  constLines.forEach((line) => lines.push(line));
  if (constLines.length) lines.push("");
  Object.entries(variables).forEach(([name, value]) => {
    const cname = sanitizeId(name.startsWith("\\") ? name.slice(1) : name);
    lines.push(`static const double ${cname} = ${Number(value) || 0};`);
  });
  if (Object.keys(variables).length) lines.push("");
  lines.push("typedef struct {");
  outDecls.forEach((line) => lines.push(`  ${line}`));
  stateDecls.forEach((line) => lines.push(`  ${line}`));
  lines.push("} ModelState;");
  lines.push("");
  lines.push("typedef struct {");
  inputNames.forEach((name) => {
    lines.push(`  double ${name};`);
  });
  if (!inputNames.length) lines.push("  double _unused;");
  lines.push("} ModelInput;");
  lines.push("");
  lines.push("typedef struct {");
  outputNames.forEach((name) => {
    lines.push(`  double ${name};`);
  });
  if (!outputNames.length) lines.push("  double _unused;");
  lines.push("} ModelOutput;");
  lines.push("");
  lines.push(`static const int INPUT_COUNT = ${inputNames.length};`);
  lines.push(`static const int OUTPUT_COUNT = ${outputNames.length};`);
  lines.push("static const char* input_names[] = {");
  inputNames.forEach((name) => {
    lines.push(`  "${name}",`);
  });
  if (!inputNames.length) lines.push("  \"_unused\",");
  lines.push("};");
  lines.push("static const char* output_names[] = {");
  outputNames.forEach((name) => {
    lines.push(`  \"${name}\",`);
  });
  if (!outputNames.length) lines.push("  \"_unused\",");
  lines.push("};");
  lines.push("");
  lines.push("void InitModel(ModelState* s) {");
  lines.push("  if (!s) return;");
  outDecls.forEach((line) => {
    const name = line.replace("double ", "").replace(";", "");
    lines.push(`  s->${name} = 0.0;`);
  });
  initLines.forEach((line) => lines.push(line));
  lines.push("}");
  lines.push("");
  const dtVal = resolveNumeric(sampleTime, variables) || 0.01;
  lines.push("void RunStep(ModelState* s, const ModelInput* in, ModelOutput* out, double t) {");
  lines.push(`  const double dt = ${dtVal};`);
  order.forEach((id) => {
    const bid = sanitizeId(id);
    lines.push(`  int valid_${bid} = 0;`);
  });

  lines.push("  // output phase");
  order.forEach((id) => {
    const block = byId.get(id);
    if (!block) return;
    const bid = sanitizeId(block.id);
    const params = block.params || {};
    const type = block.type;
    const in0 = getInputExpr(block.id, 0, type === "mult" ? "1.0" : "0.0");
    const in1 = getInputExpr(block.id, 1, type === "mult" ? "1.0" : "0.0");
    const in2 = getInputExpr(block.id, 2, type === "mult" ? "1.0" : "0.0");
    lines.push(`  // ${block.type} ${block.id} output`);
    if (type === "labelSource") {
      const mapping = labelSourceMappings.find((m) => m.id === block.id);
      if (mapping?.sinkId) {
        lines.push(`  s->out_${bid} = 0.0;`);
      } else {
        const name = getLabelName(block);
        lines.push(`  s->out_${bid} = in ? in->${name} : 0.0;`);
      }
      lines.push(`  valid_${bid} = 1;`);
    } else if (type === "constant") {
      lines.push(`  s->out_${bid} = ${resolveNumeric(params.value, variables)};`);
      lines.push(`  valid_${bid} = 1;`);
    } else if (type === "step") {
      lines.push(`  s->out_${bid} = (t >= ${resolveNumeric(params.stepTime, variables)} ? 1.0 : 0.0);`);
      lines.push(`  valid_${bid} = 1;`);
    } else if (type === "ramp") {
      const start = resolveNumeric(params.start, variables);
      const slope = resolveNumeric(params.slope, variables);
      lines.push(`  s->out_${bid} = (t >= ${start} ? (t - ${start}) * ${slope} : 0.0);`);
      lines.push(`  valid_${bid} = 1;`);
    } else if (type === "impulse") {
      lines.push(`  s->out_${bid} = (fabs(t - ${resolveNumeric(params.time, variables)}) <= dt * 0.5 ? ${resolveNumeric(params.amp, variables)} / fmax(dt, 1e-6) : 0.0);`);
      lines.push(`  valid_${bid} = 1;`);
    } else if (type === "sine") {
      lines.push(`  s->out_${bid} = ${resolveNumeric(params.amp, variables)} * sin(2.0 * M_PI * ${resolveNumeric(params.freq, variables)} * t + ${resolveNumeric(params.phase, variables)});`);
      lines.push(`  valid_${bid} = 1;`);
    } else if (type === "chirp") {
      const f0 = resolveNumeric(params.f0, variables);
      const f1 = resolveNumeric(params.f1, variables);
      const t1 = Math.max(0.001, resolveNumeric(params.t1, variables) || 1);
      lines.push(`  { double k = (${f1} - ${f0}) / ${t1};`);
      lines.push(`    double phase = 2.0 * M_PI * (${f0} * t + 0.5 * k * t * t);`);
      lines.push(`    s->out_${bid} = ${resolveNumeric(params.amp, variables)} * sin(phase); }`);
      lines.push(`  valid_${bid} = 1;`);
    } else if (type === "noise") {
      lines.push("  s->rng_state = 1664525u * s->rng_state + 1013904223u;");
      lines.push(`  s->out_${bid} = ${resolveNumeric(params.amp, variables)} * ((s->rng_state / 4294967295.0) * 2.0 - 1.0);`);
      lines.push(`  valid_${bid} = 1;`);
    } else if (type === "fileSource") {
      lines.push(`  s->out_${bid} = 0.0; /* TODO: file source */`);
      lines.push(`  valid_${bid} = 1;`);
    } else if (type === "integrator") {
      lines.push(`  s->out_${bid} = s->int_${bid};`);
      lines.push(`  valid_${bid} = 1;`);
    } else if (type === "derivative") {
      lines.push(`  s->out_${bid} = s->der_out_${bid};`);
      lines.push(`  valid_${bid} = 1;`);
    } else if (type === "delay") {
      lines.push(`  s->out_${bid} = s->delay_buf_${bid}[s->delay_idx_${bid}];`);
      lines.push(`  valid_${bid} = 1;`);
    } else if (type === "ddelay") {
      lines.push(`  s->out_${bid} = s->ddelay_last_${bid};`);
      lines.push(`  valid_${bid} = 1;`);
    } else if (type === "rate") {
      lines.push(`  s->out_${bid} = s->rate_${bid};`);
      lines.push(`  valid_${bid} = 1;`);
    } else if (type === "backlash") {
      lines.push(`  s->out_${bid} = s->backlash_${bid};`);
      lines.push(`  valid_${bid} = 1;`);
    } else if (type === "lpf") {
      lines.push(`  s->out_${bid} = s->lpf_${bid};`);
      lines.push(`  valid_${bid} = 1;`);
    } else if (type === "hpf") {
      lines.push(`  s->out_${bid} = s->hpf_out_${bid};`);
      lines.push(`  valid_${bid} = 1;`);
    } else if (type === "pid") {
      lines.push(`  s->out_${bid} = s->pid_out_${bid};`);
      lines.push(`  valid_${bid} = 1;`);
    } else if (type === "zoh") {
      lines.push(`  s->out_${bid} = s->zoh_last_${bid};`);
      lines.push(`  valid_${bid} = 1;`);
    } else if (type === "foh") {
      lines.push(`  s->out_${bid} = s->foh_out_${bid};`);
      lines.push(`  valid_${bid} = 1;`);
    } else if (type === "dtf") {
      lines.push(`  s->out_${bid} = (dtf_den_${bid}_n > 1) ? s->dtf_y_${bid}[0] : 0.0;`);
      lines.push(`  valid_${bid} = 1;`);
    } else if (type === "tf") {
      lines.push(`  if (tf_n_${bid} == 0) {`);
      lines.push(`    s->out_${bid} = tf_D_${bid} * (${in0});`);
      lines.push("  } else {");
      lines.push(`    double y_${bid} = tf_D_${bid} * (${in0});`);
      lines.push(`    for (int i = 0; i < tf_n_${bid}; i++) y_${bid} += tf_C_${bid}[i] * s->tf_x_${bid}[i];`);
      lines.push(`    s->out_${bid} = y_${bid};`);
      lines.push("  }");
      lines.push(`  valid_${bid} = 1;`);
    } else if (type === "stateSpace") {
      lines.push(`  s->out_${bid} = s->ss_out_${bid};`);
      lines.push(`  valid_${bid} = 1;`);
    } else if (type === "dstateSpace") {
      lines.push(`  s->out_${bid} = s->dss_last_${bid};`);
      lines.push(`  valid_${bid} = 1;`);
    }
  });

  lines.push("  // algebraic resolve");
  lines.push("  for (int iter = 0; iter < 50; iter++) {");
  lines.push("    int updated = 0;");
  labelSourceMappings.forEach((mapping) => {
    const bid = sanitizeId(mapping.id);
    if (!mapping.sinkId) {
      lines.push(`    { double next = in ? in->${mapping.name} : 0.0;`);
      lines.push(`      if (!valid_${bid} || s->out_${bid} != next) { s->out_${bid} = next; valid_${bid} = 1; updated = 1; } }`);
      return;
    }
    if (!mapping.sinkInput) {
      lines.push(`    { double next = 0.0;`);
      lines.push(`      if (!valid_${bid} || s->out_${bid} != next) { s->out_${bid} = next; valid_${bid} = 1; updated = 1; } }`);
      return;
    }
    const fromId = sanitizeId(mapping.sinkInput);
    lines.push(`    if (valid_${fromId}) {`);
    lines.push(`      double next = s->out_${fromId};`);
    lines.push(`      if (!valid_${bid} || s->out_${bid} != next) { s->out_${bid} = next; valid_${bid} = 1; updated = 1; }`);
    lines.push("    }");
  });
  order.forEach((id) => {
    const block = byId.get(id);
    if (!block) return;
    const bid = sanitizeId(block.id);
    const params = block.params || {};
    const type = block.type;
    const inputsForBlock = inputs.get(block.id) || [];
    if (type === "gain") {
      const fromId = inputsForBlock[0] ? sanitizeId(inputsForBlock[0]) : null;
      if (!fromId) return;
      lines.push(`    if (valid_${fromId}) {`);
      lines.push(`      double next = s->out_${fromId} * ${resolveNumeric(params.gain, variables)};`);
      lines.push(`      if (!valid_${bid} || s->out_${bid} != next) { s->out_${bid} = next; valid_${bid} = 1; updated = 1; }`);
      lines.push("    }");
      return;
    }
    if (type === "sum") {
      const signs = params.signs || [];
      lines.push("    { int missing = 0;");
      const terms = [0, 1, 2].map((i) => {
        const from = inputsForBlock[i];
        if (!from) return "0.0";
        const fromId = sanitizeId(from);
        lines.push(`      if (!valid_${fromId}) missing = 1;`);
        const sign = signs[i] == null ? 1 : Number(signs[i]) || 1;
        return `s->out_${fromId} * ${sign}`;
      });
      lines.push("      if (!missing) {");
      lines.push(`        double next = ${terms.join(" + ")};`);
      lines.push(`        if (!valid_${bid} || s->out_${bid} != next) { s->out_${bid} = next; valid_${bid} = 1; updated = 1; }`);
      lines.push("      }");
      lines.push("    }");
      return;
    }
    if (type === "mult") {
      const factors = [];
      lines.push("    { int missing = 0;");
      [0, 1, 2].forEach((i) => {
        const from = inputsForBlock[i];
        if (!from) {
          lines.push("      missing = 1;");
          factors.push("1.0");
        } else {
          const fromId = sanitizeId(from);
          lines.push(`      if (!valid_${fromId}) missing = 1;`);
          factors.push(`s->out_${fromId}`);
        }
      });
      lines.push("      if (!missing) {");
      lines.push(`        double next = ${factors.join(" * ")};`);
      lines.push(`        if (!valid_${bid} || s->out_${bid} != next) { s->out_${bid} = next; valid_${bid} = 1; updated = 1; }`);
      lines.push("      }");
      lines.push("    }");
      return;
    }
    if (type === "saturation") {
      const fromId = inputsForBlock[0] ? sanitizeId(inputsForBlock[0]) : null;
      if (!fromId) return;
      const maxVal = resolveNumeric(params.max, variables);
      const minVal = resolveNumeric(params.min, variables);
      lines.push(`    if (valid_${fromId}) {`);
      lines.push(`      double v = s->out_${fromId};`);
      lines.push(`      if (v > ${maxVal}) v = ${maxVal};`);
      lines.push(`      if (v < ${minVal}) v = ${minVal};`);
      lines.push(`      if (!valid_${bid} || s->out_${bid} != v) { s->out_${bid} = v; valid_${bid} = 1; updated = 1; }`);
      lines.push("    }");
      return;
    }
    if (type === "tf") {
      lines.push(`    if (tf_n_${bid} == 0) {`);
      lines.push(`      double next = tf_D_${bid} * (${getInputExpr(block.id, 0, "0.0")});`);
      lines.push(`      if (!valid_${bid} || s->out_${bid} != next) { s->out_${bid} = next; valid_${bid} = 1; updated = 1; }`);
      lines.push("    }");
    }
  });
  lines.push("    if (!updated) break;");
  lines.push("  }");

  lines.push("  // label sinks");
  labelSinks.forEach((block) => {
    const bid = sanitizeId(block.id);
    const name = getLabelName(block);
    const in0 = getInputExpr(block.id, 0, "0.0");
    lines.push(`  s->out_${bid} = ${in0};`);
    lines.push(`  valid_${bid} = 1;`);
    lines.push(`  if (out) out->${name} = s->out_${bid};`);
  });

  lines.push("  // update phase");
  order.forEach((id) => {
    const block = byId.get(id);
    if (!block) return;
    const bid = sanitizeId(block.id);
    const params = block.params || {};
    const type = block.type;
    const in0 = getInputExpr(block.id, 0, type === "mult" ? "1.0" : "0.0");
    if (type === "integrator") {
      lines.push(`  s->int_${bid} += (${in0}) * dt;`);
    } else if (type === "derivative") {
      lines.push(`  s->der_out_${bid} = ((${in0}) - s->der_prev_${bid}) / fmax(dt, 1e-6);`);
      lines.push(`  s->der_prev_${bid} = (${in0});`);
    } else if (type === "delay") {
      const steps = Math.max(1, Math.round(resolveNumeric(params.delay, variables) / dtVal));
      lines.push(`  s->delay_buf_${bid}[s->delay_idx_${bid}] = (${in0});`);
      lines.push(`  s->delay_idx_${bid} = (s->delay_idx_${bid} + 1) % ${steps + 1};`);
    } else if (type === "ddelay") {
      const steps = Math.max(1, Math.round(resolveNumeric(params.steps, variables) || 1));
      const ts = Math.max(0.001, resolveNumeric(params.ts, variables) || 0.1);
      lines.push(`  if (t + 1e-6 >= s->ddelay_next_${bid}) {`);
      lines.push(`    for (int i = 0; i < ${steps - 1}; i++) s->ddelay_buf_${bid}[i] = s->ddelay_buf_${bid}[i + 1];`);
      lines.push(`    s->ddelay_buf_${bid}[${steps - 1}] = (${in0});`);
      lines.push(`    s->ddelay_last_${bid} = s->ddelay_buf_${bid}[0];`);
      lines.push(`    s->ddelay_next_${bid} = t + ${ts};`);
      lines.push("  }");
    } else if (type === "rate") {
      const rise = Math.max(0, resolveNumeric(params.rise, variables));
      const fall = Math.max(0, resolveNumeric(params.fall, variables));
      lines.push(`  { double maxRise = s->rate_${bid} + ${rise} * dt;`);
      lines.push(`    double maxFall = s->rate_${bid} - ${fall} * dt;`);
      lines.push(`    double v = (${in0});`);
      lines.push(`    if (v > maxRise) v = maxRise;`);
      lines.push(`    if (v < maxFall) v = maxFall;`);
      lines.push(`    s->rate_${bid} = v; }`);
    } else if (type === "backlash") {
      const width = Math.max(0, resolveNumeric(params.width, variables));
      lines.push(`  { double v = (${in0});`);
      lines.push(`    if (v > s->backlash_${bid} + ${width} / 2.0) s->backlash_${bid} = v - ${width} / 2.0;`);
      lines.push(`    if (v < s->backlash_${bid} - ${width} / 2.0) s->backlash_${bid} = v + ${width} / 2.0; }`);
    } else if (type === "lpf") {
      const fc = Math.max(0, resolveNumeric(params.cutoff, variables));
      lines.push(`  s->lpf_${bid} += dt * (2.0 * M_PI * ${fc}) * ((${in0}) - s->lpf_${bid});`);
    } else if (type === "hpf") {
      const fc = Math.max(0, resolveNumeric(params.cutoff, variables));
      lines.push(`  s->hpf_${bid} += dt * (2.0 * M_PI * ${fc}) * ((${in0}) - s->hpf_${bid});`);
      lines.push(`  s->hpf_out_${bid} = (${in0}) - s->hpf_${bid};`);
    } else if (type === "pid") {
      const kp = resolveNumeric(params.kp, variables);
      const ki = resolveNumeric(params.ki, variables);
      const kd = resolveNumeric(params.kd, variables);
      lines.push(`  { double v = (${in0});`);
      lines.push(`    s->pid_int_${bid} += v * dt;`);
      lines.push(`    double deriv = (v - s->pid_prev_${bid}) / fmax(dt, 1e-6);`);
      lines.push(`    s->pid_out_${bid} = ${kp} * v + ${ki} * s->pid_int_${bid} + ${kd} * deriv;`);
      lines.push(`    s->pid_prev_${bid} = v; }`);
    } else if (type === "zoh") {
      const ts = Math.max(0.001, resolveNumeric(params.ts, variables) || dtVal);
      lines.push(`  if (t + 1e-6 >= s->zoh_next_${bid}) {`);
      lines.push(`    s->zoh_last_${bid} = (${in0});`);
      lines.push(`    s->zoh_next_${bid} = t + ${ts};`);
      lines.push("  }");
    } else if (type === "foh") {
      const ts = Math.max(0.001, resolveNumeric(params.ts, variables) || dtVal);
      lines.push(`  { double slope = (s->foh_last_${bid} - s->foh_prev_${bid}) / ${ts};`);
      lines.push(`    s->foh_out_${bid} = s->foh_last_${bid} + slope * (t - s->foh_last_t_${bid}); }`);
      lines.push(`  if (t + 1e-6 >= s->foh_next_${bid}) {`);
      lines.push(`    s->foh_prev_${bid} = s->foh_last_${bid};`);
      lines.push(`    s->foh_last_${bid} = (${in0});`);
      lines.push(`    s->foh_last_t_${bid} = t;`);
      lines.push(`    s->foh_next_${bid} = t + ${ts};`);
      lines.push("  }");
    } else if (type === "dtf") {
      const ts = Math.max(0.001, resolveNumeric(params.ts, variables) || dtVal);
      lines.push(`  if (t + 1e-6 >= s->dtf_next_${bid}) {`);
      lines.push(`    for (int i = dtf_num_${bid}_n - 1; i > 0; i--) s->dtf_x_${bid}[i] = s->dtf_x_${bid}[i - 1];`);
      lines.push(`    s->dtf_x_${bid}[0] = (${in0});`);
      lines.push(`    double y = 0.0;`);
      lines.push(`    for (int i = 0; i < dtf_num_${bid}_n; i++) y += dtf_num_${bid}[i] * s->dtf_x_${bid}[i];`);
      lines.push(`    for (int i = 1; i < dtf_den_${bid}_n; i++) y -= dtf_den_${bid}[i] * s->dtf_y_${bid}[i - 1];`);
      lines.push(`    for (int i = dtf_den_${bid}_n - 2; i > 0; i--) s->dtf_y_${bid}[i] = s->dtf_y_${bid}[i - 1];`);
      lines.push(`    if (dtf_den_${bid}_n > 1) s->dtf_y_${bid}[0] = y;`);
      lines.push(`    s->dtf_next_${bid} = t + ${ts};`);
      lines.push("  }");
    } else if (type === "tf") {
      lines.push(`  if (tf_n_${bid} > 0) {`);
      lines.push(`    double k1_${bid}[tf_n_${bid}];`);
      lines.push(`    double k2_${bid}[tf_n_${bid}];`);
      lines.push(`    double k3_${bid}[tf_n_${bid}];`);
      lines.push(`    double k4_${bid}[tf_n_${bid}];`);
      lines.push(`    double temp_${bid}[tf_n_${bid}];`);
      lines.push(`    for (int i = 0; i < tf_n_${bid}; i++) {`);
      lines.push(`      double acc = 0.0;`);
      lines.push(`      for (int j = 0; j < tf_n_${bid}; j++) acc += tf_A_${bid}[i][j] * s->tf_x_${bid}[j];`);
      lines.push(`      k1_${bid}[i] = acc + tf_B_${bid}[i] * (${in0});`);
      lines.push("    }");
      lines.push(`    for (int i = 0; i < tf_n_${bid}; i++) temp_${bid}[i] = s->tf_x_${bid}[i] + 0.5 * dt * k1_${bid}[i];`);
      lines.push(`    for (int i = 0; i < tf_n_${bid}; i++) {`);
      lines.push(`      double acc = 0.0;`);
      lines.push(`      for (int j = 0; j < tf_n_${bid}; j++) acc += tf_A_${bid}[i][j] * temp_${bid}[j];`);
      lines.push(`      k2_${bid}[i] = acc + tf_B_${bid}[i] * (${in0});`);
      lines.push("    }");
      lines.push(`    for (int i = 0; i < tf_n_${bid}; i++) temp_${bid}[i] = s->tf_x_${bid}[i] + 0.5 * dt * k2_${bid}[i];`);
      lines.push(`    for (int i = 0; i < tf_n_${bid}; i++) {`);
      lines.push(`      double acc = 0.0;`);
      lines.push(`      for (int j = 0; j < tf_n_${bid}; j++) acc += tf_A_${bid}[i][j] * temp_${bid}[j];`);
      lines.push(`      k3_${bid}[i] = acc + tf_B_${bid}[i] * (${in0});`);
      lines.push("    }");
      lines.push(`    for (int i = 0; i < tf_n_${bid}; i++) temp_${bid}[i] = s->tf_x_${bid}[i] + dt * k3_${bid}[i];`);
      lines.push(`    for (int i = 0; i < tf_n_${bid}; i++) {`);
      lines.push(`      double acc = 0.0;`);
      lines.push(`      for (int j = 0; j < tf_n_${bid}; j++) acc += tf_A_${bid}[i][j] * temp_${bid}[j];`);
      lines.push(`      k4_${bid}[i] = acc + tf_B_${bid}[i] * (${in0});`);
      lines.push("    }");
      lines.push(`    for (int i = 0; i < tf_n_${bid}; i++) {`);
      lines.push(`      s->tf_x_${bid}[i] += (dt / 6.0) * (k1_${bid}[i] + 2.0 * k2_${bid}[i] + 2.0 * k3_${bid}[i] + k4_${bid}[i]);`);
      lines.push("    }");
      lines.push("  }");
    } else if (type === "stateSpace") {
      const A = resolveNumeric(params.A, variables);
      const B = resolveNumeric(params.B, variables);
      const C = resolveNumeric(params.C, variables);
      const D = resolveNumeric(params.D, variables);
      lines.push(`  s->ss_x_${bid} += dt * (${A} * s->ss_x_${bid} + ${B} * (${in0}));`);
      lines.push(`  s->ss_out_${bid} = ${C} * s->ss_x_${bid} + ${D} * (${in0});`);
    } else if (type === "dstateSpace") {
      const A = resolveNumeric(params.A, variables);
      const B = resolveNumeric(params.B, variables);
      const C = resolveNumeric(params.C, variables);
      const D = resolveNumeric(params.D, variables);
      const ts = Math.max(0.001, resolveNumeric(params.ts, variables) || dtVal);
      lines.push(`  if (t + 1e-6 >= s->dss_next_${bid}) {`);
      lines.push(`    s->dss_x_${bid} = ${A} * s->dss_x_${bid} + ${B} * (${in0});`);
      lines.push(`    s->dss_last_${bid} = ${C} * s->dss_x_${bid} + ${D} * (${in0});`);
      lines.push(`    s->dss_next_${bid} = t + ${ts};`);
      lines.push("  }");
    }
  });
  lines.push("}");
  lines.push("");
  if (includeMain) {
    lines.push("typedef struct {");
    lines.push("  double* time;");
    lines.push("  double* values;");
    lines.push("  int count;");
    lines.push("  int capacity;");
    lines.push("} InputSeries;");
    lines.push("");
    lines.push("static void init_series(InputSeries* s) {");
    lines.push("  s->time = NULL;");
    lines.push("  s->values = NULL;");
    lines.push("  s->count = 0;");
    lines.push("  s->capacity = 0;");
    lines.push("}");
    lines.push("");
    lines.push("static void free_series(InputSeries* s) {");
    lines.push("  free(s->time);");
    lines.push("  free(s->values);");
    lines.push("  s->time = NULL;");
    lines.push("  s->values = NULL;");
    lines.push("  s->count = 0;");
    lines.push("  s->capacity = 0;");
    lines.push("}");
    lines.push("");
    lines.push("static int ensure_capacity(InputSeries* s, int needed) {");
    lines.push("  if (needed <= s->capacity) return 1;");
    lines.push("  int newCap = s->capacity ? s->capacity * 2 : 256;");
    lines.push("  while (newCap < needed) newCap *= 2;");
    lines.push("  double* newTime = (double*)realloc(s->time, sizeof(double) * newCap);");
    lines.push("  if (!newTime) return 0;");
    lines.push("  double* newValues = (double*)realloc(s->values, sizeof(double) * newCap * (INPUT_COUNT > 0 ? INPUT_COUNT : 1));");
    lines.push("  if (!newValues) return 0;");
    lines.push("  s->time = newTime;");
    lines.push("  s->values = newValues;");
    lines.push("  s->capacity = newCap;");
    lines.push("  return 1;");
    lines.push("}");
    lines.push("");
    lines.push("static int read_csv(const char* path, InputSeries* series) {");
    lines.push("  if (!path) return 0;");
    lines.push("  FILE* f = fopen(path, \"r\");");
    lines.push("  if (!f) return 0;");
    lines.push("  char line[4096];");
    lines.push("  if (!fgets(line, sizeof(line), f)) { fclose(f); return 0; }");
    lines.push("  int colMap[128];");
    lines.push("  int colCount = 0;");
    lines.push("  char* token = strtok(line, \",\\n\\r\");");
    lines.push("  while (token && colCount < 128) {");
    lines.push("    if (strcmp(token, \"t\") == 0 || strcmp(token, \"time\") == 0) colMap[colCount] = -1;");
    lines.push("    else {");
    lines.push("      int idx = -1;");
    lines.push("      for (int i = 0; i < INPUT_COUNT; i++) {");
    lines.push("        if (strcmp(token, input_names[i]) == 0) { idx = i; break; }");
    lines.push("      }");
    lines.push("      colMap[colCount] = idx;");
    lines.push("    }");
    lines.push("    colCount++;");
    lines.push("    token = strtok(NULL, \",\\n\\r\");");
    lines.push("  }");
    lines.push("  while (fgets(line, sizeof(line), f)) {");
    lines.push("    if (!ensure_capacity(series, series->count + 1)) break;");
    lines.push("    double t = 0.0;");
    lines.push("    for (int i = 0; i < INPUT_COUNT; i++) {");
    lines.push("      series->values[series->count * (INPUT_COUNT > 0 ? INPUT_COUNT : 1) + i] = 0.0;");
    lines.push("    }");
    lines.push("    int col = 0;");
    lines.push("    token = strtok(line, \",\\n\\r\");");
    lines.push("    while (token && col < colCount) {");
    lines.push("      double v = strtod(token, NULL);");
    lines.push("      if (colMap[col] == -1) t = v;");
    lines.push("      else if (colMap[col] >= 0) series->values[series->count * (INPUT_COUNT > 0 ? INPUT_COUNT : 1) + colMap[col]] = v;");
    lines.push("      col++;");
    lines.push("      token = strtok(NULL, \",\\n\\r\");");
    lines.push("    }");
    lines.push("    series->time[series->count] = t;");
    lines.push("    series->count += 1;");
    lines.push("  }");
    lines.push("  fclose(f);");
    lines.push("  return series->count;");
    lines.push("}");
    lines.push("");
    lines.push("static void fill_inputs(const InputSeries* series, int* idx, double t, ModelInput* in) {");
    lines.push("  if (!series || series->count == 0 || INPUT_COUNT == 0) return;");
    lines.push("  while (*idx + 1 < series->count && series->time[*idx + 1] <= t) {");
    lines.push("    *idx += 1;");
    lines.push("  }");
    lines.push("  int base = (*idx) * INPUT_COUNT;");
    lines.push("  for (int i = 0; i < INPUT_COUNT; i++) {");
    lines.push("    ((double*)in)[i] = series->values[base + i];");
    lines.push("  }");
    lines.push("}");
    lines.push("");
    lines.push("static void write_header(FILE* f) {");
    lines.push("  fprintf(f, \"t\");");
    lines.push("  for (int i = 0; i < OUTPUT_COUNT; i++) fprintf(f, \",%s\", output_names[i]);");
    lines.push("  fprintf(f, \"\\n\");");
    lines.push("}");
    lines.push("");
    lines.push("int main(int argc, char** argv) {");
    lines.push(`  double tEnd = ${mainDuration};`);
    lines.push("  const char* inPath = NULL;");
    lines.push("  const char* outPath = NULL;");
    lines.push(`  const double dt = ${dtVal};`);
    lines.push("  for (int i = 1; i < argc; i++) {");
    lines.push("    if (strcmp(argv[i], \"-t\") == 0 && i + 1 < argc) tEnd = atof(argv[++i]);");
    lines.push("    else if (strcmp(argv[i], \"-i\") == 0 && i + 1 < argc) inPath = argv[++i];");
    lines.push("    else if (strcmp(argv[i], \"-o\") == 0 && i + 1 < argc) outPath = argv[++i];");
    lines.push("  }");
    lines.push("  ModelState state;");
    lines.push("  ModelInput in = {0};");
    lines.push("  ModelOutput out = {0};");
    lines.push("  InitModel(&state);");
    lines.push("  InputSeries series;");
    lines.push("  init_series(&series);");
    lines.push("  int seriesIdx = 0;");
    lines.push("  if (inPath) read_csv(inPath, &series);");
    lines.push("  FILE* outFile = outPath ? fopen(outPath, \"w\") : stdout;");
    lines.push("  if (!outFile) outFile = stdout;");
    lines.push("  write_header(outFile);");
    lines.push("  for (double t = 0.0; t <= tEnd + 1e-9; t += dt) {");
    lines.push("    if (inPath) fill_inputs(&series, &seriesIdx, t, &in);");
    lines.push("    RunStep(&state, &in, &out, t);");
    lines.push("    fprintf(outFile, \"%.6f\", t);");
    lines.push("    for (int i = 0; i < OUTPUT_COUNT; i++) {");
    lines.push("      fprintf(outFile, \",%.6f\", ((double*)&out)[i]);");
    lines.push("    }");
    lines.push("    fprintf(outFile, \"\\n\");");
    lines.push("  }");
    lines.push("  if (outPath && outFile && outFile != stdout) fclose(outFile);");
    lines.push("  free_series(&series);");
    lines.push("  return 0;");
    lines.push("}");
    lines.push("");
  }
  return lines.join("\n");
};
