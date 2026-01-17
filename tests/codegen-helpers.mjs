import { mkdtempSync, writeFileSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { spawnSync } from "child_process";
import assert from "assert/strict";
import { simulate } from "../sim.js";

export const SAMPLE_TIME = 0.01;
export const DURATION = 0.1;

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

export function assertSeriesClose(jsSeries, csvRows, tol = 1e-6) {
  assert.equal(jsSeries.time.length, csvRows.length, "time sample count should match");
  jsSeries.series.forEach((value, idx) => {
    const row = csvRows[idx];
    assert.ok(row, "row should exist");
    const out = row.values[0] ?? 0;
    assert.ok(Math.abs(value - out) <= tol, `value mismatch at ${idx}: ${value} vs ${out}`);
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
