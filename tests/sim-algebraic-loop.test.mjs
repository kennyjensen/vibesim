import assert from "assert/strict";
import { simulate } from "../sim.js";

const blocks = new Map([
  ["b1", { id: "b1", type: "constant", inputs: 0, outputs: 1, params: { value: 1 } }],
  ["b2", { id: "b2", type: "sum", inputs: 3, outputs: 1, params: { signs: [1, 1, 1] } }],
  ["b3", { id: "b3", type: "gain", inputs: 1, outputs: 1, params: { gain: -1 } }],
  ["b4", { id: "b4", type: "scope", inputs: 3, outputs: 0, params: { tMin: "", tMax: "", yMin: "", yMax: "" } }],
]);

const connections = [
  { from: "b1", to: "b2", fromIndex: 0, toIndex: 0 },
  { from: "b2", to: "b3", fromIndex: 0, toIndex: 0 },
  { from: "b3", to: "b2", fromIndex: 0, toIndex: 1 },
  { from: "b2", to: "b4", fromIndex: 0, toIndex: 0 },
];

const state = {
  blocks,
  connections,
  variables: { pi: Math.PI, e: Math.E },
  sampleTime: 0.01,
};

const runtimeInput = { value: "1.0" };
const statusEl = { textContent: "" };

simulate({
  state,
  runtimeInput,
  statusEl,
});

assert.ok(
  statusEl.textContent.startsWith("Error: algebraic loop did not converge"),
  `unexpected status: ${statusEl.textContent}`
);

console.log("algebraic loop detect test passed");
