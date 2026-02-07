import { mkdtempSync, writeFileSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { spawnSync } from "child_process";
import assert from "assert/strict";
import { simulate } from "../sim.js";
import { simHandlers, resolveLabelSourcesOnce } from "../blocks/sim/index.js";

export const SAMPLE_TIME = 0.01;
export const DURATION = 0.1;

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

const INPUT_COUNTS = {
  constant: 0,
  step: 0,
  ramp: 0,
  impulse: 0,
  sine: 0,
  chirp: 0,
  noise: 0,
  fileSource: 0,
  labelSource: 0,
  gain: 1,
  sum: 3,
  mult: 3,
  integrator: 1,
  derivative: 1,
  delay: 1,
  ddelay: 1,
  tf: 1,
  dtf: 1,
  stateSpace: 1,
  dstateSpace: 1,
  lpf: 1,
  hpf: 1,
  pid: 1,
  saturation: 1,
  rate: 1,
  backlash: 1,
  zoh: 1,
  foh: 1,
  switch: 3,
  subsystem: 1,
  scope: 3,
  fileSink: 1,
  labelSink: 1,
};

const normalizeVarName = (name) => {
  if (!name) return "";
  const trimmed = String(name).trim();
  if (trimmed.startsWith("\\")) return trimmed.slice(1);
  return trimmed;
};

export function parseVariables(text) {
  const vars = { pi: Math.PI, e: Math.E };
  const lines = String(text || "").split(/\r?\n/);
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const idx = trimmed.indexOf("=");
    if (idx < 0) return;
    const name = trimmed.slice(0, idx).trim();
    const expr = trimmed.slice(idx + 1).trim();
    if (!name) return;
    const key = normalizeVarName(name);
    if (!key) return;
    const value = evalExpression(expr, vars);
    if (Number.isFinite(value)) vars[key] = value;
  });
  return vars;
}

export function parseYaml(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\t/g, "  "))
    .filter((line) => line.trim().length > 0 && !line.trim().startsWith("#"))
    .map((line) => ({
      indent: line.match(/^ */)[0].length,
      text: line.trim(),
    }));
  let index = 0;

  const parseScalar = (raw) => {
    if (raw === "null") return null;
    if (raw === "true") return true;
    if (raw === "false") return false;
    if (raw === "[]") return [];
    if (raw === "{}") return {};
    if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
    if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
      try {
        return JSON.parse(raw);
      } catch {
        return raw.slice(1, -1);
      }
    }
    return raw;
  };

  const nextNonEmpty = (start) => {
    for (let i = start; i < lines.length; i += 1) {
      if (lines[i]) return lines[i];
    }
    return null;
  };

  const parseBlock = (indentLevel) => {
    const current = lines[index];
    if (!current) return { value: null, next: index };
    if (current.text.startsWith("- ") || current.text === "-") return parseArray(indentLevel);
    return parseObject(indentLevel);
  };

  const parseArray = (indentLevel) => {
    const arr = [];
    while (index < lines.length) {
      const line = lines[index];
      if (line.indent < indentLevel || !(line.text.startsWith("- ") || line.text === "-")) break;
      const itemText = line.text === "-" ? "" : line.text.slice(2).trim();
      if (!itemText) {
        index += 1;
        const next = nextNonEmpty(index);
        if (next && next.indent > line.indent) {
          const parsed = parseBlock(line.indent + 2);
          arr.push(parsed.value);
          index = parsed.next;
        } else {
          arr.push(null);
        }
        continue;
      }
      if (itemText.includes(":")) {
        const [rawKey, ...rest] = itemText.split(":");
        const key = rawKey.trim();
        const valueRaw = rest.join(":").trim();
        const obj = {};
        if (valueRaw) {
          obj[key] = parseScalar(valueRaw);
          index += 1;
        } else {
          index += 1;
          const next = nextNonEmpty(index);
          if (next && next.indent > line.indent) {
            const parsed = parseBlock(line.indent + 2);
            obj[key] = parsed.value;
            index = parsed.next;
          } else {
            obj[key] = null;
          }
        }
        const nextLine = nextNonEmpty(index);
        if (nextLine && nextLine.indent > line.indent) {
          const parsed = parseObject(line.indent + 2);
          Object.assign(obj, parsed.value);
          index = parsed.next;
        }
        arr.push(obj);
        continue;
      }
      arr.push(parseScalar(itemText));
      index += 1;
    }
    return { value: arr, next: index };
  };

  const parseObject = (indentLevel) => {
    const obj = {};
    while (index < lines.length) {
      const line = lines[index];
      if (line.indent < indentLevel || line.text.startsWith("- ") || line.text === "-") break;
      const [rawKey, ...rest] = line.text.split(":");
      const key = rawKey.trim();
      const valueRaw = rest.join(":").trim();
      if (!valueRaw) {
        index += 1;
        const next = nextNonEmpty(index);
        if (next && next.indent > line.indent) {
          const parsed = parseBlock(line.indent + 2);
          obj[key] = parsed.value;
          index = parsed.next;
        } else {
          obj[key] = null;
        }
      } else {
        obj[key] = parseScalar(valueRaw);
        index += 1;
      }
    }
    return { value: obj, next: index };
  };

  const parsed = parseObject(0);
  return parsed.value;
}

export function loadDiagramFromYaml(path) {
  const raw = readFileSync(path, "utf8");
  const data = parseYaml(raw);
  const variablesText = typeof data.variables === "string" ? data.variables : "";
  const variables = parseVariables(variablesText);
  return {
    ...data,
    variables,
    blocks: Array.isArray(data.blocks) ? data.blocks : [],
    connections: Array.isArray(data.connections) ? data.connections : [],
  };
}

export function runJsSimOutputs(diagram, duration = DURATION, dt = SAMPLE_TIME) {
  const blocks = Array.isArray(diagram.blocks) ? diagram.blocks : [];
  const blocksWithInputs = blocks.map((block) => ({
    ...block,
    inputs: INPUT_COUNTS[block.type] ?? 0,
  }));
  const connections = Array.isArray(diagram.connections) ? diagram.connections : [];
  const variables = diagram.variables || { pi: Math.PI, e: Math.E };
  const blockObjects = new Map();
  blocks.forEach((block) => {
    blockObjects.set(block.id, {
      id: block.id,
      type: block.type,
      inputs: INPUT_COUNTS[block.type] ?? 0,
      outputs: 0,
      params: block.params || {},
    });
  });

  const inputMap = new Map();
  blockObjects.forEach((block) => {
    inputMap.set(block.id, Array(block.inputs).fill(null));
  });
  connections.forEach((conn) => {
    const inputs = inputMap.get(conn.to);
    if (!inputs) return;
    if (conn.toIndex < inputs.length) inputs[conn.toIndex] = conn.from;
  });

  const resolveParam = (value, block, key) => {
    if (block.type === "labelSource" || block.type === "labelSink") {
      if (key === "name") return value;
    }
    if (block.type === "switch" && key === "condition") {
      return value;
    }
    if (block.type === "subsystem" && (key === "name" || key === "externalInputs" || key === "externalOutputs" || key === "subsystem")) {
      return value;
    }
    if (block.type === "fileSource" || block.type === "fileSink") {
      if (key === "path" || key === "times" || key === "values" || key === "lastCsv") return value;
    }
    if (key === "signs") return value;
    if (Array.isArray(value)) {
      return value.map((v) => {
        const out = evalExpression(v, variables);
        return Number.isFinite(out) ? out : 0;
      });
    }
    const out = evalExpression(value, variables);
    return Number.isFinite(out) ? out : 0;
  };

  const resolvedParams = new Map();
  blocksWithInputs.forEach((block) => {
    const params = block.params || {};
    const resolved = {};
    Object.entries(params).forEach(([key, value]) => {
      resolved[key] = resolveParam(value, block, key);
    });
    resolvedParams.set(block.id, resolved);
  });

  const labelSinks = new Map();
  const blockState = new Map();
  const ctx = {
    resolvedParams,
    inputMap,
    labelSinks,
    blockState,
    dt,
  };

  blocksWithInputs.forEach((block) => {
    const handler = simHandlers[block.type];
    if (handler?.init) handler.init(ctx, block);
  });

  const outputNames = [];
  const outputNameSet = new Set();
  const outputNameToBlock = new Map();
  blocksWithInputs.forEach((block) => {
    if (block.type !== "labelSink") return;
    const name = String(block.params?.name || "").trim();
    if (!name) return;
    if (!outputNameSet.has(name)) {
      outputNameSet.add(name);
      outputNames.push(name);
    }
    outputNameToBlock.set(name, block.id);
  });

  const outputSeries = outputNames.map(() => []);
  const time = [];
  const samples = Math.floor(duration / dt);
  for (let i = 0; i <= samples; i += 1) {
    const t = i * dt;
    time.push(t);
    const outputs = new Map();
    ctx.t = t;
    ctx.outputs = outputs;

    blocksWithInputs.forEach((block) => {
      const handler = simHandlers[block.type];
      if (handler?.output) handler.output(ctx, block);
    });

    const resolveLabelSources = () =>
      resolveLabelSourcesOnce(blocks, outputs, inputMap, labelSinks);
    let progress = true;
    let iter = 0;
    const maxIter = 50;
    while (progress && iter < maxIter) {
      iter += 1;
      progress = false;
      if (resolveLabelSources()) progress = true;
      blocksWithInputs.forEach((block) => {
        const handler = simHandlers[block.type];
        if (!handler?.algebraic) return;
        const result = handler.algebraic(ctx, block);
        if (result?.updated) progress = true;
      });
      if (resolveLabelSources()) progress = true;
    }

    blocksWithInputs.forEach((block) => {
      const handler = simHandlers[block.type];
      if (handler?.afterStep) handler.afterStep(ctx, block);
    });

    outputNames.forEach((name, idx) => {
      const sinkId = outputNameToBlock.get(name);
      const inputs = sinkId ? inputMap.get(sinkId) : null;
      const fromId = inputs ? inputs[0] : null;
      const value = fromId ? outputs.get(fromId) : 0;
      outputSeries[idx].push(value ?? 0);
    });

    blocksWithInputs.forEach((block) => {
      const handler = simHandlers[block.type];
      if (handler?.update) handler.update(ctx, block);
    });
  }

  return { time, names: outputNames, series: outputSeries };
}

export function buildBasicDiagram() {
  return {
    blocks: [
      { id: "b1", type: "constant", x: 100, y: 100, rotation: 0, params: { value: 2 } },
      { id: "b2", type: "gain", x: 220, y: 100, rotation: 0, params: { gain: 3 } },
      { id: "b3", type: "scope", x: 340, y: 100, rotation: 0, params: { tMin: "", tMax: "", yMin: "", yMax: "" } },
      { id: "b4", type: "labelSink", x: 340, y: 180, rotation: 0, params: { name: "y", showNode: true } },
    ],
    connections: [
      { from: "b1", to: "b2", fromIndex: 0, toIndex: 0 },
      { from: "b2", to: "b3", fromIndex: 0, toIndex: 0 },
      { from: "b2", to: "b4", fromIndex: 0, toIndex: 0 },
    ],
    variables: {},
  };
}

export function runJsSim(diagram, duration = DURATION, dt = SAMPLE_TIME) {
  const blockObjects = new Map();
  diagram.blocks.forEach((block) => {
    const inputCounts = {
      gain: 1,
      sum: 3,
      mult: 3,
      scope: 1,
      labelSink: 1,
    };
    blockObjects.set(block.id, {
      id: block.id,
      type: block.type,
      inputs: inputCounts[block.type] ?? 0,
      outputs: block.type === "constant" || block.type === "gain" ? 1 : 0,
      params: block.params || {},
      scopeData: null,
    });
  });

  const scopeBlock = blockObjects.get("b3");
  const state = {
    blocks: blockObjects,
    connections: diagram.connections.map((conn) => ({ ...conn })),
    variables: diagram.variables || {},
  };
  const runtimeInput = { value: String(duration) };
  const statusEl = { textContent: "" };

  simulate({ state, runtimeInput, statusEl });
  assert.ok(scopeBlock?.scopeData, "scope data should be populated by simulate");
  return {
    time: scopeBlock.scopeData.time,
    series: scopeBlock.scopeData.series[0],
    dt,
  };
}

export function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const [t, ...rest] = lines[i].split(",");
    rows.push({ t: Number(t), values: rest.map(Number) });
  }
  return rows;
}

export function assertSeriesClose(jsSeries, csvRows, tol = 1.0) {
  assert.equal(jsSeries.time.length, csvRows.length, "time sample count should match");
  jsSeries.series.forEach((value, idx) => {
    const row = csvRows[idx];
    assert.ok(row, "row should exist");
    const out = row.values[0] ?? 0;
    assert.ok(Math.abs(value - out) <= tol, `value mismatch at ${idx}: ${value} vs ${out}`);
  });
}

export function assertMultiSeriesClose(jsSeries, csvRows, tol = 1.0) {
  assert.equal(jsSeries.time.length, csvRows.length, "time sample count should match");
  jsSeries.series.forEach((series, seriesIdx) => {
    series.forEach((value, idx) => {
      const row = csvRows[idx];
      assert.ok(row, "row should exist");
      const out = row.values[seriesIdx] ?? 0;
      assert.ok(Math.abs(value - out) <= tol, `series ${seriesIdx} mismatch at ${idx}: ${value} vs ${out}`);
    });
  });
}

export function runGeneratedC(code, duration = DURATION) {
  const dir = mkdtempSync(join(tmpdir(), "vibesim-c-"));
  const cPath = join(dir, "model.c");
  const exePath = join(dir, "model");
  writeFileSync(cPath, code, "utf8");
  const build = spawnSync("gcc", [cPath, "-O2", "-lm", "-o", exePath], { encoding: "utf8" });
  assert.equal(build.status, 0, `gcc failed: ${build.stderr || build.stdout}`);
  const run = spawnSync(exePath, ["-t", String(duration)], { encoding: "utf8" });
  assert.equal(run.status, 0, `c run failed: ${run.stderr || run.stdout}`);
  return parseCsv(run.stdout);
}

export function runGeneratedPython(code, duration = DURATION) {
  const dir = mkdtempSync(join(tmpdir(), "vibesim-py-"));
  const pyPath = join(dir, "model.py");
  writeFileSync(pyPath, code, "utf8");
  const run = spawnSync("python3", [pyPath, "-t", String(duration)], { encoding: "utf8" });
  assert.equal(run.status, 0, `python run failed: ${run.stderr || run.stdout}`);
  return parseCsv(run.stdout);
}
