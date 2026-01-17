const sanitizeId = (id) => String(id).replace(/[^a-zA-Z0-9_]/g, "_");

const resolveNumeric = (value, variables) => {
  if (value == null) return 0;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value).trim();
  if (!text) return 0;
  const direct = Number(text);
  if (Number.isFinite(direct)) return direct;
  if (variables && Object.prototype.hasOwnProperty.call(variables, text)) {
    return Number(variables[text]) || 0;
  }
  const stripped = text.startsWith("\\") ? text.slice(1) : text;
  if (variables && Object.prototype.hasOwnProperty.call(variables, stripped)) {
    return Number(variables[stripped]) || 0;
  }
  return 0;
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

const buildExecutionOrder = (blocks, connections) => {
  const ids = blocks.map((b) => b.id);
  const indeg = new Map(ids.map((id) => [id, 0]));
  const adj = new Map(ids.map((id) => [id, []]));
  connections.forEach((conn) => {
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

const buildTfModel = (numArr, denArr) => {
  if (!denArr.length) return null;
  const a0 = denArr[0] || 1;
  const denNorm = denArr.map((v) => v / a0);
  const n = denNorm.length - 1;
  if (n === 0) {
    const gain = (numArr[0] || 0) / a0;
    return { n: 0, A: [], B: [], C: [], D: gain };
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
  return { n, A, B, C, D };
};

const buildDiscreteTf = (numArr, denArr) => {
  const safeDen = denArr.length ? denArr : [1];
  const a0 = safeDen[0] || 1;
  return {
    num: (numArr.length ? numArr : [0]).map((v) => v / a0),
    den: safeDen.map((v) => v / a0),
  };
};

export const generateC = (diagram, { sampleTime = 0.01 } = {}) => {
  const blocks = diagram.blocks || [];
  const connections = diagram.connections || [];
  const variables = diagram.variables || {};
  const order = buildExecutionOrder(blocks, connections);
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const inputs = new Map(blocks.map((b) => [b.id, []]));
  connections.forEach((conn) => {
    const list = inputs.get(conn.to) || [];
    list[conn.toIndex ?? 0] = conn.from;
    inputs.set(conn.to, list);
  });

  const labelSources = blocks.filter((b) => b.type === "labelSource");
  const labelSinks = blocks.filter((b) => b.type === "labelSink");

  const stateDecls = [];
  const initLines = [];
  const constLines = [];

  const addState = (line, init = "0.0") => {
    stateDecls.push(line);
    const name = line.replace("double ", "").replace(";", "");
    initLines.push(`  s->${name} = ${init};`);
  };

  blocks.forEach((block) => {
    const id = sanitizeId(block.id);
    const params = block.params || {};
    if (block.type === "integrator") addState(`double int_${id};`);
    if (block.type === "derivative") addState(`double der_prev_${id};`);
    if (block.type === "rate") addState(`double rate_${id};`);
    if (block.type === "backlash") addState(`double backlash_${id};`);
    if (block.type === "lpf") addState(`double lpf_${id};`);
    if (block.type === "hpf") {
      addState(`double hpf_${id};`);
      addState(`double hpf_out_${id};`);
    }
    if (block.type === "pid") {
      addState(`double pid_int_${id};`);
      addState(`double pid_prev_${id};`);
      addState(`double pid_out_${id};`);
    }
    if (block.type === "zoh") {
      addState(`double zoh_last_${id};`);
      addState(`double zoh_next_${id};`);
    }
    if (block.type === "foh") {
      addState(`double foh_prev_${id};`);
      addState(`double foh_last_${id};`);
      addState(`double foh_last_t_${id};`);
      addState(`double foh_next_${id};`);
    }
    if (block.type === "delay") {
      const steps = Math.max(1, Math.round(resolveNumeric(params.delay, variables) / Number(sampleTime || 0.01)));
      stateDecls.push(`double delay_buf_${id}[${steps + 1}];`);
      addState(`int delay_idx_${id};`, "0");
      initLines.push(`  for (int i = 0; i < ${steps + 1}; i++) s->delay_buf_${id}[i] = 0.0;`);
    }
    if (block.type === "ddelay") {
      const steps = Math.max(1, Math.round(resolveNumeric(params.steps, variables) || 1));
      stateDecls.push(`double ddelay_buf_${id}[${steps}];`);
      addState(`double ddelay_next_${id};`, "0.0");
      addState(`double ddelay_last_${id};`, "0.0");
      initLines.push(`  for (int i = 0; i < ${steps}; i++) s->ddelay_buf_${id}[i] = 0.0;`);
    }
    if (block.type === "stateSpace") addState(`double ss_x_${id};`);
    if (block.type === "dstateSpace") {
      addState(`double dss_x_${id};`);
      addState(`double dss_next_${id};`);
      addState(`double dss_last_${id};`);
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
        addState(`double tf_out_${id};`);
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
      addState(`double dtf_next_${id};`);
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
    return `s->out_${sanitizeId(from)}`;
  };

  const lines = [];
  lines.push("/* Generated by Vibesim */");
  lines.push("#include <math.h>");
  lines.push("#include <stdint.h>");
  lines.push("#include <stdio.h>");
  lines.push("#include <stdlib.h>");
  lines.push("#include <string.h>");
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
  labelSources.forEach((b) => {
    const name = sanitizeId(b.params?.name || b.id);
    lines.push(`  double ${name};`);
  });
  if (!labelSources.length) lines.push("  double _unused;");
  lines.push("} ModelInput;");
  lines.push("");
  lines.push("typedef struct {");
  labelSinks.forEach((b) => {
    const name = sanitizeId(b.params?.name || b.id);
    lines.push(`  double ${name};`);
  });
  if (!labelSinks.length) lines.push("  double _unused;");
  lines.push("} ModelOutput;");
  lines.push("");
  lines.push(`static const int INPUT_COUNT = ${labelSources.length};`);
  lines.push(`static const int OUTPUT_COUNT = ${labelSinks.length};`);
  lines.push("static const char* input_names[] = {");
  labelSources.forEach((b) => {
    const name = sanitizeId(b.params?.name || b.id);
    lines.push(`  "${name}",`);
  });
  if (!labelSources.length) lines.push("  \"_unused\",");
  lines.push("};");
  lines.push("static const char* output_names[] = {");
  labelSinks.forEach((b) => {
    const name = sanitizeId(b.params?.name || b.id);
    lines.push(`  \"${name}\",`);
  });
  if (!labelSinks.length) lines.push("  \"_unused\",");
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
    const block = byId.get(id);
    if (!block) return;
    const bid = sanitizeId(block.id);
    const params = block.params || {};
    const type = block.type;
    const in0 = getInputExpr(block.id, 0, type === "mult" ? "1.0" : "0.0");
    const in1 = getInputExpr(block.id, 1, type === "mult" ? "1.0" : "0.0");
    const in2 = getInputExpr(block.id, 2, type === "mult" ? "1.0" : "0.0");
    lines.push(`  // ${block.type} ${block.id}`);
    if (type === "labelSource") {
      const name = sanitizeId(block.params?.name || block.id);
      lines.push(`  s->out_${bid} = in ? in->${name} : 0.0;`);
    } else if (type === "labelSink") {
      const name = sanitizeId(block.params?.name || block.id);
      lines.push(`  s->out_${bid} = ${in0};`);
      lines.push(`  if (out) out->${name} = s->out_${bid};`);
    } else if (type === "constant") {
      lines.push(`  s->out_${bid} = ${resolveNumeric(params.value, variables)};`);
    } else if (type === "step") {
      lines.push(`  s->out_${bid} = (t >= ${resolveNumeric(params.stepTime, variables)} ? 1.0 : 0.0);`);
    } else if (type === "ramp") {
      const start = resolveNumeric(params.start, variables);
      const slope = resolveNumeric(params.slope, variables);
      lines.push(`  s->out_${bid} = (t >= ${start} ? (t - ${start}) * ${slope} : 0.0);`);
    } else if (type === "impulse") {
      lines.push(`  s->out_${bid} = (fabs(t - ${resolveNumeric(params.time, variables)}) <= dt * 0.5 ? ${resolveNumeric(params.amp, variables)} / fmax(dt, 1e-6) : 0.0);`);
    } else if (type === "sine") {
      lines.push(`  s->out_${bid} = ${resolveNumeric(params.amp, variables)} * sin(2.0 * M_PI * ${resolveNumeric(params.freq, variables)} * t + ${resolveNumeric(params.phase, variables)});`);
    } else if (type === "chirp") {
      const f0 = resolveNumeric(params.f0, variables);
      const f1 = resolveNumeric(params.f1, variables);
      const t1 = Math.max(0.001, resolveNumeric(params.t1, variables) || 1);
      lines.push(`  { double k = (${f1} - ${f0}) / ${t1};`);
      lines.push(`    double phase = 2.0 * M_PI * (${f0} * t + 0.5 * k * t * t);`);
      lines.push(`    s->out_${bid} = ${resolveNumeric(params.amp, variables)} * sin(phase); }`);
    } else if (type === "noise") {
      lines.push("  s->rng_state = 1664525u * s->rng_state + 1013904223u;");
      lines.push(`  s->out_${bid} = ${resolveNumeric(params.amp, variables)} * ((s->rng_state / 4294967295.0) * 2.0 - 1.0);`);
    } else if (type === "fileSource") {
      lines.push(`  s->out_${bid} = 0.0; /* TODO: file source */`);
    } else if (type === "gain") {
      lines.push(`  s->out_${bid} = (${in0}) * ${resolveNumeric(params.gain, variables)};`);
    } else if (type === "sum") {
      const signs = params.signs || [];
      const terms = [0, 1, 2].map((i) => {
        const sign = signs[i] == null ? 1 : Number(signs[i]) || 1;
        return `(${getInputExpr(block.id, i, "0.0")}) * ${sign}`;
      });
      lines.push(`  s->out_${bid} = ${terms.join(" + ")};`);
    } else if (type === "mult") {
      lines.push(`  s->out_${bid} = (${in0}) * (${in1}) * (${in2});`);
    } else if (type === "saturation") {
      lines.push(`  { double v = (${in0});`);
      lines.push(`    if (v > ${resolveNumeric(params.max, variables)}) v = ${resolveNumeric(params.max, variables)};`);
      lines.push(`    if (v < ${resolveNumeric(params.min, variables)}) v = ${resolveNumeric(params.min, variables)};`);
      lines.push(`    s->out_${bid} = v; }`);
    } else if (type === "integrator") {
      lines.push(`  s->out_${bid} = s->int_${bid};`);
      lines.push(`  s->int_${bid} += (${in0}) * dt;`);
    } else if (type === "derivative") {
      lines.push(`  s->out_${bid} = ((${in0}) - s->der_prev_${bid}) / fmax(dt, 1e-6);`);
      lines.push(`  s->der_prev_${bid} = (${in0});`);
    } else if (type === "delay") {
      const steps = Math.max(1, Math.round(resolveNumeric(params.delay, variables) / dtVal));
      lines.push(`  s->out_${bid} = s->delay_buf_${bid}[s->delay_idx_${bid}];`);
      lines.push(`  s->delay_buf_${bid}[s->delay_idx_${bid}] = (${in0});`);
      lines.push(`  s->delay_idx_${bid} = (s->delay_idx_${bid} + 1) % ${steps + 1};`);
    } else if (type === "ddelay") {
      const steps = Math.max(1, Math.round(resolveNumeric(params.steps, variables) || 1));
      const ts = Math.max(0.001, resolveNumeric(params.ts, variables) || 0.1);
      lines.push(`  s->out_${bid} = s->ddelay_last_${bid};`);
      lines.push(`  if (t + 1e-6 >= s->ddelay_next_${bid}) {`);
      lines.push(`    for (int i = 0; i < ${steps - 1}; i++) s->ddelay_buf_${bid}[i] = s->ddelay_buf_${bid}[i + 1];`);
      lines.push(`    s->ddelay_buf_${bid}[${steps - 1}] = (${in0});`);
      lines.push(`    s->ddelay_last_${bid} = s->ddelay_buf_${bid}[0];`);
      lines.push(`    s->ddelay_next_${bid} = t + ${ts};`);
      lines.push("  }");
    } else if (type === "rate") {
      const rise = Math.max(0, resolveNumeric(params.rise, variables));
      const fall = Math.max(0, resolveNumeric(params.fall, variables));
      lines.push(`  s->out_${bid} = s->rate_${bid};`);
      lines.push(`  { double maxRise = s->rate_${bid} + ${rise} * dt;`);
      lines.push(`    double maxFall = s->rate_${bid} - ${fall} * dt;`);
      lines.push(`    double v = (${in0});`);
      lines.push(`    if (v > maxRise) v = maxRise;`);
      lines.push(`    if (v < maxFall) v = maxFall;`);
      lines.push(`    s->rate_${bid} = v; }`);
    } else if (type === "backlash") {
      const width = Math.max(0, resolveNumeric(params.width, variables));
      lines.push(`  s->out_${bid} = s->backlash_${bid};`);
      lines.push(`  { double v = (${in0});`);
      lines.push(`    if (v > s->backlash_${bid} + ${width} / 2.0) s->backlash_${bid} = v - ${width} / 2.0;`);
      lines.push(`    if (v < s->backlash_${bid} - ${width} / 2.0) s->backlash_${bid} = v + ${width} / 2.0; }`);
    } else if (type === "lpf") {
      const fc = Math.max(0, resolveNumeric(params.cutoff, variables));
      lines.push(`  s->out_${bid} = s->lpf_${bid};`);
      lines.push(`  s->lpf_${bid} += dt * (2.0 * M_PI * ${fc}) * ((${in0}) - s->lpf_${bid});`);
    } else if (type === "hpf") {
      const fc = Math.max(0, resolveNumeric(params.cutoff, variables));
      lines.push(`  s->out_${bid} = s->hpf_out_${bid};`);
      lines.push(`  s->hpf_${bid} += dt * (2.0 * M_PI * ${fc}) * ((${in0}) - s->hpf_${bid});`);
      lines.push(`  s->hpf_out_${bid} = (${in0}) - s->hpf_${bid};`);
    } else if (type === "pid") {
      const kp = resolveNumeric(params.kp, variables);
      const ki = resolveNumeric(params.ki, variables);
      const kd = resolveNumeric(params.kd, variables);
      lines.push(`  s->out_${bid} = s->pid_out_${bid};`);
      lines.push(`  { double v = (${in0});`);
      lines.push(`    s->pid_int_${bid} += v * dt;`);
      lines.push(`    double deriv = (v - s->pid_prev_${bid}) / fmax(dt, 1e-6);`);
      lines.push(`    s->pid_out_${bid} = ${kp} * v + ${ki} * s->pid_int_${bid} + ${kd} * deriv;`);
      lines.push(`    s->pid_prev_${bid} = v; }`);
    } else if (type === "zoh") {
      const ts = Math.max(0.001, resolveNumeric(params.ts, variables) || dtVal);
      lines.push(`  s->out_${bid} = s->zoh_last_${bid};`);
      lines.push(`  if (t + 1e-6 >= s->zoh_next_${bid}) {`);
      lines.push(`    s->zoh_last_${bid} = (${in0});`);
      lines.push(`    s->zoh_next_${bid} = t + ${ts};`);
      lines.push("  }");
    } else if (type === "foh") {
      const ts = Math.max(0.001, resolveNumeric(params.ts, variables) || dtVal);
      lines.push(`  { double slope = (s->foh_last_${bid} - s->foh_prev_${bid}) / ${ts};`);
      lines.push(`    s->out_${bid} = s->foh_last_${bid} + slope * (t - s->foh_last_t_${bid}); }`);
      lines.push(`  if (t + 1e-6 >= s->foh_next_${bid}) {`);
      lines.push(`    s->foh_prev_${bid} = s->foh_last_${bid};`);
      lines.push(`    s->foh_last_${bid} = (${in0});`);
      lines.push(`    s->foh_last_t_${bid} = t;`);
      lines.push(`    s->foh_next_${bid} = t + ${ts};`);
      lines.push("  }");
    } else if (type === "dtf") {
      const ts = Math.max(0.001, resolveNumeric(params.ts, variables) || dtVal);
      lines.push(`  s->out_${bid} = (dtf_den_${bid}_n > 1) ? s->dtf_y_${bid}[0] : 0.0;`);
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
      lines.push(`  s->out_${bid} = s->tf_out_${bid};`);
      lines.push(`  if (tf_n_${bid} == 0) {`);
      lines.push(`    s->tf_out_${bid} = tf_D_${bid} * (${in0});`);
      lines.push("  } else {");
      lines.push(`    double dx_${bid}[tf_n_${bid}];`);
      lines.push(`    for (int i = 0; i < tf_n_${bid}; i++) {`);
      lines.push(`      double acc = 0.0;`);
      lines.push(`      for (int j = 0; j < tf_n_${bid}; j++) acc += tf_A_${bid}[i][j] * s->tf_x_${bid}[j];`);
      lines.push(`      dx_${bid}[i] = acc + tf_B_${bid}[i] * (${in0});`);
      lines.push("    }");
      lines.push(`    for (int i = 0; i < tf_n_${bid}; i++) s->tf_x_${bid}[i] += dx_${bid}[i] * dt;`);
      lines.push(`    double y = tf_D_${bid} * (${in0});`);
      lines.push(`    for (int i = 0; i < tf_n_${bid}; i++) y += tf_C_${bid}[i] * s->tf_x_${bid}[i];`);
      lines.push(`    s->tf_out_${bid} = y;`);
      lines.push("  }");
    } else if (type === "stateSpace") {
      const A = resolveNumeric(params.A, variables);
      const B = resolveNumeric(params.B, variables);
      const C = resolveNumeric(params.C, variables);
      const D = resolveNumeric(params.D, variables);
      lines.push(`  s->out_${bid} = ${C} * s->ss_x_${bid} + ${D} * (${in0});`);
      lines.push(`  s->ss_x_${bid} += dt * (${A} * s->ss_x_${bid} + ${B} * (${in0}));`);
    } else if (type === "dstateSpace") {
      const A = resolveNumeric(params.A, variables);
      const B = resolveNumeric(params.B, variables);
      const C = resolveNumeric(params.C, variables);
      const D = resolveNumeric(params.D, variables);
      const ts = Math.max(0.001, resolveNumeric(params.ts, variables) || dtVal);
      lines.push(`  s->out_${bid} = s->dss_last_${bid};`);
      lines.push(`  if (t + 1e-6 >= s->dss_next_${bid}) {`);
      lines.push(`    s->dss_x_${bid} = ${A} * s->dss_x_${bid} + ${B} * (${in0});`);
      lines.push(`    s->dss_last_${bid} = ${C} * s->dss_x_${bid} + ${D} * (${in0});`);
      lines.push(`    s->dss_next_${bid} = t + ${ts};`);
      lines.push("  }");
    } else if (type === "scope" || type === "fileSink") {
      lines.push(`  /* ${type} sink omitted */`);
    } else {
      lines.push(`  s->out_${bid} = 0.0; /* TODO: ${type} */`);
    }
  });
  lines.push("}");
  lines.push("");
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
  lines.push("  double tEnd = 1.0;");
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
  return lines.join("\n");
};
