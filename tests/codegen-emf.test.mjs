import { generateC } from "../codegen/c.js";
import { generatePython } from "../codegen/python.js";
import {
  loadDiagramFromYaml,
  runJsSimOutputs,
  runGeneratedC,
  runGeneratedPython,
  assertMultiSeriesClose,
  SAMPLE_TIME,
} from "./codegen-helpers.mjs";

const diagram = loadDiagramFromYaml("examples/emf.yaml");
const fullDuration = Number.isFinite(Number(diagram.runtime)) && Number(diagram.runtime) > 0
  ? Number(diagram.runtime)
  : 10.0;
const jsSeries = runJsSimOutputs(diagram, fullDuration, SAMPLE_TIME);

const cCode = generateC(diagram, { sampleTime: SAMPLE_TIME });
const cRows = runGeneratedC(cCode, fullDuration);
assertMultiSeriesClose(jsSeries, cRows, 1e-3);

const pyCode = generatePython(diagram, { sampleTime: SAMPLE_TIME });
const pyRows = runGeneratedPython(pyCode, fullDuration);
assertMultiSeriesClose(jsSeries, pyRows, 1e-3);

console.log("codegen EMF tests passed");
