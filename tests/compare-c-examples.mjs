import assert from "assert/strict";
import { readdirSync } from "fs";
import { join } from "path";
import { generateC } from "../codegen/c.js";
import {
  loadDiagramFromYaml,
  runJsSimOutputs,
  runGeneratedC,
  assertMultiSeriesClose,
  SAMPLE_TIME,
} from "./codegen-helpers.mjs";

const examplesDir = "examples";
const exampleFiles = readdirSync(examplesDir).filter((name) => name.endsWith(".yaml"));

assert.ok(exampleFiles.length > 0, "no example YAML files found");

exampleFiles.forEach((file) => {
  console.log(`c compare start: ${file}`);
  const diagram = loadDiagramFromYaml(join(examplesDir, file));
  const duration = Number.isFinite(Number(diagram.runtime)) && Number(diagram.runtime) > 0
    ? Number(diagram.runtime)
    : 10.0;
  const jsSeries = runJsSimOutputs(diagram, duration, SAMPLE_TIME);
  const cCode = generateC(diagram, { sampleTime: SAMPLE_TIME });
  const cRows = runGeneratedC(cCode, duration);
  assertMultiSeriesClose(jsSeries, cRows, 1e-3);
  console.log(`c compare ok: ${file}`);
});

console.log("c compare examples passed");
