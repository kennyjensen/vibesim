import assert from "assert/strict";
import { generateC } from "../codegen/c.js";
import { buildBasicDiagram, runJsSim, runGeneratedC, assertSeriesClose, SAMPLE_TIME } from "./codegen-helpers.mjs";


{
  const diagram = buildBasicDiagram();
  const jsSeries = runJsSim(diagram);
  const cCode = generateC(diagram, { sampleTime: SAMPLE_TIME });
  const rows = runGeneratedC(cCode);
  assert.ok(rows.length > 0, "expected C output rows");
  assertSeriesClose(jsSeries, rows);
}

console.log("codegen C tests passed");
