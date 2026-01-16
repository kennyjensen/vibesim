import { snap, distancePointToSegment, GRID_SIZE, segmentLengthStats } from "./geometry.js";
import { routeAllConnections, routeDirtyConnections } from "./router.js";
import { renderScope } from "./sim.js";

const DEBUG_SELECTION = true;
const DEBUG_WIRE_CHECKS = true;
const SELECTION_PAD = 10;
const HOP_RADIUS = 4;

function createSvgElement(tag, attrs = {}, text = "") {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  Object.entries(attrs).forEach(([key, value]) => {
    el.setAttribute(key, value);
  });
  if (text) el.textContent = text;
  return el;
}

function renderSvgMath(group, mathMl, width, height) {
  if (!group) return;
  group.innerHTML = "";
  const foreign = createSvgElement("foreignObject", {
    x: 0,
    y: 0,
    width,
    height,
    class: "upright",
  });
  const div = document.createElement("div");
  div.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
  div.className = "math-foreign";
  div.innerHTML = mathMl;
  foreign.appendChild(div);
  group.appendChild(foreign);
}

let mathJaxQueued = false;
let mathJaxRetryScheduled = false;
let mathJaxFlushScheduled = false;
const mathJaxQueue = new Set();
function queueMathJaxTypeset() {
  if (mathJaxFlushScheduled) return;
  mathJaxFlushScheduled = true;
  requestAnimationFrame(() => {
    mathJaxFlushScheduled = false;
    if (window.MathJax && typeof window.MathJax.typesetPromise === "function") {
      const targets = Array.from(mathJaxQueue);
      mathJaxQueue.clear();
      window.MathJax.typesetPromise(targets);
      mathJaxRetryScheduled = false;
    } else if (!mathJaxRetryScheduled) {
      mathJaxRetryScheduled = true;
      setTimeout(() => {
        mathJaxRetryScheduled = false;
        queueMathJaxTypeset();
      }, 200);
    }
  });
}

function renderTeXMath(group, tex, width, height) {
  if (!group) return;
  group.innerHTML = "";
  mathJaxQueue.add(group);
  const foreign = createSvgElement("foreignObject", {
    x: 0,
    y: 0,
    width,
    height,
    class: "upright",
  });
  const div = document.createElement("div");
  div.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
  div.className = "math-foreign";
  const span = document.createElement("span");
  span.className = "mathjax-tex";
  span.textContent = `\\(${tex}\\)`;
  div.appendChild(span);
  foreign.appendChild(div);
  group.appendChild(foreign);
  queueMathJaxTypeset();
}

function svgRect(x, y, w, h, cls) {
  return createSvgElement("rect", { x, y, width: w, height: h, class: cls });
}

function svgText(x, y, text) {
  return createSvgElement("text", { x, y, class: "block-text upright" }, text);
}

function renderSourcePlot(group, width, height, plotPath) {
  group.appendChild(svgRect(0, 0, width, height, "block-body"));
  const axisX = 14;
  const axisY = height - 16;
  const axisTop = 14;
  const axisRight = width - 14;
  group.appendChild(
    createSvgElement("line", {
      x1: axisX,
      y1: axisY,
      x2: axisRight,
      y2: axisY,
      class: "source-axis",
      stroke: "#3c3c3c",
      "stroke-width": 2,
      fill: "none",
    })
  );
  group.appendChild(
    createSvgElement("line", {
      x1: axisRight,
      y1: axisY,
      x2: axisRight - 6,
      y2: axisY - 3,
      class: "source-axis",
      stroke: "#3c3c3c",
      "stroke-width": 2,
      fill: "none",
    })
  );
  group.appendChild(
    createSvgElement("line", {
      x1: axisRight,
      y1: axisY,
      x2: axisRight - 6,
      y2: axisY + 3,
      class: "source-axis",
      stroke: "#3c3c3c",
      "stroke-width": 2,
      fill: "none",
    })
  );
  group.appendChild(
    createSvgElement("line", {
      x1: axisX,
      y1: axisY,
      x2: axisX,
      y2: axisTop,
      class: "source-axis",
      stroke: "#3c3c3c",
      "stroke-width": 2,
      fill: "none",
    })
  );
  group.appendChild(
    createSvgElement("line", {
      x1: axisX,
      y1: axisTop,
      x2: axisX - 3,
      y2: axisTop + 6,
      class: "source-axis",
      stroke: "#3c3c3c",
      "stroke-width": 2,
      fill: "none",
    })
  );
  group.appendChild(
    createSvgElement("line", {
      x1: axisX,
      y1: axisTop,
      x2: axisX + 3,
      y2: axisTop + 6,
      class: "source-axis",
      stroke: "#3c3c3c",
      "stroke-width": 2,
      fill: "none",
    })
  );
  group.appendChild(
    createSvgElement("path", {
      d: plotPath,
      class: "source-plot",
      stroke: "#3c3c3c",
      "stroke-width": 2,
      fill: "none",
    })
  );
}

function renderCenteredAxesPlot(group, width, height, plotPath) {
  group.appendChild(svgRect(0, 0, width, height, "block-body"));
  const axisLeft = 14;
  const axisRight = width - 14;
  const axisTop = 14;
  const axisBottom = height - 14;
  const midX = (axisLeft + axisRight) / 2;
  const midY = (axisTop + axisBottom) / 2;
  group.appendChild(
    createSvgElement("line", {
      x1: axisLeft,
      y1: midY,
      x2: axisRight,
      y2: midY,
      class: "source-axis",
      stroke: "#3c3c3c",
      "stroke-width": 2,
      fill: "none",
    })
  );
  group.appendChild(
    createSvgElement("line", {
      x1: axisRight,
      y1: midY,
      x2: axisRight - 6,
      y2: midY - 3,
      class: "source-axis",
      stroke: "#3c3c3c",
      "stroke-width": 2,
      fill: "none",
    })
  );
  group.appendChild(
    createSvgElement("line", {
      x1: axisRight,
      y1: midY,
      x2: axisRight - 6,
      y2: midY + 3,
      class: "source-axis",
      stroke: "#3c3c3c",
      "stroke-width": 2,
      fill: "none",
    })
  );
  group.appendChild(
    createSvgElement("line", {
      x1: midX,
      y1: axisBottom,
      x2: midX,
      y2: axisTop,
      class: "source-axis",
      stroke: "#3c3c3c",
      "stroke-width": 2,
      fill: "none",
    })
  );
  group.appendChild(
    createSvgElement("line", {
      x1: midX,
      y1: axisTop,
      x2: midX - 3,
      y2: axisTop + 6,
      class: "source-axis",
      stroke: "#3c3c3c",
      "stroke-width": 2,
      fill: "none",
    })
  );
  group.appendChild(
    createSvgElement("line", {
      x1: midX,
      y1: axisTop,
      x2: midX + 3,
      y2: axisTop + 6,
      class: "source-axis",
      stroke: "#3c3c3c",
      "stroke-width": 2,
      fill: "none",
    })
  );
  if (!plotPath) return;
  const paths = Array.isArray(plotPath) ? plotPath : [plotPath];
  paths.forEach((d) => {
    group.appendChild(
      createSvgElement("path", {
        d,
        class: "source-plot",
        stroke: "#3c3c3c",
        "stroke-width": 2,
        fill: "none",
      })
    );
  });
}

function renderLabelNode(block, label, { showNode = true } = {}) {
  const group = block.group;
  const mathGroup = createSvgElement("g", { class: "label-math", transform: "translate(0,-20)" });
  group.appendChild(mathGroup);
  renderTeXMath(mathGroup, label || "", block.width, block.height);
  if (showNode) {
    group.appendChild(createSvgElement("circle", { cx: 20, cy: 20, r: 5, class: "label-node" }));
  }
}

export function buildFallbackPath(fromPos, toPos) {
  if (!fromPos || !toPos) return [];
  if (fromPos.x === toPos.x || fromPos.y === toPos.y) {
    return [fromPos, toPos];
  }
  return [fromPos, { x: fromPos.x, y: toPos.y }, toPos];
}

function buildSegments(points, owner) {
  const segments = [];
  if (!points || points.length < 2) return segments;
  const hasBadPoint = points.some((pt) => !Number.isFinite(pt.x) || !Number.isFinite(pt.y));
  if (hasBadPoint) return segments;
  let runStart = points[0];
  let prev = points[0];
  let orientation = points[1].x === points[0].x ? "V" : "H";

  const pushSegment = (start, end, isStubOverride = null) => {
    if (start.x === end.x && start.y === end.y) return;
    if (orientation === "V") {
      const minY = Math.min(start.y, end.y);
      const maxY = Math.max(start.y, end.y);
      const length = maxY - minY;
      const isStub =
        isStubOverride ??
        ((start === points[0] && length <= GRID_SIZE) || (end === points[points.length - 1] && length <= GRID_SIZE));
      segments.push({
        owner,
        orientation: "V",
        a: start,
        b: end,
        minY,
        maxY,
        x: start.x,
        isStub,
      });
    } else {
      const minX = Math.min(start.x, end.x);
      const maxX = Math.max(start.x, end.x);
      const length = maxX - minX;
      const isStub =
        isStubOverride ??
        ((start === points[0] && length <= GRID_SIZE) || (end === points[points.length - 1] && length <= GRID_SIZE));
      segments.push({
        owner,
        orientation: "H",
        a: start,
        b: end,
        minX,
        maxX,
        y: start.y,
        isStub,
      });
    }
  };

  for (let i = 1; i < points.length; i += 1) {
    const curr = points[i];
    const stepOrientation = curr.x === prev.x ? "V" : "H";
    if (stepOrientation !== orientation) {
      pushSegment(runStart, prev);
      runStart = prev;
      orientation = stepOrientation;
    }
    prev = curr;
  }
  pushSegment(runStart, prev);
  return segments;
}

function getCrossingsOnHorizontal(seg, otherSegments) {
  const hits = [];
  const y = seg.y;
  otherSegments.forEach((other) => {
    if (other.orientation !== "V") return;
    if (other.x <= seg.minX || other.x >= seg.maxX) return;
    if (y <= other.minY || y >= other.maxY) return;
    hits.push(other.x);
  });
  return hits;
}

function getCrossingsOnVertical(seg, otherSegments) {
  const hits = [];
  const x = seg.x;
  otherSegments.forEach((other) => {
    if (other.orientation !== "H") return;
    if (other.y <= seg.minY || other.y >= seg.maxY) return;
    if (x <= other.minX || x >= other.maxX) return;
    hits.push(other.y);
  });
  return hits;
}

function buildPathWithHops(segments, otherSegments) {
  if (!segments.length) return "";
  const commands = [];
  let current = segments[0].a;
  commands.push(`M ${current.x} ${current.y}`);

  segments.forEach((seg) => {
    if (current.x !== seg.a.x || current.y !== seg.a.y) {
      commands.push(`L ${seg.a.x} ${seg.a.y}`);
      current = seg.a;
    }

    if (seg.isStub) {
      commands.push(`L ${seg.b.x} ${seg.b.y}`);
      current = seg.b;
      return;
    }

    if (seg.orientation === "H") {
      const dir = seg.a.x <= seg.b.x ? 1 : -1;
      const crossings = getCrossingsOnHorizontal(seg, otherSegments)
        .filter((x) => x > seg.minX + HOP_RADIUS && x < seg.maxX - HOP_RADIUS)
        .sort((a, b) => (dir === 1 ? a - b : b - a));
      crossings.forEach((x) => {
        commands.push(`L ${x - HOP_RADIUS * dir} ${seg.a.y}`);
        commands.push(`a ${HOP_RADIUS} ${HOP_RADIUS} 0 0 1 ${HOP_RADIUS * 2 * dir} 0`);
      });
      commands.push(`L ${seg.b.x} ${seg.b.y}`);
    } else {
      const dir = seg.a.y <= seg.b.y ? 1 : -1;
      const crossings = getCrossingsOnVertical(seg, otherSegments)
        .filter((y) => y > seg.minY + HOP_RADIUS && y < seg.maxY - HOP_RADIUS)
        .sort((a, b) => (dir === 1 ? a - b : b - a));
      crossings.forEach((y) => {
        commands.push(`L ${seg.a.x} ${y - HOP_RADIUS * dir}`);
        commands.push(`a ${HOP_RADIUS} ${HOP_RADIUS} 0 0 1 0 ${HOP_RADIUS * 2 * dir}`);
      });
      commands.push(`L ${seg.b.x} ${seg.b.y}`);
    }
    current = seg.b;
  });

  return commands.join(" ");
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

function drawIcon(type, x, y, sizeOverride = null) {
  const g = createSvgElement("g", { class: "block-icon upright", transform: `translate(${x}, ${y})` });
  const size = sizeOverride ?? 22;
  const mid = size / 2;
  const addText = (text) => {
    g.appendChild(createSvgElement("text", { x: mid, y: mid }, text));
  };
  const addMath = (tex) => {
    const foreign = createSvgElement("foreignObject", {
      x: 0,
      y: 0,
      width: size,
      height: size,
      class: "upright",
    });
    const div = document.createElement("div");
    div.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
    div.className = "icon-math";
    const span = document.createElement("span");
    span.className = "mathjax-tex";
    span.textContent = `\\(${tex}\\)`;
    div.appendChild(span);
    foreign.appendChild(div);
    g.appendChild(foreign);
    queueMathJaxTypeset();
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
    addMath("z^{-1}");
  } else if (type === "zoh") {
    addText("ZOH");
  } else if (type === "foh") {
    addText("FOH");
  } else if (type === "integrator") {
    addText("1/s");
  } else if (type === "derivative") {
    addText("d/dt");
  } else if (type === "delay") {
    addText("e^-sT");
  } else if (type === "ddelay") {
    addMath("z^{-1}");
  } else if (type === "stateSpace") {
    addText("SS");
  } else if (type === "dstateSpace") {
    addText("SSd");
  } else {
    addText("fx");
  }
  return g;
}

function buildTransferMathML(num = [], den = []) {
  const numRow = buildPolyMathML(num);
  const denRow = buildPolyMathML(den);
  return `<math xmlns="http://www.w3.org/1998/Math/MathML"><mfrac>${numRow}${denRow}</mfrac></math>`;
}

function buildPolyMathML(coeffs = []) {
  const list = Array.isArray(coeffs) ? coeffs : [];
  if (list.length === 0) {
    return "<mrow><mn>0</mn></mrow>";
  }
  const degree = list.length - 1;
  const parts = [];
  list.forEach((coeff, idx) => {
    const power = degree - idx;
    const raw = typeof coeff === "string" ? coeff.trim() : coeff;
    const numeric = Number(raw);
    const isNumeric = Number.isFinite(numeric);
    if (isNumeric && numeric === 0) return;
    let sign = "+";
    let abs = numeric;
    let sym = null;
    if (!isNumeric) {
      const text = String(raw || "");
      if (!text) return;
      if (text.startsWith("-")) {
        sign = "-";
        sym = text.slice(1).trim() || "0";
      } else if (text.startsWith("+")) {
        sym = text.slice(1).trim() || "0";
      } else {
        sym = text;
      }
    } else {
      sign = numeric < 0 ? "-" : "+";
      abs = Math.abs(numeric);
    }
    const isFirst = parts.length === 0;
    if (!isFirst) {
      parts.push(`<mo>${sign}</mo>`);
    } else if (sign === "-") {
      parts.push("<mo>-</mo>");
    }
    if (power === 0) {
      if (sym) parts.push(`<mi>${sym}</mi>`);
      else parts.push(`<mn>${abs}</mn>`);
      return;
    }
    if (sym) {
      parts.push(`<mi>${sym}</mi>`);
      parts.push("<mo>&#x2062;</mo>");
    } else if (abs !== 1) {
      parts.push(`<mn>${abs}</mn>`);
      parts.push("<mo>&#x2062;</mo>");
    }
    if (power === 1) {
      parts.push("<mi>s</mi>");
    } else {
      parts.push(`<msup><mi>s</mi><mn>${power}</mn></msup>`);
    }
  });
  if (parts.length === 0) {
    return "<mrow><mn>0</mn></mrow>";
  }
  return `<mrow>${parts.join("")}</mrow>`;
}

function buildTransferTeX(num = [], den = [], variable = "s") {
  const numRow = buildPolyTeX(num, variable);
  const denRow = buildPolyTeX(den, variable);
  return `\\frac{${numRow}}{${denRow}}`;
}

function buildPolyTeX(coeffs = [], variable = "s") {
  const list = Array.isArray(coeffs) ? coeffs : [];
  if (list.length === 0) return "0";
  const degree = list.length - 1;
  const parts = [];
  list.forEach((coeff, idx) => {
    const power = degree - idx;
    const raw = typeof coeff === "string" ? coeff.trim() : coeff;
    const numeric = Number(raw);
    const isNumeric = Number.isFinite(numeric);
    if (isNumeric && numeric === 0) return;
    let sign = "+";
    let abs = numeric;
    let sym = null;
    if (!isNumeric) {
      const text = String(raw || "");
      if (!text) return;
      if (text.startsWith("-")) {
        sign = "-";
        sym = text.slice(1).trim() || "0";
      } else if (text.startsWith("+")) {
        sym = text.slice(1).trim() || "0";
      } else {
        sym = text;
      }
    } else {
      sign = numeric < 0 ? "-" : "+";
      abs = Math.abs(numeric);
    }
    const isFirst = parts.length === 0;
    if (!isFirst) {
      parts.push(sign);
    } else if (sign === "-") {
      parts.push("-");
    }
    if (power === 0) {
      parts.push(sym ? sym : `${abs}`);
      return;
    }
    if (sym) {
      parts.push(`${sym}`);
    } else if (abs !== 1) {
      parts.push(`${abs}`);
    }
    if (sym) {
      parts.push("\\,");
    }
    if (power === 1) {
      parts.push(variable);
    } else {
      parts.push(`${variable}^{${power}}`);
    }
  });
  if (parts.length === 0) return "0";
  return parts.join("");
}

const blockTemplates = {
  constant: {
    width: 80,
    height: 80,
    inputs: [],
    outputs: [{ x: 80, y: 40, side: "right" }],
    defaultParams: { value: 1 },
    render: (block) => {
      const group = block.group;
      group.appendChild(svgRect(0, 0, block.width, block.height, "block-body"));
      const mathGroup = createSvgElement("g", { class: "constant-math" });
      group.appendChild(mathGroup);
      renderTeXMath(mathGroup, `${block.params.value}`, block.width, block.height);
    },
  },
  step: {
    width: 80,
    height: 80,
    inputs: [],
    outputs: [{ x: 80, y: 40, side: "right" }],
    defaultParams: { stepTime: 0 },
    render: (block) => {
      const axisX = 14;
      const axisY = block.height - 16;
      const axisTop = 14;
      const axisRight = block.width - 14;
      const baseline = axisY - 6;
      const stepPath = `M${axisX} ${baseline} H${axisX + 16} V${axisTop + 8} H${axisRight - 4}`;
      renderSourcePlot(block.group, block.width, block.height, stepPath);
    },
  },
  ramp: {
    width: 80,
    height: 80,
    inputs: [],
    outputs: [{ x: 80, y: 40, side: "right" }],
    defaultParams: { slope: 1, start: 0 },
    render: (block) => {
      const axisX = 14;
      const axisY = block.height - 16;
      const axisTop = 14;
      const axisRight = block.width - 14;
      const baseline = axisY - 6;
      const rampPath = `M${axisX} ${baseline} L${axisRight - 4} ${axisTop + 8}`;
      renderSourcePlot(block.group, block.width, block.height, rampPath);
    },
  },
  impulse: {
    width: 80,
    height: 80,
    inputs: [],
    outputs: [{ x: 80, y: 40, side: "right" }],
    defaultParams: { time: 0, amp: 1 },
    render: (block) => {
      const axisX = 14;
      const axisY = block.height - 16;
      const axisTop = 14;
      const baseline = axisY - 6;
      const spikeX = axisX + 22;
      const impulsePath = `M${axisX} ${baseline} H${spikeX - 2} V${axisTop + 6} H${spikeX + 2} V${baseline} H${block.width - 18}`;
      renderSourcePlot(block.group, block.width, block.height, impulsePath);
    },
  },
  sine: {
    width: 80,
    height: 80,
    inputs: [],
    outputs: [{ x: 80, y: 40, side: "right" }],
    defaultParams: { amp: 1, freq: 1, phase: 0 },
    render: (block) => {
      const axisX = 14;
      const axisY = block.height - 16;
      const axisTop = 14;
      const axisRight = block.width - 14;
      const midY = (axisY + axisTop) / 2;
      const amp = (axisY - axisTop) / 3;
      const w = axisRight - axisX - 4;
      const sinePath = `M${axisX} ${midY}
        C${axisX + w * 0.25} ${midY - amp}, ${axisX + w * 0.25} ${midY - amp}, ${axisX + w * 0.5} ${midY}
        C${axisX + w * 0.75} ${midY + amp}, ${axisX + w * 0.75} ${midY + amp}, ${axisX + w} ${midY}`;
      renderSourcePlot(block.group, block.width, block.height, sinePath);
    },
  },
  chirp: {
    width: 80,
    height: 80,
    inputs: [],
    outputs: [{ x: 80, y: 40, side: "right" }],
    defaultParams: { amp: 1, f0: 1, f1: 5, t1: 10 },
    render: (block) => {
      const axisX = 14;
      const axisY = block.height - 16;
      const axisTop = 14;
      const axisRight = block.width - 14;
      const midY = (axisY + axisTop) / 2;
      const amp = (axisY - axisTop) / 3;
      const w = axisRight - axisX - 4;
      const chirpPath = `M${axisX} ${midY}
        C${axisX + w * 0.18} ${midY - amp}, ${axisX + w * 0.18} ${midY - amp}, ${axisX + w * 0.3} ${midY}
        C${axisX + w * 0.42} ${midY + amp}, ${axisX + w * 0.42} ${midY + amp}, ${axisX + w * 0.54} ${midY}
        C${axisX + w * 0.62} ${midY - amp}, ${axisX + w * 0.62} ${midY - amp}, ${axisX + w * 0.7} ${midY}
        C${axisX + w * 0.76} ${midY + amp}, ${axisX + w * 0.76} ${midY + amp}, ${axisX + w * 0.82} ${midY}
        C${axisX + w * 0.86} ${midY - amp}, ${axisX + w * 0.86} ${midY - amp}, ${axisX + w * 0.9} ${midY}
        C${axisX + w * 0.93} ${midY + amp}, ${axisX + w * 0.93} ${midY + amp}, ${axisX + w * 0.96} ${midY}
        C${axisX + w * 0.98} ${midY - amp}, ${axisX + w * 0.98} ${midY - amp}, ${axisX + w} ${midY}`;
      renderSourcePlot(block.group, block.width, block.height, chirpPath);
    },
  },
  noise: {
    width: 80,
    height: 80,
    inputs: [],
    outputs: [{ x: 80, y: 40, side: "right" }],
    defaultParams: { amp: 1 },
    render: (block) => {
      const axisX = 14;
      const axisY = block.height - 16;
      const axisTop = 14;
      const axisRight = block.width - 14;
      const minX = axisX + 2;
      const maxX = axisRight - 2;
      const minY = axisTop + 2;
      const maxY = axisY - 2;
      const midY = (minY + maxY) / 2;
      const amp = (maxY - minY) / 2;
      const offsets = [0, -0.2, 0.6, -0.9, 0.3, -0.7, 0.95, -0.4, 0.8, -0.95, 0.5, -0.6, 0.9, -0.3, 0.7, -0.85, 0.4];
      const step = (maxX - minX) / (offsets.length - 1);
      const clamp = (val, min, max) => Math.max(min, Math.min(max, val));
      const points = offsets.map((val, idx) => {
        const x = clamp(minX + idx * step, minX, maxX);
        const y = clamp(midY + val * amp, minY, maxY);
        return { x, y };
      });
      const noisePath = points
        .map((pt, idx) => `${idx === 0 ? "M" : "L"}${pt.x} ${pt.y}`)
        .join(" ");
      renderSourcePlot(block.group, block.width, block.height, noisePath);
    },
  },
  fileSource: {
    width: 80,
    height: 80,
    inputs: [],
    outputs: [{ x: 80, y: 40, side: "right" }],
    defaultParams: { path: "signal.csv" },
    render: (block) => {
      const group = block.group;
      group.appendChild(svgRect(0, 0, block.width, block.height, "block-body"));
      const iconW = 44;
      const iconH = 54;
      const x = (block.width - iconW) / 2;
      const y = (block.height - iconH) / 2;
      const fold = 12;
      group.appendChild(
        createSvgElement("path", {
          d: [
            `M${x} ${y}`,
            `H${x + iconW - fold}`,
            `L${x + iconW} ${y + fold}`,
            `V${y + iconH}`,
            `H${x}`,
            "Z",
          ].join(" "),
          class: "file-icon-stroke",
        })
      );
      group.appendChild(
        createSvgElement("polyline", {
          points: `${x + iconW - fold},${y} ${x + iconW - fold},${y + fold} ${x + iconW},${y + fold}`,
          class: "file-icon-stroke",
        })
      );
      group.appendChild(
        createSvgElement(
          "text",
          { x: block.width / 2, y: block.height / 2 + 4, class: "file-icon-label upright", "text-anchor": "middle" },
          "IN"
        )
      );
    },
  },
  labelSource: {
    width: 40,
    height: 40,
    inputs: [],
    outputs: [{ x: 40, y: 20, side: "right" }],
    defaultParams: { name: "x" },
    render: (block) => {
      renderLabelNode(block, block.params.name);
      block.group.appendChild(createSvgElement("line", { x1: 25, y1: 20, x2: 40, y2: 20, class: "label-node" }));
    },
  },
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
    width: 40,
    height: 40,
    inputs: [
      { x: 20 - GRID_SIZE * 2, y: 20, side: "left", wireX: 20 - GRID_SIZE, wireY: 20 },
      { x: 20, y: 20 - GRID_SIZE * 2, side: "top", wireX: 20, wireY: 20 - GRID_SIZE },
      { x: 20, y: 20 + GRID_SIZE * 2, side: "bottom", wireX: 20, wireY: 20 + GRID_SIZE },
    ],
    outputs: [{ x: 20 + GRID_SIZE * 2, y: 20, side: "right", wireX: 20 + GRID_SIZE, wireY: 20 }],
    defaultParams: {},
    render: (block) => {
      const group = block.group;
      const r = 20;
      const offset = r / Math.SQRT2;
      group.appendChild(createSvgElement("circle", { cx: 20, cy: 20, r: 20, class: "sum-circle" }));
      group.appendChild(
        createSvgElement("line", {
          x1: 20 - offset,
          y1: 20 - offset,
          x2: 20 + offset,
          y2: 20 + offset,
          class: "sum-line",
        })
      );
      group.appendChild(
        createSvgElement("line", {
          x1: 20 + offset,
          y1: 20 - offset,
          x2: 20 - offset,
          y2: 20 + offset,
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
  integrator: {
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
          class: "block-body integrator-body",
        })
      );
      const mathGroup = createSvgElement("g", { class: "integrator-math" });
      group.appendChild(mathGroup);
      renderTeXMath(mathGroup, "\\frac{1}{s}", block.width, block.height);
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
  saturation: {
    width: 80,
    height: 80,
    inputs: [{ x: 0, y: 40, side: "left" }],
    outputs: [{ x: 80, y: 40, side: "right" }],
    defaultParams: { min: -1, max: 1 },
    render: (block) => {
      const axisLeft = 14;
      const axisRight = block.width - 14;
      const axisTop = 14;
      const axisBottom = block.height - 14;
      const midX = (axisLeft + axisRight) / 2;
      const midY = (axisTop + axisBottom) / 2;
      const flatY = midY - 16;
      const lowY = midY + 16;
      const leftX = axisLeft + 6;
      const rightX = axisRight - 6;
      const satPath = `M${leftX} ${lowY} L${midX - 10} ${lowY} L${midX + 10} ${flatY} L${rightX} ${flatY}`;
      renderCenteredAxesPlot(block.group, block.width, block.height, satPath);
    },
  },
  rate: {
    width: 80,
    height: 80,
    inputs: [{ x: 0, y: 40, side: "left" }],
    outputs: [{ x: 80, y: 40, side: "right" }],
    defaultParams: { rise: 1, fall: 1 },
    render: (block) => {
      const axisLeft = 14;
      const axisRight = block.width - 14;
      const axisTop = 14;
      const axisBottom = block.height - 14;
      const midX = (axisLeft + axisRight) / 2;
      const midY = (axisTop + axisBottom) / 2;
      const leftX = axisLeft + 6;
      const rightX = axisRight - 6;
      const curveEndX = midX + 6;
      const curveEndY = midY - 8;
      const dashedPath = `M${leftX} ${midY + 14} C${leftX + 6} ${midY + 10} ${midX - 4} ${midY + 2} ${curveEndX} ${curveEndY}`;
      const solidPath = `M${leftX} ${midY + 14} C${leftX + 8} ${midY + 10} ${midX - 2} ${midY + 2} ${curveEndX} ${curveEndY} L${rightX} ${midY - 14}`;
      renderCenteredAxesPlot(block.group, block.width, block.height, null);
      block.group.appendChild(
        createSvgElement("path", {
          d: dashedPath,
          class: "source-plot dashed-plot",
        })
      );
      block.group.appendChild(
        createSvgElement("path", {
          d: solidPath,
          class: "source-plot",
        })
      );
    },
  },
  backlash: {
    width: 80,
    height: 80,
    inputs: [{ x: 0, y: 40, side: "left" }],
    outputs: [{ x: 80, y: 40, side: "right" }],
    defaultParams: { width: 1 },
    render: (block) => {
      const axisLeft = 14;
      const axisRight = block.width - 14;
      const axisTop = 14;
      const axisBottom = block.height - 14;
      const midX = (axisLeft + axisRight) / 2;
      const midY = (axisTop + axisBottom) / 2;
      const leftX = axisLeft + 6;
      const rightX = axisRight - 6;
      const gap = 8;
      const slope = 10;
      const lowY = midY + slope;
      const highY = midY - slope;
      const lowerPath = `M${leftX} ${lowY} L${midX - gap} ${lowY} L${midX + gap} ${highY} L${rightX} ${highY}`;
      const upperPath = `M${leftX} ${lowY + 6} L${midX - gap} ${lowY + 6} L${midX + gap} ${highY + 6} L${rightX} ${highY + 6}`;
      renderCenteredAxesPlot(block.group, block.width, block.height, null);
      block.group.appendChild(
        createSvgElement("path", { d: lowerPath, class: "source-plot" })
      );
      block.group.appendChild(
        createSvgElement("path", { d: upperPath, class: "source-plot" })
      );
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
  zoh: {
    width: 80,
    height: 80,
    inputs: [{ x: 0, y: 40, side: "left" }],
    outputs: [{ x: 80, y: 40, side: "right" }],
    defaultParams: { ts: 0.1 },
    render: (block) => {
      const group = block.group;
      group.appendChild(svgRect(0, 0, block.width, block.height, "block-body"));
      const mathGroup = createSvgElement("g", { class: "zoh-math" });
      group.appendChild(mathGroup);
      renderTeXMath(mathGroup, "\\mathsf{ZOH}", block.width, block.height);
    },
  },
  foh: {
    width: 80,
    height: 80,
    inputs: [{ x: 0, y: 40, side: "left" }],
    outputs: [{ x: 80, y: 40, side: "right" }],
    defaultParams: { ts: 0.1 },
    render: (block) => {
      const group = block.group;
      group.appendChild(svgRect(0, 0, block.width, block.height, "block-body"));
      const mathGroup = createSvgElement("g", { class: "foh-math" });
      group.appendChild(mathGroup);
      renderTeXMath(mathGroup, "\\mathsf{FOH}", block.width, block.height);
    },
  },
  dtf: {
    width: 140,
    height: 80,
    inputs: [{ x: 0, y: 40, side: "left" }],
    outputs: [{ x: 140, y: 40, side: "right" }],
    defaultParams: { num: [1], den: [1, -0.5], ts: 0.1 },
    render: (block) => {
      const group = block.group;
      group.appendChild(svgRect(0, 0, block.width, block.height, "block-body"));
      const mathGroup = createSvgElement("g", { class: "dtf-math" });
      group.appendChild(mathGroup);
      renderTeXMath(
        mathGroup,
        buildTransferTeX(block.params.num, block.params.den, "z"),
        block.width,
        block.height
      );
    },
  },
  dstateSpace: {
    width: 200,
    height: 80,
    inputs: [{ x: 0, y: 40, side: "left" }],
    outputs: [{ x: 200, y: 40, side: "right" }],
    defaultParams: { A: 1, B: 1, C: 1, D: 0, ts: 0.1 },
    render: (block) => {
      const group = block.group;
      group.appendChild(svgRect(0, 0, block.width, block.height, "block-body"));
      const mathGroup = createSvgElement("g", { class: "dss-math" });
      group.appendChild(mathGroup);
      renderTeXMath(
        mathGroup,
        "\\begin{aligned}x_{k+1}&=Ax_k+Bu_k\\\\y_k&=Cx_k+Du_k\\end{aligned}",
        block.width,
        block.height
      );
    },
  },
  ddelay: {
    width: 80,
    height: 80,
    inputs: [{ x: 0, y: 40, side: "left" }],
    outputs: [{ x: 80, y: 40, side: "right" }],
    defaultParams: { steps: 1, ts: 0.1 },
    render: (block) => {
      const group = block.group;
      group.appendChild(svgRect(0, 0, block.width, block.height, "block-body"));
      const mathGroup = createSvgElement("g", { class: "ddelay-math" });
      group.appendChild(mathGroup);
      renderTeXMath(mathGroup, "z^{-1}", block.width, block.height);
    },
  },
  scope: {
    width: 220,
    height: 160,
    inputs: [
      { x: 0, y: 40, side: "left" },
      { x: 0, y: 80, side: "left" },
      { x: 0, y: 120, side: "left" },
    ],
    outputs: [],
    defaultParams: { tMin: "", tMax: "", yMin: "", yMax: "", width: 220, height: 160 },
    render: (block) => {
      const group = block.group;
      const body = svgRect(0, 0, block.width, block.height, "block-body");
      group.appendChild(body);
      const title = svgText(10, 20, "Scope");
      group.appendChild(title);
      block.bodyRect = body;
      block.scopeTitle = title;
      const plotHeight = block.height - 40;
      const plot = svgRect(10, 30, block.width - 20, plotHeight, "scope-plot");
      group.appendChild(plot);
      const axesGroup = createSvgElement("g", { class: "scope-axes" });
      const xAxis = createSvgElement("line", { class: "scope-axis" });
      const yAxis = createSvgElement("line", { class: "scope-axis" });
      axesGroup.appendChild(xAxis);
      axesGroup.appendChild(yAxis);
      const xTicks = Array.from({ length: 9 }, () => createSvgElement("line", { class: "scope-tick" }));
      const yTicks = Array.from({ length: 9 }, () => createSvgElement("line", { class: "scope-tick" }));
      xTicks.forEach((tick) => axesGroup.appendChild(tick));
      yTicks.forEach((tick) => axesGroup.appendChild(tick));
      group.appendChild(axesGroup);
      const colors = ["scope-path-1", "scope-path-2", "scope-path-3"];
      block.scopePaths = colors.map((cls) => {
        const path = createSvgElement("path", { class: `scope-path ${cls}` });
        group.appendChild(path);
        return path;
      });
      block.scopePlot = plot;
      block.scopeAxes = { xAxis, yAxis, xTicks, yTicks };
    },
  },
  fileSink: {
    width: 80,
    height: 80,
    inputs: [{ x: 0, y: 40, side: "left" }],
    outputs: [],
    defaultParams: { path: "output.csv" },
    render: (block) => {
      const group = block.group;
      group.appendChild(svgRect(0, 0, block.width, block.height, "block-body"));
      const iconW = 44;
      const iconH = 54;
      const x = (block.width - iconW) / 2;
      const y = (block.height - iconH) / 2;
      const fold = 12;
      group.appendChild(
        createSvgElement("path", {
          d: [
            `M${x} ${y}`,
            `H${x + iconW - fold}`,
            `L${x + iconW} ${y + fold}`,
            `V${y + iconH}`,
            `H${x}`,
            "Z",
          ].join(" "),
          class: "file-icon-stroke",
        })
      );
      group.appendChild(
        createSvgElement("polyline", {
          points: `${x + iconW - fold},${y} ${x + iconW - fold},${y + fold} ${x + iconW},${y + fold}`,
          class: "file-icon-stroke",
        })
      );
      group.appendChild(
        createSvgElement(
          "text",
          { x: block.width / 2, y: block.height / 2 + 4, class: "file-icon-label upright", "text-anchor": "middle" },
          "OUT"
        )
      );
    },
  },
  labelSink: {
    width: 40,
    height: 40,
    inputs: [{ x: 0, y: 20, side: "left" }],
    outputs: [],
    defaultParams: { name: "x", showNode: true },
    render: (block) => {
      const showNode = block.params.showNode !== false;
      renderLabelNode(block, block.params.name, { showNode });
      if (showNode) {
        block.group.appendChild(createSvgElement("line", { x1: 15, y1: 20, x2: 0, y2: 20, class: "label-node" }));
      }
    },
  },
};

export function createRenderer({ svg, blockLayer, wireLayer, overlayLayer, state, onSelectBlock, onSelectConnection }) {
  const ensureWireArrowMarker = () => {
    let defs = svg.querySelector("defs");
    if (!defs) {
      defs = createSvgElement("defs");
      svg.insertBefore(defs, svg.firstChild);
    }
    if (!defs.querySelector("#wire-arrow")) {
      const marker = createSvgElement("marker", {
        id: "wire-arrow",
        markerWidth: 12,
        markerHeight: 12,
        refX: 12,
        refY: 6,
        orient: "auto",
        markerUnits: "userSpaceOnUse",
      });
      marker.appendChild(
        createSvgElement("path", { d: "M0,0 L12,6 L0,12 Z", class: "wire-arrow" })
      );
      defs.appendChild(marker);
    }
  };
  ensureWireArrowMarker();
  const debugLog = document.getElementById("debugLog");
  const copyDebugButton = document.getElementById("copyDebug");
  if (!DEBUG_WIRE_CHECKS && debugLog) {
    const panel = debugLog.closest(".debug-panel");
    if (panel) panel.style.display = "none";
  }
  if (DEBUG_WIRE_CHECKS && debugLog && copyDebugButton) {
    copyDebugButton.addEventListener("click", async () => {
      const text = debugLog.textContent || "";
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
      } catch (err) {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.setAttribute("readonly", "true");
        textarea.style.position = "fixed";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
    });
  }

  function refreshDebugLog() {
    if (!DEBUG_WIRE_CHECKS || !debugLog) return;
    try {
      debugLog.textContent = buildDebugSnapshot();
    } catch (err) {
      debugLog.textContent = `Debug error: ${err?.message || err}`;
    }
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
  const marqueeRect = createSvgElement("rect", {
    class: "selection-marquee",
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    display: "none",
  });
  overlayLayer.appendChild(marqueeRect);
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


  function createBlock(type, x = 60, y = 60, options = {}) {
    const template = blockTemplates[type];
    if (!template) return null;
    const id = options.id || `b${state.nextId++}`;
    if (options.id) {
      const match = /^b(\d+)$/.exec(options.id);
      if (match) {
        const nextId = Number(match[1]) + 1;
        if (Number.isFinite(nextId)) state.nextId = Math.max(state.nextId, nextId);
      }
    }
    const params = { ...(template.defaultParams || {}), ...(options.params || {}) };
    let blockWidth = template.width;
    let blockHeight = template.height;
    if (type === "scope") {
      const paramWidth = Number(params.width);
      const paramHeight = Number(params.height);
      if (Number.isFinite(paramWidth)) blockWidth = paramWidth;
      if (Number.isFinite(paramHeight)) blockHeight = paramHeight;
    }
    const group = createSvgElement("g", {
      class: `svg-block type-${type}`,
      "data-block-id": id,
    });

    const block = {
      id,
      type,
      x: snap(x),
      y: snap(y),
      width: blockWidth,
      height: blockHeight,
      rotation: options.rotation ?? 0,
      inputs: template.inputs.length,
      outputs: template.outputs.length,
      params,
      group,
      ports: [],
    };

    template.render(block);

    const dragHeight = type === "scope" ? 24 : block.height;
    const minDragSize = 80;
    const dragWidth = type === "scope" ? block.width : Math.max(block.width, minDragSize);
    const dragBoxHeight = type === "scope" ? dragHeight : Math.max(dragHeight, minDragSize);
    const dragX = type === "scope" ? 0 : (block.width - dragWidth) / 2;
    const dragY = type === "scope" ? 0 : (block.height - dragBoxHeight) / 2;
    const dragRect = createSvgElement("rect", {
      x: dragX,
      y: dragY,
      width: dragWidth,
      height: dragBoxHeight,
      class: "drag-handle",
    });
    group.appendChild(dragRect);
    block.dragRect = dragRect;

    template.inputs.forEach((port, index) => {
      const circle = createPortCircle(id, "in", index, port, type);
      group.appendChild(circle);
      block.ports.push({
        ...port,
        type: "in",
        index,
        el: circle,
        wireX: port.wireX ?? port.x,
        wireY: port.wireY ?? port.y,
      });
    });
    template.outputs.forEach((port, index) => {
      const circle = createPortCircle(id, "out", index, port, type);
      group.appendChild(circle);
      block.ports.push({
        ...port,
        type: "out",
        index,
        el: circle,
        wireX: port.wireX ?? port.x,
        wireY: port.wireY ?? port.y,
      });
    });

    if (type === "scope") {
      const resizeHandle = createSvgElement("rect", {
        class: "resize-handle",
        x: block.width - 16,
        y: block.height - 16,
        width: 12,
        height: 12,
      });
      group.appendChild(resizeHandle);
      block.resizeHandle = resizeHandle;
      enableResize(block, resizeHandle);
    }

    blockLayer.appendChild(group);
    state.blocks.set(id, block);

    if (type === "scope") {
      updateScopeLayout(block);
    }

    updateBlockTransform(block);
    enableDrag(block, dragRect);
    enableSelection(block, dragRect);
    enableScopeHover(block);
    state.routingDirty = true;
    updateConnections();
  }

  function createPortCircle(blockId, type, index, port, blockType) {
    const group = createSvgElement("g", {
      class: "port-group",
      "data-block-id": blockId,
      "data-port-type": type,
      "data-port-index": index,
    });
    const hitOffset = 0;
    let hitX = port.x;
    let hitY = port.y;
    if (hitOffset) {
      if (port.side === "left") hitX -= hitOffset;
      if (port.side === "right") hitX += hitOffset;
      if (port.side === "top") hitY -= hitOffset;
      if (port.side === "bottom") hitY += hitOffset;
    }
    const hit = createSvgElement("circle", {
      cx: hitX,
      cy: hitY,
      r: 12,
      class: "port-hit",
    });
    const shape =
      type === "in"
        ? createSvgElement("rect", {
            x: port.x - 6,
            y: port.y - 6,
            width: 12,
            height: 12,
            class: `port ${type} port-square`,
          })
        : createSvgElement("circle", {
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
    shape.addEventListener("click", onClick);
    group.appendChild(hit);
    group.appendChild(shape);
    return group;
  }

  function handlePortClick(portEl) {
    if (state.suppressNextPortClick) {
      state.suppressNextPortClick = false;
      return;
    }
    const blockId = portEl.getAttribute("data-block-id");
    const portType = portEl.getAttribute("data-port-type");
    const portIndex = Number(portEl.getAttribute("data-port-index"));

    if (!state.pendingPort) {
      if (portType !== "out") return;
      state.pendingPort = { blockId, portType, portIndex };
      const dot = portEl.querySelector(".port");
      if (dot) dot.classList.add("pending");
      updatePortVisibility();
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
    updatePortVisibility();
  }

  const SCOPE_MIN_W = 160;
  const SCOPE_MIN_H = 120;
  const SCOPE_HANDLE_SIZE = 12;
  const SCOPE_HANDLE_INSET = 4;

  function clampScopeSize(width, height) {
    const clampedWidth = Math.max(SCOPE_MIN_W, snap(Number.isFinite(width) ? width : SCOPE_MIN_W));
    const clampedHeight = Math.max(SCOPE_MIN_H, snap(Number.isFinite(height) ? height : SCOPE_MIN_H));
    return { width: clampedWidth, height: clampedHeight };
  }

  function updatePortElement(port) {
    if (!port?.el) return;
    const hit = port.el.querySelector(".port-hit");
    if (hit) {
      hit.setAttribute("cx", port.x);
      hit.setAttribute("cy", port.y);
    }
    const shape = port.el.querySelector(".port");
    if (!shape) return;
    if (shape.tagName.toLowerCase() === "rect") {
      shape.setAttribute("x", port.x - 6);
      shape.setAttribute("y", port.y - 6);
    } else {
      shape.setAttribute("cx", port.x);
      shape.setAttribute("cy", port.y);
    }
  }

  function updateScopeLayout(block) {
    if (!block || block.type !== "scope") return;
    const { width, height } = clampScopeSize(block.width, block.height);
    block.width = width;
    block.height = height;
    block.params.width = width;
    block.params.height = height;

    if (block.bodyRect) {
      block.bodyRect.setAttribute("width", width);
      block.bodyRect.setAttribute("height", height);
    }
    if (block.scopePlot) {
      const plotW = Math.max(40, width - 20);
      const plotH = Math.max(40, height - 40);
      block.scopePlot.setAttribute("width", plotW);
      block.scopePlot.setAttribute("height", plotH);
    }
    if (block.dragRect) {
      block.dragRect.setAttribute("width", width);
    }
    if (block.resizeHandle) {
      block.resizeHandle.setAttribute("x", width - SCOPE_HANDLE_SIZE - SCOPE_HANDLE_INSET);
      block.resizeHandle.setAttribute("y", height - SCOPE_HANDLE_SIZE - SCOPE_HANDLE_INSET);
      block.resizeHandle.setAttribute("width", SCOPE_HANDLE_SIZE);
      block.resizeHandle.setAttribute("height", SCOPE_HANDLE_SIZE);
    }

    const inputPorts = block.ports.filter((port) => port.type === "in").sort((a, b) => a.index - b.index);
    const count = inputPorts.length;
    const top = 40;
    const bottom = Math.max(top, height - 40);
    inputPorts.forEach((port, index) => {
      const t = count > 1 ? index / (count - 1) : 0.5;
      port.x = 0;
      port.y = snap(top + (bottom - top) * t);
      port.side = "left";
      port.wireX = port.x;
      port.wireY = port.y;
      updatePortElement(port);
    });

    updateBlockTransform(block);
    if (block.scopeData) renderScope(block);
    updateSelectionBox();
  }

  function enableDrag(block, handle) {
    let offsetX = 0;
    let offsetY = 0;
    let dragging = false;
    let didDrag = false;
    let startClient = null;
    let startedFromPort = false;
    let dragGroup = null;
    const DRAG_THRESHOLD = 6;

    const beginPointer = (event, fromPort = false) => {
      if (state.deleteMode || state.isPinching) return;
      if (!fromPort) event.preventDefault();
      dragging = false;
      didDrag = false;
      startedFromPort = fromPort;
      startClient = { x: event.clientX, y: event.clientY };
      if (!fromPort) handle.setPointerCapture(event.pointerId);
    };

    handle.addEventListener("pointerdown", (event) => beginPointer(event, false));
    block.group.addEventListener("pointerdown", (event) => {
      const isPort = event.target.closest?.(".port-group");
      if (!isPort) return;
      beginPointer(event, true);
    });

    block.group.addEventListener("pointermove", (event) => {
      if (!startClient) return;
      if (!dragging) {
        const dx = event.clientX - startClient.x;
        const dy = event.clientY - startClient.y;
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        dragging = true;
        didDrag = true;
        if (startedFromPort) {
          event.preventDefault();
          handle.setPointerCapture(event.pointerId);
        }
        const point = clientToSvg(event.clientX, event.clientY);
        offsetX = point.x - block.x;
        offsetY = point.y - block.y;
        const selectedIds = state.selectedIds || new Set();
        if (selectedIds.size > 1 && selectedIds.has(block.id)) {
          const startPositions = new Map();
          selectedIds.forEach((id) => {
            const selectedBlock = state.blocks.get(id);
            if (selectedBlock) startPositions.set(id, { x: selectedBlock.x, y: selectedBlock.y });
          });
          dragGroup = { startPositions };
        } else {
          dragGroup = null;
        }
      }
      const point = clientToSvg(event.clientX, event.clientY);
      const x = snap(point.x - offsetX);
      const y = snap(point.y - offsetY);
      if (dragGroup) {
        const startPos = dragGroup.startPositions.get(block.id);
        if (startPos) {
          const dx = x - startPos.x;
          const dy = y - startPos.y;
          dragGroup.startPositions.forEach((pos, id) => {
            const selectedBlock = state.blocks.get(id);
            if (!selectedBlock) return;
            selectedBlock.x = Math.max(0, pos.x + dx);
            selectedBlock.y = Math.max(0, pos.y + dy);
            updateBlockTransform(selectedBlock);
          });
        }
      } else {
        block.x = Math.max(0, x);
        block.y = Math.max(0, y);
        updateBlockTransform(block);
      }
      state.fastRouting = true;
      state.routingDirty = true;
      if (state.dirtyBlocks) {
        if (dragGroup) {
          dragGroup.startPositions.forEach((_pos, id) => state.dirtyBlocks.add(id));
        } else {
          state.dirtyBlocks.add(block.id);
        }
      }
      updateConnections();
    });

    block.group.addEventListener("pointerup", (event) => {
      if (dragging) event.preventDefault();
      const moved = didDrag;
      dragging = false;
      startClient = null;
      if (startedFromPort && didDrag) state.suppressNextPortClick = true;
      startedFromPort = false;
      didDrag = false;
      state.fastRouting = false;
      if (moved) {
        if (state.dirtyBlocks) {
          if (dragGroup) {
            dragGroup.startPositions.forEach((_pos, id) => state.dirtyBlocks.add(id));
          } else {
            state.dirtyBlocks.add(block.id);
          }
        }
        state.routingDirty = true;
        updateConnections(true);
      }
      dragGroup = null;
    });

    block.group.addEventListener("pointercancel", () => {
      dragging = false;
      startClient = null;
      startedFromPort = false;
      didDrag = false;
      state.fastRouting = false;
    });
  }

  function enableResize(block, handle) {
    let resizing = false;
    let startPoint = null;
    let startSize = null;
    const beginResize = (event) => {
      event.preventDefault();
      event.stopPropagation();
      resizing = true;
      const point = clientToSvg(event.clientX, event.clientY);
      startPoint = { x: point.x, y: point.y };
      startSize = { width: block.width, height: block.height };
      handle.setPointerCapture(event.pointerId);
    };
    handle.addEventListener("pointerdown", beginResize);
    handle.addEventListener("pointermove", (event) => {
      if (!resizing || !startPoint || !startSize) return;
      const point = clientToSvg(event.clientX, event.clientY);
      const nextWidth = startSize.width + (point.x - startPoint.x);
      const nextHeight = startSize.height + (point.y - startPoint.y);
      block.width = nextWidth;
      block.height = nextHeight;
      updateScopeLayout(block);
      state.fastRouting = true;
      state.routingDirty = true;
      if (state.dirtyBlocks) state.dirtyBlocks.add(block.id);
      updateConnections();
    });
    const finishResize = () => {
      if (!resizing) return;
      resizing = false;
      startPoint = null;
      startSize = null;
      state.fastRouting = false;
      state.routingDirty = true;
      updateConnections(true);
    };
    handle.addEventListener("pointerup", finishResize);
    handle.addEventListener("pointercancel", finishResize);
  }

  function enableSelection(block, handle) {
    handle.addEventListener("click", (event) => {
      event.stopPropagation();
      if (!event.ctrlKey) {
        selectBlock(block.id);
      }
    });
  }

  function updatePortVisibility() {
    const show = Boolean((state.selectedIds && state.selectedIds.size > 0) || state.selectedId || state.pendingPort);
    svg.classList.toggle("ports-visible", show);
  }

  function selectBlock(blockId) {
    state.selectedId = blockId;
    state.selectedConnection = null;
    if (state.selectedIds) {
      state.selectedIds.clear();
      if (blockId) state.selectedIds.add(blockId);
    }
    if (state.selectedConnections) state.selectedConnections.clear();
    state.blocks.forEach((block) => {
      block.group.classList.toggle("selected", block.id === blockId);
    });
    state.connections.forEach((conn) => {
      conn.path.classList.toggle("selected", false);
    });
    onSelectBlock(blockId ? state.blocks.get(blockId) : null);
    updatePortVisibility();
    updateSelectionBox();
  }

  function selectConnection(conn) {
    state.selectedConnection = conn;
    state.selectedId = null;
    if (state.selectedConnections) {
      state.selectedConnections.clear();
      if (conn) state.selectedConnections.add(conn);
    }
    if (state.selectedIds) state.selectedIds.clear();
    state.blocks.forEach((block) => {
      block.group.classList.toggle("selected", false);
    });
    state.connections.forEach((c) => {
      c.path.classList.toggle("selected", c === conn);
    });
    if (!conn) {
      onSelectConnection(null);
      updatePortVisibility();
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
    updatePortVisibility();
    updateSelectionBox();
  }

  svg.addEventListener("pointermove", (event) => {
    if (!marqueeState.active) return;
    if (event.pointerId !== marqueeState.pointerId) return;
    const point = clientToSvg(event.clientX, event.clientY);
    updateMarqueeRect(marqueeState.start, point);
  });

  svg.addEventListener("pointerup", (event) => {
    if (!marqueeState.active) return;
    if (event.pointerId !== marqueeState.pointerId) return;
    finishMarqueeSelection(event);
  });

  svg.addEventListener("pointercancel", (event) => {
    if (!marqueeState.active) return;
    if (event.pointerId !== marqueeState.pointerId) return;
    marqueeRect.setAttribute("display", "none");
    marqueeState.active = false;
    marqueeState.pointerId = null;
    marqueeState.start = null;
  });

  const marqueeState = {
    active: false,
    pointerId: null,
    start: null,
  };

  function updateMarqueeRect(start, current) {
    const left = Math.min(start.x, current.x);
    const right = Math.max(start.x, current.x);
    const top = Math.min(start.y, current.y);
    const bottom = Math.max(start.y, current.y);
    marqueeRect.setAttribute("display", "block");
    marqueeRect.setAttribute("x", left);
    marqueeRect.setAttribute("y", top);
    marqueeRect.setAttribute("width", right - left);
    marqueeRect.setAttribute("height", bottom - top);
    return { left, right, top, bottom };
  }

  function setMultiSelection(blockIds, connections) {
    if (state.selectedIds) {
      state.selectedIds.clear();
      blockIds.forEach((id) => state.selectedIds.add(id));
    }
    if (state.selectedConnections) {
      state.selectedConnections.clear();
      connections.forEach((conn) => state.selectedConnections.add(conn));
    }
    state.selectedId = blockIds.size === 1 && connections.size === 0 ? Array.from(blockIds)[0] : null;
    state.selectedConnection = connections.size === 1 && blockIds.size === 0 ? Array.from(connections)[0] : null;
    state.blocks.forEach((block) => {
      block.group.classList.toggle("selected", blockIds.has(block.id));
    });
    state.connections.forEach((conn) => {
      conn.path.classList.toggle("selected", connections.has(conn));
    });
    if (state.selectedId) {
      onSelectBlock(state.blocks.get(state.selectedId));
    } else if (state.selectedConnection) {
      const conn = state.selectedConnection;
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
    } else if (blockIds.size || connections.size) {
      onSelectBlock({ kind: "multi", blocks: blockIds.size, connections: connections.size });
    } else {
      onSelectBlock(null);
      onSelectConnection(null);
    }
    updatePortVisibility();
    updateSelectionBox();
  }

  function startMarqueeSelection(event) {
    if (event.button !== 0) return;
    const point = clientToSvg(event.clientX, event.clientY);
    marqueeState.active = true;
    marqueeState.pointerId = event.pointerId;
    marqueeState.start = point;
    updateMarqueeRect(point, point);
    try {
      svg.setPointerCapture(event.pointerId);
    } catch (err) {
      // Ignore capture failures.
    }
  }

  function finishMarqueeSelection(event) {
    const point = clientToSvg(event.clientX, event.clientY);
    const rect = updateMarqueeRect(marqueeState.start, point);
    marqueeRect.setAttribute("display", "none");
    marqueeState.active = false;
    marqueeState.pointerId = null;
    marqueeState.start = null;
    state.suppressNextCanvasClick = true;

    const selectedBlocks = new Set();
    state.blocks.forEach((block) => {
      const bounds = getRotatedBounds(block);
      const intersects =
        rect.left <= bounds.right &&
        rect.right >= bounds.left &&
        rect.top <= bounds.bottom &&
        rect.bottom >= bounds.top;
      if (intersects) selectedBlocks.add(block.id);
    });

    const selectedConnections = new Set();
    state.connections.forEach((conn) => {
      let points = conn.points || [];
      if (!points || points.length < 2) {
        points = buildFallbackPathFromPorts(conn);
      }
      const renderPoints = applyWireOffsets(conn, points);
      for (let i = 0; i < renderPoints.length - 1; i += 1) {
        if (segmentHitsRect(renderPoints[i], renderPoints[i + 1], rect)) {
          selectedConnections.add(conn);
          break;
        }
      }
    });

    setMultiSelection(selectedBlocks, selectedConnections);
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

    const path = createSvgElement("path", { class: "wire", "marker-end": "url(#wire-arrow)" });
    const hitPath = createSvgElement("path", { class: "wire-hit" });
    wireLayer.appendChild(hitPath);
    wireLayer.appendChild(path);
    const conn = { from: fromId, to: toId, toIndex, fromIndex, path, hitPath, points: [] };
    const onSelect = (event) => {
      event.stopPropagation();
      selectConnection(conn);
    };
    path.addEventListener("click", onSelect);
    hitPath.addEventListener("click", onSelect);
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
      const timeLimitMs = state.fastRouting ? 80 : 1000;
      const worldW = Number(svg.dataset.worldWidth) || svg.clientWidth || 1;
      const worldH = Number(svg.dataset.worldHeight) || svg.clientHeight || 1;
      const needsFullRoute = state.connections.some((conn) => !conn.points || conn.points.length < 2);
      let paths = new Map();
      let dirtySet = null;
      if (!needsFullRoute) {
        dirtySet = computeDirtyConnections();
      }
      state.debugDirtySetSize = dirtySet ? dirtySet.size : 0;
      state.debugDirtyConnections = dirtySet
        ? Array.from(dirtySet).map((conn) => `${conn.from}:${conn.fromIndex ?? 0}->${conn.to}:${conn.toIndex ?? 0}`)
        : [];
      if (!needsFullRoute && dirtySet && dirtySet.size > 0) {
        paths = routeDirtyConnections(state, worldW, worldH, { x: 0, y: 0 }, dirtySet, timeLimitMs);
        applyWirePaths(paths);
        if (state.debugOverlapCount > 0) {
          state.debugFallbackFullRoute = true;
          const fallbackPaths = routeAllConnections(state, worldW, worldH, { x: 0, y: 0 }, 2000);
          applyWirePaths(fallbackPaths);
        } else {
          state.debugFallbackFullRoute = false;
        }
        refreshDebugLog();
      } else if (needsFullRoute || !dirtySet) {
        paths = routeAllConnections(state, worldW, worldH, { x: 0, y: 0 }, timeLimitMs);
        applyWirePaths(paths);
        state.debugFallbackFullRoute = false;
        refreshDebugLog();
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
    applyWirePaths(paths);
    state.routingDirty = false;
    if (state.dirtyBlocks) state.dirtyBlocks.clear();
    if (state.dirtyConnections) state.dirtyConnections.clear();
    updateSelectionBox();
    refreshDebugLog();
  }

  function applyWirePaths(paths) {
    const segmentMap = new Map();
    let overlapCount = 0;
    state.connections.forEach((conn) => {
      let points = conn.points || [];
      if (!points || points.length < 2) {
        points = buildFallbackPathFromPorts(conn);
      }
      const toBlock = state.blocks.get(conn.to);
      if (toBlock?.type === "labelSink") {
        conn.path.removeAttribute("marker-end");
      } else {
        conn.path.setAttribute("marker-end", "url(#wire-arrow)");
      }
      const renderPoints = state.fastRouting ? buildDragRenderPoints(conn, points) : points;
      const finalPoints = applyWireOffsets(conn, renderPoints);
      const segments = buildSegments(finalPoints, conn);
      if (DEBUG_WIRE_CHECKS && debugLog && finalPoints.length > 1 && segments.length === 0) {
        writeDebug(debugLog, `[wire ${conn.from}->${conn.to}] no segments for render points`);
      }
      conn.debugRenderPoints = finalPoints.slice();
      conn.debugRenderSegments = segments.length;
      conn.debugSegmentPreview = segments
        .slice(0, 6)
        .map((seg) => `${seg.orientation}:${seg.a.x},${seg.a.y}->${seg.b.x},${seg.b.y}${seg.isStub ? ":stub" : ""}`);
      segmentMap.set(conn, segments);
    });
    const priorSegments = [];
    state.connections.forEach((conn) => {
      let points = conn.points || [];
      if (!points || points.length < 2) {
        points = buildFallbackPathFromPorts(conn);
      }
      const renderPoints = state.fastRouting ? buildDragRenderPoints(conn, points) : points;
      const finalPoints = applyWireOffsets(conn, renderPoints);
      if (!finalPoints.length || hasInvalidPoint(finalPoints)) {
        if (DEBUG_WIRE_CHECKS && debugLog) {
          const bad = hasInvalidPoint(finalPoints);
          writeDebug(
            debugLog,
            `[wire ${conn.from}->${conn.to}] invalid render points=${bad ? "non-finite" : "empty"}`
          );
        }
        conn.path.setAttribute("d", "");
        if (conn.hitPath) conn.hitPath.setAttribute("d", "");
        return;
      }
      const segments = segmentMap.get(conn) || [];
      const otherSegments = priorSegments.slice();
      const d = buildPathWithHops(segments, otherSegments);
      if (!isValidPathString(d)) {
        if (DEBUG_WIRE_CHECKS && debugLog) {
          writeDebug(debugLog, `[wire ${conn.from}->${conn.to}] invalid path string`);
        }
        return;
      }
      conn.debugPath = d;
      conn.path.setAttribute("d", d);
      if (conn.hitPath) conn.hitPath.setAttribute("d", d);
      segments.forEach((seg) => {
        if (!seg.isStub) priorSegments.push(seg);
      });
      if (DEBUG_WIRE_CHECKS) {
        const bad = checkWireIssues(conn, debugLog);
        conn.path.classList.toggle("wire-error", bad);
        if (conn.debugIssues && conn.debugIssues.includes("overlaps another wire")) {
          overlapCount += 1;
        }
      }
    });
    state.debugOverlapCount = overlapCount;
  }

  function isValidPathString(d) {
    if (!d) return true;
    if (d.includes("NaN") || d.includes("undefined")) return false;
    return true;
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
    conn.debugIssues = issues.slice();
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

  function buildDragRenderPoints(conn, points) {
    const fromPos = getPortPosition(conn.from, "out", conn.fromIndex ?? 0);
    const toPos = getPortPosition(conn.to, "in", conn.toIndex ?? 0);
    if (!fromPos || !toPos) return points;
    if (!points || points.length === 0) {
      return buildFallbackPath(fromPos, toPos);
    }
    const start = points[0];
    const end = points[points.length - 1];
    let result = points.slice();
    if (start.x !== fromPos.x || start.y !== fromPos.y) {
      const head = buildOrthogonalHead(fromPos, start);
      result = [...head, ...result];
    }
    if (end.x !== toPos.x || end.y !== toPos.y) {
      const tail = buildOrthogonalTail(end, toPos);
      result = [...result, ...tail];
    }
    return dedupePoints(result);
  }

  function applyWireOffsets(conn, points) {
    if (!points || points.length === 0) return points;
    const fromSel = getPortPosition(conn.from, "out", conn.fromIndex ?? 0);
    const toSel = getPortPosition(conn.to, "in", conn.toIndex ?? 0);
    const fromWire = getWirePosition(conn.from, "out", conn.fromIndex ?? 0);
    const toWire = getWirePosition(conn.to, "in", conn.toIndex ?? 0);
    let result = points.slice();
    if (fromWire && fromSel) {
      if (result.length === 0 || result[0].x !== fromSel.x || result[0].y !== fromSel.y) {
        result = [fromSel, ...result];
      }
      const aligned = fromWire.x === fromSel.x || fromWire.y === fromSel.y;
      if (aligned && (fromWire.x !== fromSel.x || fromWire.y !== fromSel.y)) {
        result = [fromWire, ...result];
      } else if (aligned) {
        result[0] = fromWire;
      }
    }
    if (toWire && toSel) {
      const last = result[result.length - 1];
      if (!last || last.x !== toSel.x || last.y !== toSel.y) {
        result = [...result, toSel];
      }
      const aligned = toWire.x === toSel.x || toWire.y === toSel.y;
      if (aligned && (toWire.x !== toSel.x || toWire.y !== toSel.y)) {
        result = [...result, toWire];
      } else if (aligned) {
        result[result.length - 1] = toWire;
      }
    }
    return dedupePoints(result);
  }

  function hasInvalidPoint(points) {
    if (!points || points.length === 0) return false;
    return points.some((pt) => !Number.isFinite(pt.x) || !Number.isFinite(pt.y));
  }

  function buildFallbackPathFromPorts(conn) {
    const fromPos = getPortPosition(conn.from, "out", conn.fromIndex ?? 0);
    const toPos = getPortPosition(conn.to, "in", conn.toIndex ?? 0);
    if (!fromPos || !toPos) return [];
    return buildFallbackPath(fromPos, toPos);
  }

  function buildOrthogonalHead(fromPos, toPos) {
    if (fromPos.x === toPos.x || fromPos.y === toPos.y) {
      return [fromPos];
    }
    return [fromPos, { x: fromPos.x, y: toPos.y }];
  }

  function buildOrthogonalTail(fromPos, toPos) {
    if (fromPos.x === toPos.x || fromPos.y === toPos.y) {
      return [fromPos, toPos];
    }
    return [fromPos, { x: fromPos.x, y: toPos.y }, toPos];
  }

  function dedupePoints(points) {
    if (points.length < 2) return points;
    const deduped = [points[0]];
    for (let i = 1; i < points.length; i += 1) {
      const prev = deduped[deduped.length - 1];
      const next = points[i];
      if (prev.x === next.x && prev.y === next.y) continue;
      deduped.push(next);
    }
    return deduped;
  }

  function getPortPosition(blockId, type, index) {
    const block = state.blocks.get(blockId);
    if (!block) return null;
    const port = block.ports.find((p) => p.type === type && p.index === index);
    if (!port) return null;
    const pos = rotatePoint({ x: block.x + port.x, y: block.y + port.y }, block);
    return { x: snap(pos.x), y: snap(pos.y) };
  }

  function getPortPositionRaw(blockId, type, index) {
    const block = state.blocks.get(blockId);
    if (!block) return null;
    const port = block.ports.find((p) => p.type === type && p.index === index);
    if (!port) return null;
    const pos = rotatePoint({ x: block.x + port.x, y: block.y + port.y }, block);
    return { x: pos.x, y: pos.y };
  }

  function getWirePosition(blockId, type, index) {
    const block = state.blocks.get(blockId);
    if (!block) return null;
    const port = block.ports.find((p) => p.type === type && p.index === index);
    if (!port) return null;
    const pos = rotatePoint({ x: block.x + port.wireX, y: block.y + port.wireY }, block);
    return { x: snap(pos.x), y: snap(pos.y) };
  }

  function getWirePositionRaw(blockId, type, index) {
    const block = state.blocks.get(blockId);
    if (!block) return null;
    const port = block.ports.find((p) => p.type === type && p.index === index);
    if (!port) return null;
    const pos = rotatePoint({ x: block.x + port.wireX, y: block.y + port.wireY }, block);
    return { x: pos.x, y: pos.y };
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

  function resizeBlock(block, width, height) {
    if (!block || block.type !== "scope") return;
    block.width = width;
    block.height = height;
    updateScopeLayout(block);
    state.routingDirty = true;
    updateConnections(true);
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
    const padding = 0;
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
    if (text.startsWith("[wire")) return;
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
    const summary = [];
    const viewBox = svg.getAttribute("viewBox") || "";
    summary.push(`viewBox=${viewBox}`);
    summary.push(`svgSize=${svg.clientWidth}x${svg.clientHeight}`);
    summary.push(`world=${svg.dataset.worldWidth || "?"}x${svg.dataset.worldHeight || "?"}`);
    summary.push(`blocks=${state.blocks.size} connections=${state.connections.length}`);
    summary.push(`layers=blocks:${blockLayer.childElementCount} wires:${wireLayer.childElementCount}`);
    summary.push(`flags=pinch:${state.isPinching} pan:${state.isPanning} fast:${state.fastRouting} dirty:${state.routingDirty} sched:${state.routingScheduled}`);
    try {
      const style = window.getComputedStyle(svg);
      summary.push(`svgStyle=display:${style.display} visibility:${style.visibility} opacity:${style.opacity}`);
    } catch (err) {
      summary.push(`svgStyleError=${err?.message || err}`);
    }
    try {
      const style = window.getComputedStyle(canvas);
      summary.push(`canvasStyle=display:${style.display} visibility:${style.visibility} opacity:${style.opacity}`);
    } catch (err) {
      summary.push(`canvasStyleError=${err?.message || err}`);
    }
    const canvasEl = document.getElementById("canvas");
    if (canvasEl) {
      const rect = canvasEl.getBoundingClientRect();
      summary.push(`canvasRect=${Math.round(rect.width)}x${Math.round(rect.height)}`);
    }
    const workspaceEl = document.querySelector(".workspace");
    if (workspaceEl) {
      const rect = workspaceEl.getBoundingClientRect();
      summary.push(`workspaceRect=${Math.round(rect.width)}x${Math.round(rect.height)}`);
    }
    try {
      const box = svg.getBBox();
      summary.push(`svgBBox=${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.width)}x${Math.round(box.height)}`);
    } catch (err) {
      summary.push(`svgBBoxError=${err?.message || err}`);
    }
    try {
      const box = blockLayer.getBBox();
      summary.push(`blockBBox=${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.width)}x${Math.round(box.height)}`);
    } catch (err) {
      summary.push(`blockBBoxError=${err?.message || err}`);
    }
    const nodeLines = [];
    state.blocks.forEach((block) => {
      block.ports.forEach((port) => {
        const raw = rotatePoint({ x: block.x + port.x, y: block.y + port.y }, block);
        const gridX = Math.round(raw.x / GRID_SIZE);
        const gridY = Math.round(raw.y / GRID_SIZE);
        const side = getPortSide(block, raw);
        const dir = side === "left" ? "left" : side === "right" ? "right" : side === "top" ? "up" : "down";
        nodeLines.push(
          `${block.id} port:${port.type}${port.index} px=(${Math.round(raw.x)},${Math.round(raw.y)}) grid=(${gridX},${gridY}) dir=${dir}`
        );
      });
    });
    const wireLines = [];
    const router = typeof window !== "undefined" ? window.__routerLast : null;
    if (router?.result) {
      summary.push(`routerDurationMs=${router.result.durationMs ?? "?"}`);
      summary.push(`routerMaxTimeMs=${router.settings?.maxTimeMs ?? "?"}`);
      summary.push(`routerIncremental=${router.settings?.incremental ?? "?"}`);
      summary.push(`routerWires=${router.result.wires?.size ?? "?"} failed=${router.result.failures?.length ?? 0}`);
      if (router.result.cost) {
        summary.push(
          `routerCost=total:${router.result.cost.total} length:${router.result.cost.length} turns:${router.result.cost.turns} hops:${router.result.cost.hops} near:${router.result.cost.near} failed:${router.result.cost.failed}`
        );
      }
      if (router.stats) {
        summary.push(
          `routerStats=nodes:${router.stats.nodes} conns:${router.stats.connections} prevWires:${router.stats.prevWires} dirty:${router.stats.dirty ?? "?"} changed:${router.stats.changed ?? "?"}`
        );
      }
    }
    if (typeof state.debugDirtySetSize === "number") {
      summary.push(`dirtySetSize=${state.debugDirtySetSize}`);
    }
    if (Array.isArray(state.debugDirtyConnections) && state.debugDirtyConnections.length) {
      summary.push(`dirtyConnections=${state.debugDirtyConnections.join(",")}`);
    }
    if (typeof state.debugOverlapCount === "number") {
      summary.push(`overlapCount=${state.debugOverlapCount}`);
    }
    if (state.debugFallbackFullRoute) {
      summary.push("fallbackFullRoute=true");
    }
    const debugObstacles = buildDebugObstacles();
    const debugSettings = {
      lengthCost: router?.settings?.lengthCost ?? 1,
      turnCost: router?.settings?.turnCost ?? 6,
      hopCost: router?.settings?.hopCost ?? 20,
      nearWirePenalty1: router?.settings?.nearWirePenalty1 ?? 6,
      nearWirePenalty2: router?.settings?.nearWirePenalty2 ?? 2,
      nearObstaclePenalty1: router?.settings?.nearObstaclePenalty1 ?? 10,
      nearObstaclePenalty2: router?.settings?.nearObstaclePenalty2 ?? 4,
    };
    const wireCosts = new Map();
    if (router?.result?.wires) {
      router.result.wires.forEach((wire, key) => {
        wireCosts.set(key, wire.cost || {});
      });
    }
    if (router?.result?.failures?.length) {
      summary.push(`routeFailures=${router.result.failures.length}`);
      router.result.failures.forEach((failure) => {
        summary.push(`failure=${failure.key} reason=${failure.reason}`);
      });
    }
    state.connections.forEach((conn) => {
      const fromIndex = conn.fromIndex ?? 0;
      const toIndex = conn.toIndex ?? 0;
      const key = `${conn.from}:${fromIndex}->${conn.to}:${toIndex}`;
      const points = conn.points || [];
      const gridPoints = points.map((pt) => `(${Math.round(pt.x / GRID_SIZE)},${Math.round(pt.y / GRID_SIZE)})`).join(" ");
      const length = Math.max(0, points.length - 1);
      let turns = 0;
      let hops = 0;
      for (let i = 2; i < points.length; i += 1) {
        const a = points[i - 2];
        const b = points[i - 1];
        const c = points[i];
        const dir1 = a.x === b.x ? "V" : "H";
        const dir2 = b.x === c.x ? "V" : "H";
        if (dir1 !== dir2) turns += 1;
      }
      const cost = wireCosts.get(key);
      const near = cost?.nearBreakdown ?? {};
      const wireLen = cost?.length ?? length;
      const wireTurns = cost?.turns ?? turns;
      const wireHops = cost?.hops ?? hops;
      const obsNear = computeDebugObsNear(points, debugObstacles, conn.from, conn.to);
      const obs1 = obsNear.obs1;
      const obs2 = obsNear.obs2;
      const nearCost =
        (near.wire1 ?? 0) * debugSettings.nearWirePenalty1 +
        (near.wire2 ?? 0) * debugSettings.nearWirePenalty2 +
        obs1 * debugSettings.nearObstaclePenalty1 +
        obs2 * debugSettings.nearObstaclePenalty2;
      const total =
        wireLen * debugSettings.lengthCost +
        wireTurns * debugSettings.turnCost +
        wireHops * debugSettings.hopCost +
        nearCost;
      const fromSel = getPortPositionRaw(conn.from, "out", fromIndex);
      const toSel = getPortPositionRaw(conn.to, "in", toIndex);
      const fromWire = getWirePositionRaw(conn.from, "out", fromIndex);
      const toWire = getWirePositionRaw(conn.to, "in", toIndex);
      const basePoints = points.length ? points : buildFallbackPathFromPorts(conn);
      const rendered = applyWireOffsets(conn, basePoints);
      const badRaw = hasInvalidPoint(points);
      const badRendered = hasInvalidPoint(rendered);
      const pointSummary = (pts) => {
        if (!pts || !pts.length) return "empty";
        const first = pts[0];
        const last = pts[pts.length - 1];
        return `count=${pts.length} first=(${Math.round(first.x)},${Math.round(first.y)}) last=(${Math.round(
          last.x
        )},${Math.round(last.y)})`;
      };
      wireLines.push(
        `${conn.from} port:out${fromIndex} -> ${conn.to} port:in${toIndex} len=${wireLen} turns=${wireTurns} hops=${wireHops} wire1=${near.wire1 ?? 0} wire2=${near.wire2 ?? 0} obs1=${obs1} obs2=${obs2} cost=${total} route=${gridPoints}`
      );
      wireLines.push(
        `  sel=(${Math.round(fromSel?.x ?? NaN)},${Math.round(fromSel?.y ?? NaN)}) -> (${Math.round(
          toSel?.x ?? NaN
        )},${Math.round(toSel?.y ?? NaN)}) wire=(${Math.round(fromWire?.x ?? NaN)},${Math.round(
          fromWire?.y ?? NaN
        )}) -> (${Math.round(toWire?.x ?? NaN)},${Math.round(toWire?.y ?? NaN)}) badRaw=${badRaw} badRender=${badRendered}`
      );
      const pathLen = conn.debugPath ? conn.debugPath.length : 0;
      const pathPreview = conn.debugPath ? conn.debugPath.slice(0, 80) : "";
      const wireError = conn.path?.classList?.contains("wire-error") ? "true" : "false";
      wireLines.push(`  base=${pointSummary(basePoints)} render=${pointSummary(rendered)} segs=${conn.debugRenderSegments ?? 0}`);
      wireLines.push(`  pathLen=${pathLen} wireError=${wireError} path="${pathPreview}"`);
      if (conn.debugSegmentPreview && conn.debugSegmentPreview.length) {
        wireLines.push(`  segPreview=${conn.debugSegmentPreview.join(" | ")}`);
      }
      if (conn.debugIssues && conn.debugIssues.length) {
        wireLines.push(`  issues=${conn.debugIssues.join("|")}`);
      }
    });
    const obstacleLines = [];
    if (debugObstacles.length) {
      obstacleLines.push(`obstacles=${JSON.stringify(debugObstacles)}`);
    }
    return ["summary:", ...summary, "nodes:", ...nodeLines, "wires:", ...wireLines, ...obstacleLines].join("\n");
  }

  function buildDebugObstacles() {
    const PORT_RADIUS = 6;
    const obstacles = [];
    state.blocks.forEach((block) => {
      const bounds = getRotatedBounds(block);
      let left = bounds.left;
      let right = bounds.right;
      let top = bounds.top;
      let bottom = bounds.bottom;
      block.ports.forEach((port) => {
        const pos = rotatePoint({ x: block.x + port.x, y: block.y + port.y }, block);
        left = Math.min(left, pos.x - PORT_RADIUS);
        right = Math.max(right, pos.x + PORT_RADIUS);
        top = Math.min(top, pos.y - PORT_RADIUS);
        bottom = Math.max(bottom, pos.y + PORT_RADIUS);
      });
      obstacles.push({
        x0: Math.floor(left / GRID_SIZE),
        y0: Math.floor(top / GRID_SIZE),
        x1: Math.floor(right / GRID_SIZE),
        y1: Math.floor(bottom / GRID_SIZE),
        owner: block.id,
      });
    });
    return obstacles;
  }

  function computeDebugObsNear(points, obstacles, fromBlockId, toBlockId) {
    let obs1 = 0;
    let obs2 = 0;
    if (!points || !points.length) return { obs1, obs2 };
    points.forEach((pt) => {
      const gx = Math.round(pt.x / GRID_SIZE);
      const gy = Math.round(pt.y / GRID_SIZE);
      let minDist = Infinity;
      obstacles.forEach((obs) => {
        const dx = gx < obs.x0 ? obs.x0 - gx : gx > obs.x1 ? gx - obs.x1 : 0;
        const dy = gy < obs.y0 ? obs.y0 - gy : gy > obs.y1 ? gy - obs.y1 : 0;
        minDist = Math.min(minDist, dx + dy);
      });
      if (minDist <= 1) obs1 += 1;
      else if (minDist <= 2) obs2 += 1;
    });
    return { obs1, obs2 };
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
    if (state.selectedIds) state.selectedIds.clear();
    if (state.selectedConnections) state.selectedConnections.clear();
    state.deleteMode = false;
    blockLayer.innerHTML = "";
    wireLayer.innerHTML = "";
    selectionRect.setAttribute("display", "none");
    marqueeRect.setAttribute("display", "none");
    updatePortVisibility();
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
      state.connections[idx].hitPath?.remove();
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
      const mathGroup = block.group.querySelector(".constant-math");
      if (mathGroup) renderTeXMath(mathGroup, `${block.params.value}`, block.width, block.height);
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
    if (block.type === "delay") {
      const mathGroup = block.group.querySelector(".delay-math");
      if (mathGroup) renderTeXMath(mathGroup, "e^{-sT}", block.width, block.height);
    }
    if (block.type === "labelSource" || block.type === "labelSink") {
      const mathGroup = block.group.querySelector(".label-math");
      if (mathGroup) renderTeXMath(mathGroup, block.params.name || "", block.width, block.height);
      if (block.type === "labelSink") {
        const showNode = block.params.showNode !== false;
        const circle = block.group.querySelector("circle.label-node");
        const line = block.group.querySelector("line.label-node");
        if (circle) circle.style.display = showNode ? "block" : "none";
        if (line) line.style.display = showNode ? "block" : "none";
      }
    }
    if (block.type === "pid") {
      const mathGroup = block.group.querySelector(".pid-math");
      if (mathGroup) renderTeXMath(mathGroup, "\\mathsf{PID}", block.width, block.height);
    }
    if (block.type === "zoh") {
      const mathGroup = block.group.querySelector(".zoh-math");
      if (mathGroup) renderTeXMath(mathGroup, "\\mathsf{ZOH}", block.width, block.height);
    }
    if (block.type === "foh") {
      const mathGroup = block.group.querySelector(".foh-math");
      if (mathGroup) renderTeXMath(mathGroup, "\\mathsf{FOH}", block.width, block.height);
    }
    if (block.type === "fileSource") {
      const texts = block.group.querySelectorAll("text");
      if (texts[1]) texts[1].textContent = `${block.params.path}`;
    }
    if (block.type === "gain") {
      const mathGroup = block.group.querySelector(".gain-math");
      if (mathGroup) renderTeXMath(mathGroup, `${block.params.gain}`, block.width, block.height);
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
    if (block.type === "saturation") {
      // icon only
    }
    if (block.type === "rate") {
      // icon only
    }
    if (block.type === "backlash") {
      // icon only
    }
    if (block.type === "tf") {
      const mathGroup = block.group.querySelector(".tf-math");
      if (mathGroup) {
        renderTeXMath(
          mathGroup,
          buildTransferTeX(block.params.num, block.params.den),
          block.width,
          block.height
        );
      }
    }
    if (block.type === "dtf") {
      const mathGroup = block.group.querySelector(".dtf-math");
      if (mathGroup) {
        renderTeXMath(
          mathGroup,
          buildTransferTeX(block.params.num, block.params.den, "z"),
          block.width,
          block.height
        );
      }
    }
    if (block.type === "ddelay") {
      const mathGroup = block.group.querySelector(".ddelay-math");
      if (mathGroup) renderTeXMath(mathGroup, "z^{-1}", block.width, block.height);
    }
    if (block.type === "fileSink") {
      // icon only
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
    createConnection,
    updateConnections,
    updateBlockTransform,
    selectConnection,
    clearPending,
    selectBlock,
    startMarqueeSelection,
    clearWorkspace,
    findNearestConnection,
    deleteConnection,
    deleteBlock,
    updateBlockLabel,
    updateSelectionBox,
    clientToSvg,
    forceFullRoute,
    resizeBlock,
  };
}
