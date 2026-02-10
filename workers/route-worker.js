import { GRID_SIZE, snap } from "../geometry.js";
import { routeAllConnections } from "../router.js";

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

function getPortSide(block, rotatedPoint) {
  const center = { x: block.x + block.width / 2, y: block.y + block.height / 2 };
  const dx = rotatedPoint.x - center.x;
  const dy = rotatedPoint.y - center.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? "left" : "right";
  return dy < 0 ? "top" : "bottom";
}

function sideToDir(side) {
  if (side === "left") return "left";
  if (side === "right") return "right";
  if (side === "top") return "up";
  return "down";
}

function buildRouteInput(snapshot) {
  const blocks = Array.isArray(snapshot?.blocks) ? snapshot.blocks : [];
  const rawConnections = Array.isArray(snapshot?.connections) ? snapshot.connections : [];
  const blockMap = new Map(blocks.map((block) => [block.id, block]));
  const nodes = [];
  const nodeMap = new Map();
  const connections = [];
  const obstacles = [];

  const ensurePortNode = (blockId, type, index) => {
    const block = blockMap.get(blockId);
    if (!block || !Array.isArray(block.ports)) return null;
    const port = block.ports.find((p) => p.type === type && Number(p.index) === Number(index));
    if (!port) return null;
    const key = `${blockId}:${type}:${index}`;
    if (nodeMap.has(key)) return nodeMap.get(key);
    const raw = rotatePoint({ x: block.x + port.x, y: block.y + port.y }, block);
    const pos = { x: snap(raw.x), y: snap(raw.y) };
    const side = getPortSide(block, raw);
    const node = {
      id: key,
      x: Math.round(pos.x / GRID_SIZE),
      y: Math.round(pos.y / GRID_SIZE),
      dir: sideToDir(side),
    };
    nodeMap.set(key, node);
    nodes.push(node);
    return node;
  };

  rawConnections.forEach((conn, idx) => {
    const fromIndex = Number(conn?.fromIndex ?? 0);
    const toIndex = Number(conn?.toIndex ?? 0);
    const fromNode = ensurePortNode(conn?.from, "out", fromIndex);
    const toNode = ensurePortNode(conn?.to, "in", toIndex);
    if (!fromNode || !toNode) return;
    const key = `${conn.from}:${fromIndex}->${conn.to}:${toIndex}:${idx}`;
    connections.push({ from: fromNode.id, to: toNode.id, key, idx });
  });

  const PORT_RADIUS = 6;
  blocks.forEach((block) => {
    let bounds = getRotatedBounds(block);
    let left = bounds.left;
    let right = bounds.right;
    let top = bounds.top;
    let bottom = bounds.bottom;
    (block.ports || []).forEach((port) => {
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

  return { nodes, connections, obstacles };
}

export function routeSnapshot(snapshot, width, height, timeLimitMs) {
  const blocksArr = Array.isArray(snapshot?.blocks) ? snapshot.blocks : [];
  const connsArr = Array.isArray(snapshot?.connections) ? snapshot.connections : [];
  const blocks = new Map();
  blocksArr.forEach((block) => {
    if (!block || !block.id) return;
    blocks.set(block.id, {
      id: block.id,
      x: Number(block.x) || 0,
      y: Number(block.y) || 0,
      width: Number(block.width) || 0,
      height: Number(block.height) || 0,
      rotation: Number(block.rotation) || 0,
      ports: Array.isArray(block.ports) ? block.ports : [],
    });
  });
  const connections = [];
  connsArr.forEach((conn) => {
    if (!conn || !blocks.has(conn.from) || !blocks.has(conn.to)) return;
    connections.push({
      from: conn.from,
      to: conn.to,
      fromIndex: Number(conn.fromIndex ?? 0),
      toIndex: Number(conn.toIndex ?? 0),
      points: [],
    });
  });
  const state = { blocks, connections, dirtyConnections: new Set(), dirtyBlocks: new Set(), routingDirty: false };
  routeAllConnections(
    state,
    Number(width) || 1,
    Number(height) || 1,
    { x: 0, y: 0 },
    Number.isFinite(timeLimitMs) ? timeLimitMs : 4000
  );
  return state.connections.map((conn) => (Array.isArray(conn.points) && conn.points.length >= 2 ? conn.points : null));
}

if (typeof self !== "undefined") {
  self.onmessage = (event) => {
    const { jobId, snapshot, width, height, timeLimitMs } = event.data || {};
    try {
      const routes = routeSnapshot(snapshot || {}, width, height, timeLimitMs);
      self.postMessage({ jobId, ok: true, routes });
    } catch (error) {
      self.postMessage({ jobId, ok: false, error: String(error?.message || error) });
    }
  };
}
