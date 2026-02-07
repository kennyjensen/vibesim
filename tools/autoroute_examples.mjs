import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { GRID_SIZE } from "../geometry.js";
import { buildBlockTemplates } from "../blocks/index.js";
import { routeAllConnections } from "../router.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const examplesDir = path.join(repoRoot, "examples");

const dummyHelpers = {
  GRID_SIZE,
  createSvgElement: () => ({}),
  svgRect: () => ({}),
  svgText: () => ({}),
  renderTeXMath: () => {},
  renderSourcePlot: () => {},
  renderCenteredAxesPlot: () => {},
  renderLabelNode: () => {},
};

const templates = buildBlockTemplates(dummyHelpers);

function parseYAML(text) {
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
    if ((raw.startsWith("[") && raw.endsWith("]")) || (raw.startsWith("{") && raw.endsWith("}"))) {
      try {
        return JSON.parse(raw);
      } catch {
        // treat as text
      }
    }
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
      if (!line.text.includes(":")) {
        index += 1;
        continue;
      }
      const [rawKey, ...rest] = line.text.split(":");
      const key = rawKey.trim();
      const valueRaw = rest.join(":").trim();
      if (!key || key === "{}") {
        index += 1;
        continue;
      }
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

  return parseObject(0).value;
}

function toYAML(data) {
  const lines = [];
  const isPointPairArray = (value) =>
    Array.isArray(value)
    && value.length > 0
    && value.every((item) =>
      Array.isArray(item)
      && item.length >= 2
      && Number.isFinite(Number(item[0]))
      && Number.isFinite(Number(item[1])));

  const yamlScalar = (value) => {
    if (value === null || value === undefined) return "null";
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    if (typeof value === "boolean") return value ? "true" : "false";
    if (Array.isArray(value)) return JSON.stringify(value);
    const str = String(value);
    if (/^[A-Za-z0-9_.-]+$/.test(str)) return str;
    return JSON.stringify(str);
  };

  const write = (value, indent) => {
    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${" ".repeat(indent)}[]`);
        return;
      }
      if (isPointPairArray(value)) {
        lines.push(`${" ".repeat(indent)}${JSON.stringify(value)}`);
        return;
      }
      value.forEach((item) => {
        if (typeof item === "object" && item !== null) {
          lines.push(`${" ".repeat(indent)}-`);
          write(item, indent + 2);
        } else {
          lines.push(`${" ".repeat(indent)}- ${yamlScalar(item)}`);
        }
      });
      return;
    }
    if (typeof value === "object" && value !== null) {
      const entries = Object.entries(value);
      if (entries.length === 0) {
        lines.push(`${" ".repeat(indent)}{}`);
        return;
      }
      entries.forEach(([key, val]) => {
        if (Array.isArray(val) && val.length === 0) {
          lines.push(`${" ".repeat(indent)}${key}: []`);
          return;
        }
        if (isPointPairArray(val)) {
          lines.push(`${" ".repeat(indent)}${key}: ${JSON.stringify(val)}`);
          return;
        }
        if (typeof val === "object" && val !== null) {
          lines.push(`${" ".repeat(indent)}${key}:`);
          write(val, indent + 2);
        } else {
          lines.push(`${" ".repeat(indent)}${key}: ${yamlScalar(val)}`);
        }
      });
      return;
    }
    lines.push(`${" ".repeat(indent)}${yamlScalar(value)}`);
  };

  write(data, 0);
  return `${lines.join("\n")}\n`;
}

function normalizePoints(rawPoints) {
  if (!Array.isArray(rawPoints)) return [];
  const pts = rawPoints
    .map((pt) => {
      if (Array.isArray(pt) && pt.length >= 2) {
        return { x: Number(pt[0]), y: Number(pt[1]) };
      }
      return { x: Number(pt?.x), y: Number(pt?.y) };
    })
    .filter((pt) => Number.isFinite(pt.x) && Number.isFinite(pt.y));
  return pts;
}

function materializeBlock(blockData) {
  const template = templates[blockData.type];
  if (!template) return null;
  const params = { ...(template.defaultParams || {}), ...(blockData.params || {}) };
  const block = {
    id: blockData.id,
    type: blockData.type,
    x: Number(blockData.x) || 0,
    y: Number(blockData.y) || 0,
    width: template.width,
    height: template.height,
    rotation: Number(blockData.rotation) || 0,
    params,
    ports: [],
    dynamicInputs: null,
    dynamicOutputs: null,
  };

  if (Number.isFinite(Number(params.width)) && Number(params.width) > 0) block.width = Number(params.width);
  if (Number.isFinite(Number(params.height)) && Number(params.height) > 0) block.height = Number(params.height);
  if (typeof template.resize === "function") template.resize(block);

  const inputs = Array.isArray(block.dynamicInputs) ? block.dynamicInputs : (template.inputs || []);
  const outputs = Array.isArray(block.dynamicOutputs) ? block.dynamicOutputs : (template.outputs || []);
  inputs.forEach((port, index) => {
    block.ports.push({ type: "in", index, x: port.x, y: port.y, side: port.side });
  });
  outputs.forEach((port, index) => {
    block.ports.push({ type: "out", index, x: port.x, y: port.y, side: port.side });
  });
  return block;
}

function routeDiagram(data) {
  const blocksArr = Array.isArray(data.blocks) ? data.blocks : [];
  const connectionsArr = Array.isArray(data.connections) ? data.connections : [];

  const blocks = new Map();
  blocksArr.forEach((b) => {
    if (!b || !b.id || !b.type) return;
    const materialized = materializeBlock(b);
    if (!materialized) return;
    blocks.set(b.id, materialized);
  });

  const connections = [];
  connectionsArr.forEach((conn) => {
    if (!conn) return;
    if (!blocks.has(conn.from) || !blocks.has(conn.to)) return;
    connections.push({
      from: conn.from,
      to: conn.to,
      fromIndex: Number(conn.fromIndex ?? 0),
      toIndex: Number(conn.toIndex ?? 0),
      points: normalizePoints(conn.points),
    });
  });

  const state = {
    blocks,
    connections,
    dirtyConnections: new Set(),
    dirtyBlocks: new Set(),
    routingDirty: false,
  };

  routeAllConnections(state, 4000, 3000, { x: 0, y: 0 }, 2000, false);

  data.connections = connectionsArr.map((conn) => {
    const match = connections.find((c) =>
      c.from === conn.from
      && c.to === conn.to
      && (c.fromIndex ?? 0) === Number(conn.fromIndex ?? 0)
      && (c.toIndex ?? 0) === Number(conn.toIndex ?? 0)
    );
    if (!match || !Array.isArray(match.points) || match.points.length < 2) {
      const copy = { ...conn };
      delete copy.points;
      return copy;
    }
    return {
      ...conn,
      points: match.points.map((pt) => [Math.round(pt.x), Math.round(pt.y)]),
    };
  });
}

function main() {
  const files = fs.readdirSync(examplesDir).filter((name) => name.endsWith(".yaml")).sort();
  files.forEach((file) => {
    const full = path.join(examplesDir, file);
    const text = fs.readFileSync(full, "utf8");
    const data = parseYAML(text);
    routeDiagram(data);
    fs.writeFileSync(full, toYAML(data), "utf8");
    process.stdout.write(`updated ${file}\n`);
  });
}

main();
