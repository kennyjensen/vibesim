import assert from "assert/strict";
import { generateTikz } from "../codegen/tikz.js";
import { buildBasicDiagram, runJsSim } from "./codegen-helpers.mjs";


{
  const diagram = buildBasicDiagram();
  const jsSeries = runJsSim(diagram);
  const tikz = generateTikz(diagram);
  const last = jsSeries.series[jsSeries.series.length - 1];
  assert.ok(Number.isFinite(last), "expected js sim output");
  assert.ok(tikz.includes("$2$"), "constant value should render as math");
  assert.ok(tikz.includes("$3$"), "gain value should render as math");
  assert.ok(tikz.includes("$y$"), "label sink name should render as math");
  assert.ok(tikz.includes("\\begin{tikzpicture}"), "tikz output should include preamble");
}

console.log("codegen TikZ tests passed");
