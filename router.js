import { GRID_SIZE, snap } from "./geometry.js";

export function routeConnections2({
  nodes = [],
  connections = [],
  obstacles = [],
  prevSolution = null,
  settings = {},
} = {}) {
  const startTime = Date.now();
  const opts = {
    maxTimeMs: settings.maxTimeMs ?? 200,
    lengthCost: settings.lengthCost ?? 1,
    turnCost: settings.turnCost ?? 6,
    hopCost: settings.hopCost ?? 20,
    nearObstacleDistance: settings.nearObstacleDistance ?? 0,
    nearObstaclePenalty: settings.nearObstaclePenalty ?? 0,
    nearWirePenalty1: settings.nearWirePenalty1 ?? 0,
    nearWirePenalty2: settings.nearWirePenalty2 ?? 0,
    nearObstaclePenalty1: settings.nearObstaclePenalty1 ?? 0,
    nearObstaclePenalty2: settings.nearObstaclePenalty2 ?? 0,
    incremental: settings.incremental ?? false,
    fullOptimize: settings.fullOptimize ?? true,
    searchPadding: settings.searchPadding ?? 20,
    changedConnections: new Set(settings.changedConnections ?? []),
    changedNodes: new Set(settings.changedNodes ?? []),
  };

  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const connectionKeys = connections.map((conn, idx) => connectionKey(conn, idx));
  const connectionMeta = new Map();
  connections.forEach((conn, idx) => {
    const key = connectionKeys[idx];
    connectionMeta.set(key, {
      from: conn.from,
      to: conn.to,
      fromBlock: blockIdFromNodeId(conn.from),
      toBlock: blockIdFromNodeId(conn.to),
    });
  });

  const prevWires = new Map();
  if (prevSolution && prevSolution.wires) {
    if (prevSolution.wires instanceof Map) {
      prevSolution.wires.forEach((wire, key) => prevWires.set(key, wire));
    } else {
      Object.entries(prevSolution.wires).forEach(([key, wire]) => prevWires.set(key, wire));
    }
  }

  const dirtyConnections = new Set();
  connections.forEach((conn, idx) => {
    const key = connectionKeys[idx];
    const dirty =
      !opts.incremental ||
      opts.fullOptimize ||
      opts.changedConnections.has(key) ||
      opts.changedNodes.has(conn.from) ||
      opts.changedNodes.has(conn.to) ||
      !prevWires.has(key);
    if (dirty) dirtyConnections.add(key);
  });

  const bounds = computeBounds(nodes, obstacles, opts.searchPadding);
  const obstacleGrid = buildObstacleGrid(obstacles);
  const routedWires = new Map();

  const staticWires = [];
  connections.forEach((conn, idx) => {
    const key = connectionKeys[idx];
    if (!dirtyConnections.has(key)) {
      const wire = prevWires.get(key);
      if (wire && Array.isArray(wire.points)) {
        routedWires.set(key, wire);
        staticWires.push({ points: wire.points, meta: connectionMeta.get(key) });
      }
    }
  });

  const occupancy = buildOccupancy(staticWires);
  const costs = { total: 0, length: 0, turns: 0, hops: 0, near: 0, failed: 0 };
  const nearBreakdown = { wire1: 0, wire2: 0, obs1: 0, obs2: 0 };
  const failures = [];

  connections.forEach((conn, idx) => {
    const key = connectionKeys[idx];
    if (!dirtyConnections.has(key)) return;
    if (Date.now() - startTime > opts.maxTimeMs) {
      costs.failed += 1;
      return;
    }
    const from = nodeMap.get(conn.from);
    const to = nodeMap.get(conn.to);
    if (!from || !to) {
      costs.failed += 1;
      return;
    }
    const result = routeSingleConnection({
      from,
      to,
      obstacles,
      obstacleGrid,
      occupancy,
      bounds,
      opts,
      meta: {
        from: conn.from,
        to: conn.to,
        key,
        fromBlock: blockIdFromNodeId(conn.from),
        toBlock: blockIdFromNodeId(conn.to),
      },
    });
    if (result.points.length === 0) {
      costs.failed += 1;
      failures.push({
        key,
        from: from.id,
        to: to.id,
        reason: result.reason || "no_path",
        start: { x: from.x, y: from.y, dir: from.dir },
        end: { x: to.x, y: to.y, dir: to.dir },
      });
      return;
    }
    result.key = key;
    routedWires.set(key, result);
    occupancyAddWire(occupancy, result.points, {
      from: conn.from,
      to: conn.to,
      key,
      fromBlock: blockIdFromNodeId(conn.from),
      toBlock: blockIdFromNodeId(conn.to),
    });
    costs.total += result.cost.total;
    costs.length += result.cost.length;
    costs.turns += result.cost.turns;
    costs.hops += result.cost.hops;
    costs.near += result.cost.near;
    nearBreakdown.wire1 += result.cost.nearBreakdown?.wire1 ?? 0;
    nearBreakdown.wire2 += result.cost.nearBreakdown?.wire2 ?? 0;
    nearBreakdown.obs1 += result.cost.nearBreakdown?.obs1 ?? 0;
    nearBreakdown.obs2 += result.cost.nearBreakdown?.obs2 ?? 0;
  });

  return {
    wires: routedWires,
    cost: costs,
    nearBreakdown,
    failures,
    settings: opts,
    durationMs: Date.now() - startTime,
  };
}

function connectionKey(conn, idx) {
  if (conn.key) return String(conn.key);
  if (conn.id) return String(conn.id);
  const fromIndex = conn.fromIndex ?? 0;
  const toIndex = conn.toIndex ?? 0;
  return `${conn.from}:${fromIndex}->${conn.to}:${toIndex}:${idx}`;
}

function computeBounds(nodes, obstacles, padding) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  nodes.forEach((node) => {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x);
    maxY = Math.max(maxY, node.y);
  });
  obstacles.forEach((obs) => {
    minX = Math.min(minX, obs.x0);
    minY = Math.min(minY, obs.y0);
    maxX = Math.max(maxX, obs.x1);
    maxY = Math.max(maxY, obs.y1);
  });
  if (!isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = 0;
    maxY = 0;
  }
  return {
    minX: minX - padding,
    minY: minY - padding,
    maxX: maxX + padding,
    maxY: maxY + padding,
  };
}

function routeSingleConnection({ from, to, obstacles, obstacleGrid, occupancy, bounds, opts, meta }) {
  const startDir = dirToVector(from.dir);
  const endDir = dirToVector(to.dir);
  if (!startDir || !endDir) return emptyResult("bad_direction");
  const endIncoming = { x: -endDir.x, y: -endDir.y };

  const start = { x: from.x, y: from.y };
  const end = { x: to.x, y: to.y };
  const startStep = { x: start.x + startDir.x, y: start.y + startDir.y };
  const endStep = { x: end.x - endIncoming.x, y: end.y - endIncoming.y };
  const allowedSet = new Set([
    pointKeyInt(start.x, start.y),
    pointKeyInt(end.x, end.y),
    pointKeyInt(startStep.x, startStep.y),
    pointKeyInt(endStep.x, endStep.y),
  ]);

  if (isBlocked(startStep, obstacles, allowedSet, obstacleGrid)) {
    return emptyResult("blocked_start_step");
  }
  if (isBlocked(endStep, obstacles, allowedSet, obstacleGrid)) {
    return emptyResult("blocked_end_step");
  }

  const gridW = bounds.maxX - bounds.minX + 1;
  const gridH = bounds.maxY - bounds.minY + 1;
  const cellCount = gridW * gridH;
  const stateCount = cellCount * 8;
  const gScore = new Float64Array(stateCount);
  gScore.fill(Number.POSITIVE_INFINITY);
  const cameFrom = new Int32Array(stateCount);
  cameFrom.fill(-1);
  const lenArr = new Int32Array(stateCount);
  const turnsArr = new Int16Array(stateCount);
  const hopsArr = new Int16Array(stateCount);
  const nearArr = new Int32Array(stateCount);
  const wire1Arr = new Int32Array(stateCount);
  const wire2Arr = new Int32Array(stateCount);
  const obs1Arr = new Int32Array(stateCount);
  const obs2Arr = new Int32Array(stateCount);

  const startDirKey = dirKey(startDir);
  const endIncomingKey = dirKey(endIncoming);
  const startDirIdx = dirIndex(startDirKey);
  const endDirIdx = dirIndex(endIncomingKey);
  const endIncomingIdx = endDirIdx;
  const startCell = cellIndex(start.x, start.y, bounds.minX, bounds.minY, gridW);
  const startIndex = stateIndex(startCell, startDirIdx, 0);

  gScore[startIndex] = 0;
  const open = new MinHeap();
  open.push({ idx: startIndex, f: heuristic(start, end) });
  const searchStart = Date.now();

  while (open.size() > 0) {
    if (Date.now() - searchStart > opts.maxTimeMs) break;
    const current = open.pop();
    const state = decodeState(current.idx, bounds.minX, bounds.minY, gridW);
    if (state.x === end.x && state.y === end.y && state.dir === endDirIdx) {
      return buildResultFromArrays(
        current.idx,
        cameFrom,
        {
          totalArr: gScore,
          lenArr,
          turnsArr,
          hopsArr,
          nearArr,
          wire1Arr,
          wire2Arr,
          obs1Arr,
          obs2Arr,
        },
        bounds.minX,
        bounds.minY,
        gridW
      );
    }
    const currentStats = {
      length: lenArr[current.idx],
      turns: turnsArr[current.idx],
      hops: hopsArr[current.idx],
      near: nearArr[current.idx],
      nearBreakdown: {
        wire1: wire1Arr[current.idx],
        wire2: wire2Arr[current.idx],
        obs1: obs1Arr[current.idx],
        obs2: obs2Arr[current.idx],
      },
    };

    const neighbors = expandNeighborsFast(
      state,
      start,
      end,
      startStep,
      endStep,
      endIncomingIdx,
      occupancy,
      obstacles,
      obstacleGrid,
      bounds,
      opts,
      currentStats,
      meta,
      allowedSet
    );
    for (let i = 0; i < neighbors.length; i += 1) {
      const next = neighbors[i];
      const cell = cellIndex(next.state.x, next.state.y, bounds.minX, bounds.minY, gridW);
      const nextIdx = stateIndex(cell, next.state.dir, next.state.hopLock);
      const tentative = next.cost.total;
      if (tentative < gScore[nextIdx]) {
        cameFrom[nextIdx] = current.idx;
        gScore[nextIdx] = tentative;
        lenArr[nextIdx] = next.cost.length;
        turnsArr[nextIdx] = next.cost.turns;
        hopsArr[nextIdx] = next.cost.hops;
        nearArr[nextIdx] = next.cost.near;
        wire1Arr[nextIdx] = next.cost.nearBreakdown.wire1;
        wire2Arr[nextIdx] = next.cost.nearBreakdown.wire2;
        obs1Arr[nextIdx] = next.cost.nearBreakdown.obs1;
        obs2Arr[nextIdx] = next.cost.nearBreakdown.obs2;
        open.push({
          idx: nextIdx,
          f: tentative + heuristic(next.state, end),
        });
      }
    }
  }
  if (Date.now() - searchStart > opts.maxTimeMs) {
    return emptyResult("timeout");
  }
  return emptyResult("no_path");
}

function expandNeighborsFast(
  state,
  start,
  end,
  startStep,
  endStep,
  endIncomingIdx,
  occupancy,
  obstacles,
  obstacleGrid,
  bounds,
  opts,
  currentStats,
  meta,
  allowedSet
) {
  const dirs = [
    { x: 1, y: 0, idx: 0 },
    { x: -1, y: 0, idx: 1 },
    { x: 0, y: 1, idx: 2 },
    { x: 0, y: -1, idx: 3 },
  ];
  const results = [];
  dirs.forEach((dir) => {
    if (state.hopLock > 0 && dir.idx !== state.dir) return;
    if (state.x === start.x && state.y === start.y && dir.idx !== state.dir) return;
    const nx = state.x + dir.x;
    const ny = state.y + dir.y;
    if (nx < bounds.minX || nx > bounds.maxX || ny < bounds.minY || ny > bounds.maxY) return;
    const nextPoint = { x: nx, y: ny };

    if (nx === end.x && ny === end.y && dir.idx !== endIncomingIdx) return;
    if (nx === end.x && ny === end.y && (state.x !== endStep.x || state.y !== endStep.y)) return;
    if (isBlocked(nextPoint, obstacles, allowedSet, obstacleGrid)) return;
    if (occupancyEdgeBlocked(state, nextPoint, occupancy, allowedSet, meta)) return;
    const edgeKey = edgeKeyFor(state, nextPoint);
    const edgeOccupied = occupancy.edges.has(edgeKey);

    const occInfo = occupancyPointInfo(nextPoint, occupancy, allowedSet, meta);
    let nextHopLock = Math.max(state.hopLock - 1, 0);
    let hopCost = 0;
    if (occInfo.occupied) {
      const crossesVertical = occInfo.vertical && (dir.x !== 0);
      const crossesHorizontal = occInfo.horizontal && (dir.y !== 0);
      if (crossesVertical || crossesHorizontal) {
        nextHopLock = Math.max(nextHopLock, 1);
        hopCost = opts.hopCost;
      } else {
        return;
      }
    }

    const turnCost = state.dir !== dir.idx ? opts.turnCost : 0;
    const nearData = proximityPenalty(nextPoint, obstacleGrid, occupancy, opts, meta, currentStats, end);
    results.push({
      state: {
        x: nx,
        y: ny,
        dir: dir.idx,
        hopLock: nextHopLock,
      },
      cost: buildCost(currentStats, opts, {
        turnCost,
        hopCost,
        nearBreakdown: nearData.breakdown,
        nearCost: nearData.cost,
        lengthIncrement: edgeOccupied ? 0 : 1,
      }),
    });
  });
  return results;
}

function buildResultFromArrays(endIdx, cameFrom, statsArrays, minX, minY, gridW) {
  const path = [];
  let currentIdx = endIdx;
  while (currentIdx >= 0) {
    const state = decodeState(currentIdx, minX, minY, gridW);
    path.push({ x: state.x, y: state.y });
    currentIdx = cameFrom[currentIdx];
  }
  path.reverse();
  const stats = {
    total: statsArrays.totalArr ? statsArrays.totalArr[endIdx] : 0,
    length: statsArrays.lenArr[endIdx] ?? 0,
    turns: statsArrays.turnsArr[endIdx] ?? 0,
    hops: statsArrays.hopsArr[endIdx] ?? 0,
    near: statsArrays.nearArr[endIdx] ?? 0,
    nearBreakdown: {
      wire1: statsArrays.wire1Arr[endIdx] ?? 0,
      wire2: statsArrays.wire2Arr[endIdx] ?? 0,
      obs1: statsArrays.obs1Arr[endIdx] ?? 0,
      obs2: statsArrays.obs2Arr[endIdx] ?? 0,
    },
  };
  stats.total = stats.total || stats.length + stats.turns + stats.hops + stats.near;
  return { points: path, cost: stats };
}

function proximityPenalty(point, obstacleGrid, occupancy, opts, meta, currentStats, end) {
  let wire1 = 0;
  let wire2 = 0;
  let obs1 = 0;
  let obs2 = 0;

  const neighbors1 = [
    { x: point.x + 1, y: point.y },
    { x: point.x - 1, y: point.y },
    { x: point.x, y: point.y + 1 },
    { x: point.x, y: point.y - 1 },
  ];
  const neighbors2 = [
    { x: point.x + 2, y: point.y },
    { x: point.x - 2, y: point.y },
    { x: point.x, y: point.y + 2 },
    { x: point.x, y: point.y - 2 },
    { x: point.x + 1, y: point.y + 1 },
    { x: point.x + 1, y: point.y - 1 },
    { x: point.x - 1, y: point.y + 1 },
    { x: point.x - 1, y: point.y - 1 },
  ];

  const isWireNear = (target) => {
    const info = occupancy.points.get(pointKey(target));
    if (!info || !info.wireIds) return false;
    if (meta && info.owners && (info.owners.has(meta.from) || info.owners.has(meta.to))) return false;
    return true;
  };

  if (neighbors1.some((target) => isWireNear(target))) {
    wire1 = 1;
  } else if (neighbors2.some((target) => isWireNear(target))) {
    wire2 = 1;
  }

  if (obstacleGrid) {
    const obsNear = obstacleNear(point, obstacleGrid);
    obs1 = obsNear.obs1;
    obs2 = obsNear.obs2;
  }

  const cost =
    wire1 * opts.nearWirePenalty1 +
    wire2 * opts.nearWirePenalty2 +
    obs1 * opts.nearObstaclePenalty1 +
    obs2 * opts.nearObstaclePenalty2;

  return {
    cost,
    breakdown: { wire1, wire2, obs1, obs2 },
  };
}

function buildCost(
  currentStats,
  opts,
  { turnCost, hopCost, nearCost, nearBreakdown, lengthIncrement }
) {
  const length = currentStats.length + (lengthIncrement ?? 1);
  const turns = currentStats.turns + (turnCost ? 1 : 0);
  const hops = currentStats.hops + (hopCost ? 1 : 0);
  const near = currentStats.near + nearCost;

  const wire1 = (currentStats.nearBreakdown?.wire1 ?? 0) + (nearBreakdown?.wire1 ?? 0);
  const wire2 = (currentStats.nearBreakdown?.wire2 ?? 0) + (nearBreakdown?.wire2 ?? 0);
  const obs1 = (currentStats.nearBreakdown?.obs1 ?? 0) + (nearBreakdown?.obs1 ?? 0);
  const obs2 = (currentStats.nearBreakdown?.obs2 ?? 0) + (nearBreakdown?.obs2 ?? 0);

  const total = length * opts.lengthCost + turns * opts.turnCost + hops * opts.hopCost + near;
  return {
    total,
    length,
    turns,
    hops,
    near,
    nearBreakdown: { wire1, wire2, obs1, obs2 },
  };
}

function emptyResult(reason) {
  return { points: [], cost: { total: 0, length: 0, turns: 0, hops: 0, near: 0 }, reason };
}

function heuristic(point, end) {
  return Math.abs(point.x - end.x) + Math.abs(point.y - end.y);
}

function dirToVector(dir) {
  if (!dir) return null;
  if (dir === "right" || dir === 0) return { x: 1, y: 0 };
  if (dir === "left" || dir === 180) return { x: -1, y: 0 };
  if (dir === "down" || dir === 90) return { x: 0, y: 1 };
  if (dir === "up" || dir === 270) return { x: 0, y: -1 };
  return null;
}

function dirKey(dir) {
  if (dir.x === 1 && dir.y === 0) return "r";
  if (dir.x === -1 && dir.y === 0) return "l";
  if (dir.x === 0 && dir.y === 1) return "d";
  if (dir.x === 0 && dir.y === -1) return "u";
  return "";
}

function dirIndex(key) {
  if (key === "r") return 0;
  if (key === "l") return 1;
  if (key === "d") return 2;
  if (key === "u") return 3;
  return 0;
}

function cellIndex(x, y, minX, minY, gridW) {
  return (y - minY) * gridW + (x - minX);
}

function stateIndex(cell, dirIdx, hopLock) {
  return (cell * 4 + dirIdx) * 2 + hopLock;
}

function decodeState(idx, minX, minY, gridW) {
  const cell = Math.floor(idx / 8);
  const rem = idx - cell * 8;
  const dir = Math.floor(rem / 2);
  const hopLock = rem % 2;
  const x = (cell % gridW) + minX;
  const y = Math.floor(cell / gridW) + minY;
  return { x, y, dir, hopLock };
}


function isBlocked(point, obstacles, allowedSet, obstacleGrid) {
  if (allowedSet.has(pointKeyInt(point.x, point.y))) return false;
  if (obstacleGrid) {
    return obstacleGrid.has(pointKeyInt(point.x, point.y));
  }
  return obstacles.some(
    (obs) => point.x >= obs.x0 && point.x <= obs.x1 && point.y >= obs.y0 && point.y <= obs.y1
  );
}

function buildOccupancy(wires) {
  const points = new Map();
  const edges = new Map();
  wires.forEach((wire) => occupancyAddWire({ points, edges }, wire.points, wire.meta));
  return { points, edges };
}

function occupancyAddWire(occupancy, points, meta) {
  const ownerIds = meta ? new Set([meta.from, meta.to]) : new Set();
  const wireIds = meta && meta.key ? new Set([meta.key]) : new Set();
  for (let i = 0; i < points.length; i += 1) {
    const key = pointKey(points[i]);
    const info =
      occupancy.points.get(key) ??
      { horizontal: false, vertical: false, occupied: false, owners: new Set(), wireIds: new Set() };
    info.occupied = true;
    ownerIds.forEach((id) => info.owners.add(id));
    wireIds.forEach((id) => info.wireIds.add(id));
    occupancy.points.set(key, info);
    if (i > 0) {
      const prev = points[i - 1];
      const curr = points[i];
      const edgeKey = edgeKeyFor(prev, curr);
      const edgeOwners = occupancy.edges.get(edgeKey) ?? new Set();
      ownerIds.forEach((id) => edgeOwners.add(id));
      if (meta && meta.key) edgeOwners.add(meta.key);
      occupancy.edges.set(edgeKey, edgeOwners);
      if (i < points.length - 1) {
        const next = points[i + 1];
        if (prev.x === curr.x && curr.x === next.x) info.vertical = true;
        if (prev.y === curr.y && curr.y === next.y) info.horizontal = true;
      }
    }
  }
}

function occupancyEdgeBlocked(from, to, occupancy, allowedSet, meta) {
  if (allowedSet.has(pointKeyInt(from.x, from.y)) || allowedSet.has(pointKeyInt(to.x, to.y))) return false;
  const edgeKey = edgeKeyFor(from, to);
  const owners = occupancy.edges.get(edgeKey);
  if (!owners) return false;
  if (meta && (owners.has(meta.from) || owners.has(meta.to) || owners.has(meta.key))) return false;
  return true;
}

function occupancyPointInfo(point, occupancy, allowedSet, meta) {
  if (allowedSet.has(pointKeyInt(point.x, point.y))) {
    return { occupied: false, horizontal: false, vertical: false, owners: new Set(), wireIds: new Set() };
  }
  const info = occupancy.points.get(pointKey(point));
  if (!info) return { occupied: false, horizontal: false, vertical: false, owners: new Set(), wireIds: new Set() };
  if (meta && (info.owners.has(meta.from) || info.owners.has(meta.to) || info.wireIds.has(meta.key))) {
    return { occupied: false, horizontal: false, vertical: false, owners: info.owners, wireIds: info.wireIds };
  }
  return info;
}

function buildObstacleGrid(obstacles) {
  if (!obstacles.length) return null;
  const grid = new Set();
  obstacles.forEach((obs) => {
    for (let x = Math.floor(obs.x0); x <= Math.floor(obs.x1); x += 1) {
      for (let y = Math.floor(obs.y0); y <= Math.floor(obs.y1); y += 1) {
        grid.add(pointKeyInt(x, y));
      }
    }
  });
  return grid;
}

function obstacleNear(point, grid) {
  if (grid.has(pointKeyInt(point.x, point.y))) return { obs1: 1, obs2: 0 };
  const neighbors1 = [
    { x: point.x + 1, y: point.y },
    { x: point.x - 1, y: point.y },
    { x: point.x, y: point.y + 1 },
    { x: point.x, y: point.y - 1 },
  ];
  if (neighbors1.some((pt) => grid.has(pointKeyInt(pt.x, pt.y)))) {
    return { obs1: 1, obs2: 0 };
  }
  const neighbors2 = [
    { x: point.x + 2, y: point.y },
    { x: point.x - 2, y: point.y },
    { x: point.x, y: point.y + 2 },
    { x: point.x, y: point.y - 2 },
    { x: point.x + 1, y: point.y + 1 },
    { x: point.x + 1, y: point.y - 1 },
    { x: point.x - 1, y: point.y + 1 },
    { x: point.x - 1, y: point.y - 1 },
  ];
  if (neighbors2.some((pt) => grid.has(pointKeyInt(pt.x, pt.y)))) {
    return { obs1: 0, obs2: 1 };
  }
  return { obs1: 0, obs2: 0 };
}

function pointKey(point) {
  return `${point.x},${point.y}`;
}

function pointKeyInt(x, y) {
  return ((x & 0xffff) << 16) | (y & 0xffff);
}

function edgeKeyFor(a, b) {
  if (a.x === b.x) {
    const y0 = Math.min(a.y, b.y);
    const y1 = Math.max(a.y, b.y);
    return `v:${a.x}:${y0}:${y1}`;
  }
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  return `h:${x0}:${x1}:${a.y}`;
}

class MinHeap {
  constructor() {
    this.items = [];
  }

  size() {
    return this.items.length;
  }

  push(item) {
    this.items.push(item);
    this.bubbleUp(this.items.length - 1);
  }

  pop() {
    if (this.items.length === 1) return this.items.pop();
    const top = this.items[0];
    this.items[0] = this.items.pop();
    this.bubbleDown(0);
    return top;
  }

  bubbleUp(index) {
    let idx = index;
    while (idx > 0) {
      const parent = Math.floor((idx - 1) / 2);
      if (this.items[parent].f <= this.items[idx].f) break;
      [this.items[parent], this.items[idx]] = [this.items[idx], this.items[parent]];
      idx = parent;
    }
  }

  bubbleDown(index) {
    let idx = index;
    const length = this.items.length;
    while (true) {
      const left = idx * 2 + 1;
      const right = idx * 2 + 2;
      let smallest = idx;
      if (left < length && this.items[left].f < this.items[smallest].f) smallest = left;
      if (right < length && this.items[right].f < this.items[smallest].f) smallest = right;
      if (smallest === idx) break;
      [this.items[smallest], this.items[idx]] = [this.items[idx], this.items[smallest]];
      idx = smallest;
    }
  }
}

export function routeAllConnections(
  state,
  width,
  height,
  offset = { x: 0, y: 0 },
  timeLimitMs
) {
  const { nodes, connections, obstacles } = buildRouter2Input(state);
  const settings = {
    maxTimeMs: timeLimitMs ?? 400,
    incremental: false,
    fullOptimize: true,
    searchPadding: Math.max(20, Math.ceil(Math.max(width, height) / GRID_SIZE) + 5),
    nearObstaclePenalty1: 10,
    nearObstaclePenalty2: 4,
    nearWirePenalty1: 6,
    nearWirePenalty2: 2,
  };
  const result = routeConnections2({
    nodes,
    connections,
    obstacles,
    settings,
  });
  if (typeof window !== "undefined") {
    window.__routerLast = {
      nodes,
      connections,
      obstacles,
      result,
      settings,
      stats: {
        nodes: nodes.length,
        connections: connections.length,
        prevWires: 0,
        dirty: connections.length,
        changed: connections.length,
      },
    };
  }
  return applyRouter2Result(state, connections, result);
}

export function routeDirtyConnections(state, width, height, offset = { x: 0, y: 0 }, dirtySet, timeLimitMs) {
  const { nodes, connections, obstacles, prevSolution } = buildRouter2Input(state, dirtySet);
  const changedConnections = new Set(
    connections.filter((conn) => dirtySet.has(conn.__ref)).map((conn) => conn.key)
  );
  const settings = {
    maxTimeMs: timeLimitMs ?? 400,
    incremental: true,
    fullOptimize: false,
    changedConnections: Array.from(changedConnections),
    searchPadding: Math.max(20, Math.ceil(Math.max(width, height) / GRID_SIZE) + 5),
    nearObstaclePenalty1: 10,
    nearObstaclePenalty2: 4,
    nearWirePenalty1: 6,
    nearWirePenalty2: 2,
  };
  const result = routeConnections2({
    nodes,
    connections,
    obstacles,
    prevSolution,
    settings,
  });
  if (typeof window !== "undefined") {
    const prevCount = prevSolution?.wires
      ? prevSolution.wires instanceof Map
        ? prevSolution.wires.size
        : Object.keys(prevSolution.wires).length
      : 0;
    window.__routerLast = {
      nodes,
      connections,
      obstacles,
      result,
      settings,
      stats: {
        nodes: nodes.length,
        connections: connections.length,
        prevWires: prevCount,
        dirty: dirtySet?.size ?? 0,
        changed: changedConnections.size,
      },
    };
  }
  return applyRouter2Result(state, connections, result);
}

function buildRouter2Input(state, dirtySet = null) {
  const nodes = [];
  const nodeMap = new Map();
  const connections = [];
  const prevWires = {};
  const obstacles = [];

  state.connections.forEach((conn) => {
    const fromNode = ensurePortNode(state, conn.from, "out", conn.fromIndex ?? 0, nodeMap, nodes);
    const toNode = ensurePortNode(state, conn.to, "in", conn.toIndex ?? 0, nodeMap, nodes);
    if (!fromNode || !toNode) return;
    const key = `${conn.from}:${conn.fromIndex ?? 0}->${conn.to}:${conn.toIndex ?? 0}`;
    connections.push({ from: fromNode.id, to: toNode.id, key, __ref: conn });
    if (conn.points && conn.points.length > 1 && (!dirtySet || !dirtySet.has(conn))) {
      prevWires[key] = conn.points.map((pt) => ({
        x: Math.round(pt.x / GRID_SIZE),
        y: Math.round(pt.y / GRID_SIZE),
      }));
    }
  });

  state.blocks.forEach((block) => {
    obstacles.push(...blockToObstacles(block));
  });

  const prevSolution = Object.keys(prevWires).length ? { wires: prevWires } : null;
  return { nodes, connections, obstacles, prevSolution };
}

function ensurePortNode(state, blockId, type, index, nodeMap, nodes) {
  const block = state.blocks.get(blockId);
  if (!block) return null;
  const port = block.ports.find((p) => p.type === type && p.index === index);
  if (!port) return null;
  const key = `${blockId}:${type}:${index}`;
  if (nodeMap.has(key)) return nodeMap.get(key);
  const raw = rotatePoint({ x: block.x + port.x, y: block.y + port.y }, block);
  const pos = { x: snap(raw.x), y: snap(raw.y) };
  const side = getPortSide(block, raw);
  const dir = sideToDir(side);
  const node = {
    id: key,
    x: Math.round(pos.x / GRID_SIZE),
    y: Math.round(pos.y / GRID_SIZE),
    dir,
  };
  nodeMap.set(key, node);
  nodes.push(node);
  return node;
}

function blockIdFromNodeId(nodeId) {
  return typeof nodeId === "string" ? nodeId.split(":")[0] : "";
}

function blockToObstacles(block) {
  const PORT_RADIUS = 6;
  const padding = 0;
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
  left -= padding;
  right += padding;
  top -= padding;
  bottom += padding;
  return [
    {
      x0: Math.floor(left / GRID_SIZE),
      y0: Math.floor(top / GRID_SIZE),
      x1: Math.floor(right / GRID_SIZE),
      y1: Math.floor(bottom / GRID_SIZE),
      owner: block.id,
    },
  ];
}

function applyRouter2Result(state, connections, result) {
  const paths = new Map();
  connections.forEach((conn) => {
    const wire = result.wires.get(conn.key);
    if (!wire || !wire.points.length) {
      if (conn.__ref.points && conn.__ref.points.length) {
        paths.set(conn.__ref, pointsToPath(conn.__ref.points));
      } else {
        conn.__ref.points = [];
        paths.set(conn.__ref, "");
      }
      return;
    }
    const points = wire.points.map((pt) => ({
      x: pt.x * GRID_SIZE,
      y: pt.y * GRID_SIZE,
    }));
    conn.__ref.points = points;
    const d = pointsToPath(points);
    paths.set(conn.__ref, d);
  });
  return paths;
}

function pointsToPath(points) {
  if (!points.length) return "";
  const parts = [`M ${points[0].x} ${points[0].y}`];
  for (let i = 1; i < points.length; i += 1) {
    parts.push(`L ${points[i].x} ${points[i].y}`);
  }
  return parts.join(" ");
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
