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

export const generatePython = (diagram, { sampleTime = 0.01 } = {}) => {
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

  const stateInit = [];
  blocks.forEach((block) => {
    const id = sanitizeId(block.id);
    const params = block.params || {};
    if (block.type === "integrator") stateInit.push(`state["int_${id}"] = 0.0`);
    if (block.type === "derivative") stateInit.push(`state["der_prev_${id}"] = 0.0`);
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
    if (block.type === "stateSpace") stateInit.push(`state["ss_x_${id}"] = 0.0`);
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
      stateInit.push(`state["tf_num_${id}"] = ${JSON.stringify(num.length ? num : [0])}`);
      stateInit.push(`state["tf_den_${id}"] = ${JSON.stringify(den.length ? den : [1])}`);
      const n = Math.max(0, den.length - 1);
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
    return `out["${sanitizeId(from)}"]`;
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
  order.forEach((id) => {
    const block = byId.get(id);
    if (!block) return;
    const bid = sanitizeId(block.id);
    const params = block.params || {};
    const type = block.type;
    const in0 = getInputExpr(block.id, 0, type === "mult" ? "1.0" : "0.0");
    const in1 = getInputExpr(block.id, 1, type === "mult" ? "1.0" : "0.0");
    const in2 = getInputExpr(block.id, 2, type === "mult" ? "1.0" : "0.0");
    lines.push(`    # ${block.type} ${block.id}`);
    if (type === "labelSource") {
      const name = sanitizeId(block.params?.name || block.id);
      lines.push(`    out["${bid}"] = inputs.get("${name}", 0.0) if inputs else 0.0`);
    } else if (type === "labelSink") {
      const name = sanitizeId(block.params?.name || block.id);
      lines.push(`    out["${bid}"] = ${in0}`);
      lines.push(`    if outputs is not None: outputs["${name}"] = out["${bid}"]`);
    } else if (type === "constant") {
      lines.push(`    out["${bid}"] = ${resolveNumeric(params.value, variables)}`);
    } else if (type === "step") {
      lines.push(`    out["${bid}"] = 1.0 if t >= ${resolveNumeric(params.stepTime, variables)} else 0.0`);
    } else if (type === "ramp") {
      const start = resolveNumeric(params.start, variables);
      const slope = resolveNumeric(params.slope, variables);
      lines.push(`    out["${bid}"] = (t - ${start}) * ${slope} if t >= ${start} else 0.0`);
    } else if (type === "impulse") {
      lines.push(`    out["${bid}"] = (${resolveNumeric(params.amp, variables)} / max(dt, 1e-6)) if abs(t - ${resolveNumeric(params.time, variables)}) <= dt * 0.5 else 0.0`);
    } else if (type === "sine") {
      lines.push(`    out["${bid}"] = ${resolveNumeric(params.amp, variables)} * math.sin(2.0 * math.pi * ${resolveNumeric(params.freq, variables)} * t + ${resolveNumeric(params.phase, variables)})`);
    } else if (type === "chirp") {
      const f0 = resolveNumeric(params.f0, variables);
      const f1 = resolveNumeric(params.f1, variables);
      const t1 = Math.max(0.001, resolveNumeric(params.t1, variables) || 1);
      lines.push(`    k = (${f1} - ${f0}) / ${t1}`);
      lines.push(`    out["${bid}"] = ${resolveNumeric(params.amp, variables)} * math.sin(2.0 * math.pi * (${f0} * t + 0.5 * k * t * t))`);
    } else if (type === "noise") {
      lines.push(`    state["rng_${bid}"] = (1664525 * state["rng_${bid}"] + 1013904223) & 0xFFFFFFFF`);
      lines.push(`    out["${bid}"] = ${resolveNumeric(params.amp, variables)} * ((state["rng_${bid}"] / 4294967295.0) * 2.0 - 1.0)`);
    } else if (type === "fileSource") {
      lines.push(`    out["${bid}"] = 0.0  # TODO: file source`);
    } else if (type === "gain") {
      lines.push(`    out["${bid}"] = (${in0}) * ${resolveNumeric(params.gain, variables)}`);
    } else if (type === "sum") {
      const signs = params.signs || [];
      const terms = [0, 1, 2].map((i) => {
        const sign = signs[i] == null ? 1 : Number(signs[i]) || 1;
        return `(${getInputExpr(block.id, i, "0.0")}) * ${sign}`;
      });
      lines.push(`    out["${bid}"] = ${terms.join(" + ")}`);
    } else if (type === "mult") {
      lines.push(`    out["${bid}"] = (${in0}) * (${in1}) * (${in2})`);
    } else if (type === "saturation") {
      lines.push(`    v = ${in0}`);
      lines.push(`    v = min(${resolveNumeric(params.max, variables)}, max(${resolveNumeric(params.min, variables)}, v))`);
      lines.push(`    out["${bid}"] = v`);
    } else if (type === "integrator") {
      lines.push(`    out["${bid}"] = state["int_${bid}"]`);
      lines.push(`    state["int_${bid}"] += (${in0}) * dt`);
    } else if (type === "derivative") {
      lines.push(`    out["${bid}"] = (${in0} - state["der_prev_${bid}"]) / max(dt, 1e-6)`);
      lines.push(`    state["der_prev_${bid}"] = ${in0}`);
    } else if (type === "delay") {
      lines.push(`    buf = state["delay_buf_${bid}"]`);
      lines.push(`    idx = state["delay_idx_${bid}"]`);
      lines.push(`    out["${bid}"] = buf[idx]`);
      lines.push(`    buf[idx] = ${in0}`);
      lines.push(`    state["delay_idx_${bid}"] = (idx + 1) % len(buf)`);
    } else if (type === "ddelay") {
      const steps = Math.max(1, Math.round(resolveNumeric(params.steps, variables) || 1));
      const ts = Math.max(0.001, resolveNumeric(params.ts, variables) || 0.1);
      lines.push(`    out["${bid}"] = state["ddelay_last_${bid}"]`);
      lines.push(`    if t + 1e-6 >= state["ddelay_next_${bid}"]:`); 
      lines.push(`        buf = state["ddelay_buf_${bid}"]`);
      lines.push(`        for i in range(${steps - 1}): buf[i] = buf[i + 1]`);
      lines.push(`        buf[${steps - 1}] = ${in0}`);
      lines.push(`        state["ddelay_last_${bid}"] = buf[0]`);
      lines.push(`        state["ddelay_next_${bid}"] = t + ${ts}`);
    } else if (type === "rate") {
      const rise = Math.max(0, resolveNumeric(params.rise, variables));
      const fall = Math.max(0, resolveNumeric(params.fall, variables));
      lines.push(`    v = ${in0}`);
      lines.push(`    max_rise = state["rate_${bid}"] + ${rise} * dt`);
      lines.push(`    max_fall = state["rate_${bid}"] - ${fall} * dt`);
      lines.push(`    if v > max_rise: v = max_rise`);
      lines.push(`    if v < max_fall: v = max_fall`);
      lines.push(`    state["rate_${bid}"] = v`);
      lines.push(`    out["${bid}"] = v`);
    } else if (type === "backlash") {
      const width = Math.max(0, resolveNumeric(params.width, variables));
      lines.push(`    v = ${in0}`);
      lines.push(`    if v > state["backlash_${bid}"] + ${width} / 2.0: state["backlash_${bid}"] = v - ${width} / 2.0`);
      lines.push(`    if v < state["backlash_${bid}"] - ${width} / 2.0: state["backlash_${bid}"] = v + ${width} / 2.0`);
      lines.push(`    out["${bid}"] = state["backlash_${bid}"]`);
    } else if (type === "lpf") {
      const fc = Math.max(0, resolveNumeric(params.cutoff, variables));
      lines.push(`    out["${bid}"] = state["lpf_${bid}"]`);
      lines.push(`    state["lpf_${bid}"] += dt * (2.0 * math.pi * ${fc}) * (${in0} - state["lpf_${bid}"])`);
    } else if (type === "hpf") {
      const fc = Math.max(0, resolveNumeric(params.cutoff, variables));
      lines.push(`    out["${bid}"] = state["hpf_out_${bid}"]`);
      lines.push(`    state["hpf_${bid}"] += dt * (2.0 * math.pi * ${fc}) * (${in0} - state["hpf_${bid}"])`);
      lines.push(`    state["hpf_out_${bid}"] = ${in0} - state["hpf_${bid}"]`);
    } else if (type === "pid") {
      const kp = resolveNumeric(params.kp, variables);
      const ki = resolveNumeric(params.ki, variables);
      const kd = resolveNumeric(params.kd, variables);
      lines.push(`    v = ${in0}`);
      lines.push(`    state["pid_int_${bid}"] += v * dt`);
      lines.push(`    deriv = (v - state["pid_prev_${bid}"]) / max(dt, 1e-6)`);
      lines.push(`    state["pid_out_${bid}"] = ${kp} * v + ${ki} * state["pid_int_${bid}"] + ${kd} * deriv`);
      lines.push(`    state["pid_prev_${bid}"] = v`);
      lines.push(`    out["${bid}"] = state["pid_out_${bid}"]`);
    } else if (type === "zoh") {
      const ts = Math.max(0.001, resolveNumeric(params.ts, variables) || resolveNumeric(sampleTime, variables));
      lines.push(`    out["${bid}"] = state["zoh_last_${bid}"]`);
      lines.push(`    if t + 1e-6 >= state["zoh_next_${bid}"]:`); 
      lines.push(`        state["zoh_last_${bid}"] = ${in0}`);
      lines.push(`        state["zoh_next_${bid}"] = t + ${ts}`);
    } else if (type === "foh") {
      const ts = Math.max(0.001, resolveNumeric(params.ts, variables) || resolveNumeric(sampleTime, variables));
      lines.push(`    slope = (state["foh_last_${bid}"] - state["foh_prev_${bid}"]) / ${ts}`);
      lines.push(`    out["${bid}"] = state["foh_last_${bid}"] + slope * (t - state["foh_last_t_${bid}"])`);
      lines.push(`    if t + 1e-6 >= state["foh_next_${bid}"]:`); 
      lines.push(`        state["foh_prev_${bid}"] = state["foh_last_${bid}"]`);
      lines.push(`        state["foh_last_${bid}"] = ${in0}`);
      lines.push(`        state["foh_last_t_${bid}"] = t`);
      lines.push(`        state["foh_next_${bid}"] = t + ${ts}`);
    } else if (type === "dtf") {
      const ts = Math.max(0.001, resolveNumeric(params.ts, variables) || resolveNumeric(sampleTime, variables));
      lines.push(`    out["${bid}"] = state["dtf_y_${bid}"][0] if state["dtf_y_${bid}"] else 0.0`);
      lines.push(`    if t + 1e-6 >= state["dtf_next_${bid}"]:`); 
      lines.push(`        xhist = state["dtf_x_${bid}"]`);
      lines.push(`        yhist = state["dtf_y_${bid}"]`);
      lines.push(`        num = state["dtf_num_${bid}"]`);
      lines.push(`        den = state["dtf_den_${bid}"]`);
      lines.push(`        for i in range(len(xhist) - 1, 0, -1): xhist[i] = xhist[i - 1]`);
      lines.push(`        xhist[0] = ${in0}`);
      lines.push(`        y = 0.0`);
      lines.push(`        for i in range(len(num)): y += num[i] * xhist[i]`);
      lines.push(`        for i in range(1, len(den)): y -= den[i] * yhist[i - 1]`);
      lines.push(`        if yhist:`);
      lines.push(`            for i in range(len(yhist) - 1, 0, -1): yhist[i] = yhist[i - 1]`);
      lines.push(`            yhist[0] = y`);
      lines.push(`        state["dtf_next_${bid}"] = t + ${ts}`);
    } else if (type === "tf") {
      const num = parseList(params.num, variables);
      const den = parseList(params.den, variables);
      const n = Math.max(0, den.length - 1);
      lines.push(`    out["${bid}"] = state.get("tf_out_${bid}", 0.0)`);
      lines.push(`    if ${n} == 0:`);
      lines.push(`        out["${bid}"] = (${num[0] || 0}) * (${in0}) / max(${den[0] || 1}, 1e-9)`);
      lines.push("    else:");
      lines.push(`        x = state["tf_x_${bid}"]`);
      lines.push(`        a = ${JSON.stringify(den)}`);
      lines.push(`        b = ${JSON.stringify(num)}`);
      lines.push(`        dx = [0.0] * len(x)`);
      lines.push("        for i in range(len(x)):");
      lines.push("            if i < len(x) - 1: dx[i] = x[i + 1]");
      lines.push("            else: dx[i] = 0.0 - sum(a[j + 1] * x[j] for j in range(len(x)))");
      lines.push("        for i in range(len(x)): x[i] += dx[i] * dt");
      lines.push("        y = (b[0] if b else 0.0) * " + in0);
      lines.push("        for i in range(len(x)): y += (b[i + 1] if i + 1 < len(b) else 0.0) * x[i]");
      lines.push(`        out["${bid}"] = y`);
      lines.push(`        state["tf_out_${bid}"] = y`);
    } else if (type === "stateSpace") {
      const A = resolveNumeric(params.A, variables);
      const B = resolveNumeric(params.B, variables);
      const C = resolveNumeric(params.C, variables);
      const D = resolveNumeric(params.D, variables);
      lines.push(`    out["${bid}"] = ${C} * state["ss_x_${bid}"] + ${D} * (${in0})`);
      lines.push(`    state["ss_x_${bid}"] += dt * (${A} * state["ss_x_${bid}"] + ${B} * (${in0}))`);
    } else if (type === "dstateSpace") {
      const A = resolveNumeric(params.A, variables);
      const B = resolveNumeric(params.B, variables);
      const C = resolveNumeric(params.C, variables);
      const D = resolveNumeric(params.D, variables);
      const ts = Math.max(0.001, resolveNumeric(params.ts, variables) || resolveNumeric(sampleTime, variables));
      lines.push(`    out["${bid}"] = state["dss_last_${bid}"]`);
      lines.push(`    if t + 1e-6 >= state["dss_next_${bid}"]:`); 
      lines.push(`        state["dss_x_${bid}"] = ${A} * state["dss_x_${bid}"] + ${B} * (${in0})`);
      lines.push(`        state["dss_last_${bid}"] = ${C} * state["dss_x_${bid}"] + ${D} * (${in0})`);
      lines.push(`        state["dss_next_${bid}"] = t + ${ts}`);
    } else if (type === "scope" || type === "fileSink") {
      lines.push(`    # ${type} sink omitted`);
      lines.push(`    out["${bid}"] = ${in0}`);
    } else {
      lines.push(`    out["${bid}"] = 0.0  # TODO: ${type}`);
    }
  });
  lines.push("    return out");
  lines.push("");
  lines.push("def run_step(state, inputs=None, outputs=None, t=0.0, dt=None):");
  lines.push("    return run_step_internal(state, inputs or {}, outputs, t, dt)");
  lines.push("");
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
  labelSources.forEach((b) => {
    const name = sanitizeId(b.params?.name || b.id);
    lines.push(`            vals["${name}"] = float(row.get("${name}", 0.0) or 0.0)`);
  });
  if (!labelSources.length) {
    lines.push("            vals['_unused'] = 0.0");
  }
  lines.push("            times.append(t)");
  lines.push("            rows.append(vals)");
  lines.push("    return times, rows");
  lines.push("");
  lines.push("def _write_output_header(writer):");
  lines.push("    header = ['t']");
  labelSinks.forEach((b) => {
    const name = sanitizeId(b.params?.name || b.id);
    lines.push(`    header.append("${name}")`);
  });
  if (!labelSinks.length) {
    lines.push("    header.append('_unused')");
  }
  lines.push("    writer.writerow(header)");
  lines.push("");
  lines.push("def main(argv=None):");
  lines.push("    import argparse, sys, csv");
  lines.push("    parser = argparse.ArgumentParser()");
  lines.push("    parser.add_argument('-t', type=float, default=1.0)");
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
  labelSinks.forEach((b) => {
    const name = sanitizeId(b.params?.name || b.id);
    lines.push(`        row.append(f\"{outputs.get('${name}', 0.0):.6f}\")`);
  });
  if (!labelSinks.length) {
    lines.push("        row.append('0.000000')");
  }
  lines.push("        writer.writerow(row)");
  lines.push("        t += dt");
  lines.push("    if args.output: out_f.close()");
  lines.push("");
  lines.push("if __name__ == '__main__':");
  lines.push("    main()");
  lines.push("");
  return lines.join("\n");
};
