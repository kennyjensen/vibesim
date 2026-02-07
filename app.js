import { createRenderer, FORCE_FULL_ROUTE_TIME_LIMIT_MS } from "./render.js";
import { simulate, renderScope } from "./sim.js";
import { getSnapOffset, shouldCollapse, shouldExpand, lockAxis } from "./carousel-utils.js";
import { generateCode } from "./codegen/index.js";
import { stabilityMargins } from "./control/margins.js";
import { diagramToFRD } from "./control/diagram.js";
import { blockLibrary } from "./blocks/index.js";
import { createInspector } from "./blocks/inspector.js";
import { evalExpression, exprToLatex } from "./utils/expr.js";
import { GRID_SIZE } from "./geometry.js";

const svg = document.getElementById("svgCanvas");
const blockLayer = document.getElementById("blockLayer");
const wireLayer = document.getElementById("wireLayer");
const overlayLayer = document.getElementById("overlayLayer");
const runBtn = document.getElementById("runBtn");
const runButtons = document.querySelectorAll('[data-action="run"]');
const clearBtn = document.getElementById("clearBtn");
const saveBtn = document.getElementById("saveBtn");
const loadBtn = document.getElementById("loadBtn");
const loadInput = document.getElementById("loadInput");
const loadSubsystemBtn = document.getElementById("loadSubsystemBtn");
const loadSubsystemInput = document.getElementById("loadSubsystemInput");
const subsystemUpBtn = document.getElementById("subsystemUpBtn");
const codegenBtn = document.getElementById("codegenBtn");
const codegenLang = document.getElementById("codegenLang");
const simDt = document.getElementById("simDt");
const codegenIncludeMain = document.getElementById("codegenIncludeMain");
const diagramNameInput = document.getElementById("diagramName");
const marginOutputText = document.getElementById("marginOutputText");
const marginLoopSelect = document.getElementById("marginLoopSelect");
const statusEl = document.getElementById("status");
const runtimeInput = document.getElementById("runtimeInput");
const inspectorBody = document.getElementById("inspectorBody");
const deleteSelectionBtn = document.getElementById("deleteSelection");
const examplesList = document.getElementById("examplesList");
const rotateSelectionBtn = document.getElementById("rotateSelection");
const errorBox = document.getElementById("errorBox");
const debugPanel = document.getElementById("debugPanel");
const debugLog = document.getElementById("debugLog");
const blockLibraryGroups = document.getElementById("blockLibraryGroups");

const DEBUG_UI = false;

if (debugPanel) debugPanel.hidden = !DEBUG_UI;
if (typeof window !== "undefined") window.vibesimDebugUserFunc = DEBUG_UI;

const updateUserFuncDebug = () => {
  const selected = state.selectedId ? state.blocks.get(state.selectedId) : null;
  if (selected?.type === "userFunc") {
    const expr = String(selected.params?.expr || "u");
    const latex = exprToLatex(expr);
    const sizing = window.vibesimUserFuncSizing || "";
    const text = `[userFunc]\nexpr=${expr}\nlatex=${latex}${sizing ? `\n\n${sizing}` : ""}`;
    window.vibesimDebugExtra = text;
    if (debugLog) debugLog.textContent = text;
    return;
  }
  window.vibesimDebugExtra = "";
};

window.addEventListener("userFuncSizingDebug", () => {
  updateUserFuncDebug();
});

if (rotateSelectionBtn) rotateSelectionBtn.disabled = true;

const themes = [
  { id: "signal-slate", name: "Signal Slate" },
  { id: "analog-sand", name: "Analog Sand" },
  { id: "control-grid", name: "Control Grid" },
  { id: "orbit-ice", name: "Orbit Ice" },
  { id: "lab-white", name: "Lab White" },
  { id: "circuit-mint", name: "Circuit Mint" },
  { id: "radar-tan", name: "Radar Tan" },
  { id: "blueprint-lite", name: "Blueprint Lite" },
  { id: "quartz-steel", name: "Quartz Steel" },
  { id: "night-shift", name: "Night Shift" },
  { id: "terminal-ink", name: "Terminal Ink" },
  { id: "violet-burn", name: "Violet Burn" },
  { id: "noir-cyan", name: "Noir Cyan" },
];

const applyTheme = (themeId) => {
  const chosen = themes.find((theme) => theme.id === themeId) || themes[0];
  document.body.dataset.theme = chosen.id;
};


const renderBlockLibrary = () => {
  if (!blockLibraryGroups) return;
  blockLibraryGroups.innerHTML = "";
  const groups = [...blockLibrary];
  if (state.loadedSubsystems.size) {
    const subsystemBlocks = Array.from(state.loadedSubsystems.entries()).map(([key, spec]) => ({
      type: "subsystem",
      label: spec.name,
      subsystemKey: key,
    }));
    groups.push({
      id: "subsystems",
      title: "Subsystems",
      blocks: subsystemBlocks,
    });
  }
  groups.forEach((group) => {
    const details = document.createElement("details");
    details.className = "tool-group";
    const summary = document.createElement("summary");
    summary.textContent = group.title;
    details.appendChild(summary);
    group.blocks.forEach((item) => {
      const button = document.createElement("button");
      button.className = "tool";
      button.dataset.type = item.type;
      if (item.subsystemKey) button.dataset.subsystemKey = item.subsystemKey;
      button.textContent = item.label;
      details.appendChild(button);
    });
    blockLibraryGroups.appendChild(details);
  });
};

window.addEventListener("error", (event) => {
  const message = event?.message || "Unknown error";
  const file = event?.filename ? event.filename.split("/").pop() : "";
  const line = event?.lineno ? `:${event.lineno}` : "";
  if (statusEl) statusEl.textContent = `Error: ${message}${file ? ` (${file}${line})` : ""}`;
});
window.addEventListener("unhandledrejection", (event) => {
  const reason = event?.reason?.message || event?.reason || "Unhandled rejection";
  if (statusEl) statusEl.textContent = `Error: ${reason}`;
});

const state = {
  blocks: new Map(),
  connections: [],
  pendingPort: null,
  nextId: 1,
  selectedId: null,
  selectedConnection: null,
  selectedIds: new Set(),
  selectedConnections: new Set(),
  suppressNextCanvasClick: false,
  deleteMode: false,
  isPinching: false,
  isPanning: false,
  routingDirty: false,
  routingScheduled: false,
  fastRouting: false,
  deferRouting: false,
  deferRoutingIds: new Set(),
  dirtyBlocks: new Set(),
  dirtyConnections: new Set(),
  variables: {},
  variablesText: "",
  variablesDisplay: [],
  diagramName: "vibesim",
  selectedLoopKey: null,
  sampleTime: 0.01,
  loadedSubsystems: new Map(),
  subsystemStack: [],
};

let fitToDiagram = () => {};
let updateStabilityPanel = () => {};
const signalDiagramChanged = () => {
  window.dispatchEvent(new Event("diagramChanged"));
};

const deepClone = (value) => JSON.parse(JSON.stringify(value));

const connectionKey = (conn) =>
  `${conn.from}:${Number(conn.fromIndex ?? 0)}->${conn.to}:${Number(conn.toIndex ?? 0)}`;

const captureUiState = () => {
  const routePoints = {};
  state.connections.forEach((conn) => {
    if (!Array.isArray(conn.points) || conn.points.length < 2) return;
    routePoints[connectionKey(conn)] = conn.points.map((pt) => ({ x: Number(pt.x), y: Number(pt.y) }));
  });
  const scopeState = {};
  state.blocks.forEach((block) => {
    if (block.type === "scope" && block.scopeData) {
      scopeState[block.id] = { kind: "scope", data: deepClone(block.scopeData) };
    } else if (block.type === "xyScope" && block.xyScopeData) {
      scopeState[block.id] = { kind: "xyScope", data: deepClone(block.xyScopeData) };
    }
  });
  return { routePoints, scopeState };
};

const buildSubsystemSpec = (data, fallbackName = "Subsystem") => {
  const blocks = Array.isArray(data?.blocks) ? deepClone(data.blocks) : [];
  const connections = Array.isArray(data?.connections) ? deepClone(data.connections) : [];
  if (!blocks.length) throw new Error("Subsystem YAML has no blocks");
  const name = String(data?.name || fallbackName).trim() || fallbackName;
  const externalInputs = blocks
    .filter((b) => b?.type === "labelSource" && b?.params?.isExternalPort === true)
    .sort((a, b) => (Number(a?.y) || 0) - (Number(b?.y) || 0))
    .map((b) => ({ id: b.id, name: String(b?.params?.name || b.id) }));
  const externalOutputs = blocks
    .filter((b) => b?.type === "labelSink" && b?.params?.isExternalPort === true)
    .sort((a, b) => (Number(a?.y) || 0) - (Number(b?.y) || 0))
    .map((b) => ({ id: b.id, name: String(b?.params?.name || b.id) }));
  if (!externalInputs.length && !externalOutputs.length) {
    throw new Error("No external ports found. Mark label blocks with 'Is external port'");
  }
  return {
    name,
    blocks,
    connections,
    externalInputs,
    externalOutputs,
  };
};

const updateSubsystemNavUi = () => {
  if (!subsystemUpBtn) return;
  const isRoot = state.subsystemStack.length === 0;
  subsystemUpBtn.hidden = isRoot;
  subsystemUpBtn.setAttribute("aria-hidden", String(isRoot));
  document.body.classList.toggle("is-root-diagram", isRoot);
};

function openSubsystemFromBlock(block) {
  if (!block || block.type !== "subsystem") return;
  const spec = block.params?.subsystem;
  if (!spec || !Array.isArray(spec.blocks) || !Array.isArray(spec.connections)) {
    statusEl.textContent = "Subsystem is missing internal diagram data.";
    return;
  }
  const snapshot = serializeDiagram(state);
  const parentUiState = captureUiState();
  state.subsystemStack.push({
    parentDiagram: snapshot,
    parentUiState,
    hostBlockId: block.id,
  });
  updateSubsystemNavUi();
  loadDiagram(
    {
      name: String(spec.name || block.params?.name || "Subsystem"),
      blocks: deepClone(spec.blocks),
      connections: deepClone(spec.connections),
      variables: snapshot.variables || "",
      sampleTime: Number(snapshot.sampleTime) || state.sampleTime || 0.01,
      runtime: Number(snapshot.runtime) || Number(runtimeInput?.value) || 1,
    },
    { preserveSubsystemStack: true, restoreUiState: deepClone(spec.uiState || null) }
  );
  renderer.selectBlock(null);
  renderInspector(null);
  statusEl.textContent = `Opened subsystem: ${block.params?.name || "Subsystem"}`;
}

function closeSubsystemView() {
  if (!state.subsystemStack.length) return;
  const innerSnapshot = serializeDiagram(state);
  const entry = state.subsystemStack.pop();
  const innerUiState = captureUiState();
  loadDiagram(entry.parentDiagram, {
    preserveSubsystemStack: true,
    restoreUiState: deepClone(entry.parentUiState || null),
  });
  const host = state.blocks.get(entry.hostBlockId);
  if (host && host.type === "subsystem") {
    let spec;
    try {
      spec = buildSubsystemSpec(innerSnapshot, host.params?.name || "Subsystem");
    } catch (error) {
      spec = {
        name: String(host.params?.name || innerSnapshot.name || "Subsystem"),
        blocks: deepClone(innerSnapshot.blocks || []),
        connections: deepClone(innerSnapshot.connections || []),
        externalInputs: deepClone(host.params?.externalInputs || []),
        externalOutputs: deepClone(host.params?.externalOutputs || []),
      };
      statusEl.textContent =
        `Returned to parent (warning: ${error?.message || "invalid subsystem external ports"})`;
    }
    host.params.subsystem = deepClone(spec);
    host.params.subsystem.uiState = deepClone(innerUiState);
    host.params.externalInputs = deepClone(spec.externalInputs || []);
    host.params.externalOutputs = deepClone(spec.externalOutputs || []);
    if (!host.params.name) host.params.name = spec.name;
    renderer.updateBlockLabel(host);
    renderer.selectBlock(host.id);
    renderInspector(host);
    signalDiagramChanged();
  } else {
    statusEl.textContent = "Returned to parent";
  }
  updateSubsystemNavUi();
}

const listLoopCandidates = () => {
  const blocks = Array.from(state.blocks.values()).map((block) => ({
    id: block.id,
    type: block.type,
    params: block.params || {},
  }));
  const connections = state.connections.map((conn) => ({
    from: conn.from,
    to: conn.to,
    fromIndex: conn.fromIndex ?? 0,
    toIndex: conn.toIndex ?? 0,
  }));
  const traverse = (startId, adj, sumId) => {
    const visited = new Set();
    const stack = [startId];
    while (stack.length) {
      const id = stack.pop();
      if (visited.has(id)) continue;
      visited.add(id);
      (adj.get(id) || []).forEach((next) => {
        if (next === sumId) return;
        stack.push(next);
      });
    }
    return visited;
  };

  const loops = [];
  blocks.forEach((block) => {
    if (block.type !== "sum") return;
    const sumId = block.id;
    const signs = Array.isArray(block.params?.signs) ? block.params.signs : [];
    const forward = new Map();
    const backward = new Map();
    blocks.forEach((node) => {
      forward.set(node.id, []);
      backward.set(node.id, []);
    });
    connections.forEach((conn) => {
      if (!forward.has(conn.from) || !forward.has(conn.to)) return;
      if (conn.from === sumId || conn.to === sumId) return;
      forward.get(conn.from).push(conn.to);
      backward.get(conn.to).push(conn.from);
    });
    const outgoing = connections.filter((conn) => conn.from === sumId);
    const incoming = connections.filter((conn) => conn.to === sumId);
    if (!outgoing.length || !incoming.length) return;
    outgoing.forEach((outConn) => {
      const forwardReach = traverse(outConn.to, forward, sumId);
      incoming.forEach((inConn) => {
        if (!forwardReach.has(inConn.from)) return;
        const backwardReach = traverse(inConn.from, backward, sumId);
        const activeIds = new Set(
          Array.from(forwardReach).filter((id) => backwardReach.has(id))
        );
        activeIds.add(outConn.to);
        activeIds.add(inConn.from);
        activeIds.delete(sumId);
        const feedbackSign = Number(signs[inConn.toIndex ?? 0] ?? 1) || 0;
        const key = `${sumId}:${outConn.to}:${outConn.toIndex ?? 0}->${inConn.from}:${inConn.fromIndex ?? 0}`;
        loops.push({
          key,
          sumId,
          outConn,
          inConn,
          activeIds,
          feedbackSign,
        });
      });
    });
  });
  return loops;
};

const buildLoopDiagram = (loop) => {
  if (!loop) return { error: "No loop selected." };
  const blocks = Array.from(state.blocks.values()).map((block) => ({
    id: block.id,
    type: block.type,
    params: block.params || {},
  }));
  const connections = state.connections.map((conn) => ({
    from: conn.from,
    to: conn.to,
    fromIndex: conn.fromIndex ?? 0,
    toIndex: conn.toIndex ?? 0,
  }));
  const activeIds = loop.activeIds || new Set();
  const loopBlocks = blocks.filter((block) => activeIds.has(block.id));
  const loopConnections = connections.filter(
    (conn) =>
      conn.from !== loop.sumId &&
      conn.to !== loop.sumId &&
      activeIds.has(conn.from) &&
      activeIds.has(conn.to)
  );

  const loopInputId = "loop_input";
  const loopOutputId = "loop_output";
  const loopSignId = "loop_feedback_sign";
  loopBlocks.push({ id: loopInputId, type: "labelSource", params: { name: "loop_in" } });
  const loopSignGain = loop.feedbackSign === 0 ? 0 : -loop.feedbackSign;
  if (loopSignGain !== 1) {
    loopBlocks.push({ id: loopSignId, type: "gain", params: { gain: loopSignGain } });
  }
  loopBlocks.push({ id: loopOutputId, type: "labelSink", params: { name: "loop_out", showNode: true } });
  loopConnections.push({
    from: loopInputId,
    to: loop.outConn.to,
    fromIndex: 0,
    toIndex: loop.outConn.toIndex ?? 0,
  });
  if (loopSignGain !== 1) {
    loopConnections.push({
      from: loop.inConn.from,
      to: loopSignId,
      fromIndex: loop.inConn.fromIndex ?? 0,
      toIndex: 0,
    });
    loopConnections.push({
      from: loopSignId,
      to: loopOutputId,
      fromIndex: 0,
      toIndex: 0,
    });
  } else {
    loopConnections.push({
      from: loop.inConn.from,
      to: loopOutputId,
      fromIndex: loop.inConn.fromIndex ?? 0,
      toIndex: 0,
    });
  }
  return {
    diagram: {
      blocks: loopBlocks,
      connections: loopConnections,
    },
    summary: {
      sumId: loop.sumId,
      forward: loop.outConn.to,
      feedback: loop.inConn.from,
    },
  };
};

const focusPropertiesPanel = () => {
  if (!window.matchMedia("(max-width: 900px)").matches) return;
  const carousel = document.querySelector(".panel-carousel");
  const inspector = document.getElementById("inspector");
  if (!carousel || !inspector) return;
  carousel.scrollTo({ left: inspector.offsetLeft, behavior: "smooth" });
};

let renderInspector = () => {};
const renderer = createRenderer({
  svg,
  blockLayer,
  wireLayer,
  overlayLayer,
  state,
  onSelectBlock: (blockId) => {
    renderInspector(blockId);
    focusPropertiesPanel();
    updateStabilityPanel();
    updateUserFuncDebug();
  },
  onSelectConnection: (connectionId) => {
    renderInspector(connectionId);
    focusPropertiesPanel();
    updateStabilityPanel();
  },
  onOpenSubsystem: (block) => {
    openSubsystemFromBlock(block);
  },
});

renderInspector = createInspector({
  inspectorBody,
  rotateSelectionBtn,
  renderer,
  renderScope,
  signalDiagramChanged,
  onOpenSubsystem: (block) => openSubsystemFromBlock(block),
}).renderInspector;

if (inspectorBody) {
  inspectorBody.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.dataset.edit !== "expr") return;
    updateUserFuncDebug();
  });
}

const downloadFile = (name, content, { immediate = false } = {}) => {
  const blob = new Blob([content], { type: "text/plain" });
  if (window.navigator?.msSaveOrOpenBlob) {
    window.navigator.msSaveOrOpenBlob(blob, name);
    return;
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.style.display = "none";
  document.body.appendChild(link);
  const clickLink = () => {
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  if (immediate) {
    clickLink();
  } else {
    requestAnimationFrame(() => setTimeout(clickLink, 0));
  }
};

let zoomScale = 1;
let viewBox = { x: 0, y: 0, w: 0, h: 0 };

const getViewportSize = () => {
  const canvas = document.getElementById("canvas");
  if (canvas) {
    const rect = canvas.getBoundingClientRect();
    if (rect.width && rect.height) {
      return { w: rect.width, h: rect.height };
    }
  }
  return { w: svg.clientWidth || 1, h: svg.clientHeight || 1 };
};
const pointers = new Map();
let pinchStart = null;
let panStart = null;
let pendingPan = null;
let panRaf = null;
const WORLD = { w: 4000, h: 3000 };

function updateGrid(canvas, scale, viewBox) {
  if (!canvas) return;
  const gridPx = 10 * scale;
  const mod = (value, modValue) => ((value % modValue) + modValue) % modValue;
  const offsetX = -mod(viewBox.x * scale, gridPx);
  const offsetY = -mod(viewBox.y * scale, gridPx);
  canvas.style.setProperty("--grid-size", `${gridPx}px`);
  canvas.style.setProperty("--grid-offset-x", `${offsetX}px`);
  canvas.style.setProperty("--grid-offset-y", `${offsetY}px`);
}

const normalizeVarName = (name) => {
  if (!name) return "";
  const trimmed = String(name).trim();
  if (trimmed.startsWith("\\")) return trimmed.slice(1);
  return trimmed;
};

const parseVariables = (text) => {
  const vars = { pi: Math.PI, e: Math.E };
  const display = [];
  const lines = String(text || "").split(/\r?\n/);
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const idx = trimmed.indexOf("=");
    if (idx < 0) return;
    const name = trimmed.slice(0, idx).trim();
    const expr = trimmed.slice(idx + 1).trim();
    if (!name) return;
    const key = normalizeVarName(name);
    if (!key) return;
    const value = evalExpression(expr, vars);
    if (Number.isFinite(value)) {
      vars[key] = value;
      display.push(`${name}=${value}`);
    }
  });
  return { vars, display };
};



function clearWorkspace() {
  renderer.clearWorkspace();
  statusEl.textContent = "Idle";
  inspectorBody.textContent = "Select a block or wire.";
}

function sanitizeFilename(name) {
  const base = String(name || "vibesim").trim() || "vibesim";
  return base.replace(/[^a-zA-Z0-9_-]+/g, "_");
}

function serializeDiagram(state) {
  const blocks = Array.from(state.blocks.values()).map((block) => ({
    id: block.id,
    type: block.type,
    x: Math.round(block.x),
    y: Math.round(block.y),
    rotation: block.rotation || 0,
    params: block.params || {},
  }));
  const connections = state.connections.map((conn) => ({
    from: conn.from,
    to: conn.to,
    fromIndex: conn.fromIndex ?? 0,
    toIndex: conn.toIndex ?? 0,
  }));
  return {
    version: 1,
    name: state.diagramName || "vibesim",
    blocks,
    connections,
    variables: state.variablesText || "",
    sampleTime: Number(state.sampleTime) || 0.01,
    runtime: Number(runtimeInput?.value) || 0,
  };
}

function loadDiagram(data, options = {}) {
  const preserveSubsystemStack = Boolean(options?.preserveSubsystemStack);
  const restoreUiState = options?.restoreUiState && typeof options.restoreUiState === "object"
    ? options.restoreUiState
    : null;
  if (!data || typeof data !== "object") throw new Error("Invalid diagram file");
  const blocks = Array.isArray(data.blocks) ? data.blocks : [];
  const connections = Array.isArray(data.connections) ? data.connections : [];
  state.diagramName = typeof data.name === "string" && data.name.trim() ? data.name.trim() : "vibesim";
  if (diagramNameInput) diagramNameInput.value = state.diagramName;
  if (runtimeInput && Number.isFinite(Number(data.runtime))) {
    runtimeInput.value = String(Number(data.runtime));
  }
  if (simDt && Number.isFinite(Number(data.sampleTime))) {
    simDt.value = String(Number(data.sampleTime));
    const value = Number(simDt.value);
    state.sampleTime = Number.isFinite(value) && value > 0 ? value : 0.01;
  }
  state.variablesText = typeof data.variables === "string" ? data.variables : "";
  const variablesInput = document.getElementById("variablesInput");
  const variablesPreview = document.getElementById("variablesPreview");
  if (variablesInput) variablesInput.value = state.variablesText;
  const parsed = parseVariables(state.variablesText);
  state.variables = parsed.vars;
  state.variablesDisplay = parsed.display;
  if (variablesPreview) {
    const entries = state.variablesDisplay.join("\n");
    variablesPreview.textContent = entries || "No variables defined.";
  }
  if (!preserveSubsystemStack) {
    state.subsystemStack = [];
    updateSubsystemNavUi();
  }
  renderer.clearWorkspace();
  state.routingDirty = false;
  state.dirtyBlocks.clear();
  state.dirtyConnections.clear();

  blocks.forEach((block) => {
    if (!block || !block.type) return;
    renderer.createBlock(block.type, Number(block.x) || 0, Number(block.y) || 0, {
      id: block.id,
      rotation: Number(block.rotation) || 0,
      params: block.params || {},
    });
    const created = state.blocks.get(block.id);
    if (created) renderer.updateBlockLabel(created);
  });

  connections.forEach((conn) => {
    if (!conn) return;
    if (!state.blocks.has(conn.from) || !state.blocks.has(conn.to)) return;
    renderer.createConnection(conn.from, conn.to, conn.toIndex ?? 0, conn.fromIndex ?? 0);
  });

  if (restoreUiState?.routePoints && typeof restoreUiState.routePoints === "object") {
    state.connections.forEach((conn) => {
      const key = connectionKey(conn);
      const pts = restoreUiState.routePoints[key];
      if (!Array.isArray(pts) || pts.length < 2) return;
      conn.points = pts
        .map((pt) => ({ x: Number(pt?.x), y: Number(pt?.y) }))
        .filter((pt) => Number.isFinite(pt.x) && Number.isFinite(pt.y));
    });
  }

  if (restoreUiState?.scopeState && typeof restoreUiState.scopeState === "object") {
    Object.entries(restoreUiState.scopeState).forEach(([blockId, entry]) => {
      const block = state.blocks.get(blockId);
      if (!block || !entry || typeof entry !== "object") return;
      if (entry.kind === "scope" && block.type === "scope") {
        block.scopeData = deepClone(entry.data);
        renderScope(block);
      } else if (entry.kind === "xyScope" && block.type === "xyScope") {
        block.xyScopeData = deepClone(entry.data);
        renderScope(block);
      }
    });
  }

  fitToDiagram();
  if (restoreUiState?.routePoints) {
    state.fastRouting = false;
    state.routingDirty = false;
    if (state.dirtyBlocks) state.dirtyBlocks.clear();
    if (state.dirtyConnections) state.dirtyConnections.clear();
    if (renderer.renderCurrentWirePaths) renderer.renderCurrentWirePaths();
    if (typeof updateStabilityPanel === "function") updateStabilityPanel();
  } else {
    // Show blocks and simple wires immediately, then do the expensive route.
    state.fastRouting = true;
    state.routingDirty = true;
    state.dirtyConnections = new Set(state.connections);
    renderer.updateConnections(true);
    requestAnimationFrame(() => {
      setTimeout(() => {
        state.fastRouting = false;
        renderer.forceFullRoute(FORCE_FULL_ROUTE_TIME_LIMIT_MS);
        if (typeof updateStabilityPanel === "function") updateStabilityPanel();
      }, 0);
    });
  }
}

function toYAML(data) {
  const lines = [];
  const write = (value, indent) => {
    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${" ".repeat(indent)}[]`);
        return;
      }
      value.forEach((item) => {
        if (typeof item === "object" && item !== null) {
          lines.push(`${" ".repeat(indent)}-`);
          write(item, indent + 2);
        } else {
          lines.push(`${" ".repeat(indent)}- ${yamlScalar(item)}`);
        }
      });
      return;
    }
    if (typeof value === "object" && value !== null) {
      const entries = Object.entries(value);
      if (entries.length === 0) {
        lines.push(`${" ".repeat(indent)}{}`);
        return;
      }
      entries.forEach(([key, val]) => {
        if (Array.isArray(val) && val.length === 0) {
          lines.push(`${" ".repeat(indent)}${key}: []`);
          return;
        }
        if (typeof val === "object" && val !== null) {
          lines.push(`${" ".repeat(indent)}${key}:`);
          write(val, indent + 2);
        } else {
          lines.push(`${" ".repeat(indent)}${key}: ${yamlScalar(val)}`);
        }
      });
      return;
    }
    lines.push(`${" ".repeat(indent)}${yamlScalar(value)}`);
  };
  write(data, 0);
  return lines.join("\n");
}

function yamlScalar(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return JSON.stringify(value);
  const str = String(value);
  if (/^[A-Za-z0-9_.-]+$/.test(str)) return str;
  return JSON.stringify(str);
}

function parseYAML(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\t/g, "  "))
    .filter((line) => line.trim().length > 0 && !line.trim().startsWith("#"))
    .map((line) => ({
      indent: line.match(/^ */)[0].length,
      text: line.trim(),
    }));
  let index = 0;

  const parseScalar = (raw) => {
    if (raw === "null") return null;
    if (raw === "true") return true;
    if (raw === "false") return false;
    if (raw === "[]") return [];
    if (raw === "{}") return {};
    if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
    if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
      try {
        return JSON.parse(raw);
      } catch {
        return raw.slice(1, -1);
      }
    }
    return raw;
  };

  const nextNonEmpty = (start) => {
    for (let i = start; i < lines.length; i += 1) {
      if (lines[i]) return lines[i];
    }
    return null;
  };

  const parseBlock = (indentLevel) => {
    const current = lines[index];
    if (!current) return { value: null, next: index };
    if (current.text.startsWith("- ") || current.text === "-") return parseArray(indentLevel);
    return parseObject(indentLevel);
  };

  const parseArray = (indentLevel) => {
    const arr = [];
    while (index < lines.length) {
      const line = lines[index];
      if (line.indent < indentLevel || !(line.text.startsWith("- ") || line.text === "-")) break;
      const itemText = line.text === "-" ? "" : line.text.slice(2).trim();
      if (!itemText) {
        index += 1;
        const next = nextNonEmpty(index);
        if (next && next.indent > line.indent) {
          const parsed = parseBlock(line.indent + 2);
          arr.push(parsed.value);
          index = parsed.next;
        } else {
          arr.push(null);
        }
        continue;
      }
      if (itemText.includes(":")) {
        const [rawKey, ...rest] = itemText.split(":");
        const key = rawKey.trim();
        const valueRaw = rest.join(":").trim();
        const obj = {};
        if (valueRaw) {
          obj[key] = parseScalar(valueRaw);
          index += 1;
        } else {
          index += 1;
          const next = nextNonEmpty(index);
          if (next && next.indent > line.indent) {
            const parsed = parseBlock(line.indent + 2);
            obj[key] = parsed.value;
            index = parsed.next;
          } else {
            obj[key] = null;
          }
        }
        const nextLine = nextNonEmpty(index);
        if (nextLine && nextLine.indent > line.indent) {
          const parsed = parseObject(line.indent + 2);
          Object.assign(obj, parsed.value);
          index = parsed.next;
        }
        arr.push(obj);
        continue;
      }
      arr.push(parseScalar(itemText));
      index += 1;
    }
    return { value: arr, next: index };
  };

  const parseObject = (indentLevel) => {
    const obj = {};
    while (index < lines.length) {
      const line = lines[index];
      if (line.indent < indentLevel || line.text.startsWith("- ") || line.text === "-") break;
      const [rawKey, ...rest] = line.text.split(":");
      const key = rawKey.trim();
      const valueRaw = rest.join(":").trim();
      if (!valueRaw) {
        index += 1;
        const next = nextNonEmpty(index);
        if (next && next.indent > line.indent) {
          const parsed = parseBlock(line.indent + 2);
          obj[key] = parsed.value;
          index = parsed.next;
        } else {
          obj[key] = null;
        }
      } else {
        obj[key] = parseScalar(valueRaw);
        index += 1;
      }
    }
    return { value: obj, next: index };
  };

  const parsed = parseObject(0);
  return parsed.value;
}

function init() {
  updateSubsystemNavUi();
  if (subsystemUpBtn) {
    subsystemUpBtn.addEventListener("click", () => {
      closeSubsystemView();
    });
  }
  if (diagramNameInput) {
    diagramNameInput.value = state.diagramName;
    diagramNameInput.addEventListener("input", () => {
      state.diagramName = diagramNameInput.value.trim() || "vibesim";
    });
  }
  if (marginLoopSelect) {
    marginLoopSelect.addEventListener("change", () => {
      state.selectedLoopKey = marginLoopSelect.value || null;
      updateStabilityPanel();
    });
  }
  updateStabilityPanel = () => {
    if (!marginOutputText) return;
    const loops = listLoopCandidates();
    const noneValue = "none";
    if (!loops.length) {
      if (marginLoopSelect) {
        marginLoopSelect.innerHTML = "";
      }
      marginOutputText.textContent = "No loops detected.";
      if (renderer.setLoopHighlight) renderer.setLoopHighlight(null, null);
      return;
    }
    const loopKeys = new Set(loops.map((loop) => loop.key));
    let selectedKey = state.selectedLoopKey;
    if (!selectedKey || !loopKeys.has(selectedKey)) selectedKey = noneValue;
    state.selectedLoopKey = selectedKey;
    if (marginLoopSelect) {
      marginLoopSelect.innerHTML = "";
      const noneOption = document.createElement("option");
      noneOption.value = noneValue;
      noneOption.textContent = "None";
      marginLoopSelect.appendChild(noneOption);
      loops.forEach((loop) => {
        const option = document.createElement("option");
        option.value = loop.key;
        const signText = loop.feedbackSign === 1 ? "" : ` (fb ${loop.feedbackSign})`;
        option.textContent = `Sum ${loop.sumId}: ${loop.outConn.to} -> ${loop.inConn.from}${signText}`;
        marginLoopSelect.appendChild(option);
      });
      marginLoopSelect.value = selectedKey;
    }
    if (selectedKey === noneValue) {
      marginOutputText.textContent = "No loop selected.";
      if (renderer.setLoopHighlight) renderer.setLoopHighlight(null, null);
      return;
    }
    const selectedLoop = loops.find((loop) => loop.key === selectedKey) || loops[0];
    const loop = buildLoopDiagram(selectedLoop);
    if (loop.error) {
      marginOutputText.textContent = `Error: ${loop.error}`;
      if (renderer.setLoopHighlight) renderer.setLoopHighlight(null, null);
      return;
    }
    const diagram = { ...loop.diagram, variables: state.variables || {} };
    const activeBlocks = diagram.blocks.map((block) => ({
      id: block.id,
      type: block.type,
      params: block.params || {},
    }));
    if (renderer.setLoopHighlight) {
      const highlightBlocks = new Set(selectedLoop.activeIds || []);
      highlightBlocks.add(selectedLoop.sumId);
      const highlightConnections = new Set();
      state.connections.forEach((conn) => {
        const fromIdx = conn.fromIndex ?? 0;
        const toIdx = conn.toIndex ?? 0;
        if (conn.from === selectedLoop.sumId &&
            conn.to === selectedLoop.outConn.to &&
            fromIdx === (selectedLoop.outConn.fromIndex ?? 0) &&
            toIdx === (selectedLoop.outConn.toIndex ?? 0)) {
          highlightConnections.add(conn);
          return;
        }
        if (conn.to === selectedLoop.sumId &&
            conn.from === selectedLoop.inConn.from &&
            fromIdx === (selectedLoop.inConn.fromIndex ?? 0) &&
            toIdx === (selectedLoop.inConn.toIndex ?? 0)) {
          highlightConnections.add(conn);
          return;
        }
        if (
          selectedLoop.activeIds &&
          selectedLoop.activeIds.has(conn.from) &&
          selectedLoop.activeIds.has(conn.to)
        ) {
          highlightConnections.add(conn);
        }
      });
      renderer.setLoopHighlight(highlightBlocks, highlightConnections);
    }
    try {
      const frd = diagramToFRD(diagram, { input: "loop_in", output: "loop_out" });
      const [gm, pm, sm, wpc, wgc, wms] = stabilityMargins({
        diagram,
        input: "loop_in",
        output: "loop_out",
      });
      const omegaMin = frd.omega[0];
      const omegaMax = frd.omega[frd.omega.length - 1];
      const formatNumber = (value) => {
        if (!Number.isFinite(value)) return String(value);
        return value.toFixed(3);
      };
      const formatDb = (value) => {
        if (!Number.isFinite(value) || value <= 0) return "NaN";
        return formatNumber(20 * Math.log10(value));
      };
      marginOutputText.textContent =
        `omega=[${formatNumber(omegaMin)}, ${formatNumber(omegaMax)}] (${frd.omega.length} pts)\n` +
        `gm=${formatNumber(gm)} (${formatDb(gm)} dB)\n` +
        `pm=${formatNumber(pm)} deg\n` +
        `sm=${formatNumber(sm)} (${formatDb(sm)} dB)\n` +
        `wpc=${formatNumber(wpc)}\n` +
        `wgc=${formatNumber(wgc)}\n` +
        `wms=${formatNumber(wms)}`;
    } catch (err) {
      marginOutputText.textContent = `Error: ${err?.message || err}`;
    }
  };
  applyTheme(themes[0].id);
  window.addEventListener("diagramChanged", updateStabilityPanel);
  updateStabilityPanel();
  const normalizeExamplePath = (path) => {
    if (!path) return "";
    const trimmed = path.trim();
    if (!trimmed) return "";
    const withExt = /\.ya?ml$/i.test(trimmed) ? trimmed : `${trimmed}.yaml`;
    if (withExt.includes("/")) return withExt;
    return `examples/${withExt}`;
  };

  const loadExample = async (path) => {
    const normalizedPath = normalizeExamplePath(path);
    if (!normalizedPath) return;
    const resolvedPath = new URL(normalizedPath, window.location.href).toString();
    if (statusEl) statusEl.textContent = `Loading example: ${path}`;
    try {
      const response = await fetch(resolvedPath, { cache: "no-store" });
      if (!response.ok) throw new Error(`Failed to load ${normalizedPath}`);
      const text = await response.text();
      const data = parseYAML(text);
      loadDiagram(data);
      if (statusEl) statusEl.textContent = "Loaded example";
    } catch (error) {
      if (statusEl) statusEl.textContent = `Example load error: ${error?.message || error}`;
    }
  };

  const exampleFiles = [
    "examples/inverted_pendulum.yaml",
    "examples/emf.yaml",
    "examples/antiwindup.yaml",
    "examples/complementary.yaml",
  ];
  if (examplesList) {
    examplesList.innerHTML = "";
    exampleFiles.forEach((path) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "secondary";
      const fallback = path.split("/").pop()?.replace(/_/g, " ").replace(/\.ya?ml$/i, "") || path;
      button.textContent = fallback.replace(/\b\w/g, (char) => char.toUpperCase());
      fetch(path, { cache: "no-store" })
        .then((response) => (response.ok ? response.text() : null))
        .then((text) => {
          if (!text) return;
          const data = parseYAML(text);
          if (data?.name) button.textContent = String(data.name);
        })
        .catch(() => {});
      button.addEventListener("click", () => loadExample(path));
      examplesList.appendChild(button);
    });
  }
  const url = new URL(window.location.href);
  const exampleParam = url.searchParams.get("example");
  const hashExample = window.location.hash.match(/example=([^&]+)/);
  if (exampleParam) {
    loadExample(decodeURIComponent(exampleParam));
  } else if (hashExample) {
    loadExample(decodeURIComponent(hashExample[1]));
  } else {
    const urlPath = decodeURIComponent(window.location.pathname || "");
    if (/\.ya?ml$/i.test(urlPath)) {
      const cleanedPath = urlPath.replace(/^\/+/, "");
      loadExample(cleanedPath);
    }
  }
  const initViewBox = () => {
    const { w, h } = getViewportSize();
    if (viewBox.w === 0 || viewBox.h === 0) {
      zoomScale = 1.5;
      const vbW = w / zoomScale;
      const vbH = h / zoomScale;
      viewBox = {
        x: (WORLD.w - vbW) / 2,
        y: (WORLD.h - vbH) / 2,
        w: vbW,
        h: vbH,
      };
      svg.setAttribute("viewBox", `${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`);
      svg.dataset.worldWidth = String(WORLD.w);
      svg.dataset.worldHeight = String(WORLD.h);
      const canvas = document.getElementById("canvas");
      updateGrid(canvas, zoomScale, viewBox);
      return;
    }
    const center = { x: viewBox.x + viewBox.w / 2, y: viewBox.y + viewBox.h / 2 };
    viewBox = { x: center.x - (w / zoomScale) / 2, y: center.y - (h / zoomScale) / 2, w: w / zoomScale, h: h / zoomScale };
    svg.setAttribute("viewBox", `${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`);
    const canvas = document.getElementById("canvas");
    updateGrid(canvas, zoomScale, viewBox);
  };

  const updateViewBox = (scale, center = null) => {
    const { w, h } = getViewportSize();
    const currentCenter = center || { x: viewBox.x + viewBox.w / 2, y: viewBox.y + viewBox.h / 2 };
    const newW = w / scale;
    const newH = h / scale;
    viewBox = { x: currentCenter.x - newW / 2, y: currentCenter.y - newH / 2, w: newW, h: newH };
    svg.setAttribute("viewBox", `${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`);
    const canvas = document.getElementById("canvas");
    updateGrid(canvas, scale, viewBox);
  };

  const updateViewBoxWithAnchor = (scale, anchor, baseViewBox = viewBox) => {
    const { w, h } = getViewportSize();
    const newW = w / scale;
    const newH = h / scale;
    const relX = (anchor.x - baseViewBox.x) / baseViewBox.w;
    const relY = (anchor.y - baseViewBox.y) / baseViewBox.h;
    viewBox = {
      x: anchor.x - relX * newW,
      y: anchor.y - relY * newH,
      w: newW,
      h: newH,
    };
    svg.setAttribute("viewBox", `${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`);
    const canvas = document.getElementById("canvas");
    updateGrid(canvas, scale, viewBox);
  };

  fitToDiagram = () => {
    if (state.blocks.size === 0) {
      initViewBox();
      return;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    state.blocks.forEach((block) => {
      minX = Math.min(minX, block.x);
      minY = Math.min(minY, block.y);
      maxX = Math.max(maxX, block.x + block.width);
      maxY = Math.max(maxY, block.y + block.height);
    });
    const pad = 60;
    minX -= pad;
    minY -= pad;
    maxX += pad;
    maxY += pad;
    const boundsW = Math.max(1, maxX - minX);
    const boundsH = Math.max(1, maxY - minY);
    const { w, h } = getViewportSize();
    const scale = Math.max(0.1, Math.min(3, Math.min(w / boundsW, h / boundsH)));
    zoomScale = scale;
    updateViewBox(scale, { x: minX + boundsW / 2, y: minY + boundsH / 2 });
  };

  const exportSvg = async () => {
    const clone = svg.cloneNode(true);
    clone.removeAttribute("width");
    clone.removeAttribute("height");
    clone.setAttribute("viewBox", `${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`);
    const cssText = await fetch("style.css", { cache: "no-store" }).then((res) => res.text()).catch(() => "");
    if (cssText) {
      const style = document.createElement("style");
      style.textContent = cssText;
      clone.insertBefore(style, clone.firstChild);
    }
    const sanitizeMath = (root) => {
      const sizeMap = {
        "gain-math": 28,
        "constant-math": 34,
        "ss-math": 20,
        "dss-math": 20,
        "delay-math": 28,
        "pid-math": 21,
        "zoh-math": 21,
        "foh-math": 21,
        "label-math": 16,
        "tf-math": 28,
        "dtf-math": 28,
        "integrator-math": 40,
        "derivative-math": 40,
        "ddelay-math": 28,
      };
      const getSize = (node) => {
        let cur = node.parentElement;
        while (cur) {
          if (cur.classList) {
            for (const cls of cur.classList) {
              if (sizeMap[cls]) return sizeMap[cls];
            }
          }
          cur = cur.parentElement;
        }
        return 28;
      };
      root.querySelectorAll("foreignObject").forEach((fo) => {
        const tex = fo.querySelector(".mathjax-tex")?.textContent || "";
        const cleaned = tex.replace(/^\\\(|^\\\[/, "").replace(/\\\)$|\\\]$/, "");
        const x = Number(fo.getAttribute("x") || 0);
        const y = Number(fo.getAttribute("y") || 0);
        const w = Number(fo.getAttribute("width") || 0);
        const h = Number(fo.getAttribute("height") || 0);
        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("x", String(x + w / 2));
        text.setAttribute("y", String(y + h / 2));
        text.setAttribute("text-anchor", "middle");
        text.setAttribute("dominant-baseline", "middle");
        text.setAttribute("fill", "#1b1a17");
        text.setAttribute("font-size", String(getSize(fo)));
        text.textContent = cleaned;
        fo.parentNode?.insertBefore(text, fo);
        fo.remove();
      });
    };
    sanitizeMath(clone);
    return new XMLSerializer().serializeToString(clone);
  };

  const renderSvgToCanvas = async () => {
    const svgText = await exportSvg();
    const blob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const scale = 2;
        const canvas = document.createElement("canvas");
        canvas.width = viewBox.w * scale;
        canvas.height = viewBox.h * scale;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          URL.revokeObjectURL(url);
          reject(new Error("No canvas context"));
          return;
        }
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve({ canvas, width: canvas.width, height: canvas.height });
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Failed to render SVG"));
      };
      img.src = url;
    });
  };

  const downloadPdf = async (openTarget = null) => {
    try {
      statusEl.textContent = "Exporting PDF...";
      const { canvas } = await renderSvgToCanvas();
      canvas.toBlob((pngBlob) => {
        if (!pngBlob) {
          statusEl.textContent = "PDF export failed: PNG conversion failed";
          return;
        }
        const pngUrl = URL.createObjectURL(pngBlob);
        if (openTarget) {
          openTarget.location = pngUrl;
        } else {
          const link = document.createElement("a");
          link.href = pngUrl;
          link.download = "vibesim.png";
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        }
        setTimeout(() => URL.revokeObjectURL(pngUrl), 10000);
        statusEl.textContent = "Image exported";
      }, "image/png");
    } catch (error) {
      statusEl.textContent = `Export failed: ${error?.message || error}`;
    }
  };


  initViewBox();

  const variablesInput = document.getElementById("variablesInput");
  const applyVariablesBtn = document.getElementById("applyVariables");
  const variablesPreview = document.getElementById("variablesPreview");
  const updateVariables = () => {
    state.variablesText = variablesInput?.value || "";
    const parsed = parseVariables(state.variablesText);
    state.variables = parsed.vars;
    state.variablesDisplay = parsed.display;
    if (variablesPreview) {
      const entries = state.variablesDisplay.join("\n");
      variablesPreview.textContent = entries || "No variables defined.";
    }
    statusEl.textContent = "Variables updated";
    signalDiagramChanged();
  };
  if (applyVariablesBtn) applyVariablesBtn.addEventListener("click", updateVariables);
  if (variablesInput) variablesInput.addEventListener("change", updateVariables);
  updateVariables();

  renderBlockLibrary();
  if (blockLibraryGroups) {
    blockLibraryGroups.addEventListener("click", (event) => {
      const button = event.target.closest(".tool");
      if (!button) return;
      const type = button.dataset.type;
      const subsystemKey = button.dataset.subsystemKey || "";
      const offset = state.blocks.size * 20;
      const centerX = viewBox.x + viewBox.w / 2;
      const centerY = viewBox.y + viewBox.h / 2;
      try {
        const options = {};
        if (type === "subsystem" && subsystemKey) {
          const spec = state.loadedSubsystems.get(subsystemKey);
          if (!spec) throw new Error("Subsystem spec not found");
          options.params = {
            name: spec.name,
            externalInputs: deepClone(spec.externalInputs),
            externalOutputs: deepClone(spec.externalOutputs),
            subsystem: deepClone(spec),
          };
        }
        renderer.createBlock(type, centerX + offset, centerY + offset, options);
        statusEl.textContent = `Added ${type}`;
        updateStabilityPanel();
      } catch (error) {
        statusEl.textContent = `Error adding ${type}`;
        if (errorBox) {
          errorBox.textContent = `Error: ${error?.message || error}`;
          errorBox.style.display = "block";
        }
      }
    });
  }

  const handleRun = () => simulate({ state, runtimeInput, statusEl, downloadFile });
  if (simDt) {
    const updateSimDt = () => {
      const value = Number(simDt.value);
      state.sampleTime = Number.isFinite(value) && value > 0 ? value : 0.01;
    };
    updateSimDt();
    simDt.addEventListener("input", updateSimDt);
    simDt.addEventListener("change", updateSimDt);
  }
  if (runButtons.length) {
    runButtons.forEach((button) => button.addEventListener("click", handleRun));
  } else if (runBtn) {
    runBtn.addEventListener("click", handleRun);
  }

  if (codegenBtn) {
    codegenBtn.addEventListener("click", () => {
      const lang = codegenLang?.value || "c";
      const includeMain = codegenIncludeMain ? codegenIncludeMain.checked : true;
      const diagram = {
        blocks: Array.from(state.blocks.values()),
        connections: state.connections.slice(),
        variables: state.variables || {},
      };
      if (debugLog) {
        debugLog.textContent = [
          "[codegen] start",
          `lang=${lang}`,
          `includeMain=${includeMain}`,
          `sampleTime=${simDt?.value ?? 0.01}`,
          `blocks=${diagram.blocks.length} connections=${diagram.connections.length}`,
        ].join("\n");
      }
      try {
        const content = generateCode({
          lang,
          sampleTime: simDt?.value ?? 0.01,
          includeMain,
          diagram,
        });
        const baseName = sanitizeFilename(state.diagramName);
        const ext = lang === "python" ? "py" : lang === "tikz" ? "tex" : "c";
        downloadFile(`${baseName}.${ext}`, content);
        if (debugLog) debugLog.textContent += `\n[codegen] ok size=${content.length}`;
      } catch (error) {
        const message = error?.message || error;
        if (debugLog) debugLog.textContent += `\n[codegen] error: ${message}`;
        if (statusEl) statusEl.textContent = `Codegen error: ${message}`;
      }
    });
  }
  clearBtn.addEventListener("click", clearWorkspace);

  if (saveBtn) {
    saveBtn.addEventListener("click", () => {
      const yaml = toYAML(serializeDiagram(state));
      const blob = new Blob([yaml], { type: "text/yaml" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${sanitizeFilename(state.diagramName)}.yaml`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      statusEl.textContent = "Saved diagram";
    });
  }

  if (loadBtn && loadInput) {
    loadBtn.addEventListener("click", () => loadInput.click());
    loadInput.addEventListener("change", () => {
      const file = loadInput.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const text = String(reader.result || "");
          const data = parseYAML(text);
          loadDiagram(data);
          statusEl.textContent = "Loaded diagram";
        } catch (error) {
          statusEl.textContent = `Load error: ${error?.message || error}`;
        }
      };
      reader.readAsText(file);
      loadInput.value = "";
    });
  }

  if (loadSubsystemBtn && loadSubsystemInput) {
    loadSubsystemBtn.addEventListener("click", () => loadSubsystemInput.click());
    loadSubsystemInput.addEventListener("change", () => {
      const file = loadSubsystemInput.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const text = String(reader.result || "");
          const data = parseYAML(text);
          const baseName = file.name.replace(/\.(ya?ml)$/i, "") || "Subsystem";
          const spec = buildSubsystemSpec(data, baseName);
          const keyBase = sanitizeFilename(spec.name).toLowerCase() || "subsystem";
          let key = keyBase;
          let index = 2;
          while (state.loadedSubsystems.has(key)) {
            key = `${keyBase}_${index}`;
            index += 1;
          }
          state.loadedSubsystems.set(key, spec);
          renderBlockLibrary();
          statusEl.textContent = `Loaded subsystem: ${spec.name}`;
        } catch (error) {
          statusEl.textContent = `Subsystem load error: ${error?.message || error}`;
        }
      };
      reader.readAsText(file);
      loadSubsystemInput.value = "";
    });
  }

  const handleDeleteSelection = () => {
    if (state.selectedId) {
      renderer.deleteBlock(state.selectedId);
      renderer.selectBlock(null);
      renderInspector(null);
      statusEl.textContent = "Block deleted";
      updateStabilityPanel();
    } else if (state.selectedConnection) {
      renderer.deleteConnection(state.selectedConnection);
      renderer.selectConnection(null);
      renderInspector(null);
      statusEl.textContent = "Wire deleted";
      updateStabilityPanel();
    }
  };

  deleteSelectionBtn.addEventListener("click", handleDeleteSelection);
  const moveSelectedBlocks = (dx, dy) => {
    const selectedIds = state.selectedIds && state.selectedIds.size > 0 ? state.selectedIds : null;
    const ids = selectedIds && selectedIds.has(state.selectedId)
      ? Array.from(selectedIds)
      : state.selectedId
        ? [state.selectedId]
        : [];
    if (!ids.length) return false;
    ids.forEach((id) => {
      const block = state.blocks.get(id);
      if (!block) return;
      block.x = Math.max(0, block.x + dx);
      block.y = Math.max(0, block.y + dy);
      renderer.updateBlockTransform(block);
    });
    if (state.dirtyBlocks) ids.forEach((id) => state.dirtyBlocks.add(id));
    state.fastRouting = false;
    state.routingDirty = true;
    renderer.updateConnections(true);
    renderer.updateSelectionBox();
    signalDiagramChanged();
    return true;
  };

  window.addEventListener("keydown", (event) => {
    const target = event.target;
    const isEditable =
      target &&
      (target.isContentEditable ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
    if (isEditable) return;

    if (event.key === "Delete") {
      handleDeleteSelection();
      event.preventDefault();
      return;
    }

    let dx = 0;
    let dy = 0;
    if (event.key === "ArrowLeft") dx = -GRID_SIZE;
    if (event.key === "ArrowRight") dx = GRID_SIZE;
    if (event.key === "ArrowUp") dy = -GRID_SIZE;
    if (event.key === "ArrowDown") dy = GRID_SIZE;
    if (!dx && !dy) return;
    if (moveSelectedBlocks(dx, dy)) {
      event.preventDefault();
    }
  });

  rotateSelectionBtn.addEventListener("click", () => {
    if (!state.selectedId) return;
    const block = state.blocks.get(state.selectedId);
    if (!block) return;
    block.rotation = ((block.rotation || 0) + 90) % 360;
    renderer.updateBlockTransform(block);
    state.routingDirty = true;
    if (state.dirtyBlocks) state.dirtyBlocks.add(block.id);
    state.fastRouting = false;
    renderer.updateConnections(true);
  });

  const homeBtn = document.getElementById("homeBtn");
  const zoomInBtn = document.getElementById("zoomInBtn");
  const zoomOutBtn = document.getElementById("zoomOutBtn");
  const printBtn = document.getElementById("printBtn");

  if (homeBtn) homeBtn.addEventListener("click", fitToDiagram);
  if (zoomInBtn) {
    zoomInBtn.addEventListener("click", () => {
      zoomScale = Math.max(0.1, Math.min(3, zoomScale * 1.1));
      const center = { x: viewBox.x + viewBox.w / 2, y: viewBox.y + viewBox.h / 2 };
      updateViewBox(zoomScale, center);
    });
  }
  if (zoomOutBtn) {
    zoomOutBtn.addEventListener("click", () => {
      zoomScale = Math.max(0.1, Math.min(3, zoomScale / 1.1));
      const center = { x: viewBox.x + viewBox.w / 2, y: viewBox.y + viewBox.h / 2 };
      updateViewBox(zoomScale, center);
    });
  }
  if (printBtn) {
    printBtn.remove();
  }

  svg.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const baseViewBox = { ...viewBox };
      const delta = Math.sign(event.deltaY);
      const factor = delta > 0 ? 0.9 : 1.1;
      zoomScale = Math.max(0.1, Math.min(3, zoomScale * factor));
      const anchor = renderer.clientToSvg(event.clientX, event.clientY);
      updateViewBoxWithAnchor(zoomScale, anchor, baseViewBox);
    },
    { passive: false }
  );

  svg.addEventListener("pointerdown", (event) => {
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2) {
      const pts = Array.from(pointers.values());
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const center = { x: viewBox.x + viewBox.w / 2, y: viewBox.y + viewBox.h / 2 };
      pinchStart = { dist, scale: zoomScale, center };
      state.isPinching = true;
      panStart = null;
      return;
    }
    if (event.button !== 0) return;
    if (event.target.closest(".drag-handle") || event.target.closest(".port")) return;
    if (event.ctrlKey && event.target === svg) {
      renderer.startMarqueeSelection(event);
      return;
    }
    if (event.target !== svg) return;
    event.preventDefault();
    panStart = {
      clientX: event.clientX,
      clientY: event.clientY,
      viewBox: { ...viewBox },
    };
    svg.setPointerCapture(event.pointerId);
    state.isPanning = true;
  }, { passive: false });

  svg.addEventListener("pointermove", (event) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinchStart && pointers.size === 2) {
      const pts = Array.from(pointers.values());
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const scale = Math.max(0.1, Math.min(3, pinchStart.scale * (dist / pinchStart.dist)));
      zoomScale = scale;
      updateViewBox(scale, pinchStart.center);
      return;
    }
    if (panStart && !state.isPinching) {
      event.preventDefault();
      pendingPan = { clientX: event.clientX, clientY: event.clientY };
      if (!panRaf) {
        panRaf = requestAnimationFrame(() => {
          if (!panStart || !pendingPan) {
            panRaf = null;
            return;
          }
          const dxClient = panStart.clientX - pendingPan.clientX;
          const dyClient = panStart.clientY - pendingPan.clientY;
          const scaleX = viewBox.w / (svg.clientWidth || 1);
          const scaleY = viewBox.h / (svg.clientHeight || 1);
          const dx = dxClient * scaleX;
          const dy = dyClient * scaleY;
          viewBox = {
            x: panStart.viewBox.x + dx,
            y: panStart.viewBox.y + dy,
            w: panStart.viewBox.w,
            h: panStart.viewBox.h,
          };
          svg.setAttribute("viewBox", `${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`);
          updateGrid(document.getElementById("canvas"), zoomScale, viewBox);
          panRaf = null;
        });
      }
    }
  }, { passive: false });

  const endPinch = () => {
    pointers.clear();
    pinchStart = null;
    state.isPinching = false;
    panStart = null;
    state.isPanning = false;
    pendingPan = null;
    if (panRaf) cancelAnimationFrame(panRaf);
    panRaf = null;
    if (state.routingDirty) {
      renderer.updateConnections(true);
    }
  };

  svg.addEventListener("pointerup", endPinch);
  svg.addEventListener("pointercancel", endPinch);

  svg.addEventListener("click", (event) => {
    if (state.suppressNextCanvasClick) {
      state.suppressNextCanvasClick = false;
      return;
    }
    renderer.clearPending();
    renderer.selectBlock(null);
    renderer.selectConnection(null);
  });

  window.addEventListener("resize", () => {
    initViewBox();
    renderer.updateConnections(true);
  });

  const canvasEl = document.getElementById("canvas");
  if (canvasEl && "ResizeObserver" in window) {
    let resizeRaf = 0;
    let lastSize = { w: 0, h: 0 };
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      const rect = entry?.contentRect;
      const w = rect?.width || canvasEl.clientWidth || 0;
      const h = rect?.height || canvasEl.clientHeight || 0;
      if (!w || !h) return;
      if (Math.abs(w - lastSize.w) < 0.5 && Math.abs(h - lastSize.h) < 0.5) return;
      lastSize = { w, h };
      if (resizeRaf) cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(() => {
        initViewBox();
        renderer.updateConnections(true);
      });
    });
    ro.observe(canvasEl);
  }

  const collapseLibraryOnMobile = () => {
    if (!window.matchMedia("(max-width: 900px)").matches) return;
    document.querySelectorAll(".toolbox details").forEach((group) => {
      group.open = false;
    });
  };
  collapseLibraryOnMobile();

  const initMobileCarousel = () => {
    const carousel = document.querySelector(".panel-carousel");
    if (!carousel) return;
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let startScroll = 0;
    let lastX = 0;
    let lastT = 0;
    let velocityX = 0;
    let collapsed = false;
    let didDrag = false;
    let suppressClickUntil = 0;
    let totalDx = 0;
    const getViewportHeight = () => {
      const visualH = window.visualViewport?.height || 0;
      const innerH = window.innerHeight || 0;
      const docH = document.documentElement?.clientHeight || 0;
      return Math.max(visualH, innerH, docH);
    };
    const getCarouselPanels = () =>
      Array.from(
        carousel.querySelectorAll(":scope > .toolbox, :scope > .panel-card, :scope > .right-column > .panel-card")
      ).filter((panel) => panel.offsetParent !== null && panel.clientWidth > 0);

    const setCollapsed = (next) => {
      collapsed = next;
      carousel.classList.toggle("collapsed", collapsed);
      const viewportH = getViewportHeight();
      const expandedHeight = Math.max(200, Math.round(viewportH * 0.38));
      const targetHeight = collapsed ? 64 : expandedHeight;
      document.documentElement.style.setProperty("--carousel-height", `${targetHeight}px`);
      carousel.style.transition = "none";
      carousel.style.height = `${targetHeight}px`;
      carousel.style.scrollBehavior = collapsed ? "auto" : "smooth";
      carousel.offsetHeight;
      carousel.style.transition = "";
    };

    const onPointerDown = (event) => {
      if (!window.matchMedia("(max-width: 900px)").matches) return;
      if (!event.isPrimary) return;
      const point = event.touches ? event.touches[0] : event;
      if (collapsed) {
        setCollapsed(false);
      }
      dragging = true;
      didDrag = false;
      carousel.classList.add("dragging");
      startX = point.clientX;
      startY = point.clientY;
      startScroll = carousel.scrollLeft;
      lastX = startX;
      lastT = performance.now();
      velocityX = 0;
      totalDx = 0;
      try {
        carousel.setPointerCapture?.(event.pointerId);
      } catch (err) {
        // Ignore capture failures.
      }
    };

    const onPointerMove = (event) => {
      if (!dragging) return;
      const point = event.touches ? event.touches[0] : event;
      const dx = point.clientX - startX;
      const dy = point.clientY - startY;
      totalDx = dx;
      if (!didDrag && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
        didDrag = true;
      }
      const axis = Math.abs(dx) > 2 && Math.abs(dx) >= Math.abs(dy) * 0.4 ? "x" : lockAxis(dx, dy, 0.5);
      if (axis === "x") {
        event.preventDefault();
        carousel.scrollLeft = startScroll - dx * 2;
        const now = performance.now();
        const dt = Math.max(1, now - lastT);
        velocityX = (point.clientX - lastX) / dt;
        lastX = point.clientX;
        lastT = now;
      } else if (axis === "y") {
        if (!collapsed && shouldCollapse(dy, 20)) {
          setCollapsed(true);
          dragging = false;
        } else if (collapsed && shouldExpand(dy, 14)) {
          setCollapsed(false);
        }
      }
    };

    const onPointerUp = () => {
      dragging = false;
      carousel.classList.remove("dragging");
      if (didDrag) {
        suppressClickUntil = performance.now() + 300;
      }
      if (!window.matchMedia("(max-width: 900px)").matches) return;
      if (collapsed) return;
      const panels = getCarouselPanels();
      if (!panels.length) return;
      const offsets = panels.map((panel) => panel.offsetLeft).sort((a, b) => a - b);
      const current = carousel.scrollLeft;
      const nearest = getSnapOffset(current, offsets);
      const direction = velocityX < -0.4 ? 1 : velocityX > 0.4 ? -1 : totalDx < -20 ? 1 : totalDx > 20 ? -1 : 0;
      if (direction !== 0) {
        const idx = Math.max(0, Math.min(offsets.length - 1, offsets.indexOf(nearest) + direction));
        carousel.scrollTo({ left: offsets[idx], behavior: "smooth" });
        return;
      }
      carousel.scrollTo({ left: nearest, behavior: "smooth" });
    };

    const syncCarouselHeight = () => {
      if (!window.matchMedia("(max-width: 900px)").matches) return;
      setCollapsed(collapsed);
    };

    carousel.addEventListener("pointerdown", onPointerDown, { passive: false, capture: true });
    carousel.addEventListener("pointermove", onPointerMove, { passive: false, capture: true });
    carousel.addEventListener("pointerup", onPointerUp, { passive: true, capture: true });
    carousel.addEventListener("pointercancel", onPointerUp, { passive: true, capture: true });
    carousel.addEventListener("click", (event) => {
      if (!window.matchMedia("(max-width: 900px)").matches) return;
      if (performance.now() < suppressClickUntil) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (collapsed) {
        event.preventDefault();
        setCollapsed(false);
      }
    }, { capture: true });
    if (window.matchMedia("(max-width: 900px)").matches) {
      setCollapsed(true);
    }
    window.visualViewport?.addEventListener("resize", syncCarouselHeight);
    window.addEventListener("resize", syncCarouselHeight);
    window.addEventListener("orientationchange", () => syncCarouselHeight());

    // Allow native touch scrolling; avoid global touchmove suppression.

  };
  initMobileCarousel();

}

init();
