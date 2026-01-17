import assert from "assert/strict";
import { generatePython } from "../codegen/python.js";
import { buildBasicDiagram, runJsSim, runGeneratedPython, assertSeriesClose, SAMPLE_TIME } from "./codegen-helpers.mjs";

{
  const diagram = buildBasicDiagram();
  const jsSeries = runJsSim(diagram);
  const pyCode = generatePython(diagram, { sampleTime: SAMPLE_TIME });
  const rows = runGeneratedPython(pyCode);
  assert.ok(rows.length > 0, "expected Python output rows");
  assertSeriesClose(jsSeries, rows);
}

console.log("codegen Python tests passed");
