export const utilityLibrary = {
  id: "utility",
  title: "Utility",
  blocks: [
    { type: "switch", label: "Switch" },
  ],
};

const conditionToLatex = (condition, threshold) => {
  const op = condition === "gt" ? ">" : condition === "ne" ? "\\ne" : "\\geq";
  return `${op}\\ ${threshold}`;
};

export const createUtilityTemplates = (helpers) => {
  const { createSvgElement, renderTeXMath, GRID_SIZE } = helpers;
  return {
    switch: {
      width: 80,
      height: 80,
      inputs: [
        { x: 0, y: 20 - GRID_SIZE, side: "left" },
        { x: 0, y: 40, side: "left" },
        { x: 0, y: 60 + GRID_SIZE, side: "left" },
      ],
      outputs: [{ x: 80, y: 40, side: "right" }],
      defaultParams: { condition: "ge", threshold: 0.0 },
      render: (block) => {
        const group = block.group;
        group.appendChild(
          createSvgElement("rect", {
            x: 0,
            y: 0,
            width: block.width,
            height: block.height,
            class: "block-body",
          })
        );

        group.appendChild(createSvgElement("line", { x1: 0, y1: 10, x2: 16, y2: 10, class: "sum-line" }));
        group.appendChild(createSvgElement("line", { x1: 0, y1: 70, x2: 16, y2: 70, class: "sum-line" }));
        group.appendChild(createSvgElement("line", { x1: 64, y1: 40, x2: 80, y2: 40, class: "sum-line" }));
        group.appendChild(createSvgElement("line", { x1: 16, y1: 10, x2: 64, y2: 40, class: "sum-line" }));
        group.appendChild(createSvgElement("circle", { cx: 16, cy: 10, r: 2.8, class: "switch-dot" }));
        group.appendChild(createSvgElement("circle", { cx: 16, cy: 70, r: 2.8, class: "switch-dot" }));
        group.appendChild(createSvgElement("circle", { cx: 64, cy: 40, r: 2.8, class: "switch-dot" }));

        const mathGroup = createSvgElement("g", {
          class: "switch-math switch-math--m",
          transform: "translate(0 17)",
        });
        group.appendChild(mathGroup);
        renderTeXMath(
          mathGroup,
          `${conditionToLatex(block.params.condition, block.params.threshold)}`,
          48,
          34
        );
      },
    },
  };
};
