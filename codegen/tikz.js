const SCALE = 0.015;
const GRID = 10;

const sanitizeId = (id) => String(id).replace(/[^a-zA-Z0-9_]/g, "_");

const normalizeLatex = (text) =>
  String(text)
    .replace(/\t/g, "\\t")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");

const escapeLatex = (text) =>
  normalizeLatex(text)
    .replace(/([%#&{}_])/g, "\\$1")
    .replace(/\^/g, "\\textasciicircum{}")
    .replace(/~/g, "\\textasciitilde{}");

const toCm = (value) => (Number(value) || 0) * SCALE;
const toY = (value) => -toCm(value);

const rotatePoint = (point, block) => {
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
};

const getPortPosition = (block, type, index) => {
  const port = block.ports?.find((p) => p.type === type && p.index === index);
  if (!port) {
    return {
      x: block.x + block.width / 2,
      y: block.y + block.height / 2,
    };
  }
  const localX = port.wireX ?? port.x;
  const localY = port.wireY ?? port.y;
  return rotatePoint({ x: block.x + localX, y: block.y + localY }, block);
};

const formatMath = (value) => {
  const raw = String(value ?? "");
  const latex = escapeLatex(raw);
  return `$${latex}$`;
};

const formatLabel = (block) => {
  const params = block.params || {};
  const type = block.type;
  if (type === "labelSource" || type === "labelSink") {
    return formatMath(params.name || block.id);
  }
  if (type === "gain") {
    return formatMath(params.gain ?? 1);
  }
  if (type === "constant") {
    return formatMath(params.value ?? 0);
  }
  if (type === "integrator") return "$\\frac{1}{s}$";
  if (type === "derivative") return "$\\frac{d}{dt}$";
  if (type === "pid") return "$\\mathsf{PID}$";
  if (type === "zoh") return "$\\mathsf{ZOH}$";
  if (type === "foh") return "$\\mathsf{FOH}$";
  if (type === "ddelay") return "$z^{-1}$";
  if (type === "delay") return "$e^{-sT}$";
  if (type === "tf" || type === "dtf") {
    const num = Array.isArray(params.num) ? params.num : [];
    const den = Array.isArray(params.den) ? params.den : [];
    if (num.length && den.length) {
      const variable = type === "dtf" ? "z^{-1}" : "s";
      const numPoly = formatPolynomial(num, variable);
      const denPoly = formatPolynomial(den, variable);
      return `{\\Large $\\displaystyle\\frac{${numPoly}}{${denPoly}}$}`;
    }
    return "TF";
  }
  const label = type.replace(/([A-Z])/g, " $1");
  return escapeLatex(label.charAt(0).toUpperCase() + label.slice(1));
};

const formatPolynomial = (coeffs, variable) => {
  const terms = [];
  const n = coeffs.length;
  const formatCoeff = (coeff) => {
    const raw = String(coeff ?? "").trim();
    if (!raw) return "0";
    const num = Number(raw);
    if (Number.isFinite(num)) return num.toString();
    return escapeLatex(raw);
  };
  const formatPower = (power) => {
    if (power === 0) return "";
    if (power === 1) return variable;
    if (variable === "s") return `s^{${power}}`;
    return `(${variable})^{${power}}`;
  };
  for (let i = 0; i < n; i += 1) {
    const power = n - 1 - i;
    const raw = String(coeffs[i] ?? "").trim();
    if (!raw || Number(raw) === 0) continue;
    const coeff = formatCoeff(raw);
    const pow = formatPower(power);
    let term = "";
    if (pow) {
      if (coeff === "1") term = pow;
      else if (coeff === "-1") term = `-${pow}`;
      else term = `${coeff}${pow ? ` ${pow}` : ""}`;
    } else {
      term = coeff;
    }
    terms.push(term);
  }
  if (!terms.length) return "0";
  return terms
    .join(" + ")
    .replace(/\+\s*-/g, "- ");
};

const getPortSide = (block, rotatedPoint) => {
  const center = { x: block.x + block.width / 2, y: block.y + block.height / 2 };
  const dx = rotatedPoint.x - center.x;
  const dy = rotatedPoint.y - center.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? "left" : "right";
  return dy < 0 ? "top" : "bottom";
};

const addStub = (points, portPos, side, outgoing) => {
  const step = GRID;
  let stub = { x: portPos.x, y: portPos.y };
  if (side === "left") stub = { x: portPos.x - step, y: portPos.y };
  if (side === "right") stub = { x: portPos.x + step, y: portPos.y };
  if (side === "top") stub = { x: portPos.x, y: portPos.y - step };
  if (side === "bottom") stub = { x: portPos.x, y: portPos.y + step };
  if (outgoing) {
    if (points.length < 2 || points[1].x !== stub.x || points[1].y !== stub.y) {
      points.splice(1, 0, stub);
    }
  } else {
    const lastIndex = points.length - 1;
    if (lastIndex < 1) return;
    const prev = points[lastIndex - 1];
    if (prev.x !== stub.x || prev.y !== stub.y) {
      points.splice(lastIndex, 0, stub);
    }
  }
};

export const generateTikz = (diagram) => {
  const blocks = diagram.blocks || [];
  const connections = diagram.connections || [];
  const blockMap = new Map(blocks.map((b) => [b.id, b]));
  const lines = [];
  lines.push("\\documentclass[tikz,border=6pt]{standalone}");
  lines.push("\\usepackage{tikz}");
  lines.push("\\usepackage{amsmath}");
  lines.push("\\usetikzlibrary{arrows.meta}");
  lines.push("\\begin{document}");
  lines.push("\\begin{tikzpicture}[x=1cm,y=1cm]");
  lines.push("  \\tikzset{block/.style={draw, align=center, inner sep=1pt, line width=0.4pt}}");
  lines.push("  \\tikzset{wire/.style={line width=0.4pt}}");
  lines.push("");

  blocks.forEach((block) => {
    const id = sanitizeId(block.id);
    const label = formatLabel(block);
    const centerX = toCm(block.x + block.width / 2);
    const centerY = toY(block.y + block.height / 2);
    const w = toCm(block.width || 40);
    const h = toCm(block.height || 40);
    const type = block.type;

    if (type === "sum" || type === "mult") {
      const r = Math.min(w, h) / 2;
      lines.push(`  \\draw[block] (${centerX},${centerY}) circle (${r});`);
      if (type === "sum") {
        lines.push(`  \\draw[block] (${centerX},${centerY - r}) -- (${centerX},${centerY + r});`);
        lines.push(`  \\draw[block] (${centerX - r},${centerY}) -- (${centerX + r},${centerY});`);
        const signs = Array.isArray(block.params?.signs) ? block.params.signs : [];
        const baseX = block.x;
        const baseY = block.y;
        const signPositions = [
          { x: -24, y: 2 },
          { x: 26, y: -14 },
          { x: 26, y: 30 },
        ];
        signPositions.forEach((pos, idx) => {
          if ((signs[idx] ?? 1) >= 0) return;
          const sx = toCm(baseX + pos.x);
          const sy = toY(baseY + pos.y);
          lines.push(`  \\node at (${sx},${sy}) {$-$};`);
        });
      } else {
        const d = r / Math.SQRT2;
        lines.push(`  \\draw[block] (${centerX - d},${centerY - d}) -- (${centerX + d},${centerY + d});`);
        lines.push(`  \\draw[block] (${centerX - d},${centerY + d}) -- (${centerX + d},${centerY - d});`);
      }
    } else if (type === "gain") {
      const x0 = centerX - w / 2;
      const x1 = centerX + w / 2;
      const y0 = centerY - h / 2;
      const y1 = centerY + h / 2;
      lines.push(`  \\draw[block] (${x0},${y0}) -- (${x0},${y1}) -- (${x1},${centerY}) -- cycle;`);
      lines.push(`  \\node at (${centerX - w * 0.15},${centerY}) {${label}};`);
    } else if (type === "labelSource" || type === "labelSink") {
      const r = toCm(5);
      lines.push(`  \\draw[block] (${centerX},${centerY}) circle (${r});`);
      const lineDir = type === "labelSource" ? 1 : -1;
      const lineX = centerX + lineDir * toCm(20);
      lines.push(`  \\draw[block] (${centerX + lineDir * r},${centerY}) -- (${lineX},${centerY});`);
      lines.push(`  \\node at (${centerX},${centerY + toCm(10)}) {${label}};`);
    } else {
      lines.push(`  \\node[block, minimum width=${w}cm, minimum height=${h}cm] (${id}) at (${centerX},${centerY}) {${label}};`);
    }
  });

  lines.push("");
  connections.forEach((conn) => {
    const fromBlock = blockMap.get(conn.from);
    const toBlock = blockMap.get(conn.to);
    if (!fromBlock || !toBlock) return;
    const start = getPortPosition(fromBlock, "out", conn.fromIndex ?? 0);
    const end = getPortPosition(toBlock, "in", conn.toIndex ?? 0);
    const points =
      Array.isArray(conn.points) && conn.points.length > 1
        ? conn.points.map((pt) => ({ x: pt.x, y: pt.y }))
        : [
            start,
            {
              x: end.x,
              y: start.y,
            },
            end,
          ];
    if (points.length < 2) return;
    points[0] = start;
    points[points.length - 1] = end;
    const startSide = getPortSide(fromBlock, start);
    const endSide = getPortSide(toBlock, end);
    addStub(points, start, startSide, true);
    addStub(points, end, endSide, false);
    const path = points
      .map((pt) => `(${toCm(pt.x)},${toY(pt.y)})`)
      .join(" -- ");
    const arrow = toBlock.type === "labelSink" ? "" : ",-{Latex[length=2.5mm]}";
    lines.push(`  \\draw[wire${arrow}] ${path};`);
  });

  lines.push("\\end{tikzpicture}");
  lines.push("\\end{document}");
  return lines.join("\n");
};
