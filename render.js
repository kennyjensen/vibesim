import { snap, distancePointToSegment, GRID_SIZE, segmentLengthStats } from "./geometry.js";
import { routeAllConnections, routeDirtyConnections } from "./router.js";
import { renderScope } from "./sim.js";

const DEBUG_SELECTION = true;
const DEBUG_WIRE_CHECKS = false;
const SELECTION_PAD = 10;

function createSvgElement(tag, attrs = {}, text = "") {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  Object.entries(attrs).forEach(([key, value]) => {
    el.setAttribute(key, value);
  });
  if (text) el.textContent = text;
  return el;
}

function svgRect(x, y, w, h, cls) {
  return createSvgElement("rect", { x, y, width: w, height: h, class: cls });
}

function svgText(x, y, text) {
  return createSvgElement("text", { x, y, class: "block-text" }, text);
}

function renderRectBlock(block, title, lines = [], iconType = null) {
  const group = block.group;
  group.appendChild(svgRect(0, 0, block.width, block.height, "block-body"));
  if (iconType) {
    const icon = drawIcon(iconType, block.width - 28, 8);
    if (icon) group.appendChild(icon);
  }
  group.appendChild(svgText(10, 22, title));
  lines.forEach((line, index) => {
    group.appendChild(svgText(10, 42 + index * 16, line));
  });
}

function drawIcon(type, x, y) {
  const g = createSvgElement("g", { class: "block-icon", transform: `translate(${x}, ${y})` });
  const size = 22;
  const mid = size / 2;
  const addText = (text) => {
    g.appendChild(createSvgElement("text", { x: mid, y: mid }, text));
  };
  if (type === "constant") {
    g.appendChild(createSvgElement("line", { x1: 2, y1: mid, x2: size - 2, y2: mid }));
  } else if (type === "step") {
    g.appendChild(createSvgElement("path", { d: `M2 ${size - 4} H${mid} V4 H${size - 2}` }));
  } else if (type === "ramp") {
    g.appendChild(createSvgElement("line", { x1: 2, y1: size - 4, x2: size - 2, y2: 4 }));
  } else if (type === "impulse") {
    g.appendChild(createSvgElement("line", { x1: mid, y1: size - 2, x2: mid, y2: 2 }));
  } else if (type === "sine") {
    g.appendChild(
      createSvgElement("path", {
        d: `M2 ${mid} C6 4, 10 4, 14 ${mid} C18 ${size - 4}, 20 ${size - 4}, ${size - 2} ${mid}`,
      })
    );
  } else if (type === "chirp") {
    g.appendChild(
      createSvgElement("polyline", {
        points: `2 ${mid} 6 10 10 ${mid} 12 10 14 ${mid} 15 10 16 ${mid} 17 10 18 ${mid} 20 10 22 ${mid}`,
      })
    );
  } else if (type === "noise") {
    g.appendChild(
      createSvgElement("polyline", {
        points: `2 12 6 8 10 14 14 6 18 16 22 10`,
      })
    );
  } else if (type === "file") {
    g.appendChild(createSvgElement("rect", { x: 4, y: 2, width: 14, height: 18, rx: 2, ry: 2 }));
    g.appendChild(createSvgElement("polyline", { points: `14 2 18 6 14 6` }));
  } else if (type === "scope") {
    g.appendChild(
      createSvgElement("polyline", {
        points: `2 16 6 10 10 14 14 6 18 12 22 8`,
      })
    );
  } else if (type === "saturation") {
    g.appendChild(
      createSvgElement("path", {
        d: `M2 ${size - 4} H8 L14 6 H20`,
      })
    );
  } else if (type === "rate") {
    g.appendChild(
      createSvgElement("path", {
        d: `M2 ${size - 4} L12 6 H20`,
      })
    );
  } else if (type === "backlash") {
    g.appendChild(
      createSvgElement("polyline", {
        points: `2 16 8 16 10 10 16 10 18 4`,
      })
    );
  } else if (type === "lpf") {
    g.appendChild(createSvgElement("path", { d: `M2 6 H10 V16 H20` }));
  } else if (type === "hpf") {
    g.appendChild(createSvgElement("path", { d: `M2 16 H10 V6 H20` }));
  } else if (type === "pid") {
    addText("PID");
  } else if (type === "tf") {
    addText("TF");
  } else if (type === "dtf") {
    addText("z^-1");
  } else if (type === "zoh") {
    addText("ZOH");
  } else if (type === "foh") {
    addText("FOH");
  } else if (type === "integrator") {
    addText("1/s");
  } else if (type === "derivative") {
    addText("d/dt");
  } else {
    addText("fx");
  }
  return g;
}

const blockTemplates = {
  constant: {
    width: 120,
    height: 60,
    inputs: [],
    outputs: [{ x: 120, y: 30, side: "right" }],
    defaultParams: { value: 1 },
    render: (block) => {
      renderRectBlock(block, "Constant", [`${block.params.value}`], "constant");
    },
  },
  step: {
    width: 140,
    height: 70,
    inputs: [],
    outputs: [{ x: 140, y: 35, side: "right" }],
    defaultParams: { stepTime: 0 },
    render: (block) => {
      renderRectBlock(block, "Step", [`t=${block.params.stepTime}`], "step");
    },
  },
  ramp: {
    width: 120,
    height: 60,
    inputs: [],
    outputs: [{ x: 120, y: 30, side: "right" }],
    defaultParams: { slope: 1, start: 0 },
    render: (block) => {
      renderRectBlock(block, "Ramp", [`m=${block.params.slope} t0=${block.params.start}`], "ramp");
    },
  },
  impulse: {
    width: 120,
    height: 60,
    inputs: [],
    outputs: [{ x: 120, y: 30, side: "right" }],
    defaultParams: { time: 0, amp: 1 },
    render: (block) => {
      renderRectBlock(block, "Impulse", [`t=${block.params.time} A=${block.params.amp}`], "impulse");
    },
  },
  sine: {
    width: 130,
    height: 70,
    inputs: [],
    outputs: [{ x: 130, y: 35, side: "right" }],
    defaultParams: { amp: 1, freq: 1, phase: 0 },
    render: (block) => {
      renderRectBlock(block, "Sine", [`A=${block.params.amp} f=${block.params.freq}`, `ph=${block.params.phase}`], "sine");
    },
  },
  chirp: {
    width: 140,
    height: 70,
    inputs: [],
    outputs: [{ x: 140, y: 35, side: "right" }],
    defaultParams: { amp: 1, f0: 1, f1: 5, t1: 10 },
    render: (block) => {
      renderRectBlock(
        block,
        "Chirp",
        [`A=${block.params.amp} f0=${block.params.f0}`, `f1=${block.params.f1} t1=${block.params.t1}`],
        "chirp"
      );
    },
  },
  noise: {
    width: 120,
    height: 60,
    inputs: [],
    outputs: [{ x: 120, y: 30, side: "right" }],
    defaultParams: { amp: 1 },
    render: (block) => {
      renderRectBlock(block, "Noise", [`A=${block.params.amp}`], "noise");
    },
  },
  fileSource: {
    width: 140,
    height: 60,
    inputs: [],
    outputs: [{ x: 140, y: 30, side: "right" }],
    defaultParams: { path: "signal.csv" },
    render: (block) => {
      renderRectBlock(block, "File In", [block.params.path], "file");
    },
  },
  sum: {
    width: 40,
    height: 40,
    inputs: [
      { x: 0, y: 20, side: "left" },
      { x: 20, y: 0, side: "top" },
      { x: 20, y: 40, side: "bottom" },
    ],
    outputs: [{ x: 40, y: 20, side: "right" }],
    defaultParams: { signs: [1, 1, 1] },
    render: (block) => {
      const group = block.group;
      group.appendChild(createSvgElement("circle", { cx: 20, cy: 20, r: 20, class: "sum-circle" }));
      group.appendChild(createSvgElement("line", { x1: 20, y1: 2, x2: 20, y2: 38, class: "sum-line" }));
      group.appendChild(createSvgElement("line", { x1: 2, y1: 20, x2: 38, y2: 20, class: "sum-line" }));
      const signPositions = [
        { x: -12, y: 12 },
        { x: 32, y: -6 },
        { x: 32, y: 46 },
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
    width: 50,
    height: 50,
    inputs: [
      { x: 0, y: 25, side: "left" },
      { x: 25, y: 0, side: "top" },
    ],
    outputs: [{ x: 50, y: 25, side: "right" }],
    defaultParams: {},
    render: (block) => {
      const group = block.group;
      group.appendChild(createSvgElement("circle", { cx: 25, cy: 25, r: 25, class: "sum-circle" }));
      group.appendChild(createSvgElement("line", { x1: 12, y1: 12, x2: 38, y2: 38, class: "sum-line" }));
      group.appendChild(createSvgElement("line", { x1: 38, y1: 12, x2: 12, y2: 38, class: "sum-line" }));
    },
  },
  gain: {
    width: 92,
    height: 80,
    inputs: [{ x: 0, y: 40, side: "left" }],
    outputs: [{ x: 92, y: 40, side: "right" }],
    defaultParams: { gain: 2 },
    render: (block) => {
      const group = block.group;
      const points = "6,6 6,74 86,40";
      group.appendChild(createSvgElement("polygon", { points, class: "gain-triangle" }));
      group.appendChild(createSvgElement("text", { x: 24, y: 40, class: "gain-text" }, `${block.params.gain}`));
    },
  },
  integrator: {
    width: 90,
    height: 60,
    inputs: [{ x: 0, y: 30, side: "left" }],
    outputs: [{ x: 90, y: 30, side: "right" }],
    defaultParams: {},
    render: (block) => {
      renderRectBlock(block, "Integrator", ["1/s"], "integrator");
    },
  },
  derivative: {
    width: 100,
    height: 60,
    inputs: [{ x: 0, y: 30, side: "left" }],
    outputs: [{ x: 100, y: 30, side: "right" }],
    defaultParams: {},
    render: (block) => {
      renderRectBlock(block, "Derivative", ["d/dt"], "derivative");
    },
  },
  lpf: {
    width: 120,
    height: 60,
    inputs: [{ x: 0, y: 30, side: "left" }],
    outputs: [{ x: 120, y: 30, side: "right" }],
    defaultParams: { cutoff: 1 },
    render: (block) => {
      renderRectBlock(block, "LPF", [`fc=${block.params.cutoff}`], "lpf");
    },
  },
  hpf: {
    width: 120,
    height: 60,
    inputs: [{ x: 0, y: 30, side: "left" }],
    outputs: [{ x: 120, y: 30, side: "right" }],
    defaultParams: { cutoff: 1 },
    render: (block) => {
      renderRectBlock(block, "HPF", [`fc=${block.params.cutoff}`], "hpf");
    },
  },
  pid: {
    width: 140,
    height: 70,
    inputs: [{ x: 0, y: 35, side: "left" }],
    outputs: [{ x: 140, y: 35, side: "right" }],
    defaultParams: { kp: 1, ki: 0, kd: 0 },
    render: (block) => {
      renderRectBlock(block, "PID", [`Kp=${block.params.kp} Ki=${block.params.ki}`, `Kd=${block.params.kd}`], "pid");
    },
  },
  saturation: {
    width: 110,
    height: 60,
    inputs: [{ x: 0, y: 30, side: "left" }],
    outputs: [{ x: 110, y: 30, side: "right" }],
    defaultParams: { min: -1, max: 1 },
    render: (block) => {
      renderRectBlock(block, "Saturation", [`${block.params.min}..${block.params.max}`], "saturation");
    },
  },
  rate: {
    width: 110,
    height: 60,
    inputs: [{ x: 0, y: 30, side: "left" }],
    outputs: [{ x: 110, y: 30, side: "right" }],
    defaultParams: { rise: 1, fall: 1 },
    render: (block) => {
      renderRectBlock(block, "Rate Limit", [`r=${block.params.rise} f=${block.params.fall}`], "rate");
    },
  },
  backlash: {
    width: 110,
    height: 60,
    inputs: [{ x: 0, y: 30, side: "left" }],
    outputs: [{ x: 110, y: 30, side: "right" }],
    defaultParams: { width: 1 },
    render: (block) => {
      renderRectBlock(block, "Backlash", [`w=${block.params.width}`], "backlash");
    },
  },
  tf: {
    width: 140,
    height: 70,
    inputs: [{ x: 0, y: 35, side: "left" }],
    outputs: [{ x: 140, y: 35, side: "right" }],
    defaultParams: { num: [3], den: [1, 3] },
    render: (block) => {
      renderRectBlock(
        block,
        "Transfer",
        [`num=[${block.params.num.join(",")}]`, `den=[${block.params.den.join(",")}]`],
        "tf"
      );
    },
  },
  zoh: {
    width: 100,
    height: 60,
    inputs: [{ x: 0, y: 30, side: "left" }],
    outputs: [{ x: 100, y: 30, side: "right" }],
    defaultParams: { ts: 0.1 },
    render: (block) => {
      renderRectBlock(block, "ZOH", [`Ts=${block.params.ts}`], "zoh");
    },
  },
  foh: {
    width: 100,
    height: 60,
    inputs: [{ x: 0, y: 30, side: "left" }],
    outputs: [{ x: 100, y: 30, side: "right" }],
    defaultParams: { ts: 0.1 },
    render: (block) => {
      renderRectBlock(block, "FOH", [`Ts=${block.params.ts}`], "foh");
    },
  },
  dtf: {
    width: 140,
    height: 70,
    inputs: [{ x: 0, y: 35, side: "left" }],
    outputs: [{ x: 140, y: 35, side: "right" }],
    defaultParams: { num: [1], den: [1, -0.5], ts: 0.1 },
    render: (block) => {
      renderRectBlock(
        block,
        "Discrete TF",
        [`num=[${block.params.num.join(",")}]`, `den=[${block.params.den.join(",")}] Ts=${block.params.ts}`],
        "dtf"
      );
    },
  },
  scope: {
    width: 220,
    height: 140,
    inputs: [
      { x: 0, y: 50, side: "left" },
      { x: 0, y: 70, side: "left" },
      { x: 0, y: 90, side: "left" },
    ],
    outputs: [],
    defaultParams: {},
    render: (block) => {
      const group = block.group;
      group.appendChild(svgRect(0, 0, block.width, block.height, "block-body"));
      group.appendChild(svgText(10, 20, "Scope"));
      const icon = drawIcon("scope", block.width - 28, 8);
      if (icon) group.appendChild(icon);
      const plot = svgRect(10, 30, block.width - 20, block.height - 40, "scope-plot");
      group.appendChild(plot);
      const colors = ["scope-path-1", "scope-path-2", "scope-path-3"];
      block.scopePaths = colors.map((cls) => {
        const path = createSvgElement("path", { class: `scope-path ${cls}` });
        group.appendChild(path);
        return path;
      });
      block.scopePlot = plot;
    },
  },
  fileSink: {
    width: 140,
    height: 60,
    inputs: [{ x: 0, y: 30, side: "left" }],
    outputs: [],
    defaultParams: { path: "output.csv" },
    render: (block) => {
      renderRectBlock(block, "File Out", [block.params.path], "file");
    },
  },
};

export function createRenderer({ svg, blockLayer, wireLayer, overlayLayer, state, onSelectBlock, onSelectConnection }) {
  const debugLog = document.getElementById("debugLog");
  if (!DEBUG_WIRE_CHECKS && debugLog) {
    const panel = debugLog.closest(".debug-panel");
    if (panel) panel.style.display = "none";
  }
  const selectionRect = createSvgElement("rect", {
    class: "selection-rect",
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    display: "none",
  });
  overlayLayer.appendChild(selectionRect);
  const debugBaseRect = createSvgElement("rect", {
    class: "selection-debug-base",
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    display: DEBUG_SELECTION ? "block" : "none",
  });
  const debugKeepoutRect = createSvgElement("rect", {
    class: "selection-debug-keepout",
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    display: DEBUG_SELECTION ? "block" : "none",
  });
  const debugText = createSvgElement("text", { class: "selection-debug-text", x: 8, y: 16 });
  if (DEBUG_SELECTION) {
    overlayLayer.appendChild(debugBaseRect);
    overlayLayer.appendChild(debugKeepoutRect);
    overlayLayer.appendChild(debugText);
  }


  function createBlock(type, x = 60, y = 60) {
    const template = blockTemplates[type];
    const id = `b${state.nextId++}`;
    const params = { ...(template.defaultParams || {}) };
    const group = createSvgElement("g", {
      class: `svg-block type-${type}`,
      "data-block-id": id,
    });

    const block = {
      id,
      type,
      x: snap(x),
      y: snap(y),
      width: template.width,
      height: template.height,
      rotation: 0,
      inputs: template.inputs.length,
      outputs: template.outputs.length,
      params,
      group,
      ports: [],
    };

    template.render(block);

    const dragHeight = type === "scope" ? 24 : block.height;
    const dragRect = createSvgElement("rect", {
      x: 0,
      y: 0,
      width: block.width,
      height: dragHeight,
      class: "drag-handle",
    });
    group.appendChild(dragRect);

    template.inputs.forEach((port, index) => {
      const circle = createPortCircle(id, "in", index, port);
      group.appendChild(circle);
      block.ports.push({ ...port, type: "in", index, el: circle });
    });
    template.outputs.forEach((port, index) => {
      const circle = createPortCircle(id, "out", index, port);
      group.appendChild(circle);
      block.ports.push({ ...port, type: "out", index, el: circle });
    });

    blockLayer.appendChild(group);
    state.blocks.set(id, block);

    updateBlockTransform(block);
    enableDrag(block, dragRect);
    enableSelection(block, dragRect);
    enableScopeHover(block);
    state.routingDirty = true;
    updateConnections();
  }

  function createPortCircle(blockId, type, index, port) {
    const group = createSvgElement("g", {
      class: "port-group",
      "data-block-id": blockId,
      "data-port-type": type,
      "data-port-index": index,
    });
    const hit = createSvgElement("circle", {
      cx: port.x,
      cy: port.y,
      r: 12,
      class: "port-hit",
    });
    const circle = createSvgElement("circle", {
      cx: port.x,
      cy: port.y,
      r: 6,
      class: `port ${type}`,
    });
    const onClick = (event) => {
      event.stopPropagation();
      handlePortClick(group);
    };
    hit.addEventListener("click", onClick);
    circle.addEventListener("click", onClick);
    group.appendChild(hit);
    group.appendChild(circle);
    return group;
  }

  function handlePortClick(portEl) {
    const blockId = portEl.getAttribute("data-block-id");
    const portType = portEl.getAttribute("data-port-type");
    const portIndex = Number(portEl.getAttribute("data-port-index"));

    if (!state.pendingPort) {
      if (portType !== "out") return;
      state.pendingPort = { blockId, portType, portIndex };
      const dot = portEl.querySelector(".port");
      if (dot) dot.classList.add("pending");
      return;
    }

    const from = state.pendingPort;
    if (from.blockId === blockId) {
      clearPending();
      return;
    }

    if (portType === "in") {
      createConnection(from.blockId, blockId, portIndex);
    }
    clearPending();
  }

  function clearPending() {
    const pending = svg.querySelector(".port.pending");
    if (pending) pending.classList.remove("pending");
    state.pendingPort = null;
  }

  function enableDrag(block, handle) {
    let offsetX = 0;
    let offsetY = 0;
    let dragging = false;
    let startClient = null;
    const DRAG_THRESHOLD = 6;

    handle.addEventListener("pointerdown", (event) => {
      if (state.deleteMode || state.isPinching) return;
      event.preventDefault();
      dragging = false;
      startClient = { x: event.clientX, y: event.clientY };
      handle.setPointerCapture(event.pointerId);
    });

    handle.addEventListener("pointermove", (event) => {
      if (!startClient) return;
      if (!dragging) {
        const dx = event.clientX - startClient.x;
        const dy = event.clientY - startClient.y;
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        dragging = true;
        const point = clientToSvg(event.clientX, event.clientY);
        offsetX = point.x - block.x;
        offsetY = point.y - block.y;
      }
      const point = clientToSvg(event.clientX, event.clientY);
      const x = snap(point.x - offsetX);
      const y = snap(point.y - offsetY);
      block.x = Math.max(0, x);
      block.y = Math.max(0, y);
      updateBlockTransform(block);
      state.routingDirty = true;
      if (state.dirtyBlocks) state.dirtyBlocks.add(block.id);
      updateConnections();
    });

    handle.addEventListener("pointerup", (event) => {
      if (dragging) event.preventDefault();
      dragging = false;
      startClient = null;
    });

    handle.addEventListener("pointercancel", () => {
      dragging = false;
      startClient = null;
    });
  }

  function enableSelection(block, handle) {
    handle.addEventListener("click", (event) => {
      event.stopPropagation();
      selectBlock(block.id);
    });
  }

  function selectBlock(blockId) {
    state.selectedId = blockId;
    state.selectedConnection = null;
    state.blocks.forEach((block) => {
      block.group.classList.toggle("selected", block.id === blockId);
    });
    state.connections.forEach((conn) => {
      conn.path.classList.toggle("selected", false);
    });
    onSelectBlock(blockId ? state.blocks.get(blockId) : null);
    updateSelectionBox();
  }

  function selectConnection(conn) {
    state.selectedConnection = conn;
    state.selectedId = null;
    state.blocks.forEach((block) => {
      block.group.classList.toggle("selected", false);
    });
    state.connections.forEach((c) => {
      c.path.classList.toggle("selected", c === conn);
    });
    if (!conn) {
      onSelectConnection(null);
      updateSelectionBox();
      return;
    }
    const fromBlock = state.blocks.get(conn.from);
    const toBlock = state.blocks.get(conn.to);
    onSelectConnection({
      kind: "connection",
      fromId: conn.from,
      toId: conn.to,
      toIndex: conn.toIndex,
      fromType: fromBlock?.type || "unknown",
      toType: toBlock?.type || "unknown",
    });
    updateSelectionBox();
  }

  function enableScopeHover(block) {
    if (block.type !== "scope") return;
    block.group.addEventListener("pointermove", (event) => {
      const point = clientToSvg(event.clientX, event.clientY);
      const localX = point.x - block.x;
      block.scopeHoverX = localX;
      renderScope(block);
    });
    block.group.addEventListener("pointerleave", () => {
      block.scopeHoverX = null;
      renderScope(block);
    });
  }

  function createConnection(fromId, toId, toIndex, fromIndex = 0) {
    if (state.connections.some((c) => c.from === fromId && c.to === toId && c.toIndex === toIndex && c.fromIndex === fromIndex)) return;

    const path = createSvgElement("path", { class: "wire" });
    wireLayer.appendChild(path);
    const conn = { from: fromId, to: toId, toIndex, fromIndex, path, points: [] };
    path.addEventListener("click", (event) => {
      event.stopPropagation();
      selectConnection(conn);
    });
    state.connections.push(conn);
    state.routingDirty = true;
    if (state.dirtyConnections) state.dirtyConnections.add(conn);
    updateConnections();
  }

  function updateConnections(force = false) {
    if (state.isPanning || state.isPinching) return;
    if (!force && !state.routingDirty) return;
    if (state.routingScheduled) return;
    state.routingScheduled = true;
    const runForced = force;
    requestAnimationFrame(() => {
      state.routingScheduled = false;
      if (state.isPanning || state.isPinching) return;
      if (!runForced && !state.routingDirty) return;
      if (DEBUG_WIRE_CHECKS && debugLog) debugLog.textContent = buildDebugSnapshot();
      const worldW = Number(svg.dataset.worldWidth) || svg.clientWidth || 1;
      const worldH = Number(svg.dataset.worldHeight) || svg.clientHeight || 1;
      const needsFullRoute = state.connections.some((conn) => !conn.points || conn.points.length < 2);
      let paths = new Map();
      let dirtySet = null;
      if (!needsFullRoute) {
        dirtySet = computeDirtyConnections();
      }
      if (!needsFullRoute && dirtySet && dirtySet.size > 0) {
        paths = routeDirtyConnections(state, worldW, worldH, { x: 0, y: 0 }, dirtySet);
        paths.forEach((d, conn) => {
          if (!d) return;
          conn.path.setAttribute("d", d);
          if (DEBUG_WIRE_CHECKS) {
            const bad = checkWireIssues(conn, debugLog);
            conn.path.classList.toggle("wire-error", bad);
          }
        });
      } else if (needsFullRoute || !dirtySet) {
        paths = routeAllConnections(state, worldW, worldH, { x: 0, y: 0 });
        paths.forEach((d, conn) => {
          if (!d) return;
          conn.path.setAttribute("d", d);
          if (DEBUG_WIRE_CHECKS) {
            const bad = checkWireIssues(conn, debugLog);
            conn.path.classList.toggle("wire-error", bad);
          }
        });
      } else {
        updateSelectionBox();
        state.routingDirty = false;
        if (state.dirtyBlocks) state.dirtyBlocks.clear();
        if (state.dirtyConnections) state.dirtyConnections.clear();
        return;
      }
      state.routingDirty = false;
      if (state.dirtyBlocks) state.dirtyBlocks.clear();
      if (state.dirtyConnections) state.dirtyConnections.clear();
      updateSelectionBox();
    });
  }

  function forceFullRoute(timeLimitMs = 2000) {
    const worldW = Number(svg.dataset.worldWidth) || svg.clientWidth || 1;
    const worldH = Number(svg.dataset.worldHeight) || svg.clientHeight || 1;
    const paths = routeAllConnections(state, worldW, worldH, { x: 0, y: 0 }, timeLimitMs, false);
    paths.forEach((d, conn) => {
      if (!d) return;
      conn.path.setAttribute("d", d);
      if (DEBUG_WIRE_CHECKS) {
        const bad = checkWireIssues(conn, debugLog);
        conn.path.classList.toggle("wire-error", bad);
      }
    });
    state.routingDirty = false;
    if (state.dirtyBlocks) state.dirtyBlocks.clear();
    if (state.dirtyConnections) state.dirtyConnections.clear();
    updateSelectionBox();
  }

  function computeDirtyConnections() {
    const dirty = new Set(state.dirtyConnections || []);
    if (!state.dirtyBlocks || state.dirtyBlocks.size === 0) return dirty;
    const movedBlocks = Array.from(state.dirtyBlocks)
      .map((id) => state.blocks.get(id))
      .filter(Boolean);
    const keepouts = movedBlocks.map((block) => blockBounds(block));
    const movedIds = new Set(state.dirtyBlocks);
    state.connections.forEach((conn) => {
      if (dirty.has(conn)) return;
      if (movedIds.has(conn.from) || movedIds.has(conn.to)) {
        dirty.add(conn);
        return;
      }
      const points = conn.points || [];
      if (points.length < 2) {
        dirty.add(conn);
        return;
      }
      for (let i = 0; i < points.length - 1; i += 1) {
        const a = points[i];
        const b = points[i + 1];
        for (let j = 0; j < keepouts.length; j += 1) {
          if (segmentHitsRect(a, b, keepouts[j])) {
            dirty.add(conn);
            return;
          }
        }
      }
    });
    return dirty;
  }

  function checkWireIssues(conn, logEl) {
    const issues = [];
    const points = conn.points || [];
    if (points.length < 2) {
      issues.push("not enough points");
      writeDebug(logEl, formatWireIssue(conn, issues));
      return true;
    }
    if (!checkPortDirections(conn, points, issues)) {
      issues.push("invalid port direction");
    }
    const segments = [];
    for (let i = 0; i < points.length - 1; i += 1) {
      const a = points[i];
      const b = points[i + 1];
      if (a.x !== b.x && a.y !== b.y) {
        issues.push(`diagonal segment ${a.x},${a.y} -> ${b.x},${b.y}`);
      }
      segments.push({ a, b });
    }
    const connSegments = segments.map((seg) => ({
      ...seg,
      orientation: seg.a.x === seg.b.x ? "V" : "H",
    }));
    if (segmentHitsAnyBlock(connSegments, conn, issues)) {
      issues.push("crosses block keepout");
    }
    if (segmentOverlapsOtherWire(connSegments, conn, issues)) {
      issues.push("overlaps another wire");
    }
    if (conn.turnCheck && Number.isFinite(conn.turnCheck.minimal)) {
      if (conn.turnCheck.actual > conn.turnCheck.minimal) {
        issues.push(`extra turns (${conn.turnCheck.actual} > ${conn.turnCheck.minimal})`);
      }
    }
    for (let i = 0; i < segments.length; i += 1) {
      for (let j = i + 2; j < segments.length; j += 1) {
        if (segmentsIntersect(segments[i], segments[j])) {
          issues.push(`self-cross segments ${i}/${j}`);
        }
      }
    }
    const metrics = formatWireDebugInfo(conn);
    if (issues.length === 0) {
      writeDebug(logEl, `[wire ${conn.from}->${conn.to}] OK${metrics}`);
      return false;
    }
    writeDebug(logEl, `${formatWireIssue(conn, issues)}${metrics}`);
    return true;
  }

  function checkPortDirections(conn, points, issues) {
    const fromBlock = state.blocks.get(conn.from);
    const toBlock = state.blocks.get(conn.to);
    if (!fromBlock || !toBlock) return false;
    const fromIndex = conn.fromIndex ?? 0;
    const fromPort = fromBlock.ports.find((p) => p.type === "out" && p.index === fromIndex);
    const toPort = toBlock.ports.find((p) => p.type === "in" && p.index === conn.toIndex);
    if (!fromPort || !toPort) return false;
    const fromPos = rotatePoint({ x: fromBlock.x + fromPort.x, y: fromBlock.y + fromPort.y }, fromBlock);
    const toPos = rotatePoint({ x: toBlock.x + toPort.x, y: toBlock.y + toPort.y }, toBlock);
    const fromPortPos = { x: snap(fromPos.x), y: snap(fromPos.y) };
    const toPortPos = { x: snap(toPos.x), y: snap(toPos.y) };
    const start = points[0];
    const next = points[1];
    const last = points[points.length - 1];
    const prev = points[points.length - 2];
    const fromSide = getPortSide(fromBlock, fromPos);
    const toSide = getPortSide(toBlock, toPos);
    if (start.x !== fromPortPos.x || start.y !== fromPortPos.y) {
      issues.push("start port mismatch");
      return false;
    }
    if (last.x !== toPortPos.x || last.y !== toPortPos.y) {
      issues.push("end port mismatch");
      return false;
    }
    if (!isValidStub(fromPortPos, next, fromSide)) {
      issues.push(`bad start stub (${fromSide}) port=${fromPortPos.x},${fromPortPos.y} next=${next.x},${next.y}`);
      return false;
    }
    if (!isValidStub(toPortPos, prev, toSide)) {
      issues.push(`bad end stub (${toSide}) port=${toPortPos.x},${toPortPos.y} prev=${prev.x},${prev.y}`);
      return false;
    }
    return true;
  }

  function isValidStub(port, other, side) {
    if (side === "left") return other.y === port.y && other.x <= port.x - GRID_SIZE;
    if (side === "right") return other.y === port.y && other.x >= port.x + GRID_SIZE;
    if (side === "top") return other.x === port.x && other.y <= port.y - GRID_SIZE;
    return other.x === port.x && other.y >= port.y + GRID_SIZE;
  }

  function segmentsIntersect(segA, segB) {
    const aH = segA.a.y === segA.b.y;
    const bH = segB.a.y === segB.b.y;
    if (aH === bH) return false;
    const h = aH ? segA : segB;
    const v = aH ? segB : segA;
    const hx1 = Math.min(h.a.x, h.b.x);
    const hx2 = Math.max(h.a.x, h.b.x);
    const vy1 = Math.min(v.a.y, v.b.y);
    const vy2 = Math.max(v.a.y, v.b.y);
    const ix = v.a.x;
    const iy = h.a.y;
    return ix > hx1 && ix < hx2 && iy > vy1 && iy < vy2;
  }

  function segmentHitsAnyBlock(segments, conn, issues) {
    const fromBlock = state.blocks.get(conn.from);
    const toBlock = state.blocks.get(conn.to);
    const keepouts = [];
    state.blocks.forEach((block) => {
      const rect = blockBounds(block);
      if (block === fromBlock || block === toBlock) return;
      keepouts.push(rect);
    });
    for (let i = 0; i < segments.length; i += 1) {
      const seg = segments[i];
      for (let r = 0; r < keepouts.length; r += 1) {
        const rect = keepouts[r];
        if (segmentHitsRect(seg.a, seg.b, rect)) {
          return true;
        }
      }
    }
    return false;
  }

  function segmentOverlapsOtherWire(segments, conn, issues) {
    for (let i = 0; i < state.connections.length; i += 1) {
      const other = state.connections[i];
      if (other === conn) continue;
      if (shareSamePort(conn, other)) continue;
      const otherSegs = (other.points || []).map((pt, idx, arr) => {
        if (idx >= arr.length - 1) return null;
        const a = arr[idx];
        const b = arr[idx + 1];
        if (a.x !== b.x && a.y !== b.y) return null;
        return {
          a,
          b,
          orientation: a.x === b.x ? "V" : "H",
        };
      }).filter(Boolean);
      for (let s = 0; s < segments.length; s += 1) {
        for (let o = 0; o < otherSegs.length; o += 1) {
          if (segmentsOverlap(segments[s], otherSegs[o])) {
            return true;
          }
        }
      }
    }
    return false;
  }

  function shareSamePort(a, b) {
    if (a.from === b.from && (a.fromIndex ?? 0) === (b.fromIndex ?? 0)) return true;
    if (a.to === b.to && a.toIndex === b.toIndex) return true;
    return false;
  }

  function segmentsOverlap(a, b) {
    if (a.orientation !== b.orientation) return false;
    if (a.orientation === "H") {
      if (a.a.y !== b.a.y) return false;
      const a1 = Math.min(a.a.x, a.b.x);
      const a2 = Math.max(a.a.x, a.b.x);
      const b1 = Math.min(b.a.x, b.b.x);
      const b2 = Math.max(b.a.x, b.b.x);
      return Math.max(a1, b1) <= Math.min(a2, b2);
    }
    if (a.a.x !== b.a.x) return false;
    const a1 = Math.min(a.a.y, a.b.y);
    const a2 = Math.max(a.a.y, a.b.y);
    const b1 = Math.min(b.a.y, b.b.y);
    const b2 = Math.max(b.a.y, b.b.y);
    return Math.max(a1, b1) <= Math.min(a2, b2);
  }

  function updateBlockTransform(block) {
    const angle = block.rotation || 0;
    const cx = block.width / 2;
    const cy = block.height / 2;
    block.group.setAttribute("transform", `translate(${block.x}, ${block.y}) rotate(${angle} ${cx} ${cy})`);
    block.group.setAttribute("data-rotation", String(angle));
  }

  function getRotatedBounds(block) {
    const angle = ((block.rotation || 0) % 360 + 360) % 360;
    const cx = block.x + block.width / 2;
    const cy = block.y + block.height / 2;
    const swap = angle === 90 || angle === 270;
    const w = swap ? block.height : block.width;
    const h = swap ? block.width : block.height;
    return {
      left: cx - w / 2,
      right: cx + w / 2,
      top: cy - h / 2,
      bottom: cy + h / 2,
    };
  }

  function rotatePoint(point, block) {
    const angle = ((block.rotation || 0) % 360 + 360) % 360;
    if (angle === 0) return point;
    const cx = block.x + block.width / 2;
    const cy = block.y + block.height / 2;
    const dx = point.x - cx;
    const dy = point.y - cy;
    if (angle === 90) return { x: cx - dy, y: cy + dx };
    if (angle === 180) return { x: cx - dx, y: cy - dy };
    if (angle === 270) return { x: cx + dy, y: cy - dx };
    return point;
  }

  function getPortSide(block, rotatedPoint) {
    const center = { x: block.x + block.width / 2, y: block.y + block.height / 2 };
    const dx = rotatedPoint.x - center.x;
    const dy = rotatedPoint.y - center.y;
    if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? "left" : "right";
    return dy < 0 ? "top" : "bottom";
  }

  function blockBounds(block) {
    const PORT_RADIUS = 6;
    const bounds = getRotatedBounds(block);
    let left = bounds.left;
    let right = bounds.right;
    let top = bounds.top;
    let bottom = bounds.bottom;
    block.ports.forEach((port) => {
      const pos = rotatePoint({ x: block.x + port.x, y: block.y + port.y }, block);
      const cx = pos.x;
      const cy = pos.y;
      left = Math.min(left, cx - PORT_RADIUS);
      right = Math.max(right, cx + PORT_RADIUS);
      top = Math.min(top, cy - PORT_RADIUS);
      bottom = Math.max(bottom, cy + PORT_RADIUS);
    });
    const padding = GRID_SIZE;
    return {
      left: left - padding,
      right: right + padding,
      top: top - padding,
      bottom: bottom + padding,
    };
  }

  function segmentHitsRect(a, b, rect) {
    if (a.x === b.x) {
      const x = a.x;
      const y1 = Math.min(a.y, b.y);
      const y2 = Math.max(a.y, b.y);
      return x >= rect.left && x <= rect.right && y2 >= rect.top && y1 <= rect.bottom;
    }
    if (a.y === b.y) {
      const y = a.y;
      const x1 = Math.min(a.x, b.x);
      const x2 = Math.max(a.x, b.x);
      return y >= rect.top && y <= rect.bottom && x2 >= rect.left && x1 <= rect.right;
    }
    return false;
  }

  function writeDebug(logEl, text) {
    if (!logEl) return;
    logEl.textContent += `\n${text}`;
  }

  function formatWireIssue(conn, issues) {
    return `[wire ${conn.from}->${conn.to}] ${issues.join("; ")}`;
  }

  function formatWireDebugInfo(conn) {
    const parts = [];
    if (conn.turnCheck) {
      parts.push(`turns=${conn.turnCheck.actual}`);
      if (Number.isFinite(conn.turnCheck.minimal)) {
        parts.push(`min=${conn.turnCheck.minimal}`);
      }
    }
    const points = conn.points || [];
    if (points.length < 2) {
      return parts.length > 0 ? ` (${parts.join(" ")})` : "";
    }
    const stats = segmentLengthStats(points);
    parts.push(`len=${stats.length}`);
    parts.push(`seg1=${stats.seg1}`);
    parts.push(`seg2=${stats.seg2}`);
    parts.push(`shortPenalty=${stats.shortPenalty}`);
    return ` (${parts.join(" ")})`;
  }

  function buildDebugSnapshot() {
    const blocks = Array.from(state.blocks.values())
      .map((block) => {
        const ports = block.ports
          .map((port) => `{x:${port.x},y:${port.y},side:"${port.side}",type:"${port.type}",index:${port.index}}`)
          .join(", ");
        return `  makeBlock("${block.id}", "${block.type}", ${block.x}, ${block.y}, ${block.width}, ${block.height}, [${ports}])`;
      })
      .join(",\n");
    const conns = state.connections
      .map((conn) => `  { from: "${conn.from}", to: "${conn.to}", toIndex: ${conn.toIndex}, fromIndex: ${conn.fromIndex ?? 0} }`)
      .join(",\n");
    const summaries = state.connections
      .map((conn) => {
        const metrics = formatWireDebugInfo(conn);
        if (!conn.points || conn.points.length < 2) {
          return `[wire ${conn.from}->${conn.to}] no path${metrics}`;
        }
        return `[wire ${conn.from}->${conn.to}]${metrics}`;
      })
      .join("\n");
    return [
      "Wire checks:",
      "Test snapshot:",
      "const blocks = new Map([",
      blocks,
      "]);",
      "const connections = [",
      conns,
      "];",
      summaries,
    ].join("\n");
  }

  function updateSelectionBox() {
    const selected = state.selectedId ? state.blocks.get(state.selectedId) : null;
    if (!selected) {
      selectionRect.setAttribute("display", "none");
      if (DEBUG_SELECTION) {
        debugBaseRect.setAttribute("display", "none");
        debugKeepoutRect.setAttribute("display", "none");
        debugText.textContent = "";
      }
      return;
    }
    const bounds = getRotatedBounds(selected);
    const rect = {
      left: bounds.left - SELECTION_PAD,
      right: bounds.right + SELECTION_PAD,
      top: bounds.top - SELECTION_PAD,
      bottom: bounds.bottom + SELECTION_PAD,
    };
    selectionRect.setAttribute("display", "block");
    selectionRect.setAttribute("x", rect.left);
    selectionRect.setAttribute("y", rect.top);
    selectionRect.setAttribute("width", rect.right - rect.left);
    selectionRect.setAttribute("height", rect.bottom - rect.top);
    if (DEBUG_SELECTION) {
      debugBaseRect.setAttribute("display", "block");
      debugBaseRect.setAttribute("x", bounds.left);
      debugBaseRect.setAttribute("y", bounds.top);
      debugBaseRect.setAttribute("width", bounds.right - bounds.left);
      debugBaseRect.setAttribute("height", bounds.bottom - bounds.top);
      debugKeepoutRect.setAttribute("display", "block");
      debugKeepoutRect.setAttribute("x", rect.left);
      debugKeepoutRect.setAttribute("y", rect.top);
      debugKeepoutRect.setAttribute("width", rect.right - rect.left);
      debugKeepoutRect.setAttribute("height", rect.bottom - rect.top);
      debugText.textContent = `pad=${SELECTION_PAD}`;
    }
  }

  function clearWorkspace() {
    state.blocks.clear();
    state.connections = [];
    state.pendingPort = null;
    state.nextId = 1;
    state.selectedId = null;
    state.selectedConnection = null;
    state.deleteMode = false;
    blockLayer.innerHTML = "";
    wireLayer.innerHTML = "";
    selectionRect.setAttribute("display", "none");
  }

  function findNearestConnection(point, threshold = 12) {
    let best = null;
    let bestDist = Infinity;
    state.connections.forEach((conn) => {
      const points = conn.points || [];
      for (let i = 0; i < points.length - 1; i += 1) {
        const dist = distancePointToSegment(point, points[i], points[i + 1]);
        if (dist < bestDist) {
          bestDist = dist;
          best = conn;
        }
      }
    });
    return bestDist <= threshold ? best : null;
  }

  function deleteConnection(conn) {
    const idx = state.connections.indexOf(conn);
    if (idx >= 0) {
      state.connections[idx].path.remove();
      state.connections.splice(idx, 1);
    }
    state.routingDirty = true;
    updateConnections();
  }

  function deleteBlock(blockId) {
    const block = state.blocks.get(blockId);
    if (!block) return;
    const related = state.connections.filter((conn) => conn.from === blockId || conn.to === blockId);
    related.forEach((conn) => deleteConnection(conn));
    block.group.remove();
    state.blocks.delete(blockId);
    state.routingDirty = true;
    updateConnections();
  }

  function updateBlockLabel(block) {
    if (block.type === "constant") {
      const texts = block.group.querySelectorAll("text");
      if (texts[1]) texts[1].textContent = `${block.params.value}`;
    }
    if (block.type === "step") {
      const texts = block.group.querySelectorAll("text");
      if (texts[1]) texts[1].textContent = `t=${block.params.stepTime}`;
    }
    if (block.type === "ramp") {
      const texts = block.group.querySelectorAll("text");
      if (texts[1]) texts[1].textContent = `m=${block.params.slope} t0=${block.params.start}`;
    }
    if (block.type === "impulse") {
      const texts = block.group.querySelectorAll("text");
      if (texts[1]) texts[1].textContent = `t=${block.params.time} A=${block.params.amp}`;
    }
    if (block.type === "sine") {
      const texts = block.group.querySelectorAll("text");
      if (texts[1]) texts[1].textContent = `A=${block.params.amp} f=${block.params.freq}`;
      if (texts[2]) texts[2].textContent = `ph=${block.params.phase}`;
    }
    if (block.type === "chirp") {
      const texts = block.group.querySelectorAll("text");
      if (texts[1]) texts[1].textContent = `A=${block.params.amp} f0=${block.params.f0}`;
      if (texts[2]) texts[2].textContent = `f1=${block.params.f1} t1=${block.params.t1}`;
    }
    if (block.type === "noise") {
      const texts = block.group.querySelectorAll("text");
      if (texts[1]) texts[1].textContent = `A=${block.params.amp}`;
    }
    if (block.type === "fileSource") {
      const texts = block.group.querySelectorAll("text");
      if (texts[1]) texts[1].textContent = `${block.params.path}`;
    }
    if (block.type === "gain") {
      const label = block.group.querySelector(".gain-text");
      if (label) label.textContent = `${block.params.gain}`;
    }
    if (block.type === "sum") {
      const signs = block.params.signs || [];
      const texts = block.group.querySelectorAll(".sum-sign");
      texts.forEach((textEl) => {
        const idx = Number(textEl.getAttribute("data-sign-index")) || 0;
        textEl.textContent = (signs[idx] ?? 1) < 0 ? "-" : "";
      });
    }
    if (block.type === "derivative") {
      const texts = block.group.querySelectorAll("text");
      if (texts[1]) texts[1].textContent = "d/dt";
    }
    if (block.type === "lpf") {
      const texts = block.group.querySelectorAll("text");
      if (texts[1]) texts[1].textContent = `fc=${block.params.cutoff}`;
    }
    if (block.type === "hpf") {
      const texts = block.group.querySelectorAll("text");
      if (texts[1]) texts[1].textContent = `fc=${block.params.cutoff}`;
    }
    if (block.type === "pid") {
      const texts = block.group.querySelectorAll("text");
      if (texts[1]) texts[1].textContent = `Kp=${block.params.kp} Ki=${block.params.ki}`;
      if (texts[2]) texts[2].textContent = `Kd=${block.params.kd}`;
    }
    if (block.type === "saturation") {
      const texts = block.group.querySelectorAll("text");
      if (texts[1]) texts[1].textContent = `${block.params.min}..${block.params.max}`;
    }
    if (block.type === "rate") {
      const texts = block.group.querySelectorAll("text");
      if (texts[1]) texts[1].textContent = `r=${block.params.rise} f=${block.params.fall}`;
    }
    if (block.type === "backlash") {
      const texts = block.group.querySelectorAll("text");
      if (texts[1]) texts[1].textContent = `w=${block.params.width}`;
    }
    if (block.type === "tf") {
      const texts = block.group.querySelectorAll("text");
      if (texts[1]) texts[1].textContent = `num=[${block.params.num.join(",")}]`;
      if (texts[2]) texts[2].textContent = `den=[${block.params.den.join(",")}]`;
    }
    if (block.type === "zoh") {
      const texts = block.group.querySelectorAll("text");
      if (texts[1]) texts[1].textContent = `Ts=${block.params.ts}`;
    }
    if (block.type === "foh") {
      const texts = block.group.querySelectorAll("text");
      if (texts[1]) texts[1].textContent = `Ts=${block.params.ts}`;
    }
    if (block.type === "dtf") {
      const texts = block.group.querySelectorAll("text");
      if (texts[1]) texts[1].textContent = `num=[${block.params.num.join(",")}]`;
      if (texts[2]) texts[2].textContent = `den=[${block.params.den.join(",")}] Ts=${block.params.ts}`;
    }
    if (block.type === "fileSink") {
      const texts = block.group.querySelectorAll("text");
      if (texts[1]) texts[1].textContent = `${block.params.path}`;
    }
  }

  function clientToSvg(clientX, clientY) {
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: clientX, y: clientY };
    const inverse = ctm.inverse();
    const svgPoint = point.matrixTransform(inverse);
    return { x: svgPoint.x, y: svgPoint.y };
  }

  return {
    createBlock,
    updateConnections,
    updateBlockTransform,
    selectConnection,
    clearPending,
    selectBlock,
    clearWorkspace,
    findNearestConnection,
    deleteConnection,
    deleteBlock,
    updateBlockLabel,
    updateSelectionBox,
    clientToSvg,
    forceFullRoute,
  };
}
