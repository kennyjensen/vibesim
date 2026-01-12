import { createRenderer } from "./render.js";
import { simulate } from "./sim.js";

const svg = document.getElementById("svgCanvas");
const blockLayer = document.getElementById("blockLayer");
const wireLayer = document.getElementById("wireLayer");
const overlayLayer = document.getElementById("overlayLayer");
const runBtn = document.getElementById("runBtn");
const fullRouteBtn = document.getElementById("fullRouteBtn");
const clearBtn = document.getElementById("clearBtn");
const statusEl = document.getElementById("status");
const runtimeInput = document.getElementById("runtimeInput");
const inspectorBody = document.getElementById("inspectorBody");
const deleteSelectionBtn = document.getElementById("deleteSelection");
const rotateSelectionBtn = document.getElementById("rotateSelection");

if (rotateSelectionBtn) rotateSelectionBtn.disabled = true;

const state = {
  blocks: new Map(),
  connections: [],
  pendingPort: null,
  nextId: 1,
  selectedId: null,
  selectedConnection: null,
  deleteMode: false,
  isPinching: false,
  isPanning: false,
  routingDirty: false,
  routingScheduled: false,
  dirtyBlocks: new Set(),
  dirtyConnections: new Set(),
};

const renderer = createRenderer({
  svg,
  blockLayer,
  wireLayer,
  overlayLayer,
  state,
  onSelectBlock: renderInspector,
  onSelectConnection: renderInspector,
});

if (fullRouteBtn) {
  fullRouteBtn.addEventListener("click", () => {
    renderer.forceFullRoute(2000);
  });
}

let zoomScale = 1;
let viewBox = { x: 0, y: 0, w: 0, h: 0 };
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

function renderInspector(block) {
  if (!block) {
    inspectorBody.textContent = "Select a block or wire.";
    if (rotateSelectionBtn) rotateSelectionBtn.disabled = true;
    return;
  }

  if (block.kind === "connection") {
    inspectorBody.innerHTML = `
      <div class="param">Wire</div>
      <div class="param">From: ${block.fromType} (${block.fromId})</div>
      <div class="param">To: ${block.toType} (${block.toId}) input ${block.toIndex + 1}</div>
    `;
    if (rotateSelectionBtn) rotateSelectionBtn.disabled = true;
    return;
  }
  if (rotateSelectionBtn) rotateSelectionBtn.disabled = false;

  const parseList = (value) =>
    value
      .split(",")
      .map((v) => Number(v.trim()))
      .filter((v) => Number.isFinite(v));

  if (block.type === "constant") {
    inspectorBody.innerHTML = `
      <label class="param">Value
        <input type="number" data-edit="value" value="${block.params.value}" step="0.1">
      </label>
    `;
    const input = inspectorBody.querySelector("input[data-edit='value']");
    input.addEventListener("input", () => {
      block.params.value = Number(input.value);
      renderer.updateBlockLabel(block);
    });
  } else if (block.type === "step") {
    inspectorBody.innerHTML = `
      <label class="param">Step time (s)
        <input type="number" data-edit="stepTime" value="${block.params.stepTime}" step="0.1">
      </label>
    `;
    const input = inspectorBody.querySelector("input[data-edit='stepTime']");
    input.addEventListener("input", () => {
      block.params.stepTime = Number(input.value);
      renderer.updateBlockLabel(block);
    });
  } else if (block.type === "ramp") {
    inspectorBody.innerHTML = `
      <label class="param">Slope
        <input type="number" data-edit="slope" value="${block.params.slope}" step="0.1">
      </label>
      <label class="param">Start time (s)
        <input type="number" data-edit="start" value="${block.params.start}" step="0.1">
      </label>
    `;
    const slopeInput = inspectorBody.querySelector("input[data-edit='slope']");
    const startInput = inspectorBody.querySelector("input[data-edit='start']");
    slopeInput.addEventListener("input", () => {
      block.params.slope = Number(slopeInput.value);
      renderer.updateBlockLabel(block);
    });
    startInput.addEventListener("input", () => {
      block.params.start = Number(startInput.value);
      renderer.updateBlockLabel(block);
    });
  } else if (block.type === "impulse") {
    inspectorBody.innerHTML = `
      <label class="param">Time (s)
        <input type="number" data-edit="time" value="${block.params.time}" step="0.1">
      </label>
      <label class="param">Amplitude
        <input type="number" data-edit="amp" value="${block.params.amp}" step="0.1">
      </label>
    `;
    const timeInput = inspectorBody.querySelector("input[data-edit='time']");
    const ampInput = inspectorBody.querySelector("input[data-edit='amp']");
    timeInput.addEventListener("input", () => {
      block.params.time = Number(timeInput.value);
      renderer.updateBlockLabel(block);
    });
    ampInput.addEventListener("input", () => {
      block.params.amp = Number(ampInput.value);
      renderer.updateBlockLabel(block);
    });
  } else if (block.type === "sine") {
    inspectorBody.innerHTML = `
      <label class="param">Amplitude
        <input type="number" data-edit="amp" value="${block.params.amp}" step="0.1">
      </label>
      <label class="param">Frequency (Hz)
        <input type="number" data-edit="freq" value="${block.params.freq}" step="0.1">
      </label>
      <label class="param">Phase (rad)
        <input type="number" data-edit="phase" value="${block.params.phase}" step="0.1">
      </label>
    `;
    const ampInput = inspectorBody.querySelector("input[data-edit='amp']");
    const freqInput = inspectorBody.querySelector("input[data-edit='freq']");
    const phaseInput = inspectorBody.querySelector("input[data-edit='phase']");
    ampInput.addEventListener("input", () => {
      block.params.amp = Number(ampInput.value);
      renderer.updateBlockLabel(block);
    });
    freqInput.addEventListener("input", () => {
      block.params.freq = Number(freqInput.value);
      renderer.updateBlockLabel(block);
    });
    phaseInput.addEventListener("input", () => {
      block.params.phase = Number(phaseInput.value);
      renderer.updateBlockLabel(block);
    });
  } else if (block.type === "chirp") {
    inspectorBody.innerHTML = `
      <label class="param">Amplitude
        <input type="number" data-edit="amp" value="${block.params.amp}" step="0.1">
      </label>
      <label class="param">Start freq (Hz)
        <input type="number" data-edit="f0" value="${block.params.f0}" step="0.1">
      </label>
      <label class="param">End freq (Hz)
        <input type="number" data-edit="f1" value="${block.params.f1}" step="0.1">
      </label>
      <label class="param">Duration (s)
        <input type="number" data-edit="t1" value="${block.params.t1}" step="0.1">
      </label>
    `;
    const ampInput = inspectorBody.querySelector("input[data-edit='amp']");
    const f0Input = inspectorBody.querySelector("input[data-edit='f0']");
    const f1Input = inspectorBody.querySelector("input[data-edit='f1']");
    const t1Input = inspectorBody.querySelector("input[data-edit='t1']");
    ampInput.addEventListener("input", () => {
      block.params.amp = Number(ampInput.value);
      renderer.updateBlockLabel(block);
    });
    f0Input.addEventListener("input", () => {
      block.params.f0 = Number(f0Input.value);
      renderer.updateBlockLabel(block);
    });
    f1Input.addEventListener("input", () => {
      block.params.f1 = Number(f1Input.value);
      renderer.updateBlockLabel(block);
    });
    t1Input.addEventListener("input", () => {
      block.params.t1 = Number(t1Input.value);
      renderer.updateBlockLabel(block);
    });
  } else if (block.type === "noise") {
    inspectorBody.innerHTML = `
      <label class="param">Amplitude
        <input type="number" data-edit="amp" value="${block.params.amp}" step="0.1">
      </label>
    `;
    const ampInput = inspectorBody.querySelector("input[data-edit='amp']");
    ampInput.addEventListener("input", () => {
      block.params.amp = Number(ampInput.value);
      renderer.updateBlockLabel(block);
    });
  } else if (block.type === "fileSource") {
    inspectorBody.innerHTML = `
      <label class="param">File path
        <input type="text" data-edit="path" value="${block.params.path}">
      </label>
    `;
    const pathInput = inspectorBody.querySelector("input[data-edit='path']");
    pathInput.addEventListener("input", () => {
      block.params.path = pathInput.value;
      renderer.updateBlockLabel(block);
    });
  } else if (block.type === "gain") {
    inspectorBody.innerHTML = `
      <label class="param">Gain
        <input type="number" data-edit="gain" value="${block.params.gain}" step="0.1">
      </label>
    `;
    const input = inspectorBody.querySelector("input[data-edit='gain']");
    input.addEventListener("input", () => {
      block.params.gain = Number(input.value);
      renderer.updateBlockLabel(block);
    });
  } else if (block.type === "sum") {
    const signs = block.params.signs || [1, 1, 1];
    inspectorBody.innerHTML = `
      <label class="param">Input 1 sign
        <select data-edit="sign0">
          <option value="1">+</option>
          <option value="-1">-</option>
        </select>
      </label>
      <label class="param">Input 2 sign
        <select data-edit="sign1">
          <option value="1">+</option>
          <option value="-1">-</option>
        </select>
      </label>
      <label class="param">Input 3 sign
        <select data-edit="sign2">
          <option value="1">+</option>
          <option value="-1">-</option>
        </select>
      </label>
    `;
    const signInputs = [
      inspectorBody.querySelector("select[data-edit='sign0']"),
      inspectorBody.querySelector("select[data-edit='sign1']"),
      inspectorBody.querySelector("select[data-edit='sign2']"),
    ];
    signInputs.forEach((select, idx) => {
      if (!select) return;
      select.value = String(signs[idx] ?? 1);
      select.addEventListener("change", () => {
        if (!block.params.signs) block.params.signs = [1, 1, 1];
        block.params.signs[idx] = Number(select.value);
        renderer.updateBlockLabel(block);
      });
    });
  } else if (block.type === "lpf" || block.type === "hpf") {
    inspectorBody.innerHTML = `
      <label class="param">Cutoff (Hz)
        <input type="number" data-edit="cutoff" value="${block.params.cutoff}" step="0.1">
      </label>
    `;
    const input = inspectorBody.querySelector("input[data-edit='cutoff']");
    input.addEventListener("input", () => {
      block.params.cutoff = Number(input.value);
      renderer.updateBlockLabel(block);
    });
  } else if (block.type === "pid") {
    inspectorBody.innerHTML = `
      <label class="param">Kp
        <input type="number" data-edit="kp" value="${block.params.kp}" step="0.1">
      </label>
      <label class="param">Ki
        <input type="number" data-edit="ki" value="${block.params.ki}" step="0.1">
      </label>
      <label class="param">Kd
        <input type="number" data-edit="kd" value="${block.params.kd}" step="0.1">
      </label>
    `;
    const kpInput = inspectorBody.querySelector("input[data-edit='kp']");
    const kiInput = inspectorBody.querySelector("input[data-edit='ki']");
    const kdInput = inspectorBody.querySelector("input[data-edit='kd']");
    kpInput.addEventListener("input", () => {
      block.params.kp = Number(kpInput.value);
      renderer.updateBlockLabel(block);
    });
    kiInput.addEventListener("input", () => {
      block.params.ki = Number(kiInput.value);
      renderer.updateBlockLabel(block);
    });
    kdInput.addEventListener("input", () => {
      block.params.kd = Number(kdInput.value);
      renderer.updateBlockLabel(block);
    });
  } else if (block.type === "saturation") {
    inspectorBody.innerHTML = `
      <label class="param">Min
        <input type="number" data-edit="min" value="${block.params.min}" step="0.1">
      </label>
      <label class="param">Max
        <input type="number" data-edit="max" value="${block.params.max}" step="0.1">
      </label>
    `;
    const minInput = inspectorBody.querySelector("input[data-edit='min']");
    const maxInput = inspectorBody.querySelector("input[data-edit='max']");
    minInput.addEventListener("input", () => {
      block.params.min = Number(minInput.value);
      renderer.updateBlockLabel(block);
    });
    maxInput.addEventListener("input", () => {
      block.params.max = Number(maxInput.value);
      renderer.updateBlockLabel(block);
    });
  } else if (block.type === "rate") {
    inspectorBody.innerHTML = `
      <label class="param">Rise limit
        <input type="number" data-edit="rise" value="${block.params.rise}" step="0.1">
      </label>
      <label class="param">Fall limit
        <input type="number" data-edit="fall" value="${block.params.fall}" step="0.1">
      </label>
    `;
    const riseInput = inspectorBody.querySelector("input[data-edit='rise']");
    const fallInput = inspectorBody.querySelector("input[data-edit='fall']");
    riseInput.addEventListener("input", () => {
      block.params.rise = Number(riseInput.value);
      renderer.updateBlockLabel(block);
    });
    fallInput.addEventListener("input", () => {
      block.params.fall = Number(fallInput.value);
      renderer.updateBlockLabel(block);
    });
  } else if (block.type === "backlash") {
    inspectorBody.innerHTML = `
      <label class="param">Width
        <input type="number" data-edit="width" value="${block.params.width}" step="0.1">
      </label>
    `;
    const input = inspectorBody.querySelector("input[data-edit='width']");
    input.addEventListener("input", () => {
      block.params.width = Number(input.value);
      renderer.updateBlockLabel(block);
    });
  } else if (block.type === "tf") {
    inspectorBody.innerHTML = `
      <label class="param">Num (comma separated)
        <input type="text" data-edit="num" value="${block.params.num.join(",")}">
      </label>
      <label class="param">Den (comma separated)
        <input type="text" data-edit="den" value="${block.params.den.join(",")}">
      </label>
    `;
    const numInput = inspectorBody.querySelector("input[data-edit='num']");
    const denInput = inspectorBody.querySelector("input[data-edit='den']");
    numInput.addEventListener("input", () => {
      block.params.num = parseList(numInput.value);
      renderer.updateBlockLabel(block);
    });
    denInput.addEventListener("input", () => {
      block.params.den = parseList(denInput.value);
      renderer.updateBlockLabel(block);
    });
  } else if (block.type === "zoh" || block.type === "foh") {
    inspectorBody.innerHTML = `
      <label class="param">Sample time (s)
        <input type="number" data-edit="ts" value="${block.params.ts}" step="0.01">
      </label>
    `;
    const input = inspectorBody.querySelector("input[data-edit='ts']");
    input.addEventListener("input", () => {
      block.params.ts = Number(input.value);
      renderer.updateBlockLabel(block);
    });
  } else if (block.type === "dtf") {
    inspectorBody.innerHTML = `
      <label class="param">Num (comma separated)
        <input type="text" data-edit="num" value="${block.params.num.join(",")}">
      </label>
      <label class="param">Den (comma separated)
        <input type="text" data-edit="den" value="${block.params.den.join(",")}">
      </label>
      <label class="param">Sample time (s)
        <input type="number" data-edit="ts" value="${block.params.ts}" step="0.01">
      </label>
    `;
    const numInput = inspectorBody.querySelector("input[data-edit='num']");
    const denInput = inspectorBody.querySelector("input[data-edit='den']");
    const tsInput = inspectorBody.querySelector("input[data-edit='ts']");
    numInput.addEventListener("input", () => {
      block.params.num = parseList(numInput.value);
      renderer.updateBlockLabel(block);
    });
    denInput.addEventListener("input", () => {
      block.params.den = parseList(denInput.value);
      renderer.updateBlockLabel(block);
    });
    tsInput.addEventListener("input", () => {
      block.params.ts = Number(tsInput.value);
      renderer.updateBlockLabel(block);
    });
  } else if (block.type === "fileSink") {
    inspectorBody.innerHTML = `
      <label class="param">File path
        <input type="text" data-edit="path" value="${block.params.path}">
      </label>
    `;
    const pathInput = inspectorBody.querySelector("input[data-edit='path']");
    pathInput.addEventListener("input", () => {
      block.params.path = pathInput.value;
      renderer.updateBlockLabel(block);
    });
  } else {
    inspectorBody.textContent = "No editable parameters for this block.";
  }
}

function clearWorkspace() {
  renderer.clearWorkspace();
  statusEl.textContent = "Idle";
  inspectorBody.textContent = "Select a block or wire.";
}

function init() {
  const initViewBox = () => {
    const w = svg.clientWidth || 1;
    const h = svg.clientHeight || 1;
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
    const w = svg.clientWidth || 1;
    const h = svg.clientHeight || 1;
    const currentCenter = center || { x: viewBox.x + viewBox.w / 2, y: viewBox.y + viewBox.h / 2 };
    const newW = w / scale;
    const newH = h / scale;
    viewBox = { x: currentCenter.x - newW / 2, y: currentCenter.y - newH / 2, w: newW, h: newH };
    svg.setAttribute("viewBox", `${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`);
    const canvas = document.getElementById("canvas");
    updateGrid(canvas, scale, viewBox);
  };

  initViewBox();

  document.querySelectorAll(".tool").forEach((button) => {
    button.addEventListener("click", () => {
      const type = button.dataset.type;
      const offset = state.blocks.size * 20;
      const centerX = viewBox.x + viewBox.w / 2;
      const centerY = viewBox.y + viewBox.h / 2;
      try {
        renderer.createBlock(type, centerX + offset, centerY + offset);
        statusEl.textContent = `Added ${type}`;
      } catch (error) {
        statusEl.textContent = `Error adding ${type}`;
        errorBox.textContent = `Error: ${error?.message || error}`;
        errorBox.style.display = "block";
      }
    });
  });

  runBtn.addEventListener("click", () => simulate({ state, runtimeInput, statusEl }));
  clearBtn.addEventListener("click", clearWorkspace);

  deleteSelectionBtn.addEventListener("click", () => {
    if (state.selectedId) {
      renderer.deleteBlock(state.selectedId);
      renderer.selectBlock(null);
      renderInspector(null);
      statusEl.textContent = "Block deleted";
    } else if (state.selectedConnection) {
      renderer.deleteConnection(state.selectedConnection);
      renderer.selectConnection(null);
      renderInspector(null);
      statusEl.textContent = "Wire deleted";
    }
  });

  rotateSelectionBtn.addEventListener("click", () => {
    if (!state.selectedId) return;
    const block = state.blocks.get(state.selectedId);
    if (!block) return;
    block.rotation = ((block.rotation || 0) + 90) % 360;
    renderer.updateBlockTransform(block);
    renderer.updateConnections(true);
  });

  svg.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const delta = Math.sign(event.deltaY);
      const factor = delta > 0 ? 0.9 : 1.1;
      zoomScale = Math.max(0.1, Math.min(3, zoomScale * factor));
      const center = renderer.clientToSvg(event.clientX, event.clientY);
      updateViewBox(zoomScale, center);
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
  };

  svg.addEventListener("pointerup", endPinch);
  svg.addEventListener("pointercancel", endPinch);

  svg.addEventListener("click", (event) => {
    renderer.clearPending();
    renderer.selectBlock(null);
    renderer.selectConnection(null);
  });

  window.addEventListener("resize", () => {
    initViewBox();
    renderer.updateConnections(true);
  });

  const versionEl = document.querySelector(".version");
  if (versionEl) {
    fetch("dev-version.txt", { cache: "no-store" })
      .then((res) => res.text())
      .then((text) => {
        const counter = text.trim();
        if (counter) versionEl.textContent = `v0.1.${counter}`;
      })
      .catch(() => {});
  }
}

init();
