import assert from "assert/strict";
import { readdirSync } from "fs";
import { join } from "path";
import { generatePython } from "../codegen/python.js";
import {
  loadDiagramFromYaml,
  runJsSimOutputs,
  runGeneratedPython,
  assertMultiSeriesClose,
  SAMPLE_TIME,
} from "./codegen-helpers.mjs";

const examplesDir = "examples";
const exampleFiles = readdirSync(examplesDir).filter((name) => name.endsWith(".yaml"));

assert.ok(exampleFiles.length > 0, "no example YAML files found");

exampleFiles.forEach((file) => {
  console.log(`python compare start: ${file}`);
  const diagram = loadDiagramFromYaml(join(examplesDir, file));
  const duration = Number.isFinite(Number(diagram.runtime)) && Number(diagram.runtime) > 0
    ? Number(diagram.runtime)
    : 10.0;
  const jsSeries = runJsSimOutputs(diagram, duration, SAMPLE_TIME);
  const pyCode = generatePython(diagram, { sampleTime: SAMPLE_TIME });
  const pyRows = runGeneratedPython(pyCode, duration);
  assertMultiSeriesClose(jsSeries, pyRows, 1e-3);
  console.log(`python compare ok: ${file}`);
});

console.log("python compare examples passed");
