export const utilityLibrary = {
  id: "utility",
  title: "Utility",
  blocks: [
    { type: "switch", label: "Switch" },
  ],
};

export const SUBSYSTEM_PORT_LABEL_EDGE_PAD = 6;
export const computeSubsystemPortLabelFrame = ({ blockWidth, blockHeight, portY, side }) => {
  const width = Math.max(48, Math.floor(blockWidth * 0.36));
  const height = blockHeight;
  const x =
    side === "right"
      ? blockWidth - width - SUBSYSTEM_PORT_LABEL_EDGE_PAD
      : SUBSYSTEM_PORT_LABEL_EDGE_PAD;
  const y = Math.round(portY - height / 2);
  return { x, y, width, height };
};

const conditionToLatex = (condition, threshold) => {
  const op = condition === "gt" ? ">" : condition === "ne" ? "\\ne" : "\\geq";
  return `${op}\\!\\!${threshold}`;
};

export const createUtilityTemplates = (helpers) => {
  const { createSvgElement, renderTeXMath, GRID_SIZE, formatLabelTeX } = helpers;
  const formatPortLabelTeX = (label) => {
    const text = String(label || "").trim();
    if (!text) return "";
    return typeof formatLabelTeX === "function" ? formatLabelTeX(text) : text;
  };
  const estimateLabelWidth = (text, charWidth = 7.5, padding = 16) => {
    const len = Math.max(String(text || "").length, 1);
    return Math.ceil(len * charWidth + padding);
  };
  const computePortYs = (count, height) => {
    if (count <= 0) return [];
    if (count === 1) return [height / 2];
    const top = 20;
    const bottom = height - 20;
    const step = (bottom - top) / (count - 1);
    return Array.from({ length: count }, (_, i) => top + step * i);
  };

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
          class: "switch-math switch-math--l",
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
    subsystem: {
      width: 120,
      height: 80,
      inputs: [{ x: 0, y: 40, side: "left" }],
      outputs: [{ x: 140, y: 40, side: "right" }],
      defaultParams: {
        name: "Subsystem",
        externalInputs: [],
        externalOutputs: [],
        subsystem: null,
      },
      resize: (block) => {
        const inCount = Math.max(0, Number(block.params?.externalInputs?.length) || 0);
        const outCount = Math.max(0, Number(block.params?.externalOutputs?.length) || 0);
        const maxPorts = Math.max(inCount, outCount, 1);
        const height = Math.max(80, 40 + (maxPorts - 1) * 20);
        const name = String(block.params?.name || "Subsystem");
        const inNames = Array.isArray(block.params?.externalInputs) ? block.params.externalInputs : [];
        const outNames = Array.isArray(block.params?.externalOutputs) ? block.params.externalOutputs : [];
        const leftColumn = Math.max(
          24,
          ...inNames.map((entry, idx) => estimateLabelWidth(entry?.name || `in${idx + 1}`))
        );
        const rightColumn = Math.max(
          24,
          ...outNames.map((entry, idx) => estimateLabelWidth(entry?.name || `out${idx + 1}`))
        );
        const titleWidth = estimateLabelWidth(name, 8, 28);
        const centerColumn = Math.max(44, titleWidth);
        const width = Math.max(140, leftColumn + centerColumn + rightColumn);
        block.width = width;
        block.height = height;
        const inYs = computePortYs(inCount || 1, height);
        const outYs = computePortYs(outCount || 1, height);
        block.dynamicInputs = inYs.map((y) => ({ x: 0, y, side: "left" }));
        block.dynamicOutputs = outYs.map((y) => ({ x: width, y, side: "right" }));
        block.inputs = block.dynamicInputs.length;
        block.outputs = block.dynamicOutputs.length;
      },
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
        const inNames = Array.isArray(block.params?.externalInputs) ? block.params.externalInputs : [];
        const outNames = Array.isArray(block.params?.externalOutputs) ? block.params.externalOutputs : [];
        const inYs = Array.isArray(block.dynamicInputs) ? block.dynamicInputs.map((p) => p.y) : [block.height / 2];
        const outYs = Array.isArray(block.dynamicOutputs) ? block.dynamicOutputs.map((p) => p.y) : [block.height / 2];
        const portLabelLayer = createSvgElement("g", { class: "subsystem-port-labels" });
        const labelScale = 0.8;
        inYs.forEach((y, idx) => {
          const name = String(inNames[idx]?.name || `in${idx + 1}`);
          const frame = computeSubsystemPortLabelFrame({
            blockWidth: block.width,
            blockHeight: block.height,
            portY: y,
            side: "left",
          });
          const mathGroup = createSvgElement("g", {
            class: "label-math subsystem-port-label subsystem-port-label--left",
            transform: `translate(${frame.x},${frame.y})`,
          });
          mathGroup.dataset.scale = String(labelScale);
          portLabelLayer.appendChild(mathGroup);
          renderTeXMath(mathGroup, formatPortLabelTeX(name), frame.width, frame.height);
        });
        outYs.forEach((y, idx) => {
          const name = String(outNames[idx]?.name || `out${idx + 1}`);
          const frame = computeSubsystemPortLabelFrame({
            blockWidth: block.width,
            blockHeight: block.height,
            portY: y,
            side: "right",
          });
          const mathGroup = createSvgElement("g", {
            class: "label-math subsystem-port-label subsystem-port-label--right",
            transform: `translate(${frame.x},${frame.y})`,
          });
          mathGroup.dataset.scale = String(labelScale);
          portLabelLayer.appendChild(mathGroup);
          renderTeXMath(mathGroup, formatPortLabelTeX(name), frame.width, frame.height);
        });
        group.appendChild(portLabelLayer);
        const name = String(block.params?.name || "Subsystem");
        group.appendChild(
          createSvgElement(
            "text",
            {
              x: block.width / 2,
              y: block.height / 2,
              class: "block-text upright",
              "text-anchor": "middle",
              "dominant-baseline": "middle",
            },
            name
          )
        );
      },
    },
  };
};
