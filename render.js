import { snap, distancePointToSegment, GRID_SIZE, segmentLengthStats } from "./geometry.js";
import { routeAllConnections, routeDirtyConnections } from "./router.js";
import { renderScope } from "./sim.js";
import { buildBlockTemplates } from "./blocks/index.js";
import { exprToLatex, estimateLatexWidth } from "./utils/expr.js";
import {
  rotatePoint,
  getRotatedBounds,
  getPortSide,
  blockBounds,
  segmentHitsRect,
  segmentsIntersect,
  segmentsOverlap,
} from "./render/geometry.js";

export const FORCE_FULL_ROUTE_TIME_LIMIT_MS = 4000;

const DEBUG_WIRE_CHECKS = false;
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

let katexRetryScheduled = false;
const katexQueue = new Set();

function notifyUserFuncResize(group) {
  const blockEl = group?.closest?.(".svg-block");
  const blockId = blockEl?.dataset?.blockId;
  if (blockId && typeof window !== "undefined" && window.vibesimResizeUserFunc) {
    window.vibesimResizeUserFunc(blockId);
  }
}

function queueKatexRender() {
  if (katexRetryScheduled) return;
  katexRetryScheduled = true;
  setTimeout(() => {
    katexRetryScheduled = false;
    if (window.katex && typeof window.katex.render === "function") {
      const targets = Array.from(katexQueue);
      katexQueue.clear();
      targets.forEach((group) => {
        const spans = group.querySelectorAll(".katex-target[data-tex]");
        spans.forEach((span) => {
          const tex = span.dataset.tex || "";
          try {
            window.katex.render(tex, span, { throwOnError: false });
          } catch {
            span.textContent = tex;
          }
          span.classList.remove("katex-target");
        });
        notifyUserFuncResize(group);
      });
    } else if (katexQueue.size) {
      queueKatexRender();
    }
  }, 100);
}

function renderTeXMath(group, tex, width, height) {
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
  const span = document.createElement("span");
  span.className = "katex-target";
  span.dataset.tex = tex;
  span.style.whiteSpace = "nowrap";
  if (window.katex && typeof window.katex.render === "function") {
    try {
      window.katex.render(tex, span, { throwOnError: false });
      span.classList.remove("katex-target");
      notifyUserFuncResize(group);
    } catch {
      span.textContent = tex;
    }
  } else {
    katexQueue.add(group);
    queueKatexRender();
  }
  div.appendChild(span);
  foreign.appendChild(div);
  group.appendChild(foreign);
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
  const mathGroup = createSvgElement("g", { class: "label-math", transform: "translate(0,-24)" });
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

const blockTemplates = buildBlockTemplates({
  GRID_SIZE,
  svgRect,
  svgText,
  createSvgElement,
  renderTeXMath,
  renderSourcePlot,
  renderCenteredAxesPlot,
  buildTransferTeX,
  renderLabelNode,
});



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
    Object.keys(params).forEach((key) => {
      if (Array.isArray(params[key])) {
        params[key] = [...params[key]];
      }
    });
    if (!params._visible || typeof params._visible !== "object") {
      params._visible = {};
    }
    let blockWidth = template.width;
    let blockHeight = template.height;
    if (type === "scope") {
      const paramWidth = Number(params.width);
      const paramHeight = Number(params.height);
      if (Number.isFinite(paramWidth)) blockWidth = paramWidth;
      if (Number.isFinite(paramHeight)) blockHeight = paramHeight;
    }
    if (typeof template.resize === "function") {
      const probe = {
        id,
        type,
        width: blockWidth,
        height: blockHeight,
        params,
        inputs: template.inputs.length,
        outputs: template.outputs.length,
      };
      template.resize(probe);
      blockWidth = probe.width;
      blockHeight = probe.height;
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
      paramLabels: {},
    };

    template.render(block);
    if (type === "userFunc") {
      resizeUserFuncFromLabel(block, { force: true });
    }

    const paramDisplay = createSvgElement("text", {
      class: "param-display",
      "text-anchor": "middle",
      display: "none",
    });
    group.appendChild(paramDisplay);
    block.paramDisplay = paramDisplay;

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

    if (type === "scope" || type === "xyScope") {
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

    if (type === "scope" || type === "xyScope") {
      updateScopeLayout(block);
    }

    if (type === "constant" || type === "gain") {
      updateBlockLabel(block);
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
    if (!block || (block.type !== "scope" && block.type !== "xyScope")) return;
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
      if (block.scopeClipRect) {
        block.scopeClipRect.setAttribute("x", block.scopePlot.getAttribute("x"));
        block.scopeClipRect.setAttribute("y", block.scopePlot.getAttribute("y"));
        block.scopeClipRect.setAttribute("width", plotW);
        block.scopeClipRect.setAttribute("height", plotH);
      }
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
    if (block.type !== "xyScope" && block.scopeInputHints && block.scopeInputHints.length) {
      const hintX = 5;
      inputPorts.forEach((port, index) => {
        const hint = block.scopeInputHints[index];
        if (!hint) return;
        hint.setAttribute("cx", hintX);
        hint.setAttribute("cy", port.y);
      });
    }

    updateBlockTransform(block);
    if (block.scopeData || block.type === "xyScope") renderScope(block);
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
      if (state.isPinching) {
        if (dragging || startClient) {
          dragging = false;
          startClient = null;
          startedFromPort = false;
          didDrag = false;
          state.fastRouting = false;
        }
        return;
      }
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
        const movedIds = dragGroup
          ? Array.from(dragGroup.startPositions.keys())
          : [block.id];
        const hasCollision = detectBlockOverlap(movedIds);
        state.deferRouting = hasCollision;
        state.deferRoutingIds = hasCollision ? new Set(movedIds) : new Set();
        if (state.dirtyBlocks) {
          if (dragGroup) {
            dragGroup.startPositions.forEach((_pos, id) => state.dirtyBlocks.add(id));
          } else {
            state.dirtyBlocks.add(block.id);
          }
        }
        if (hasCollision) {
          state.routingDirty = false;
          if (state.dirtyBlocks) state.dirtyBlocks.clear();
          if (state.dirtyConnections) state.dirtyConnections.clear();
          updateSelectionBox();
          dragGroup = null;
          return;
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
        points = buildFastDragPathFromPorts(conn);
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
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("diagramChanged"));
    }
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
      if (!state.fastRouting && state.deferRouting && state.deferRoutingIds && state.deferRoutingIds.size > 0) {
        const ids = Array.from(state.deferRoutingIds);
        if (detectBlockOverlap(ids)) {
          state.routingDirty = false;
          if (state.dirtyBlocks) state.dirtyBlocks.clear();
          if (state.dirtyConnections) state.dirtyConnections.clear();
          updateSelectionBox();
          return;
        }
        state.deferRouting = false;
        state.deferRoutingIds.clear();
      }
      if (state.fastRouting) {
        const dirtySet = new Set(state.dirtyConnections || []);
        if (state.dirtyBlocks && state.dirtyBlocks.size > 0) {
          state.connections.forEach((conn) => {
            if (dirtySet.has(conn)) return;
            if (state.dirtyBlocks.has(conn.from) || state.dirtyBlocks.has(conn.to)) {
              dirtySet.add(conn);
            }
          });
        }
        dirtySet.forEach((conn) => {
          conn.points = buildFastDragPathFromPorts(conn);
        });
        applyWirePathsFast(dirtySet);
        state.routingDirty = false;
        if (state.dirtyBlocks) state.dirtyBlocks.clear();
        if (state.dirtyConnections) state.dirtyConnections.clear();
        updateSelectionBox();
        return;
      }
      const dirtyTimeLimitMs = state.fastRouting ? 80 : 4000;
      const fullTimeLimitMs = state.fastRouting ? 80 : 1500;
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
        state.debugRouteMode = "dirty";
        state.debugRouteTimeLimit = dirtyTimeLimitMs;
        paths = routeDirtyConnections(state, worldW, worldH, { x: 0, y: 0 }, dirtySet, dirtyTimeLimitMs);
        applyWirePaths(paths);
        if (state.debugOverlapCount > 0) {
          state.debugFallbackFullRoute = true;
          state.debugRouteMode = "fallback-full";
          state.debugRouteTimeLimit = 2000;
          const fallbackPaths = routeAllConnections(state, worldW, worldH, { x: 0, y: 0 }, 2000);
          applyWirePaths(fallbackPaths);
        } else {
          state.debugFallbackFullRoute = false;
        }
        refreshDebugLog();
      } else if (needsFullRoute || !dirtySet) {
        state.debugRouteMode = "full";
        state.debugRouteTimeLimit = fullTimeLimitMs;
        paths = routeAllConnections(state, worldW, worldH, { x: 0, y: 0 }, fullTimeLimitMs);
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

  function forceFullRoute(timeLimitMs = FORCE_FULL_ROUTE_TIME_LIMIT_MS) {
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
        conn.points = points;
        conn.routeFailed = true;
      } else {
        conn.routeFailed = false;
      }
      const toBlock = state.blocks.get(conn.to);
      if (toBlock?.type === "labelSink") {
        conn.path.removeAttribute("marker-end");
      } else {
        conn.path.setAttribute("marker-end", "url(#wire-arrow)");
      }
      const routedPoints = state.fastRouting ? buildDragRenderPoints(conn, points) : points;
      const stubbedPoints = enforcePortStubs(conn, routedPoints);
      if (stubbedPoints !== routedPoints) {
        conn.points = stubbedPoints;
      }
      let finalPoints = simplifyOrthogonalPath(applyWireOffsets(conn, stubbedPoints));
      finalPoints = tryShorterOrthogonalPath(conn, finalPoints);
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
        conn.points = points;
        conn.routeFailed = true;
      } else {
        conn.routeFailed = false;
      }
      const routedPoints = state.fastRouting ? buildDragRenderPoints(conn, points) : points;
      const stubbedPoints = enforcePortStubs(conn, routedPoints);
      if (stubbedPoints !== routedPoints) {
        conn.points = stubbedPoints;
      }
      let finalPoints = simplifyOrthogonalPath(applyWireOffsets(conn, stubbedPoints));
      finalPoints = tryShorterOrthogonalPath(conn, finalPoints);
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

  function applyWirePathsFast(connections) {
    if (!connections || connections.size === 0) return;
    connections.forEach((conn) => {
      let points = conn.points || [];
      if (!points || points.length < 2) {
        points = buildFallbackPathFromPorts(conn);
        conn.points = points;
        conn.routeFailed = true;
      } else {
        conn.routeFailed = false;
      }
      const toBlock = state.blocks.get(conn.to);
      if (toBlock?.type === "labelSink") {
        conn.path.removeAttribute("marker-end");
      } else {
        conn.path.setAttribute("marker-end", "url(#wire-arrow)");
      }
      const routedPoints = buildDragRenderPoints(conn, points);
      const stubbedPoints = enforcePortStubs(conn, routedPoints);
      if (stubbedPoints !== routedPoints) {
        conn.points = stubbedPoints;
      }
      let finalPoints = simplifyOrthogonalPath(applyWireOffsets(conn, stubbedPoints));
      finalPoints = tryShorterOrthogonalPath(conn, finalPoints);
      if (!finalPoints.length || hasInvalidPoint(finalPoints)) return;
      const segments = buildSegments(finalPoints, conn);
      const d = buildPathWithHops(segments, []);
      if (!isValidPathString(d)) return;
      conn.path.setAttribute("d", d);
      if (conn.hitPath) conn.hitPath.setAttribute("d", d);
    });
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
    const hardIssues = [];
    const softIssues = [];
    const points =
      conn.debugRenderPoints && conn.debugRenderPoints.length
        ? conn.debugRenderPoints
        : (conn.points || []);
    if (points.length < 2) {
      hardIssues.push("not enough points");
      writeDebug(logEl, formatWireIssue(conn, hardIssues));
      return true;
    }
    if (!checkPortDirections(conn, points, hardIssues)) {
      hardIssues.push("invalid port direction");
    }
    const segments = [];
    for (let i = 0; i < points.length - 1; i += 1) {
      const a = points[i];
      const b = points[i + 1];
      if (a.x !== b.x && a.y !== b.y) {
        hardIssues.push(`diagonal segment ${a.x},${a.y} -> ${b.x},${b.y}`);
      }
      segments.push({ a, b });
    }
    const connSegments = segments.map((seg) => ({
      ...seg,
      orientation: seg.a.x === seg.b.x ? "V" : "H",
    }));
    if (segmentHitsAnyBlock(connSegments, conn, hardIssues)) {
      hardIssues.push("crosses block keepout");
    }
    if (segmentOverlapsOtherWire(connSegments, conn, hardIssues)) {
      hardIssues.push("overlaps another wire");
    }
    if (conn.turnCheck && Number.isFinite(conn.turnCheck.minimal)) {
      if (conn.turnCheck.actual > conn.turnCheck.minimal) {
        softIssues.push(`extra turns (${conn.turnCheck.actual} > ${conn.turnCheck.minimal})`);
      }
    }
    for (let i = 0; i < segments.length; i += 1) {
      for (let j = i + 2; j < segments.length; j += 1) {
        if (segmentsIntersect(segments[i], segments[j])) {
          hardIssues.push(`self-cross segments ${i}/${j}`);
        }
      }
    }
    conn.debugIssues = [...hardIssues, ...softIssues];
    const metrics = formatWireDebugInfo(conn);
    if (hardIssues.length === 0) {
      writeDebug(logEl, `[wire ${conn.from}->${conn.to}] OK${metrics}`);
      return false;
    }
    writeDebug(logEl, `${formatWireIssue(conn, [...hardIssues, ...softIssues])}${metrics}`);
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
    return simplifyOrthogonalPath(dedupePoints(result));
  }

  function simplifyOrthogonalPath(points) {
    if (!points || points.length < 3) return points;
    let result = removeColinearPoints(dedupePoints(points));
    let changed = true;
    while (changed && result.length >= 4) {
      changed = false;
      for (let i = 0; i < result.length - 1; i += 1) {
        const a = result[i];
        const b = result[i + 1];
        for (let j = 0; j < i - 1; j += 1) {
          const c = result[j];
          const d = result[j + 1];
          const hit = orthogonalIntersection(a, b, c, d);
          if (!hit) continue;
          const head = result.slice(0, j + 1);
          if (!samePoint(head[head.length - 1], hit)) {
            head.push(hit);
          }
          let tail = result.slice(i + 1);
          if (tail.length && samePoint(tail[0], head[head.length - 1])) {
            tail = tail.slice(1);
          }
          result = removeColinearPoints(dedupePoints([...head, ...tail]));
          changed = true;
          break;
        }
        if (changed) break;
      }
    }
    return result;
  }

  function tryShorterOrthogonalPath(conn, points) {
    if (!points || points.length < 3) return points;
    const start = points[0];
    const end = points[points.length - 1];
    const currentTurns = countTurns(points);
    const candidates = [];
    if (start.x !== end.x && start.y !== end.y) {
      candidates.push([start, { x: end.x, y: start.y }, end]);
      candidates.push([start, { x: start.x, y: end.y }, end]);
    } else {
      candidates.push([start, end]);
    }
    for (let i = 0; i < candidates.length; i += 1) {
      const candidate = removeColinearPoints(dedupePoints(candidates[i]));
      if (candidate.length < 2) continue;
      if (countTurns(candidate) >= currentTurns) continue;
      const issues = [];
      if (!checkPortDirections(conn, candidate, issues)) continue;
      const segments = [];
      for (let j = 0; j < candidate.length - 1; j += 1) {
        const a = candidate[j];
        const b = candidate[j + 1];
        if (a.x !== b.x && a.y !== b.y) {
          segments.length = 0;
          break;
        }
        segments.push({
          a,
          b,
          orientation: a.x === b.x ? "V" : "H",
        });
      }
      if (!segments.length) continue;
      if (segmentHitsAnyBlock(segments, conn, [])) continue;
      if (segmentOverlapsOtherWire(segments, conn, [])) continue;
      const selfCross = segments.some((seg, idx) =>
        segments.slice(idx + 2).some((other) => segmentsIntersect(seg, other))
      );
      if (selfCross) continue;
      return candidate;
    }
    return points;
  }

  function countTurns(points) {
    if (!points || points.length < 3) return 0;
    let turns = 0;
    let lastDir = null;
    for (let i = 0; i < points.length - 1; i += 1) {
      const a = points[i];
      const b = points[i + 1];
      const dir = a.x === b.x ? "V" : a.y === b.y ? "H" : null;
      if (!dir) continue;
      if (lastDir && dir !== lastDir) turns += 1;
      lastDir = dir;
    }
    return turns;
  }

  function orthogonalIntersection(a, b, c, d) {
    const aH = a.y === b.y;
    const bH = c.y === d.y;
    if (aH === bH) return null;
    const h = aH ? { a, b } : { a: c, b: d };
    const v = aH ? { a: c, b: d } : { a, b };
    const hx1 = Math.min(h.a.x, h.b.x);
    const hx2 = Math.max(h.a.x, h.b.x);
    const vy1 = Math.min(v.a.y, v.b.y);
    const vy2 = Math.max(v.a.y, v.b.y);
    const ix = v.a.x;
    const iy = h.a.y;
    if (ix > hx1 && ix < hx2 && iy > vy1 && iy < vy2) {
      return { x: ix, y: iy };
    }
    return null;
  }

  function removeColinearPoints(points) {
    if (!points || points.length < 3) return points;
    const result = [points[0]];
    for (let i = 1; i < points.length - 1; i += 1) {
      const prev = result[result.length - 1];
      const curr = points[i];
      const next = points[i + 1];
      if ((prev.x === curr.x && curr.x === next.x) || (prev.y === curr.y && curr.y === next.y)) {
        continue;
      }
      result.push(curr);
    }
    result.push(points[points.length - 1]);
    return result;
  }

  function samePoint(a, b) {
    if (!a || !b) return false;
    return a.x === b.x && a.y === b.y;
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

  function enforcePortStubs(conn, points) {
    if (!points || points.length < 2) return points;
    const fromBlock = state.blocks.get(conn.from);
    const toBlock = state.blocks.get(conn.to);
    if (!fromBlock || !toBlock) return points;
    const fromIndex = conn.fromIndex ?? 0;
    const toIndex = conn.toIndex ?? 0;
    const fromPort = fromBlock.ports.find((p) => p.type === "out" && p.index === fromIndex);
    const toPort = toBlock.ports.find((p) => p.type === "in" && p.index === toIndex);
    if (!fromPort || !toPort) return points;

    const fromRaw = rotatePoint({ x: fromBlock.x + fromPort.x, y: fromBlock.y + fromPort.y }, fromBlock);
    const toRaw = rotatePoint({ x: toBlock.x + toPort.x, y: toBlock.y + toPort.y }, toBlock);
    const fromPortPos = { x: snap(fromRaw.x), y: snap(fromRaw.y) };
    const toPortPos = { x: snap(toRaw.x), y: snap(toRaw.y) };
    const fromSide = getPortSide(fromBlock, fromRaw);
    const toSide = getPortSide(toBlock, toRaw);

    const result = points.slice();
    if (result[0].x !== fromPortPos.x || result[0].y !== fromPortPos.y) {
      result.unshift(fromPortPos);
    }
    const next = result[1];
    const startStub = buildStubPoint(fromPortPos, fromSide);
    if (!isValidStub(fromPortPos, next, fromSide)) {
      result.splice(1, 0, startStub);
      const afterStub = result[2];
      if (afterStub && startStub.x !== afterStub.x && startStub.y !== afterStub.y) {
        if (fromSide === "left" || fromSide === "right") {
          result.splice(2, 0, { x: startStub.x, y: afterStub.y });
        } else {
          result.splice(2, 0, { x: afterStub.x, y: startStub.y });
        }
      }
    }

    const last = result[result.length - 1];
    if (last.x !== toPortPos.x || last.y !== toPortPos.y) {
      result.push(toPortPos);
    }
    const prev = result[result.length - 2];
    const endStub = buildStubPoint(toPortPos, toSide);
    if (!isValidStub(toPortPos, prev, toSide)) {
      if (prev && endStub.x !== prev.x && endStub.y !== prev.y) {
        if (toSide === "left" || toSide === "right") {
          result.splice(result.length - 1, 0, { x: endStub.x, y: prev.y });
        } else {
          result.splice(result.length - 1, 0, { x: prev.x, y: endStub.y });
        }
      }
      result.splice(result.length - 1, 0, endStub);
    }

    return dedupePoints(result);
  }

  function buildStubPoint(portPos, side) {
    if (side === "left") return { x: portPos.x - GRID_SIZE, y: portPos.y };
    if (side === "right") return { x: portPos.x + GRID_SIZE, y: portPos.y };
    if (side === "top") return { x: portPos.x, y: portPos.y - GRID_SIZE };
    return { x: portPos.x, y: portPos.y + GRID_SIZE };
  }

  function isValidStub(port, other, side) {
    if (side === "left") return other.y === port.y && other.x <= port.x - GRID_SIZE;
    if (side === "right") return other.y === port.y && other.x >= port.x + GRID_SIZE;
    if (side === "top") return other.x === port.x && other.y <= port.y - GRID_SIZE;
    return other.x === port.x && other.y >= port.y + GRID_SIZE;
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

  function buildFastDragPathFromPorts(conn) {
    const fromBlock = state.blocks.get(conn.from);
    const toBlock = state.blocks.get(conn.to);
    if (!fromBlock || !toBlock) return buildFallbackPathFromPorts(conn);
    const fromPort = fromBlock.ports.find((p) => p.type === "out" && p.index === (conn.fromIndex ?? 0));
    const toPort = toBlock.ports.find((p) => p.type === "in" && p.index === (conn.toIndex ?? 0));
    if (!fromPort || !toPort) return buildFallbackPathFromPorts(conn);
    const fromPos = rotatePoint({ x: fromBlock.x + fromPort.x, y: fromBlock.y + fromPort.y }, fromBlock);
    const toPos = rotatePoint({ x: toBlock.x + toPort.x, y: toBlock.y + toPort.y }, toBlock);
    const start = { x: snap(fromPos.x), y: snap(fromPos.y) };
    const end = { x: snap(toPos.x), y: snap(toPos.y) };
    const startSide = getPortSide(fromBlock, fromPos);
    const endSide = getPortSide(toBlock, toPos);
    const prevPoints = (conn.points || []).filter((pt) => Number.isFinite(pt.x) && Number.isFinite(pt.y));
    const movingFrom = state.dirtyBlocks?.has(conn.from) && !state.dirtyBlocks?.has(conn.to);
    const movingTo = state.dirtyBlocks?.has(conn.to) && !state.dirtyBlocks?.has(conn.from);
    if ((movingFrom || movingTo) && prevPoints.length >= 4) {
      const turnIndices = getTurnIndices(prevPoints);
      if (turnIndices.length >= 2) {
        const anchorIdx = movingFrom
          ? turnIndices[1]
          : turnIndices[turnIndices.length - 2];
        const anchor = prevPoints[anchorIdx];
        if (anchor) {
          if (movingFrom && anchorIdx > 0) {
            const approach = segmentOrientation(prevPoints[anchorIdx - 1], anchor);
            if (approach) {
              const head = buildDragPathToAnchor(start, startSide, anchor, approach);
              const tail = prevPoints.slice(anchorIdx + 1);
              return dedupePoints([...head, ...tail]);
            }
          }
          if (movingTo && anchorIdx < prevPoints.length - 1) {
            const approach = segmentOrientation(anchor, prevPoints[anchorIdx + 1]);
            if (approach) {
              const tailFromEnd = buildDragPathToAnchor(end, endSide, anchor, approach);
              const tail = dedupePoints(tailFromEnd.slice().reverse());
              const head = prevPoints.slice(0, anchorIdx + 1);
              return dedupePoints([...head, ...tail.slice(1)]);
            }
          }
        }
      }
    }
    return buildQuickPathBetweenPorts(start, startSide, end, endSide);
  }

  function buildQuickPathBetweenPorts(start, startSide, end, endSide) {
    const step = GRID_SIZE;
    const startStub = { x: start.x, y: start.y };
    if (startSide === "left") startStub.x -= step;
    if (startSide === "right") startStub.x += step;
    if (startSide === "top") startStub.y -= step;
    if (startSide === "bottom") startStub.y += step;
    const endStub = { x: end.x, y: end.y };
    if (endSide === "left") endStub.x -= step;
    if (endSide === "right") endStub.x += step;
    if (endSide === "top") endStub.y -= step;
    if (endSide === "bottom") endStub.y += step;
    const mid = [];
    if (startStub.x === endStub.x || startStub.y === endStub.y) {
      mid.push(startStub, endStub);
    } else {
      mid.push(startStub, { x: endStub.x, y: startStub.y }, endStub);
    }
    return dedupePoints([start, ...mid, end]);
  }

  function getTurnIndices(points) {
    const turns = [];
    for (let i = 1; i < points.length - 1; i += 1) {
      const prev = points[i - 1];
      const curr = points[i];
      const next = points[i + 1];
      const dir1 = segmentOrientation(prev, curr);
      const dir2 = segmentOrientation(curr, next);
      if (dir1 && dir2 && dir1 !== dir2) {
        turns.push(i);
      }
    }
    return turns;
  }

  function segmentOrientation(a, b) {
    if (!a || !b) return null;
    if (a.x === b.x && a.y !== b.y) return "V";
    if (a.y === b.y && a.x !== b.x) return "H";
    return null;
  }

  function buildDragPathToAnchor(start, startSide, anchor, approach) {
    const step = GRID_SIZE;
    const startStub = { x: start.x, y: start.y };
    if (startSide === "left") startStub.x -= step;
    if (startSide === "right") startStub.x += step;
    if (startSide === "top") startStub.y -= step;
    if (startSide === "bottom") startStub.y += step;
    if (approach === "H") {
      if (startStub.y === anchor.y) return dedupePoints([start, startStub, anchor]);
      return dedupePoints([start, startStub, { x: startStub.x, y: anchor.y }, anchor]);
    }
    if (startStub.x === anchor.x) return dedupePoints([start, startStub, anchor]);
    return dedupePoints([start, startStub, { x: anchor.x, y: startStub.y }, anchor]);
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
    const fromWirePos = getWirePosition(conn.from, "out", fromIndex);
    const toWirePos = getWirePosition(conn.to, "in", conn.toIndex ?? 0);
    const start = points[0];
    const next = points[1];
    const last = points[points.length - 1];
    const prev = points[points.length - 2];
    const fromSide = getPortSide(fromBlock, fromPos);
    const toSide = getPortSide(toBlock, toPos);
    const startPos =
      fromWirePos && start.x === fromWirePos.x && start.y === fromWirePos.y
        ? fromWirePos
        : fromPortPos;
    const endPos =
      toWirePos && last.x === toWirePos.x && last.y === toWirePos.y
        ? toWirePos
        : toPortPos;
    if (start.x !== fromPortPos.x || start.y !== fromPortPos.y) {
      if (!fromWirePos || start.x !== fromWirePos.x || start.y !== fromWirePos.y) {
        issues.push("start port mismatch");
        return false;
      }
    }
    if (last.x !== toPortPos.x || last.y !== toPortPos.y) {
      if (!toWirePos || last.x !== toWirePos.x || last.y !== toWirePos.y) {
        issues.push("end port mismatch");
        return false;
      }
    }
    if (!isValidStub(startPos, next, fromSide)) {
      issues.push(`bad start stub (${fromSide}) port=${startPos.x},${startPos.y} next=${next.x},${next.y}`);
      return false;
    }
    if (!isValidStub(endPos, prev, toSide)) {
      issues.push(`bad end stub (${toSide}) port=${endPos.x},${endPos.y} prev=${prev.x},${prev.y}`);
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

    function updateBlockTransform(block) {
    const angle = block.rotation || 0;
    const cx = block.width / 2;
    const cy = block.height / 2;
    block.group.setAttribute("transform", `translate(${block.x}, ${block.y}) rotate(${angle} ${cx} ${cy})`);
    block.group.setAttribute("data-rotation", String(angle));
  }

  function resizeBlock(block, width, height) {
    if (!block || (block.type !== "scope" && block.type !== "xyScope")) return;
    block.width = width;
    block.height = height;
    updateScopeLayout(block);
    state.routingDirty = true;
    if (state.dirtyBlocks) state.dirtyBlocks.add(block.id);
    updateConnections(true);
  }

  function getSvgScale() {
    const viewBox = svg.getAttribute("viewBox");
    if (!viewBox) return { x: 1, y: 1 };
    const parts = viewBox.split(" ").map((v) => Number(v));
    if (parts.length !== 4 || parts.some((v) => !Number.isFinite(v))) {
      return { x: 1, y: 1 };
    }
    const [, , vbWidth, vbHeight] = parts;
    if (!vbWidth || !vbHeight) return { x: 1, y: 1 };
    const scaleX = svg.clientWidth / vbWidth;
    const scaleY = svg.clientHeight / vbHeight;
    return { x: scaleX || 1, y: scaleY || 1 };
  }

  function scaleMathToFit(mathGroup, targetWidth, targetHeight, padding = 8) {
    if (!mathGroup) return;
    const span = mathGroup.querySelector("span");
    const wrapper = mathGroup.querySelector(".math-foreign");
    if (!span || !wrapper || span.classList.contains("katex-target")) return;
    const rect = span.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const scale = getSvgScale();
    const measuredW = rect.width / scale.x;
    const measuredH = rect.height / scale.y;
    const availableW = Math.max(1, targetWidth - padding * 2);
    const availableH = Math.max(1, targetHeight - padding * 2);
    const factor = Math.min(1, availableW / measuredW, availableH / measuredH);
    if (factor < 0.999) {
      wrapper.style.transformOrigin = "center center";
      wrapper.style.transform = `scale(${factor})`;
    } else {
      wrapper.style.transform = "";
    }
  }

  function getMathSpanSize(mathGroup) {
    const span = mathGroup?.querySelector?.("span");
    if (!span || span.classList.contains("katex-target")) return null;
    const rect = span.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const scale = getSvgScale();
    return {
      w: rect.width / scale.x,
      h: rect.height / scale.y,
    };
  }

  function positionGainMath(mathGroup, block, padding = 8) {
    if (!mathGroup || !block) return;
    const size = getMathSpanSize(mathGroup);
    if (!size) return;
    const desiredCenter = block.width * 0.34;
    const half = size.w / 2;
    const minCenter = padding + half;
    const maxCenter = block.width - padding - half;
    const clampedCenter = Math.min(maxCenter, Math.max(minCenter, desiredCenter));
    const shiftX = clampedCenter - (block.width / 2);
    mathGroup.setAttribute("transform", `translate(${shiftX}, 0)`);
  }

  function resizeUserFuncFromLabel(block, { force = false } = {}) {
    if (!block || block.type !== "userFunc") return;
    const rawExpr = String(block.params?.expr || "u");
    const latex = exprToLatex(rawExpr);
    const estimateWidth = estimateLatexWidth(latex);
    const rawEstimate = Math.max(120, Math.ceil(rawExpr.length * 14 + 60));
    const mathGroup = block.group.querySelector(".userfunc-math");
    const paddingX = 8;
    let width = Math.max(estimateWidth, rawEstimate);
    let height = 80;
    let measuredWidth = 0;
    const scale = getSvgScale();
    if (mathGroup) {
      for (let pass = 0; pass < 2; pass += 1) {
        const foreign = mathGroup.querySelector("foreignObject");
        if (foreign) {
          foreign.setAttribute("width", width);
          foreign.setAttribute("height", height);
        }
        const span = mathGroup.querySelector("span");
        if (span && !span.classList.contains("katex-target")) {
          const rect = span.getBoundingClientRect();
          measuredWidth = rect.width / scale.x;
          const needed = Math.ceil(measuredWidth + paddingX);
          if (needed <= width && !force) break;
          width = Math.max(width, needed);
        }
      }
    }
    if (!force && width === block.width && height === block.height) return;
    block.width = width;
    block.height = height;
    const body = block.group.querySelector("rect.block-body");
    if (body) {
      body.setAttribute("width", width);
      body.setAttribute("height", height);
    }
    if (mathGroup) {
      const foreign = mathGroup.querySelector("foreignObject");
      if (foreign) {
        foreign.setAttribute("width", width);
        foreign.setAttribute("height", height);
      }
    }
    block.dynamicInputs = [{ x: 0, y: height / 2, side: "left" }];
    block.dynamicOutputs = [{ x: width, y: height / 2, side: "right" }];
    if (block.dragRect) {
      const minDragSize = 80;
      const dragHeight = height;
      const dragWidth = Math.max(width, minDragSize);
      const dragBoxHeight = Math.max(dragHeight, minDragSize);
      const dragX = (width - dragWidth) / 2;
      const dragY = (height - dragBoxHeight) / 2;
      block.dragRect.setAttribute("x", dragX);
      block.dragRect.setAttribute("y", dragY);
      block.dragRect.setAttribute("width", dragWidth);
      block.dragRect.setAttribute("height", dragBoxHeight);
    }
    const inputPorts = block.ports.filter((port) => port.type === "in").sort((a, b) => a.index - b.index);
    const outputPorts = block.ports.filter((port) => port.type === "out").sort((a, b) => a.index - b.index);
    inputPorts.forEach((port, index) => {
      const spec = block.dynamicInputs[index];
      if (spec) {
        port.x = spec.x;
        port.y = spec.y;
        port.side = spec.side;
        port.wireX = spec.x;
        port.wireY = spec.y;
        updatePortElement(port);
      }
    });
    outputPorts.forEach((port, index) => {
      const spec = block.dynamicOutputs[index];
      if (spec) {
        port.x = spec.x;
        port.y = spec.y;
        port.side = spec.side;
        port.wireX = spec.x;
        port.wireY = spec.y;
        updatePortElement(port);
      }
    });
    updateBlockTransform(block);
    state.routingDirty = true;
    updateConnections(true);
  }

  if (typeof window !== "undefined") {
    window.vibesimResizeUserFunc = (blockId) => {
      const block = state.blocks.get(blockId);
      if (block?.type === "userFunc") {
        resizeUserFuncFromLabel(block, { force: true });
      }
    };
  }

          function rectsOverlap(a, b) {
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  }

  function detectBlockOverlap(ids) {
    if (!ids || ids.length === 0) return false;
    const movedIds = new Set(ids);
    const movedBlocks = ids.map((id) => state.blocks.get(id)).filter(Boolean);
    if (movedBlocks.length === 0) return false;
    const movedRects = movedBlocks.map((block) => ({ id: block.id, rect: blockBounds(block) }));
    const otherRects = [];
    state.blocks.forEach((block) => {
      if (movedIds.has(block.id)) return;
      otherRects.push({ id: block.id, rect: blockBounds(block) });
    });
    for (let i = 0; i < movedRects.length; i += 1) {
      const a = movedRects[i].rect;
      for (let j = 0; j < otherRects.length; j += 1) {
        const b = otherRects[j].rect;
        if (rectsOverlap(a, b)) return true;
      }
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
    if (window.vibesimDebugExtra) {
      summary.push(window.vibesimDebugExtra);
    }
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
    if (state.debugRouteMode) {
      summary.push(`routeMode=${state.debugRouteMode}`);
    }
    if (typeof state.debugRouteTimeLimit === "number") {
      summary.push(`routeTimeLimitMs=${state.debugRouteTimeLimit}`);
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
    const errorConnections = state.connections.filter((conn) => conn.path?.classList?.contains("wire-error"));
    if (errorConnections.length) {
      const errorKeys = errorConnections.map((conn) => {
        const fromIndex = conn.fromIndex ?? 0;
        const toIndex = conn.toIndex ?? 0;
        return `${conn.from}:${fromIndex}->${conn.to}:${toIndex}`;
      });
      summary.push(`wireErrors=${errorConnections.length}`);
      summary.push(`wireErrorKeys=${errorKeys.join(",")}`);
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
      wireLines.push(`  pathLen=${pathLen} wireError=${wireError} routeFailed=${conn.routeFailed ? "true" : "false"} path="${pathPreview}"`);
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
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("diagramChanged"));
    }
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
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("diagramChanged"));
    }
  }

  function updateBlockLabel(block) {
    const template = blockTemplates[block.type];
    if (template?.resize) {
      const previous = { width: block.width, height: block.height };
      template.resize(block);
      const sizeChanged = previous.width !== block.width || previous.height !== block.height;
      if (sizeChanged) {
        const rect = block.group.querySelector("rect.block-body");
        if (rect) {
          rect.setAttribute("width", block.width);
          rect.setAttribute("height", block.height);
        }
        if (block.dragRect) {
          const minDragSize = 80;
          const dragHeight = block.type === "scope" ? 24 : block.height;
          const dragWidth = block.type === "scope" ? block.width : Math.max(block.width, minDragSize);
          const dragBoxHeight = block.type === "scope" ? dragHeight : Math.max(dragHeight, minDragSize);
          const dragX = block.type === "scope" ? 0 : (block.width - dragWidth) / 2;
          const dragY = block.type === "scope" ? 0 : (block.height - dragBoxHeight) / 2;
          block.dragRect.setAttribute("x", dragX);
          block.dragRect.setAttribute("y", dragY);
          block.dragRect.setAttribute("width", dragWidth);
          block.dragRect.setAttribute("height", dragBoxHeight);
        }
        const inputPorts = block.ports.filter((port) => port.type === "in").sort((a, b) => a.index - b.index);
        const outputPorts = block.ports.filter((port) => port.type === "out").sort((a, b) => a.index - b.index);
        const dynamicInputs = Array.isArray(block.dynamicInputs) ? block.dynamicInputs : null;
        const dynamicOutputs = Array.isArray(block.dynamicOutputs) ? block.dynamicOutputs : null;
        inputPorts.forEach((port, index) => {
          const spec = dynamicInputs ? dynamicInputs[index] : null;
          if (spec) {
            port.x = spec.x;
            port.y = spec.y;
            port.side = spec.side;
          }
          port.wireX = port.x;
          port.wireY = port.y;
          updatePortElement(port);
        });
        outputPorts.forEach((port, index) => {
          const spec = dynamicOutputs ? dynamicOutputs[index] : null;
          if (spec) {
            port.x = spec.x;
            port.y = spec.y;
            port.side = spec.side;
          }
          port.wireX = port.x;
          port.wireY = port.y;
          updatePortElement(port);
        });
        updateBlockTransform(block);
        state.routingDirty = true;
        updateConnections(true);
      }
    }
    if (block.type === "constant") {
      const mathGroup = block.group.querySelector(".constant-math");
      if (mathGroup) {
        renderTeXMath(mathGroup, `${block.params.value}`, block.width, block.height);
        scaleMathToFit(mathGroup, block.width, block.height);
      }
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
    if (block.type === "userFunc") {
      const mathGroup = block.group.querySelector(".userfunc-math");
      if (mathGroup) {
        const latex = exprToLatex(block.params.expr || "u");
        renderTeXMath(mathGroup, `\\scriptsize{${latex}}`, block.width, block.height);
        resizeUserFuncFromLabel(block);
      }
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
    if (block.type === "switch") {
      const mathGroup = block.group.querySelector(".switch-math");
      if (mathGroup) {
        const op = block.params.condition === "gt"
          ? ">"
          : block.params.condition === "ne"
            ? "\\ne"
            : "\\geq";
        const rawThreshold = block.params.threshold ?? 0;
        const threshold = String(rawThreshold).trim() || "0";
        const len = threshold.length;
        mathGroup.classList.remove("switch-math--l", "switch-math--m", "switch-math--s");
        if (len > 9) {
          mathGroup.classList.add("switch-math--s");
        } else if (len >= 3) {
          mathGroup.classList.add("switch-math--m");
        } else {
          mathGroup.classList.add("switch-math--l");
        }
        mathGroup.setAttribute("transform", "translate(0 17)");
        renderTeXMath(mathGroup, `${op}\\ ${threshold}`, 48, 34);
      }
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
      if (mathGroup) {
        renderTeXMath(mathGroup, `${block.params.gain}`, block.width, block.height);
        scaleMathToFit(mathGroup, block.width * 0.6, block.height);
        positionGainMath(mathGroup, block, 8);
      }
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

    updateParamDisplay(block);
  }

  function updateParamDisplay(block) {
    const textEl = block.paramDisplay;
    if (!textEl) return;
    const visible = block.params?._visible;
    if (!visible || typeof visible !== "object") {
      textEl.setAttribute("display", "none");
      textEl.textContent = "";
      return;
    }
    const entries = Object.entries(visible).filter(([key, on]) => on && key !== "_visible");
    if (!entries.length) {
      textEl.setAttribute("display", "none");
      textEl.textContent = "";
      return;
    }
    while (textEl.firstChild) textEl.removeChild(textEl.firstChild);
    const baseX = block.width / 2;
    const baseY = block.height + 14;
    entries.forEach(([key], index) => {
      const label = (block.paramLabels && block.paramLabels[key]) || key;
      const value = block.params?.[key];
      const valueText = value == null ? "" : String(value);
      const line = `${label}: ${valueText}`;
      const tspan = createSvgElement("tspan", {
        x: baseX,
        y: baseY + index * 12,
      });
      tspan.textContent = line;
      textEl.appendChild(tspan);
    });
    textEl.setAttribute("display", "block");
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

  function setLoopHighlight(blockIds, connections) {
    const blockSet = blockIds ? new Set(blockIds) : null;
    const connSet = connections ? new Set(connections) : null;
    state.blocks.forEach((block) => {
      block.group.classList.toggle("loop-highlight", Boolean(blockSet && blockSet.has(block.id)));
    });
    state.connections.forEach((conn) => {
      const active = Boolean(connSet && connSet.has(conn));
      conn.path.classList.toggle("loop-highlight", active);
    });
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
    setLoopHighlight,
  };
}
