export const createInspector = ({
  inspectorBody,
  rotateSelectionBtn,
  renderer,
  renderScope,
  signalDiagramChanged,
}) => {
  const parseList = (value) =>
    value
      .split(",")
      .map((v) => v.trim())
      .filter((v) => v.length)
      .map((v) => {
        const num = Number(v);
        return Number.isFinite(num) ? num : v;
      });

  const renderInspector = (block) => {
    if (!block) {
      inspectorBody.textContent = "Select a block or wire.";
      if (rotateSelectionBtn) rotateSelectionBtn.disabled = true;
      return;
    }

    if (block.kind === "multi") {
      inspectorBody.textContent = `Selected ${block.blocks} blocks and ${block.connections} wires.`;
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

    if (block.type === "constant") {
      inspectorBody.innerHTML = `
        <label class="param">Value
          <input type="text" data-edit="value" value="${block.params.value}" step="0.1">
        </label>
      `;
      const input = inspectorBody.querySelector("input[data-edit='value']");
      input.addEventListener("input", () => {
        block.params.value = input.value;
        renderer.updateBlockLabel(block);
      });
    } else if (block.type === "step") {
      inspectorBody.innerHTML = `
        <label class="param">Step time (s)
          <input type="text" data-edit="stepTime" value="${block.params.stepTime}" step="0.1">
        </label>
      `;
      const input = inspectorBody.querySelector("input[data-edit='stepTime']");
      input.addEventListener("input", () => {
        block.params.stepTime = input.value;
        renderer.updateBlockLabel(block);
      });
    } else if (block.type === "ramp") {
      inspectorBody.innerHTML = `
        <label class="param">Slope
          <input type="text" data-edit="slope" value="${block.params.slope}" step="0.1">
        </label>
        <label class="param">Start time (s)
          <input type="text" data-edit="start" value="${block.params.start}" step="0.1">
        </label>
      `;
      const slopeInput = inspectorBody.querySelector("input[data-edit='slope']");
      const startInput = inspectorBody.querySelector("input[data-edit='start']");
      slopeInput.addEventListener("input", () => {
        block.params.slope = slopeInput.value;
        renderer.updateBlockLabel(block);
      });
      startInput.addEventListener("input", () => {
        block.params.start = startInput.value;
        renderer.updateBlockLabel(block);
      });
    } else if (block.type === "impulse") {
      inspectorBody.innerHTML = `
        <label class="param">Time (s)
          <input type="text" data-edit="time" value="${block.params.time}" step="0.1">
        </label>
        <label class="param">Amplitude
          <input type="text" data-edit="amp" value="${block.params.amp}" step="0.1">
        </label>
      `;
      const timeInput = inspectorBody.querySelector("input[data-edit='time']");
      const ampInput = inspectorBody.querySelector("input[data-edit='amp']");
      timeInput.addEventListener("input", () => {
        block.params.time = timeInput.value;
        renderer.updateBlockLabel(block);
      });
      ampInput.addEventListener("input", () => {
        block.params.amp = ampInput.value;
        renderer.updateBlockLabel(block);
      });
    } else if (block.type === "sine") {
      inspectorBody.innerHTML = `
        <label class="param">Amplitude
          <input type="text" data-edit="amp" value="${block.params.amp}" step="0.1">
        </label>
        <label class="param">Frequency (Hz)
          <input type="text" data-edit="freq" value="${block.params.freq}" step="0.1">
        </label>
        <label class="param">Phase (rad)
          <input type="text" data-edit="phase" value="${block.params.phase}" step="0.1">
        </label>
      `;
      const ampInput = inspectorBody.querySelector("input[data-edit='amp']");
      const freqInput = inspectorBody.querySelector("input[data-edit='freq']");
      const phaseInput = inspectorBody.querySelector("input[data-edit='phase']");
      ampInput.addEventListener("input", () => {
        block.params.amp = ampInput.value;
        renderer.updateBlockLabel(block);
      });
      freqInput.addEventListener("input", () => {
        block.params.freq = freqInput.value;
        renderer.updateBlockLabel(block);
      });
      phaseInput.addEventListener("input", () => {
        block.params.phase = phaseInput.value;
        renderer.updateBlockLabel(block);
      });
    } else if (block.type === "scope") {
      inspectorBody.innerHTML = `
        <label class="param">t min
          <input type="text" data-edit="tMin" value="${block.params.tMin ?? ""}">
        </label>
        <label class="param">t max
          <input type="text" data-edit="tMax" value="${block.params.tMax ?? ""}">
        </label>
        <label class="param">y min
          <input type="text" data-edit="yMin" value="${block.params.yMin ?? ""}">
        </label>
        <label class="param">y max
          <input type="text" data-edit="yMax" value="${block.params.yMax ?? ""}">
        </label>
        <label class="param">Width
          <input type="number" data-edit="width" value="${block.params.width ?? block.width}" min="160" step="10">
        </label>
        <label class="param">Height
          <input type="number" data-edit="height" value="${block.params.height ?? block.height}" min="120" step="10">
        </label>
      `;
      ["tMin", "tMax", "yMin", "yMax"].forEach((key) => {
        const input = inspectorBody.querySelector(`input[data-edit='${key}']`);
        if (!input) return;
        input.addEventListener("input", () => {
          block.params[key] = input.value;
          renderScope(block);
        });
      });
      ["width", "height"].forEach((key) => {
        const input = inspectorBody.querySelector(`input[data-edit='${key}']`);
        if (!input) return;
        input.addEventListener("change", () => {
          const widthValue = Number(inspectorBody.querySelector("[data-edit='width']")?.value);
          const heightValue = Number(inspectorBody.querySelector("[data-edit='height']")?.value);
          renderer.resizeBlock(block, widthValue, heightValue);
          input.value = key === "width" ? block.width : block.height;
        });
      });
    } else if (block.type === "chirp") {
      inspectorBody.innerHTML = `
        <label class="param">Amplitude
          <input type="text" data-edit="amp" value="${block.params.amp}" step="0.1">
        </label>
        <label class="param">Start freq (Hz)
          <input type="text" data-edit="f0" value="${block.params.f0}" step="0.1">
        </label>
        <label class="param">End freq (Hz)
          <input type="text" data-edit="f1" value="${block.params.f1}" step="0.1">
        </label>
        <label class="param">Duration (s)
          <input type="text" data-edit="t1" value="${block.params.t1}" step="0.1">
        </label>
      `;
      const ampInput = inspectorBody.querySelector("input[data-edit='amp']");
      const f0Input = inspectorBody.querySelector("input[data-edit='f0']");
      const f1Input = inspectorBody.querySelector("input[data-edit='f1']");
      const t1Input = inspectorBody.querySelector("input[data-edit='t1']");
      ampInput.addEventListener("input", () => {
        block.params.amp = ampInput.value;
        renderer.updateBlockLabel(block);
      });
      f0Input.addEventListener("input", () => {
        block.params.f0 = f0Input.value;
        renderer.updateBlockLabel(block);
      });
      f1Input.addEventListener("input", () => {
        block.params.f1 = f1Input.value;
        renderer.updateBlockLabel(block);
      });
      t1Input.addEventListener("input", () => {
        block.params.t1 = t1Input.value;
        renderer.updateBlockLabel(block);
      });
    } else if (block.type === "noise") {
      inspectorBody.innerHTML = `
        <label class="param">Amplitude
          <input type="text" data-edit="amp" value="${block.params.amp}" step="0.1">
        </label>
      `;
      const ampInput = inspectorBody.querySelector("input[data-edit='amp']");
      ampInput.addEventListener("input", () => {
        block.params.amp = ampInput.value;
        renderer.updateBlockLabel(block);
      });
    } else if (block.type === "integrator") {
      inspectorBody.innerHTML = `
        <label class="param">Initial state
          <input type="text" data-edit="initial" value="${block.params.initial ?? 0}" step="0.1">
        </label>
      `;
      const initialInput = inspectorBody.querySelector("input[data-edit='initial']");
      initialInput.addEventListener("input", () => {
        block.params.initial = initialInput.value;
      });
    } else if (block.type === "labelSource" || block.type === "labelSink") {
      inspectorBody.innerHTML = `
        <label class="param">Label name
          <input type="text" data-edit="name" value="${block.params.name || ""}">
        </label>
        ${block.type === "labelSink" ? `<label class="param"><input type="checkbox" data-edit="showNode" ${block.params.showNode !== false ? "checked" : ""}> Show node</label>` : ""}
      `;
      const nameInput = inspectorBody.querySelector("input[data-edit='name']");
      nameInput.addEventListener("input", () => {
        block.params.name = nameInput.value.trim();
        renderer.updateBlockLabel(block);
      });
      const showNodeInput = inspectorBody.querySelector("input[data-edit='showNode']");
      if (showNodeInput) {
        showNodeInput.addEventListener("change", () => {
          block.params.showNode = showNodeInput.checked;
          renderer.updateBlockLabel(block);
        });
      }
    } else if (block.type === "delay") {
      inspectorBody.innerHTML = `
        <label class="param">Delay (s)
          <input type="text" data-edit="delay" value="${block.params.delay}" step="0.1" min="0">
        </label>
      `;
      const input = inspectorBody.querySelector("input[data-edit='delay']");
      input.addEventListener("input", () => {
        block.params.delay = input.value;
        renderer.updateBlockLabel(block);
      });
    } else if (block.type === "stateSpace") {
      inspectorBody.innerHTML = `
        <label class="param">A
          <input type="text" data-edit="A" value="${block.params.A}" step="0.1">
        </label>
        <label class="param">B
          <input type="text" data-edit="B" value="${block.params.B}" step="0.1">
        </label>
        <label class="param">C
          <input type="text" data-edit="C" value="${block.params.C}" step="0.1">
        </label>
        <label class="param">D
          <input type="text" data-edit="D" value="${block.params.D}" step="0.1">
        </label>
      `;
      const aInput = inspectorBody.querySelector("input[data-edit='A']");
      const bInput = inspectorBody.querySelector("input[data-edit='B']");
      const cInput = inspectorBody.querySelector("input[data-edit='C']");
      const dInput = inspectorBody.querySelector("input[data-edit='D']");
      const update = () => {
        block.params.A = aInput.value;
        block.params.B = bInput.value;
        block.params.C = cInput.value;
        block.params.D = dInput.value;
      };
      [aInput, bInput, cInput, dInput].forEach((input) => {
        input.addEventListener("input", update);
      });
    } else if (block.type === "fileSource") {
      inspectorBody.innerHTML = `
        <label class="param">File path
          <input type="text" data-edit="path" value="${block.params.path}">
        </label>
        <label class="param">CSV file
          <input type="file" data-edit="file" accept=".csv,text/csv">
        </label>
        <div class="param">${block.params.loaded ? "Loaded CSV" : "No CSV loaded"}</div>
      `;
      const pathInput = inspectorBody.querySelector("input[data-edit='path']");
      const fileInput = inspectorBody.querySelector("input[data-edit='file']");
      pathInput.addEventListener("input", () => {
        block.params.path = pathInput.value;
        renderer.updateBlockLabel(block);
      });
      fileInput.addEventListener("change", () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          const text = String(reader.result || "");
          const rows = text
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => line.length > 0);
          const times = [];
          const values = [];
          rows.forEach((line, idx) => {
            const cols = line
              .split(/[,\t]/)
              .map((v) => v.trim())
              .filter((v) => v.length > 0);
            const nums = cols.map((v) => Number(v)).filter((v) => Number.isFinite(v));
            if (nums.length === 0) return;
            if (nums.length >= 2) {
              times.push(nums[0]);
              values.push(nums[1]);
            } else {
              times.push(idx);
              values.push(nums[0]);
            }
          });
          const pairs = times.map((t, i) => ({ t, v: values[i] }));
          pairs.sort((a, b) => a.t - b.t);
          block.params.times = pairs.map((p) => p.t);
          block.params.values = pairs.map((p) => p.v);
          block.params.loaded = pairs.length > 0;
          renderer.updateBlockLabel(block);
          renderInspector(block);
        };
        reader.readAsText(file);
      });
    } else if (block.type === "gain") {
      inspectorBody.innerHTML = `
        <label class="param">Gain
          <input type="text" data-edit="gain" value="${block.params.gain}" step="0.1">
        </label>
      `;
      const input = inspectorBody.querySelector("input[data-edit='gain']");
      input.addEventListener("input", () => {
        block.params.gain = input.value;
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
      ["sign0", "sign1", "sign2"].forEach((key, idx) => {
        const select = inspectorBody.querySelector(`select[data-edit='${key}']`);
        if (!select) return;
        select.value = String(signs[idx] ?? 1);
        select.addEventListener("change", () => {
          block.params.signs = [
            Number(inspectorBody.querySelector("select[data-edit='sign0']")?.value) || 1,
            Number(inspectorBody.querySelector("select[data-edit='sign1']")?.value) || 1,
            Number(inspectorBody.querySelector("select[data-edit='sign2']")?.value) || 1,
          ];
          renderer.updateBlockLabel(block);
          signalDiagramChanged();
        });
      });
    } else if (block.type === "mult") {
      inspectorBody.innerHTML = `<div class="param">Multiply inputs</div>`;
    } else if (block.type === "saturation") {
      inspectorBody.innerHTML = `
        <label class="param">Min
          <input type="text" data-edit="min" value="${block.params.min}">
        </label>
        <label class="param">Max
          <input type="text" data-edit="max" value="${block.params.max}">
        </label>
      `;
      const minInput = inspectorBody.querySelector("input[data-edit='min']");
      const maxInput = inspectorBody.querySelector("input[data-edit='max']");
      const update = () => {
        block.params.min = minInput.value;
        block.params.max = maxInput.value;
        renderer.updateBlockLabel(block);
      };
      minInput.addEventListener("input", update);
      maxInput.addEventListener("input", update);
    } else if (block.type === "rate") {
      inspectorBody.innerHTML = `
        <label class="param">Max rise
          <input type="text" data-edit="rise" value="${block.params.rise}">
        </label>
        <label class="param">Max fall
          <input type="text" data-edit="fall" value="${block.params.fall}">
        </label>
      `;
      const riseInput = inspectorBody.querySelector("input[data-edit='rise']");
      const fallInput = inspectorBody.querySelector("input[data-edit='fall']");
      riseInput.addEventListener("input", () => {
        block.params.rise = riseInput.value;
        renderer.updateBlockLabel(block);
      });
      fallInput.addEventListener("input", () => {
        block.params.fall = fallInput.value;
        renderer.updateBlockLabel(block);
      });
    } else if (block.type === "backlash") {
      inspectorBody.innerHTML = `
        <label class="param">Width
          <input type="text" data-edit="width" value="${block.params.width}">
        </label>
      `;
      const widthInput = inspectorBody.querySelector("input[data-edit='width']");
      widthInput.addEventListener("input", () => {
        block.params.width = widthInput.value;
        renderer.updateBlockLabel(block);
      });
    } else if (block.type === "tf") {
      inspectorBody.innerHTML = `
        <label class="param">Numerator (comma separated)
          <input type="text" data-edit="num" value="${(block.params.num || []).join(", ")}">
        </label>
        <label class="param">Denominator (comma separated)
          <input type="text" data-edit="den" value="${(block.params.den || []).join(", ")}">
        </label>
      `;
      const numInput = inspectorBody.querySelector("input[data-edit='num']");
      const denInput = inspectorBody.querySelector("input[data-edit='den']");
      numInput.addEventListener("input", () => {
        block.params.num = parseList(numInput.value);
        renderer.updateBlockLabel(block);
        signalDiagramChanged();
      });
      denInput.addEventListener("input", () => {
        block.params.den = parseList(denInput.value);
        renderer.updateBlockLabel(block);
        signalDiagramChanged();
      });
    } else if (block.type === "dtf") {
      inspectorBody.innerHTML = `
        <label class="param">Numerator (comma separated)
          <input type="text" data-edit="num" value="${(block.params.num || []).join(", ")}">
        </label>
        <label class="param">Denominator (comma separated)
          <input type="text" data-edit="den" value="${(block.params.den || []).join(", ")}">
        </label>
        <label class="param">Sample time (s)
          <input type="text" data-edit="ts" value="${block.params.ts ?? ""}">
        </label>
      `;
      const numInput = inspectorBody.querySelector("input[data-edit='num']");
      const denInput = inspectorBody.querySelector("input[data-edit='den']");
      const tsInput = inspectorBody.querySelector("input[data-edit='ts']");
      const update = () => {
        block.params.num = parseList(numInput.value);
        block.params.den = parseList(denInput.value);
        block.params.ts = tsInput.value;
        renderer.updateBlockLabel(block);
        signalDiagramChanged();
      };
      numInput.addEventListener("input", update);
      denInput.addEventListener("input", update);
      tsInput.addEventListener("input", update);
    } else if (block.type === "ddelay") {
      inspectorBody.innerHTML = `
        <label class="param">Steps
          <input type="text" data-edit="steps" value="${block.params.steps ?? ""}">
        </label>
        <label class="param">Sample time (s)
          <input type="text" data-edit="ts" value="${block.params.ts ?? ""}">
        </label>
      `;
      const stepsInput = inspectorBody.querySelector("input[data-edit='steps']");
      const tsInput = inspectorBody.querySelector("input[data-edit='ts']");
      const update = () => {
        block.params.steps = stepsInput.value;
        block.params.ts = tsInput.value;
        renderer.updateBlockLabel(block);
        signalDiagramChanged();
      };
      stepsInput.addEventListener("input", update);
      tsInput.addEventListener("input", update);
    } else if (block.type === "zoh" || block.type === "foh") {
      inspectorBody.innerHTML = `
        <label class="param">Sample time (s)
          <input type="text" data-edit="ts" value="${block.params.ts ?? ""}">
        </label>
      `;
      const tsInput = inspectorBody.querySelector("input[data-edit='ts']");
      tsInput.addEventListener("input", () => {
        block.params.ts = tsInput.value;
        renderer.updateBlockLabel(block);
        signalDiagramChanged();
      });
    } else if (block.type === "dstateSpace") {
      inspectorBody.innerHTML = `
        <label class="param">A
          <input type="text" data-edit="A" value="${block.params.A}" step="0.1">
        </label>
        <label class="param">B
          <input type="text" data-edit="B" value="${block.params.B}" step="0.1">
        </label>
        <label class="param">C
          <input type="text" data-edit="C" value="${block.params.C}" step="0.1">
        </label>
        <label class="param">D
          <input type="text" data-edit="D" value="${block.params.D}" step="0.1">
        </label>
        <label class="param">Sample time (s)
          <input type="text" data-edit="ts" value="${block.params.ts ?? ""}">
        </label>
      `;
      const aInput = inspectorBody.querySelector("input[data-edit='A']");
      const bInput = inspectorBody.querySelector("input[data-edit='B']");
      const cInput = inspectorBody.querySelector("input[data-edit='C']");
      const dInput = inspectorBody.querySelector("input[data-edit='D']");
      const tsInput = inspectorBody.querySelector("input[data-edit='ts']");
      const update = () => {
        block.params.A = aInput.value;
        block.params.B = bInput.value;
        block.params.C = cInput.value;
        block.params.D = dInput.value;
        block.params.ts = tsInput.value;
      };
      [aInput, bInput, cInput, dInput, tsInput].forEach((input) => {
        input.addEventListener("input", update);
      });
    } else if (block.type === "lpf" || block.type === "hpf") {
      inspectorBody.innerHTML = `
        <label class="param">Cutoff (Hz)
          <input type="text" data-edit="cutoff" value="${block.params.cutoff}" step="0.1">
        </label>
      `;
      const input = inspectorBody.querySelector("input[data-edit='cutoff']");
      input.addEventListener("input", () => {
        block.params.cutoff = input.value;
        renderer.updateBlockLabel(block);
      });
    } else if (block.type === "derivative") {
      inspectorBody.innerHTML = `<div class="param">d/dt</div>`;
    } else if (block.type === "pid") {
      inspectorBody.innerHTML = `
        <label class="param">Kp
          <input type="text" data-edit="kp" value="${block.params.kp}" step="0.1">
        </label>
        <label class="param">Ki
          <input type="text" data-edit="ki" value="${block.params.ki}" step="0.1">
        </label>
        <label class="param">Kd
          <input type="text" data-edit="kd" value="${block.params.kd}" step="0.1">
        </label>
      `;
      const kpInput = inspectorBody.querySelector("input[data-edit='kp']");
      const kiInput = inspectorBody.querySelector("input[data-edit='ki']");
      const kdInput = inspectorBody.querySelector("input[data-edit='kd']");
      const update = () => {
        block.params.kp = kpInput.value;
        block.params.ki = kiInput.value;
        block.params.kd = kdInput.value;
        renderer.updateBlockLabel(block);
      };
      kpInput.addEventListener("input", update);
      kiInput.addEventListener("input", update);
      kdInput.addEventListener("input", update);
    } else if (block.type === "fileSink") {
      inspectorBody.innerHTML = `
        <label class="param">File path
          <input type="text" data-edit="path" value="${block.params.path}">
        </label>
      `;
      const input = inspectorBody.querySelector("input[data-edit='path']");
      input.addEventListener("input", () => {
        block.params.path = input.value;
        renderer.updateBlockLabel(block);
      });
    } else {
      inspectorBody.textContent = `Selected ${block.type}`;
    }
  };

  return { renderInspector };
};
