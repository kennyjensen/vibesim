export const mathLibrary = {
  id: "math",
  title: "Math",
  blocks: [
    { type: "gain", label: "Gain" },
    { type: "sum", label: "Addition" },
    { type: "mult", label: "Multiplication" },
  ],
};

export const createMathTemplates = (helpers) => {
  const { createSvgElement, renderTeXMath, GRID_SIZE } = helpers;
  return {
    sum: {
      width: 20,
      height: 20,
      inputs: [
        { x: 10 - GRID_SIZE * 2, y: 10, side: "left", wireX: 10 - GRID_SIZE, wireY: 10 },
        { x: 10, y: 10 - GRID_SIZE * 2, side: "top", wireX: 10, wireY: 10 - GRID_SIZE },
        { x: 10, y: 10 + GRID_SIZE * 2, side: "bottom", wireX: 10, wireY: 10 + GRID_SIZE },
      ],
      outputs: [{ x: 10 + GRID_SIZE * 2, y: 10, side: "right", wireX: 10 + GRID_SIZE, wireY: 10 }],
      defaultParams: { signs: [1, 1, 1] },
      render: (block) => {
        const group = block.group;
        group.appendChild(createSvgElement("circle", { cx: 10, cy: 10, r: 10, class: "sum-circle" }));
        group.appendChild(createSvgElement("line", { x1: 10, y1: 0, x2: 10, y2: 20, class: "sum-line" }));
        group.appendChild(createSvgElement("line", { x1: 0, y1: 10, x2: 20, y2: 10, class: "sum-line" }));
        const signPositions = [
          { x: -24, y: 2 },
          { x: 26, y: -14 },
          { x: 26, y: 30 },
        ];
        signPositions.forEach((pos, idx) => {
          const sign = (block.params.signs?.[idx] ?? 1) < 0 ? "-" : "";
          group.appendChild(
            createSvgElement(
              "text",
              {
                x: pos.x,
                y: pos.y,
                class: "sum-sign",
                "data-sign-index": String(idx),
              },
              sign
            )
          );
        });
      },
    },
    mult: {
      width: 20,
      height: 20,
      inputs: [
        { x: 10 - GRID_SIZE * 2, y: 10, side: "left", wireX: 10 - GRID_SIZE, wireY: 10 },
        { x: 10, y: 10 - GRID_SIZE * 2, side: "top", wireX: 10, wireY: 10 - GRID_SIZE },
        { x: 10, y: 10 + GRID_SIZE * 2, side: "bottom", wireX: 10, wireY: 10 + GRID_SIZE },
      ],
      outputs: [{ x: 10 + GRID_SIZE * 2, y: 10, side: "right", wireX: 10 + GRID_SIZE, wireY: 10 }],
      defaultParams: {},
      render: (block) => {
        const group = block.group;
        const r = 10;
        const offset = r / Math.SQRT2;
        group.appendChild(createSvgElement("circle", { cx: 10, cy: 10, r: 10, class: "sum-circle" }));
        group.appendChild(
          createSvgElement("line", {
            x1: 10 - offset,
            y1: 10 - offset,
            x2: 10 + offset,
            y2: 10 + offset,
            class: "sum-line",
          })
        );
        group.appendChild(
          createSvgElement("line", {
            x1: 10 + offset,
            y1: 10 - offset,
            x2: 10 - offset,
            y2: 10 + offset,
            class: "sum-line",
          })
        );
      },
    },
    gain: {
      width: 100,
      height: 80,
      inputs: [{ x: 0, y: 40, side: "left" }],
      outputs: [{ x: 100, y: 40, side: "right" }],
      defaultParams: { gain: 2 },
      render: (block) => {
        const group = block.group;
        const points = "0,0 0,80 100,40";
        group.appendChild(createSvgElement("polygon", { points, class: "gain-triangle" }));
        const mathGroup = createSvgElement("g", {
          class: "gain-math",
          transform: `translate(${block.width / 3 - block.width / 2}, 0)`,
        });
        group.appendChild(mathGroup);
        renderTeXMath(mathGroup, `${block.params.gain}`, block.width, block.height);
      },
    },
  };
};
