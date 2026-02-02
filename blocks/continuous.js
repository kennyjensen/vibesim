export const continuousLibrary = {
  id: "continuous",
  title: "Continuous",
  blocks: [
    { type: "integrator", label: "Integrator" },
    { type: "tf", label: "Transfer Function" },
    { type: "delay", label: "Delay" },
    { type: "stateSpace", label: "State Space" },
    { type: "lpf", label: "LPF" },
    { type: "hpf", label: "HPF" },
    { type: "derivative", label: "Derivative" },
    { type: "pid", label: "PID" },
  ],
};

export const createContinuousTemplates = (helpers) => {
  const {
    svgRect,
    createSvgElement,
    renderTeXMath,
    renderSourcePlot,
    buildTransferTeX,
  } = helpers;
  return {
    integrator: {
      width: 80,
      height: 80,
      inputs: [{ x: 0, y: 40, side: "left" }],
      outputs: [{ x: 80, y: 40, side: "right" }],
      defaultParams: { initial: 0 },
      render: (block) => {
        const group = block.group;
        group.appendChild(
          createSvgElement("rect", {
            x: 0,
            y: 0,
            width: block.width,
            height: block.height,
            class: "block-body integrator-body",
          })
        );
        const mathGroup = createSvgElement("g", { class: "integrator-math" });
        group.appendChild(mathGroup);
        renderTeXMath(mathGroup, "\\frac{1}{s}", block.width, block.height);
      },
    },
    tf: {
      width: 160,
      height: 80,
      inputs: [{ x: 0, y: 40, side: "left" }],
      outputs: [{ x: 160, y: 40, side: "right" }],
      defaultParams: { num: [3], den: [1, 3] },
      render: (block) => {
        const group = block.group;
        group.appendChild(
          createSvgElement("rect", {
            x: 0,
            y: 0,
            width: block.width,
            height: block.height,
            class: "block-body tf-body",
          })
        );
        const mathGroup = createSvgElement("g", { class: "tf-math" });
        group.appendChild(mathGroup);
        renderTeXMath(mathGroup, buildTransferTeX(block.params.num, block.params.den), block.width, block.height);
      },
    },
    delay: {
      width: 80,
      height: 80,
      inputs: [{ x: 0, y: 40, side: "left" }],
      outputs: [{ x: 80, y: 40, side: "right" }],
      defaultParams: { delay: 0.1 },
      render: (block) => {
        const group = block.group;
        group.appendChild(svgRect(0, 0, block.width, block.height, "block-body"));
        const mathGroup = createSvgElement("g", { class: "delay-math" });
        group.appendChild(mathGroup);
        renderTeXMath(mathGroup, "e^{-sT}", block.width, block.height);
      },
    },
    stateSpace: {
      width: 160,
      height: 80,
      inputs: [{ x: 0, y: 40, side: "left" }],
      outputs: [{ x: 160, y: 40, side: "right" }],
      defaultParams: { A: 1, B: 1, C: 1, D: 0 },
      render: (block) => {
        const group = block.group;
        group.appendChild(svgRect(0, 0, block.width, block.height, "block-body"));
        const mathGroup = createSvgElement("g", { class: "ss-math" });
        group.appendChild(mathGroup);
        renderTeXMath(
          mathGroup,
          "\\begin{aligned}\\dot{x}&=Ax+Bu\\\\y&=Cx+Du\\end{aligned}",
          block.width,
          block.height
        );
      },
    },
    lpf: {
      width: 80,
      height: 80,
      inputs: [{ x: 0, y: 40, side: "left" }],
      outputs: [{ x: 80, y: 40, side: "right" }],
      defaultParams: { cutoff: 1 },
      render: (block) => {
        const axisX = 14;
        const axisY = block.height - 16;
        const axisTop = 14;
        const axisRight = block.width - 14;
        const midY = (axisY + axisTop) / 2;
        const startX = axisX + 2;
        const kneeX = axisX + (axisRight - axisX) * 0.55;
        const endX = axisRight - 2;
        const flatY = midY - 8;
        const endY = axisY - 6;
        const lpfPath = `M${startX} ${flatY} L${kneeX} ${flatY} L${endX} ${endY}`;
        renderSourcePlot(block.group, block.width, block.height, lpfPath);
      },
    },
    hpf: {
      width: 80,
      height: 80,
      inputs: [{ x: 0, y: 40, side: "left" }],
      outputs: [{ x: 80, y: 40, side: "right" }],
      defaultParams: { cutoff: 1 },
      render: (block) => {
        const axisX = 14;
        const axisY = block.height - 16;
        const axisTop = 14;
        const axisRight = block.width - 14;
        const midY = (axisY + axisTop) / 2;
        const startX = axisX + 2;
        const kneeX = axisX + (axisRight - axisX) * 0.45;
        const endX = axisRight - 2;
        const startY = axisY - 6;
        const flatY = midY - 8;
        const hpfPath = `M${startX} ${startY} L${kneeX} ${flatY} L${endX} ${flatY}`;
        renderSourcePlot(block.group, block.width, block.height, hpfPath);
      },
    },
    derivative: {
      width: 80,
      height: 80,
      inputs: [{ x: 0, y: 40, side: "left" }],
      outputs: [{ x: 80, y: 40, side: "right" }],
      defaultParams: {},
      render: (block) => {
        const group = block.group;
        group.appendChild(
          createSvgElement("rect", {
            x: 0,
            y: 0,
            width: block.width,
            height: block.height,
            class: "block-body derivative-body",
          })
        );
        const mathGroup = createSvgElement("g", { class: "derivative-math" });
        group.appendChild(mathGroup);
        renderTeXMath(mathGroup, "\\frac{d}{dt}", block.width, block.height);
      },
    },
    pid: {
      width: 80,
      height: 80,
      inputs: [{ x: 0, y: 40, side: "left" }],
      outputs: [{ x: 80, y: 40, side: "right" }],
      defaultParams: { kp: 1, ki: 0, kd: 0 },
      render: (block) => {
        const group = block.group;
        group.appendChild(svgRect(0, 0, block.width, block.height, "block-body"));
        const mathGroup = createSvgElement("g", { class: "pid-math" });
        group.appendChild(mathGroup);
        renderTeXMath(mathGroup, "\\mathsf{PID}", block.width, block.height);
      },
    },
  };
};
