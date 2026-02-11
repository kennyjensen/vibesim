import { simHandlers, resolveLabelSourcesOnce } from "./blocks/sim/index.js";
import { buildTfModel, outputFromState, integrateTfRK4 } from "./blocks/sim/helpers.js";
import { evalExpression } from "./utils/expr.js";

function roundToSignificant(value, digits = 2) {
  if (!Number.isFinite(value) || value === 0) return value;
  return Number(value.toPrecision(digits));
}

function refreshParamDisplay(scopeBlock) {
  if (typeof window === "undefined") return;
  if (typeof window.vibesimUpdateParamDisplay !== "function") return;
  window.vibesimUpdateParamDisplay(scopeBlock?.id);
}

function sourceBlockIdFromKey(key) {
  if (typeof key !== "string" || !key) return null;
  const splitIdx = key.indexOf(":");
  return splitIdx >= 0 ? key.slice(0, splitIdx) : key;
}

function buildAlgebraicPlan(algebraicBlocks, inputMap) {
  const byId = new Map();
  algebraicBlocks.forEach((entry) => byId.set(entry.block.id, entry));
  if (byId.size === 0) return { ordered: [], hasCycle: false };

  const indegree = new Map();
  const outEdges = new Map();
  byId.forEach((_, id) => {
    indegree.set(id, 0);
    outEdges.set(id, new Set());
  });

  byId.forEach((_, targetId) => {
    const inputs = inputMap.get(targetId) || [];
    inputs.forEach((srcKey) => {
      const srcId = sourceBlockIdFromKey(srcKey);
      if (!srcId || !byId.has(srcId) || srcId === targetId) return;
      const edges = outEdges.get(srcId);
      if (edges.has(targetId)) return;
      edges.add(targetId);
      indegree.set(targetId, (indegree.get(targetId) || 0) + 1);
    });
  });

  const queue = [];
  indegree.forEach((deg, id) => {
    if (deg === 0) queue.push(id);
  });
  const ordered = [];
  let readIdx = 0;
  while (readIdx < queue.length) {
    const id = queue[readIdx];
    readIdx += 1;
    ordered.push(byId.get(id));
    outEdges.get(id).forEach((neighbor) => {
      const next = (indegree.get(neighbor) || 0) - 1;
      indegree.set(neighbor, next);
      if (next === 0) queue.push(neighbor);
    });
  }
  const hasCycle = ordered.length !== byId.size;
  return { ordered: hasCycle ? algebraicBlocks : ordered, hasCycle };
}

export function simulate({ state, runtimeInput, statusEl, downloadFile }) {
  statusEl.textContent = "Running...";
  const blocks = Array.from(state.blocks.values());
  const blockHandlers = blocks.map((block) => ({ block, handler: simHandlers[block.type] }));
  const initBlocks = blockHandlers.filter(({ handler }) => Boolean(handler?.init));
  const outputBlocks = blockHandlers.filter(({ handler }) => Boolean(handler?.output));
  const algebraicBlocks = blockHandlers.filter(({ handler }) => Boolean(handler?.algebraic));
  const afterStepBlocks = blockHandlers.filter(({ handler }) => Boolean(handler?.afterStep));
  const updateBlocks = blockHandlers.filter(({ handler }) => Boolean(handler?.update));
  const finalizeBlocks = blockHandlers.filter(({ handler }) => Boolean(handler?.finalize));
  const hasLabelResolution = blocks.some((b) => b.type === "labelSource" || b.type === "labelSink");
  const labelSourceBlocks = hasLabelResolution ? blocks.filter((b) => b.type === "labelSource") : [];
  const needsAlgebraicSolve = hasLabelResolution || algebraicBlocks.length > 0;
  const scopes = blocks.filter((b) => b.type === "scope");
  const xyScopes = blocks.filter((b) => b.type === "xyScope");
  const fileSinks = blocks.filter((b) => b.type === "fileSink");

  if (scopes.length === 0 && xyScopes.length === 0 && fileSinks.length === 0) {
    statusEl.textContent = "Add a Scope block";
    return;
  }

  const inputMap = new Map();
  const variables = state.variables || { pi: Math.PI, e: Math.E };
  const resolveParam = (value, block, key) => {
    if (block.type === "labelSource" || block.type === "labelSink") {
      if (key === "name" || key === "isExternalPort") return value;
    }
    if (block.type === "userFunc" && key === "expr") return value;
    if (block.type === "fileSource" || block.type === "fileSink") {
      if (key === "path" || key === "times" || key === "values" || key === "lastCsv") return value;
    }
    if (block.type === "switch" && key === "condition") return value;
    if (block.type === "subsystem" && (key === "name" || key === "externalInputs" || key === "externalOutputs" || key === "subsystem")) return value;
    if (key === "signs") return value;
    if (Array.isArray(value)) return value.map((v) => {
      const out = evalExpression(v, variables);
      return Number.isNaN(out) ? 0 : out;
    });
    const out = evalExpression(value, variables);
    return Number.isNaN(out) ? 0 : out;
  };
  const resolvedParams = new Map();
  blocks.forEach((block) => {
    const params = block.params || {};
    const resolved = {};
    Object.entries(params).forEach(([key, value]) => {
      resolved[key] = resolveParam(value, block, key);
    });
    resolvedParams.set(block.id, resolved);
  });
  blocks.forEach((block) => {
    inputMap.set(block.id, Array(block.inputs).fill(null));
  });

  const sourceKey = (fromId, fromIndex) => {
    const idx = Number(fromIndex ?? 0);
    return idx > 0 ? `${fromId}:${idx}` : fromId;
  };

  state.connections.forEach((conn) => {
    const inputs = inputMap.get(conn.to);
    if (!inputs) return;
    if (conn.toIndex < inputs.length) inputs[conn.toIndex] = sourceKey(conn.from, conn.fromIndex);
  });
  const algebraicPlan = buildAlgebraicPlan(algebraicBlocks, inputMap);

  const dt = Math.max(1e-6, Number(state.sampleTime ?? variables.dt ?? variables.sampleTime ?? 0.01) || 0.01);
  const requestedDuration = Number(runtimeInput.value);
  const baseDuration = Number.isFinite(requestedDuration) && requestedDuration >= 0 ? requestedDuration : 10;
  const minDuration = dt * 10;
  const duration = Math.max(baseDuration, minDuration);
  const samples = Math.floor(duration / dt);
  const time = [];
  const blockState = new Map();
  const labelSinks = new Map();
  const ctx = {
    resolvedParams,
    inputMap,
    labelSinks,
    blockState,
    dt,
    variables,
  };

  initBlocks.forEach(({ block, handler }) => handler.init(ctx, block));

  let algebraicLoopFailed = false;
  let algebraicLoopTime = 0;

  for (let i = 0; i <= samples; i += 1) {
    const t = i * dt;
    time.push(t);
    const outputs = new Map();
    ctx.t = t;
    ctx.outputs = outputs;

    outputBlocks.forEach(({ block, handler }) => handler.output(ctx, block));

    const resolveLabelSources = () =>
      resolveLabelSourcesOnce(labelSourceBlocks, outputs, inputMap, labelSinks);

    if (needsAlgebraicSolve) {
      if (!hasLabelResolution && !algebraicPlan.hasCycle) {
        algebraicPlan.ordered.forEach(({ block, handler }) => {
          handler.algebraic(ctx, block);
        });
      } else {
      let progress = true;
      let iter = 0;
      const maxIter = 50;
      while (progress && iter < maxIter) {
        iter += 1;
        progress = false;
        if (hasLabelResolution && resolveLabelSources()) progress = true;
        algebraicPlan.ordered.forEach(({ block, handler }) => {
          const result = handler.algebraic(ctx, block);
          if (result?.updated) progress = true;
        });
        if (hasLabelResolution && resolveLabelSources()) progress = true;
      }
      if (progress && iter >= maxIter) {
        algebraicLoopFailed = true;
        algebraicLoopTime = t;
        break;
      }
      }
    }

    afterStepBlocks.forEach(({ block, handler }) => handler.afterStep(ctx, block));

    updateBlocks.forEach(({ block, handler }) => handler.update(ctx, block));
  }

  if (algebraicLoopFailed) {
    statusEl.textContent = `Error: algebraic loop did not converge at t=${algebraicLoopTime.toFixed(6)} s`;
    return;
  }

  finalizeBlocks.forEach(({ block, handler }) => handler.finalize(ctx, block));

  blocks.forEach((block) => {
    if (block.type !== "fileSink") return;
    const csv = block.params?.lastCsv;
    if (!csv || typeof downloadFile !== "function") return;
    const name = String(block.params?.path || "output.csv");
    downloadFile(name, csv, { immediate: true });
  });

  scopes.forEach((scope) => {
    const state = blockState.get(scope.id);
    if (!state?.scopeSeries) return;
    drawScope(scope, time, state.scopeSeries, state.scopeConnected || []);
  });
  xyScopes.forEach((scope) => {
    const state = blockState.get(scope.id);
    if (!state?.xySeries) return;
    drawXYScope(scope, state.xySeries, state.xyConnected || []);
  });

  statusEl.textContent = "Done";
}

export function drawScope(scopeBlock, time, series, connected) {
  scopeBlock.scopeData = { time, series, connected };
  renderScope(scopeBlock);
}

export function drawXYScope(scopeBlock, series, connected) {
  scopeBlock.xyScopeData = { series, connected };
  renderXYScope(scopeBlock);
}

export function renderScope(scopeBlock) {
  if (scopeBlock.type === "xyScope") {
    renderXYScope(scopeBlock);
    return;
  }
  if (!scopeBlock.scopePaths || !scopeBlock.scopePlot || !scopeBlock.scopeData) return;
  const formatTime = (t, t0, t1) => {
    const range = Math.abs((t1 ?? 0) - (t0 ?? 0));
    let scale = 1;
    let unit = "s";
    if (range < 1e-3) {
      scale = 1e6;
      unit = "µs";
    } else if (range < 1) {
      scale = 1e3;
      unit = "ms";
    }
    return { value: t * scale, unit };
  };
  const plot = scopeBlock.scopePlot;
  const plotX = Number(plot.getAttribute("x"));
  const plotY = Number(plot.getAttribute("y"));
  const plotW = Number(plot.getAttribute("width"));
  const plotH = Number(plot.getAttribute("height"));
  const axes = scopeBlock.scopeAxes;
  const showTickLabels = scopeBlock.params?.showTickLabels === true;
  const parseLimit = (value) => {
    if (value == null) return null;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) return null;
      const num = Number(trimmed);
      return Number.isFinite(num) ? num : null;
    }
    return null;
  };
  const niceStep = (range, target = 5) => {
    if (!Number.isFinite(range) || range <= 0) return 1;
    const raw = range / target;
    const pow = Math.pow(10, Math.floor(Math.log10(raw)));
    const scaled = raw / pow;
    let step = 1;
    if (scaled <= 1) step = 1;
    else if (scaled <= 2) step = 2;
    else if (scaled <= 5) step = 5;
    else step = 10;
    return step * pow;
  };
  const buildTicks = (min, max, step) => {
    if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(step) || step <= 0) return [];
    const start = Math.ceil(min / step) * step;
    const ticks = [];
    for (let v = start; v <= max + step * 0.5; v += step) ticks.push(v);
    return ticks;
  };
  const formatTick = (value) => {
    if (!Number.isFinite(value)) return "";
    if (value === 0) return "0";
    const abs = Math.abs(value);
    if (abs >= 10000 || abs < 1e-3) return value.toExponential(1).replace("+", "");
    return Number(value.toPrecision(3)).toString();
  };
  const { time, series, connected } = scopeBlock.scopeData;
  const t0Raw = Number(time[0] ?? 0);
  const t1Raw = Number(time[time.length - 1] ?? t0Raw);
  const tMinParam = parseLimit(scopeBlock.params?.tMin);
  const tMaxParam = parseLimit(scopeBlock.params?.tMax);
  const yMinParam = parseLimit(scopeBlock.params?.yMin);
  const yMaxParam = parseLimit(scopeBlock.params?.yMax);
  const t0 = tMinParam != null ? tMinParam : t0Raw;
  const t1 = tMaxParam != null ? tMaxParam : t1Raw;
  const tRange = t1 - t0;
  const activeSeries = series.filter((_, idx) => (connected ? connected[idx] : true));
  let observedMin = Infinity;
  let observedMax = -Infinity;
  let observedCount = 0;
  activeSeries.forEach((seriesValues) => {
    seriesValues.forEach((v) => {
      if (v == null || !Number.isFinite(v)) return;
      observedCount += 1;
      if (v < observedMin) observedMin = v;
      if (v > observedMax) observedMax = v;
    });
  });
  if (observedCount === 0) {
    scopeBlock.scopePaths.forEach((path) => path.setAttribute("d", ""));
    if (axes?.xTickLabels) axes.xTickLabels.forEach((label) => label.setAttribute("display", "none"));
    if (axes?.yTickLabels) axes.yTickLabels.forEach((label) => label.setAttribute("display", "none"));
    scopeBlock.computedLimits = {
      tMin: t0,
      tMax: t1,
      yMin: yMinParam != null ? yMinParam : -1.2,
      yMax: yMaxParam != null ? yMaxParam : 1.2,
    };
    refreshParamDisplay(scopeBlock);
    return;
  }

  let maxVal = Math.max(observedMax, 1);
  let minVal = Math.min(observedMin, -1);
  if (yMinParam != null) minVal = yMinParam;
  if (yMaxParam != null) maxVal = yMaxParam;
  if (maxVal === minVal) {
    maxVal += 1;
    minVal -= 1;
  }
  if (yMinParam == null && yMaxParam == null) {
    const maxAbs = Math.max(Math.abs(maxVal), Math.abs(minVal), 1e-6);
    maxVal = roundToSignificant(maxAbs * 1.2, 2);
    minVal = roundToSignificant(-maxAbs * 1.2, 2);
  }
  const range = maxVal - minVal;

  if (axes) {
    const yZero = plotY + plotH - ((0 - minVal) / range) * plotH;
    const xAxisY = Math.max(plotY, Math.min(plotY + plotH, yZero));
    axes.xAxis.setAttribute("x1", plotX);
    axes.xAxis.setAttribute("y1", xAxisY);
    axes.xAxis.setAttribute("x2", plotX + plotW);
    axes.xAxis.setAttribute("y2", xAxisY);
    axes.yAxis.setAttribute("x1", plotX);
    axes.yAxis.setAttribute("y1", plotY);
    axes.yAxis.setAttribute("x2", plotX);
    axes.yAxis.setAttribute("y2", plotY + plotH);
    const tickLen = 5;
    const yStep = niceStep(range, 5);
    const yTicks = buildTicks(minVal, maxVal, yStep);
    axes.yTicks.forEach((tick, idx) => {
      if (idx >= yTicks.length) {
        tick.setAttribute("display", "none");
        axes.yTickLabels?.[idx]?.setAttribute("display", "none");
        return;
      }
      tick.setAttribute("display", "block");
      const v = yTicks[idx];
      const y = plotY + plotH - ((v - minVal) / range) * plotH;
      tick.setAttribute("x1", plotX - tickLen);
      tick.setAttribute("y1", y);
      tick.setAttribute("x2", plotX + tickLen);
      tick.setAttribute("y2", y);
      const label = axes.yTickLabels?.[idx];
      if (label) {
        if (showTickLabels) {
          label.setAttribute("display", "block");
          label.setAttribute("x", plotX + 8);
          label.setAttribute("y", y - 2);
          label.textContent = formatTick(v);
        } else {
          label.setAttribute("display", "none");
        }
      }
    });
    const xStep = niceStep(Math.max(1e-6, tRange), 5);
    const xTicks = tRange <= 0 ? [t0] : buildTicks(t0, t1, xStep);
    axes.xTicks.forEach((tick, idx) => {
      if (idx >= xTicks.length) {
        tick.setAttribute("display", "none");
        axes.xTickLabels?.[idx]?.setAttribute("display", "none");
        return;
      }
      tick.setAttribute("display", "block");
      const v = xTicks[idx];
      const ratio = tRange <= 0 ? 0 : (v - t0) / tRange;
      const x = plotX + ratio * plotW;
      tick.setAttribute("x1", x);
      tick.setAttribute("y1", xAxisY - tickLen);
      tick.setAttribute("x2", x);
      tick.setAttribute("y2", xAxisY + tickLen);
      const label = axes.xTickLabels?.[idx];
      if (label) {
        if (showTickLabels) {
          label.setAttribute("display", "block");
          label.setAttribute("x", x + 2);
          label.setAttribute("y", xAxisY - 6);
          label.textContent = formatTick(v);
        } else {
          label.setAttribute("display", "none");
        }
      }
    });
  }

  series.forEach((valuesForSeries, seriesIdx) => {
    if (connected && !connected[seriesIdx]) {
      const pathEl = scopeBlock.scopePaths[seriesIdx];
      if (pathEl) pathEl.setAttribute("d", "");
      return;
    }
    const path = valuesForSeries
      .map((v, i) => {
        if (v == null) return null;
        const t = Number(time[i] ?? t0);
        const ratio = tRange <= 0 ? (valuesForSeries.length <= 1 ? 0 : i / (valuesForSeries.length - 1)) : (t - t0) / tRange;
        const clamped = Math.max(0, Math.min(1, ratio));
        const x = plotX + clamped * plotW;
        const y = plotY + plotH - ((v - minVal) / range) * plotH;
        return `${i === 0 ? "M" : "L"} ${x} ${y}`;
      })
      .filter(Boolean);
    const pathEl = scopeBlock.scopePaths[seriesIdx];
    if (pathEl) pathEl.setAttribute("d", path.join(" "));
  });

  scopeBlock.computedLimits = {
    tMin: t0,
    tMax: t1,
    yMin: minVal,
    yMax: maxVal,
  };
  refreshParamDisplay(scopeBlock);

  if (scopeBlock.scopeHoverX == null) return;
  const clampedX = Math.min(plotX + plotW, Math.max(plotX, scopeBlock.scopeHoverX));
  const ratio = (clampedX - plotX) / Math.max(1, plotW);
  const primaryIndex = connected ? connected.findIndex(Boolean) : 0;
  const primary = primaryIndex >= 0 ? series[primaryIndex] : series[0] || [];
  if (primary.length < 2) return;
  const idx = Math.min(primary.length - 1, Math.max(0, Math.round(ratio * (primary.length - 1))));
  const t = tRange <= 0 ? Number(time[idx] ?? t0) : t0 + ratio * tRange;
  const x = plotX + ratio * plotW;
  const timeLabel = formatTime(t, t0, t1);

  scopeBlock.scopeCursor?.remove();
  if (scopeBlock.scopeLabels) scopeBlock.scopeLabels.forEach((el) => el.remove());
  if (scopeBlock.scopeDots) scopeBlock.scopeDots.forEach((el) => el.remove());

  const cursor = createSvgElement("line", { x1: x, y1: plotY, x2: x, y2: plotY + plotH, class: "scope-cursor" });

  scopeBlock.group.appendChild(cursor);

  scopeBlock.scopeCursor = cursor;
  scopeBlock.scopeLabels = [];
  scopeBlock.scopeDots = [];

  series.forEach((valuesForSeries, seriesIdx) => {
    if (connected && !connected[seriesIdx]) return;
    const v = valuesForSeries[idx] ?? 0;
    const y = plotY + plotH - ((v - minVal) / range) * plotH;
    const dot = createSvgElement("circle", {
      cx: x,
      cy: y,
      r: 3.5,
      class: `scope-dot scope-dot-${seriesIdx + 1}`,
    });
    const label = createSvgElement(
      "text",
      { x: x + 6, y: y - 6, class: `scope-label scope-label-${seriesIdx + 1}` },
      `t=${timeLabel.value.toFixed(2)} ${timeLabel.unit} y${seriesIdx + 1}=${v.toFixed(2)}`
    );
    scopeBlock.group.appendChild(dot);
    scopeBlock.group.appendChild(label);
    scopeBlock.scopeDots.push(dot);
    scopeBlock.scopeLabels.push(label);
  });
}

export function renderXYScope(scopeBlock) {
  if (!scopeBlock.scopePaths || !scopeBlock.scopePlot || !scopeBlock.xyScopeData) return;
  const { connected } = scopeBlock.xyScopeData;
  if (connected && (!connected[0] || !connected[1])) {
    scopeBlock.scopePaths.forEach((path) => path.setAttribute("d", ""));
    if (scopeBlock.scopeAxes?.xTickLabels) scopeBlock.scopeAxes.xTickLabels.forEach((label) => label.setAttribute("display", "none"));
    if (scopeBlock.scopeAxes?.yTickLabels) scopeBlock.scopeAxes.yTickLabels.forEach((label) => label.setAttribute("display", "none"));
    refreshParamDisplay(scopeBlock);
    return;
  }
  const plot = scopeBlock.scopePlot;
  const plotX = Number(plot.getAttribute("x"));
  const plotY = Number(plot.getAttribute("y"));
  const plotW = Number(plot.getAttribute("width"));
  const plotH = Number(plot.getAttribute("height"));
  const axes = scopeBlock.scopeAxes;
  const showTickLabels = scopeBlock.params?.showTickLabels === true;
  const parseLimit = (value) => {
    if (value == null) return null;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) return null;
      const num = Number(trimmed);
      return Number.isFinite(num) ? num : null;
    }
    return null;
  };
  const niceStep = (range, target = 5) => {
    if (!Number.isFinite(range) || range <= 0) return 1;
    const raw = range / target;
    const pow = Math.pow(10, Math.floor(Math.log10(raw)));
    const scaled = raw / pow;
    let step = 1;
    if (scaled <= 1) step = 1;
    else if (scaled <= 2) step = 2;
    else if (scaled <= 5) step = 5;
    else step = 10;
    return step * pow;
  };
  const buildTicks = (min, max, step) => {
    if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(step) || step <= 0) return [];
    const start = Math.ceil(min / step) * step;
    const ticks = [];
    for (let v = start; v <= max + step * 0.5; v += step) ticks.push(v);
    return ticks;
  };
  const formatTick = (value) => {
    if (!Number.isFinite(value)) return "";
    if (value === 0) return "0";
    const abs = Math.abs(value);
    if (abs >= 10000 || abs < 1e-3) return value.toExponential(1).replace("+", "");
    return Number(value.toPrecision(3)).toString();
  };
  const { series } = scopeBlock.xyScopeData;
  const xSeries = series.x || [];
  const ySeries = series.y || [];
  const xMinParam = parseLimit(scopeBlock.params?.xMin);
  const xMaxParam = parseLimit(scopeBlock.params?.xMax);
  const yMinParam = parseLimit(scopeBlock.params?.yMin);
  const yMaxParam = parseLimit(scopeBlock.params?.yMax);
  const pairs = [];
  let observedXMin = Infinity;
  let observedXMax = -Infinity;
  let observedYMin = Infinity;
  let observedYMax = -Infinity;
  const pairCount = Math.min(xSeries.length, ySeries.length);
  for (let idx = 0; idx < pairCount; idx += 1) {
    const x = xSeries[idx];
    const y = ySeries[idx];
    if (x == null || y == null || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    pairs.push({ x, y });
    if (x < observedXMin) observedXMin = x;
    if (x > observedXMax) observedXMax = x;
    if (y < observedYMin) observedYMin = y;
    if (y > observedYMax) observedYMax = y;
  }
  if (pairs.length === 0) {
    scopeBlock.scopePaths.forEach((path) => path.setAttribute("d", ""));
    if (axes?.xTickLabels) axes.xTickLabels.forEach((label) => label.setAttribute("display", "none"));
    if (axes?.yTickLabels) axes.yTickLabels.forEach((label) => label.setAttribute("display", "none"));
    scopeBlock.computedLimits = {
      xMin: xMinParam != null ? xMinParam : -1.2,
      xMax: xMaxParam != null ? xMaxParam : 1.2,
      yMin: yMinParam != null ? yMinParam : -1.2,
      yMax: yMaxParam != null ? yMaxParam : 1.2,
    };
    refreshParamDisplay(scopeBlock);
    return;
  }
  let xMin = observedXMin;
  let xMax = observedXMax;
  let yMin = observedYMin;
  let yMax = observedYMax;
  if (xMinParam != null) xMin = xMinParam;
  if (xMaxParam != null) xMax = xMaxParam;
  if (yMinParam != null) yMin = yMinParam;
  if (yMaxParam != null) yMax = yMaxParam;
  if (xMax === xMin) {
    xMax += 1;
    xMin -= 1;
  }
  if (yMax === yMin) {
    yMax += 1;
    yMin -= 1;
  }
  if (xMinParam == null && xMaxParam == null) {
    const maxAbs = Math.max(Math.abs(xMax), Math.abs(xMin), 1e-6);
    xMax = maxAbs * 1.2;
    xMin = -maxAbs * 1.2;
  }
  if (yMinParam == null && yMaxParam == null) {
    const maxAbs = Math.max(Math.abs(yMax), Math.abs(yMin), 1e-6);
    yMax = roundToSignificant(maxAbs * 1.2, 2);
    yMin = roundToSignificant(-maxAbs * 1.2, 2);
  }
  const xRange = xMax - xMin;
  const yRange = yMax - yMin;
  if (axes) {
    const xZero = plotX + ((0 - xMin) / xRange) * plotW;
    const yZero = plotY + plotH - ((0 - yMin) / yRange) * plotH;
    const xAxisY = Math.max(plotY, Math.min(plotY + plotH, yZero));
    const yAxisX = Math.max(plotX, Math.min(plotX + plotW, xZero));
    axes.xAxis.setAttribute("x1", plotX);
    axes.xAxis.setAttribute("y1", xAxisY);
    axes.xAxis.setAttribute("x2", plotX + plotW);
    axes.xAxis.setAttribute("y2", xAxisY);
    axes.yAxis.setAttribute("x1", yAxisX);
    axes.yAxis.setAttribute("y1", plotY);
    axes.yAxis.setAttribute("x2", yAxisX);
    axes.yAxis.setAttribute("y2", plotY + plotH);
    const tickLen = 5;
    const xStep = niceStep(xRange, 5);
    const yStep = niceStep(yRange, 5);
    const xTicks = buildTicks(xMin, xMax, xStep);
    const yTicks = buildTicks(yMin, yMax, yStep);
    axes.xTicks.forEach((tick, idx) => {
      if (idx >= xTicks.length) {
        tick.setAttribute("display", "none");
        axes.xTickLabels?.[idx]?.setAttribute("display", "none");
        return;
      }
      tick.setAttribute("display", "block");
      const v = xTicks[idx];
      const x = plotX + ((v - xMin) / xRange) * plotW;
      tick.setAttribute("x1", x);
      tick.setAttribute("y1", xAxisY - tickLen);
      tick.setAttribute("x2", x);
      tick.setAttribute("y2", xAxisY + tickLen);
      const label = axes.xTickLabels?.[idx];
      if (label) {
        if (showTickLabels) {
          label.setAttribute("display", "block");
          label.setAttribute("x", x + 2);
          label.setAttribute("y", xAxisY - 6);
          label.textContent = formatTick(v);
        } else {
          label.setAttribute("display", "none");
        }
      }
    });
    axes.yTicks.forEach((tick, idx) => {
      if (idx >= yTicks.length) {
        tick.setAttribute("display", "none");
        axes.yTickLabels?.[idx]?.setAttribute("display", "none");
        return;
      }
      tick.setAttribute("display", "block");
      const v = yTicks[idx];
      const y = plotY + plotH - ((v - yMin) / yRange) * plotH;
      tick.setAttribute("x1", yAxisX - tickLen);
      tick.setAttribute("y1", y);
      tick.setAttribute("x2", yAxisX + tickLen);
      tick.setAttribute("y2", y);
      const label = axes.yTickLabels?.[idx];
      if (label) {
        if (showTickLabels) {
          label.setAttribute("display", "block");
          label.setAttribute("x", yAxisX + 8);
          label.setAttribute("y", y - 2);
          label.textContent = formatTick(v);
        } else {
          label.setAttribute("display", "none");
        }
      }
    });
  }
  const path = pairs
    .map((p, i) => {
      const x = plotX + ((p.x - xMin) / xRange) * plotW;
      const y = plotY + plotH - ((p.y - yMin) / yRange) * plotH;
      return `${i === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");
  const pathEl = scopeBlock.scopePaths[0];
  if (pathEl) pathEl.setAttribute("d", path);
  scopeBlock.computedLimits = {
    xMin,
    xMax,
    yMin,
    yMax,
  };
  refreshParamDisplay(scopeBlock);
}

export const __testOnly = {
  buildTfModel,
  outputFromState,
  integrateTfRK4,
  resolveLabelSourcesOnce,
};

function createSvgElement(tag, attrs = {}, text = "") {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  Object.entries(attrs).forEach(([key, value]) => {
    el.setAttribute(key, value);
  });
  if (text) el.textContent = text;
  return el;
}
