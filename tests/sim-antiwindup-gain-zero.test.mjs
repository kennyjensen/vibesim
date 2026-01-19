import assert from "node:assert/strict";
import fs from "node:fs";
import { simHandlers, resolveLabelSourcesOnce } from "../blocks/sim/index.js";
import { evalExpression } from "../utils/expr.js";

const parseYAML = (text) => {
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
    if ((raw.startsWith("\"") && raw.endsWith("\"")) || (raw.startsWith("'") && raw.endsWith("'"))) {
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
};

const buildInputMap = (blocks, connections) => {
  const inputMap = new Map();
  blocks.forEach((block) => {
    const signCount = block.type === "sum" && Array.isArray(block.params?.signs)
      ? block.params.signs.length
      : 0;
    inputMap.set(block.id, Array(signCount).fill(null));
  });
  connections.forEach((conn) => {
    const inputs = inputMap.get(conn.to) || [];
    const idx = conn.toIndex ?? 0;
    if (inputs.length <= idx) inputs.length = idx + 1;
    inputs[idx] = conn.from;
    inputMap.set(conn.to, inputs);
  });
  return inputMap;
};

const simulateOutputSeries = (diagram, blockId) => {
  const blocks = Array.isArray(diagram.blocks) ? diagram.blocks : [];
  const connections = Array.isArray(diagram.connections) ? diagram.connections : [];
  const dt = 0.01;
  const duration = Math.max(0.1, Number(diagram.runtime) || 10);
  const samples = Math.floor(duration / dt);
  const variables = { pi: Math.PI, e: Math.E };

  const resolveParam = (value, key) => {
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
  blocks.forEach((block) => {
    const params = block.params || {};
    const resolved = {};
    Object.entries(params).forEach(([key, value]) => {
      resolved[key] = resolveParam(value, key);
    });
    resolvedParams.set(block.id, resolved);
  });

  const inputMap = buildInputMap(blocks, connections);
  blocks.forEach((block) => {
    const inputs = inputMap.get(block.id) || [];
    block.inputs = inputs.length;
  });
  const blockState = new Map();
  const labelSinks = new Map();
  const ctx = {
    resolvedParams,
    inputMap,
    labelSinks,
    blockState,
    dt,
  };

  blocks.forEach((block) => {
    const handler = simHandlers[block.type];
    if (handler?.init) handler.init(ctx, block);
  });

  const series = [];
  for (let i = 0; i <= samples; i += 1) {
    const t = i * dt;
    const outputs = new Map();
    ctx.t = t;
    ctx.outputs = outputs;

    blocks.forEach((block) => {
      const handler = simHandlers[block.type];
      if (handler?.output) handler.output(ctx, block);
    });

    let progress = true;
    let iter = 0;
    const maxIter = 50;
    while (progress && iter < maxIter) {
      iter += 1;
      progress = false;
      if (resolveLabelSourcesOnce(blocks, outputs, inputMap, labelSinks)) progress = true;
      blocks.forEach((block) => {
        const handler = simHandlers[block.type];
        if (!handler?.algebraic) return;
        const result = handler.algebraic(ctx, block);
        if (result?.updated) progress = true;
      });
      if (resolveLabelSourcesOnce(blocks, outputs, inputMap, labelSinks)) progress = true;
    }

    series.push(outputs.get(blockId) ?? 0);

    blocks.forEach((block) => {
      const handler = simHandlers[block.type];
      if (handler?.afterStep) handler.afterStep(ctx, block);
    });
    blocks.forEach((block) => {
      const handler = simHandlers[block.type];
      if (handler?.update) handler.update(ctx, block);
    });
  }

  return series;
};

const yamlText = fs.readFileSync(new URL("../examples/antiwindup.yaml", import.meta.url), "utf8");
const diagram = parseYAML(yamlText);
const diagramZero = JSON.parse(JSON.stringify(diagram));
const diagramTiny = JSON.parse(JSON.stringify(diagram));

diagramZero.blocks.find((block) => block.id === "b18").params.gain = 0;
diagramTiny.blocks.find((block) => block.id === "b18").params.gain = 0.001;

const seriesZero = simulateOutputSeries(diagramZero, "b8");
const seriesTiny = simulateOutputSeries(diagramTiny, "b8");

let maxDiff = 0;
for (let i = 0; i < seriesZero.length; i += 1) {
  const diff = Math.abs(seriesZero[i] - seriesTiny[i]);
  if (diff > maxDiff) maxDiff = diff;
}

assert.ok(
  maxDiff < 0.05,
  `windup gain=0 should be close to gain=0.001 (max diff ${maxDiff})`
);

console.log("sim windup gain zero tests passed");
