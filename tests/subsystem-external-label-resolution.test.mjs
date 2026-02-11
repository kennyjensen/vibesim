import assert from "node:assert/strict";
import { simHandlers, resolveLabelSourcesOnce } from "../blocks/sim/index.js";

{
  const blocks = [
    { id: "in1", type: "labelSource", params: { name: "u", isExternalPort: true } },
    { id: "sinkU", type: "labelSink", params: { name: "u" } },
  ];
  const outputs = new Map([
    ["in1", 3],
    ["c1", 0],
  ]);
  const inputMap = new Map([
    ["sinkU", ["c1"]],
    ["in1", []],
  ]);
  const labelSinks = new Map([["u", "sinkU"]]);
  const changed = resolveLabelSourcesOnce(blocks, outputs, inputMap, labelSinks);
  assert.equal(changed, false, "external labelSource should not be rewritten during label resolution");
  assert.equal(outputs.get("in1"), 3, "external labelSource output should remain externally driven");
}

{
  const bIn = { id: "bin", type: "constant", inputs: 0, outputs: 1, params: { value: "3" } };
  const sub = {
    id: "sub",
    type: "subsystem",
    inputs: 1,
    outputs: 1,
    params: {
      name: "S",
      externalInputs: [{ id: "in1", name: "u" }],
      externalOutputs: [{ id: "out1", name: "y" }],
      subsystem: {
        name: "Inner",
        blocks: [
          { id: "in1", type: "labelSource", params: { name: "u", isExternalPort: true } },
          { id: "c1", type: "constant", params: { value: "0" } },
          { id: "sinkU", type: "labelSink", params: { name: "u" } },
          { id: "ls", type: "labelSource", params: { name: "u" } },
          { id: "out1", type: "labelSink", params: { name: "y", isExternalPort: true } },
        ],
        connections: [
          { from: "c1", to: "sinkU", fromIndex: 0, toIndex: 0 },
          { from: "ls", to: "out1", fromIndex: 0, toIndex: 0 },
        ],
        externalInputs: [{ id: "in1", name: "u" }],
        externalOutputs: [{ id: "out1", name: "y" }],
      },
    },
  };

  const blocks = [bIn, sub];
  const resolvedParams = new Map([
    ["bin", { value: 3 }],
    ["sub", sub.params],
  ]);
  const inputMap = new Map([
    ["bin", []],
    ["sub", ["bin"]],
  ]);
  const ctx = {
    resolvedParams,
    inputMap,
    labelSinks: new Map(),
    blockState: new Map(),
    dt: 0.01,
    variables: {},
  };

  blocks.forEach((block) => {
    const handler = simHandlers[block.type];
    if (handler?.init) handler.init(ctx, block);
  });

  ctx.t = 0;
  ctx.outputs = new Map();
  blocks.forEach((block) => {
    const handler = simHandlers[block.type];
    if (handler?.output) handler.output(ctx, block);
  });
  simHandlers.subsystem.algebraic(ctx, sub);

  const subState = ctx.blockState.get("sub")?.subsystem;
  assert.ok(subState, "subsystem state should be initialized");
  assert.equal(subState.hitMaxIterations, false, "subsystem algebraic solve should converge without hitting max iterations");
  assert.ok((subState.lastSolveIterations || 0) < 50, "subsystem algebraic solve should converge in fewer than max iterations");
}

console.log("subsystem external label resolution tests passed");
