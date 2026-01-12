import {
  GRID_SIZE,
  KEEP_OUT,
  snap,
  expandRect,
  routeOrthogonal,
  appendOrth,
  simplifyPoints,
  segmentHitsRect,
  toNode,
} from "./geometry.js";

const PORT_RADIUS = 6;
const HOP_RADIUS = 4;

const DEBUG_ROUTE = true;
const CHECK_TURN_OPTIMALITY = false;
const USE_TWO_TURN_SHORTCUT = true;

const COST = {
  turn: 30,
  wire: 200,
  wireNear: 120,
  wireFar: 40,
  node: 80,
  nodeNear: 40,
  cross: 60,
  edgeOverlap: 5000,
};
const ROUTE_TIME_LIMIT_MS = 100;

export function routeAllConnections(
  state,
  width,
  height,
  offset = { x: 0, y: 0 },
  timeLimitMs = ROUTE_TIME_LIMIT_MS,
  preferTwoTurn = USE_TWO_TURN_SHORTCUT
) {
  const startTime = typeof performance !== "undefined" ? performance.now() : Date.now();
  const baseSegments = new Map();
  const orderedSegments = new Map();
  const penaltyMap = new Map();
  const blockedEdges = new Set();
  const edgesByPort = new Map();
  const connOrder = new Map();
  const occupiedNodes = new Map();

  state.connections.forEach((conn, index) => {
    connOrder.set(conn, index);
  });

  const routingList = [...state.connections].sort((a, b) => {
    const lenA = estimateConnLength(state, a);
    const lenB = estimateConnLength(state, b);
    if (lenA !== lenB) return lenA - lenB;
    return (connOrder.get(a) ?? 0) - (connOrder.get(b) ?? 0);
  });

  if (DEBUG_ROUTE) {
    console.debug(`[router] routing ${state.connections.length} connections`);
  }

  const portLaneCounts = new Map();
  const nextLaneIndex = (id, type, index) => {
    const key = portKey(id, type, index);
    const count = portLaneCounts.get(key) || 0;
    portLaneCounts.set(key, count + 1);
    return count;
  };

  routingList.forEach((conn) => {
    const fromLane = nextLaneIndex(conn.from, "out", conn.fromIndex ?? 0);
    const toLane = nextLaneIndex(conn.to, "in", conn.toIndex);
    const points = routeSingle(
      conn,
      state,
      width,
      height,
      offset,
      penaltyMap,
      blockedEdges,
      edgesByPort,
      occupiedNodes,
      fromLane,
      toLane,
      timeLimitMs,
      preferTwoTurn
    );
    conn.points = points;
    baseSegments.set(conn, pointsToSegments(points));
    orderedSegments.set(conn, segmentsFromPoints(points));
    addPenaltyFromRoute(points, width, height, penaltyMap);
    addNodePenaltyFromRoute(points, width, height, penaltyMap);
    addEdgesFromPoints(points, blockedEdges);
    addStubEdgesForPort(points, edgesByPort, conn.from, "out", conn.fromIndex ?? 0, true);
    addStubEdgesForPort(points, edgesByPort, conn.to, "in", conn.toIndex, false);
    addOccupiedNodes(points, occupiedNodes);
  });

  const allSegments = [];
  const connSegments = new Map();

  state.connections.forEach((conn) => {
    const segs = orderedSegments.get(conn) || [];
    connSegments.set(conn, segs);
    const normalized = baseSegments.get(conn) || [];
    const sharedFrom = (a, b) => a.from === b.from && (a.fromIndex ?? 0) === (b.fromIndex ?? 0);
    const sharedTo = (a, b) => a.to === b.to && a.toIndex === b.toIndex;
    const samePort = (a, b) => sharedFrom(a, b) || sharedTo(a, b);
    allSegments.push(
      ...normalized.map((s) => ({ ...s, conn, samePort }))
    );
  });

  const paths = new Map();
  state.connections.forEach((conn) => {
    const segs = connSegments.get(conn) || [];
    const order = connOrder.get(conn) ?? 0;
    const others = allSegments.filter(
      (s) => s.conn !== conn && !s.samePort(conn, s.conn) && (connOrder.get(s.conn) ?? 0) < order
    );
    paths.set(conn, buildPathWithHops(segs, others));
    conn.points = buildPointsWithHops(conn.points, others);
  });

  if (DEBUG_ROUTE) {
    const endTime = typeof performance !== "undefined" ? performance.now() : Date.now();
    console.debug(`[router] complete in ${(endTime - startTime).toFixed(1)}ms`);
  }

  return paths;
}

export function routeDirtyConnections(
  state,
  width,
  height,
  offset = { x: 0, y: 0 },
  dirtyConnections = new Set(),
  timeLimitMs = ROUTE_TIME_LIMIT_MS,
  preferTwoTurn = USE_TWO_TURN_SHORTCUT
) {
  if (!dirtyConnections || dirtyConnections.size === 0) return new Map();
  const startTime = typeof performance !== "undefined" ? performance.now() : Date.now();
  const baseSegments = new Map();
  const orderedSegments = new Map();
  const penaltyMap = new Map();
  const blockedEdges = new Set();
  const edgesByPort = new Map();
  const connOrder = new Map();
  const occupiedNodes = new Map();

  state.connections.forEach((conn, index) => {
    connOrder.set(conn, index);
  });

  const routingList = [...state.connections].sort((a, b) => {
    const lenA = estimateConnLength(state, a);
    const lenB = estimateConnLength(state, b);
    if (lenA !== lenB) return lenA - lenB;
    return (connOrder.get(a) ?? 0) - (connOrder.get(b) ?? 0);
  });

  const portLaneCounts = new Map();
  const nextLaneIndex = (id, type, index) => {
    const key = portKey(id, type, index);
    const count = portLaneCounts.get(key) || 0;
    portLaneCounts.set(key, count + 1);
    return count;
  };

  state.connections.forEach((conn) => {
    if (dirtyConnections.has(conn)) return;
    const points = conn.points || [];
    if (points.length < 2) return;
    baseSegments.set(conn, pointsToSegments(points));
    orderedSegments.set(conn, segmentsFromPoints(points));
    addPenaltyFromRoute(points, width, height, penaltyMap);
    addNodePenaltyFromRoute(points, width, height, penaltyMap);
    addEdgesFromPoints(points, blockedEdges);
    addStubEdgesForPort(points, edgesByPort, conn.from, "out", conn.fromIndex ?? 0, true);
    addStubEdgesForPort(points, edgesByPort, conn.to, "in", conn.toIndex, false);
    addOccupiedNodes(points, occupiedNodes);
  });

  routingList.forEach((conn) => {
    const fromLane = nextLaneIndex(conn.from, "out", conn.fromIndex ?? 0);
    const toLane = nextLaneIndex(conn.to, "in", conn.toIndex);
    if (!dirtyConnections.has(conn)) return;
    const points = routeSingle(
      conn,
      state,
      width,
      height,
      offset,
      penaltyMap,
      blockedEdges,
      edgesByPort,
      occupiedNodes,
      fromLane,
      toLane,
      timeLimitMs,
      preferTwoTurn
    );
    conn.points = points;
    baseSegments.set(conn, pointsToSegments(points));
    orderedSegments.set(conn, segmentsFromPoints(points));
    addPenaltyFromRoute(points, width, height, penaltyMap);
    addNodePenaltyFromRoute(points, width, height, penaltyMap);
    addEdgesFromPoints(points, blockedEdges);
    addStubEdgesForPort(points, edgesByPort, conn.from, "out", conn.fromIndex ?? 0, true);
    addStubEdgesForPort(points, edgesByPort, conn.to, "in", conn.toIndex, false);
    addOccupiedNodes(points, occupiedNodes);
  });

  const allSegments = [];
  state.connections.forEach((conn) => {
    const normalized = baseSegments.get(conn) || [];
    const sharedFrom = (a, b) => a.from === b.from && (a.fromIndex ?? 0) === (b.fromIndex ?? 0);
    const sharedTo = (a, b) => a.to === b.to && a.toIndex === b.toIndex;
    const samePort = (a, b) => sharedFrom(a, b) || sharedTo(a, b);
    allSegments.push(...normalized.map((s) => ({ ...s, conn, samePort })));
  });

  const paths = new Map();
  dirtyConnections.forEach((conn) => {
    const segs = orderedSegments.get(conn) || [];
    const order = connOrder.get(conn) ?? 0;
    const others = allSegments.filter(
      (s) => s.conn !== conn && !s.samePort(conn, s.conn) && (connOrder.get(s.conn) ?? 0) < order
    );
    paths.set(conn, buildPathWithHops(segs, others));
    conn.points = buildPointsWithHops(conn.points || [], others);
  });

  if (DEBUG_ROUTE) {
    const endTime = typeof performance !== "undefined" ? performance.now() : Date.now();
    console.debug(`[router] dirty routing ${dirtyConnections.size} connections in ${(endTime - startTime).toFixed(1)}ms`);
  }

  return paths;
}

function estimateConnLength(state, conn) {
  const fromBlock = state.blocks.get(conn.from);
  const toBlock = state.blocks.get(conn.to);
  if (!fromBlock || !toBlock) return Infinity;
  const fromIndex = conn.fromIndex ?? 0;
  const fromPort = fromBlock.ports.find((p) => p.type === "out" && p.index === fromIndex);
  const toPort = toBlock.ports.find((p) => p.type === "in" && p.index === conn.toIndex);
  if (!fromPort || !toPort) return Infinity;
  const from = rotatePoint({ x: fromBlock.x + fromPort.x, y: fromBlock.y + fromPort.y }, fromBlock);
  const to = rotatePoint({ x: toBlock.x + toPort.x, y: toBlock.y + toPort.y }, toBlock);
  return Math.abs(from.x - to.x) + Math.abs(from.y - to.y);
}

function routeSingle(
  conn,
  state,
  width,
  height,
  offset,
  penaltyMap,
  blockedEdges,
  edgesByPort,
  occupiedNodes,
  fromLane = 0,
  toLane = 0,
  timeLimitMs = ROUTE_TIME_LIMIT_MS,
  preferTwoTurn = true
) {
  const fromBlock = state.blocks.get(conn.from);
  const toBlock = state.blocks.get(conn.to);
  if (!fromBlock || !toBlock) return [];

  const fromIndex = conn.fromIndex ?? 0;
  const fromPort = fromBlock.ports.find((p) => p.type === "out" && p.index === fromIndex);
  const toPort = toBlock.ports.find((p) => p.type === "in" && p.index === conn.toIndex);
  if (!fromPort || !toPort) return [];

  const from = rotatePoint({ x: fromBlock.x + fromPort.x, y: fromBlock.y + fromPort.y }, fromBlock);
  const to = rotatePoint({ x: toBlock.x + toPort.x, y: toBlock.y + toPort.y }, toBlock);

  const blocks = Array.from(state.blocks.values());
  const obstacles = blocks.map((b) => {
    const pad = b.id === fromBlock.id || b.id === toBlock.id ? 0 : KEEP_OUT;
    const bounds = b.id === fromBlock.id || b.id === toBlock.id ? getBlockBodyBounds(b) : getBlockBounds(b);
    return expandRect(bounds, pad);
  });

  const fromKeepout = expandRect(getBlockBounds(fromBlock), KEEP_OUT);
  const toKeepout = expandRect(getBlockBounds(toBlock), KEEP_OUT);

  const fromSide = getPortSide(fromBlock, fromPort, from);
  const toSide = getPortSide(toBlock, toPort, to);
  const startDir = sideToDir(fromSide, "out");
  const endDir = sideToDir(toSide, "in");
  const fromAnchor = snapAnchor(
    anchorFromPort(from, fromSide, fromPort.index ?? 0, fromLane)
  );
  const toAnchor = snapAnchor(
    anchorFromPort(to, toSide, toPort.index ?? 0, toLane)
  );
  const fromStub = stubPointFromPort(from, fromSide);
  const toStub = stubPointFromPort(to, toSide);

  const penaltyFn = penaltyMap ? (x, y) => penaltyMap.get(`${x},${y}`) || 0 : null;
  let window = computeRouteWindow(fromAnchor, toAnchor, obstacles, width, height);
  const runRoute = (win, penalty, edges, edgeBlockFn, allowed) => {
    const crossPenalty = buildCrossPenalty(occupiedNodes, win.offset, win.width, win.height);
    const edgePenalty = buildEdgePenalty(edges, COST.edgeOverlap, allowed, win.offset, win.width, win.height);
    const fromShift = { x: fromAnchor.x - win.offset.x, y: fromAnchor.y - win.offset.y };
    const toShift = { x: toAnchor.x - win.offset.x, y: toAnchor.y - win.offset.y };
    const shifted = win.obstacles.map((rect) => ({
      left: rect.left - win.offset.x,
      right: rect.right - win.offset.x,
      top: rect.top - win.offset.y,
      bottom: rect.bottom - win.offset.y,
    }));
    return routeOrthogonal(
      fromShift,
      toShift,
      shifted,
      win.width,
      win.height,
      penalty,
      COST.turn,
      timeLimitMs,
      edgePenalty,
      crossPenalty,
      edgeBlockFn,
      startDir,
      endDir
    );
  };
  const allowedEdges = allowedEdgeSet(edgesByPort, conn);
  const twoTurnCore = preferTwoTurn
    ? findTwoTurnPathAllowed(fromAnchor, toAnchor, obstacles, blockedEdges, allowedEdges)
    : null;
  const runWithEdges = (allowed, overrideWindow = null) => {
    let win = overrideWindow || window;
    const edgeBlockFn = buildEdgeBlocker(blockedEdges, allowed, win.offset, win.width, win.height);
    let localEdges = toLocalEdges(blockedEdges, win.offset, win.width, win.height);
    let routed = runRoute(win, penaltyFn, localEdges, edgeBlockFn, allowed);
    let usedFallback = !routed || routed.length === 0;
    if (usedFallback && win.usedLocal) {
      win = computeRouteWindow(fromAnchor, toAnchor, obstacles, width, height, GRID_SIZE * 90);
      localEdges = toLocalEdges(blockedEdges, win.offset, win.width, win.height);
      const localBlock = buildEdgeBlocker(blockedEdges, allowed, win.offset, win.width, win.height);
      routed = runRoute(win, penaltyFn, localEdges, localBlock, allowed);
      usedFallback = !routed || routed.length === 0;
    }
    if (usedFallback && win.usedLocal) {
      const globalWindow = {
        offset: offset,
        width,
        height,
        obstacles,
        usedLocal: false,
      };
      const globalBlock = buildEdgeBlocker(blockedEdges, allowed, offset, width, height);
      routed = runRoute(globalWindow, penaltyFn, blockedEdges, globalBlock, allowed);
      usedFallback = !routed || routed.length === 0;
      win = globalWindow;
    }
    if (usedFallback) {
      const boostedPenalty = penaltyFn ? (x, y) => (penaltyFn(x, y) || 0) * 8 : null;
      const localBlock = buildEdgeBlocker(blockedEdges, allowed, win.offset, win.width, win.height);
      routed = runRoute(win, boostedPenalty, null, localBlock, allowed);
      usedFallback = !routed || routed.length === 0;
    }
    return { routed, usedFallback, window: win };
  };

  let routed = null;
  let usedFallback = false;
  if (!twoTurnCore) {
    let result = runWithEdges(allowedEdges);
    routed = result.routed;
    usedFallback = result.usedFallback;
    window = result.window;
  }

  const locked = new Set(
    [
      { x: snap(from.x), y: snap(from.y) },
      { x: snap(fromStub.x), y: snap(fromStub.y) },
      { x: snap(fromAnchor.x), y: snap(fromAnchor.y) },
      { x: snap(toAnchor.x), y: snap(toAnchor.y) },
      { x: snap(toStub.x), y: snap(toStub.y) },
      { x: snap(to.x), y: snap(to.y) },
    ].map(pointKey)
  );

  let coreWorld = twoTurnCore || null;
  if (!coreWorld && !usedFallback && routed && routed.length > 0) {
    const routeOffset = window.usedLocal ? window.offset : offset;
    coreWorld = routed.map((pt) => ({ x: pt.x + routeOffset.x, y: pt.y + routeOffset.y }));
  }

  const basePoints = buildPointsFromCore(
    from,
    fromStub,
    fromAnchor,
    coreWorld,
    toAnchor,
    toStub,
    to
  );
  let simplified = finalizePoints(
    basePoints,
    locked,
    fromSide,
    toSide,
    obstacles,
    blockedEdges,
    allowedEdges
  );
  let minimalTurns = null;
  if (CHECK_TURN_OPTIMALITY) {
    const minimalCore = computeMinimalTurnCore(
      fromAnchor,
      toAnchor,
      obstacles,
      blockedEdges,
      allowedEdges,
      window,
      offset,
      width,
      height,
      startDir,
      endDir
    );
    if (minimalCore) {
      const altPoints = buildPointsFromCore(
        from,
        fromStub,
        fromAnchor,
        minimalCore,
        toAnchor,
        toStub,
        to
      );
      const altSimplified = finalizePoints(
        altPoints,
        locked,
        fromSide,
        toSide,
        obstacles,
        blockedEdges,
        allowedEdges
      );
      minimalTurns = countTurns(altSimplified);
      const currentTurns = countTurns(simplified);
      if (minimalTurns < currentTurns) {
        simplified = altSimplified;
      }
    }
    const actualTurns = countTurns(simplified);
    if (Number.isFinite(minimalTurns) && minimalTurns > actualTurns) {
      minimalTurns = actualTurns;
    }
    conn.turnCheck = {
      actual: actualTurns,
      minimal: minimalTurns,
    };
  }
  if (DEBUG_ROUTE) {
    const stats = getRouteStats(simplified);
    console.debug(
      `[router] ${conn.from}->${conn.to} fallback=${usedFallback} turns=${stats.turns} len=${stats.length}`
    );
  }
  if (DEBUG_ROUTE && usedFallback) {
    console.warn(`[router] fallback route for ${conn.from}->${conn.to}`);
  }
  return simplified;
}

function trimOutwardRuns(points, fromSide, toSide, obstacles, blockedEdges, allowedEdges) {
  if (!points || points.length < 4) return points;
  const trimmedStart = trimOutwardRun(points, fromSide, obstacles, blockedEdges, allowedEdges);
  const reversed = trimmedStart.slice().reverse();
  const trimmedEnd = trimOutwardRun(
    reversed,
    toSide,
    obstacles,
    blockedEdges,
    allowedEdges
  ).reverse();
  return trimmedEnd;
}

function finalizePoints(points, locked, fromSide, toSide, obstacles, blockedEdges, allowedEdges) {
  const snapped = points.map((pt) => ({ x: snap(pt.x), y: snap(pt.y) }));
  let simplified = simplifyPointsLocked(snapped, locked);
  const trimmed = trimOutwardRuns(simplified, fromSide, toSide, obstacles, blockedEdges, allowedEdges);
  if (trimmed !== simplified) {
    simplified = simplifyPointsLocked(trimmed, locked);
  }
  return simplified;
}

function buildPointsFromCore(from, fromStub, fromAnchor, coreWorld, toAnchor, toStub, to) {
  const points = [from];
  appendOrth(points, from, fromStub);
  appendOrth(points, fromStub, fromAnchor);
  if (coreWorld && coreWorld.length > 1) {
    const coreTrimmed = coreWorld.slice(1, -1);
    coreTrimmed.forEach((pt) => appendOrth(points, points[points.length - 1], pt));
  } else {
    appendOrth(points, fromAnchor, toAnchor);
  }
  appendOrth(points, points[points.length - 1], toAnchor);
  appendOrth(points, points[points.length - 1], toStub);
  appendOrth(points, points[points.length - 1], to);
  return points;
}

function computeMinimalTurnCore(
  fromAnchor,
  toAnchor,
  obstacles,
  blockedEdges,
  allowedEdges,
  window,
  offset,
  width,
  height,
  startDir,
  endDir
) {
  const win = window || computeRouteWindow(fromAnchor, toAnchor, obstacles, width, height);
  const edgeBlockFn = buildEdgeBlocker(blockedEdges, allowedEdges, win.offset, win.width, win.height);
  const fromShift = { x: fromAnchor.x - win.offset.x, y: fromAnchor.y - win.offset.y };
  const toShift = { x: toAnchor.x - win.offset.x, y: toAnchor.y - win.offset.y };
  const shifted = win.obstacles.map((rect) => ({
    left: rect.left - win.offset.x,
    right: rect.right - win.offset.x,
    top: rect.top - win.offset.y,
    bottom: rect.bottom - win.offset.y,
  }));
  const core = routeOrthogonal(
    fromShift,
    toShift,
    shifted,
    win.width,
    win.height,
    null,
    COST.turn * 100000,
    40,
    null,
    null,
    edgeBlockFn,
    startDir,
    endDir
  );
  if (!core || core.length === 0) return null;
  return core.map((pt) => ({ x: pt.x + win.offset.x, y: pt.y + win.offset.y }));
}

function trimOutwardRun(points, side, obstacles, blockedEdges, allowedEdges) {
  if (!points || points.length < 4) return points;
  const start = points[0];
  const stub = points[1];
  if (!isOutwardSegment(start, stub, side)) return points;
  let idx = 2;
  while (idx < points.length && isOutwardSegment(points[idx - 1], points[idx], side)) {
    idx += 1;
  }
  if (idx <= 2 || idx >= points.length) return points;
  const afterRun = points[idx];
  const corner =
    side === "left" || side === "right"
      ? { x: stub.x, y: afterRun.y }
      : { x: afterRun.x, y: stub.y };
  if (!segmentClearAllowed(stub, corner, obstacles, blockedEdges, allowedEdges)) return points;
  if (!segmentClearAllowed(corner, afterRun, obstacles, blockedEdges, allowedEdges)) return points;
  const prefix = points.slice(0, 2);
  const suffix = points.slice(idx);
  return simplifyPoints([...prefix, corner, ...suffix]);
}

function isOutwardSegment(a, b, side) {
  if (side === "left") return a.y === b.y && b.x < a.x;
  if (side === "right") return a.y === b.y && b.x > a.x;
  if (side === "top") return a.x === b.x && b.y < a.y;
  return a.x === b.x && b.y > a.y;
}


function addPenaltyFromRoute(points, width, height, penaltyMap) {
  if (!penaltyMap) return;
  const cols = Math.max(2, Math.floor(width / GRID_SIZE) + 1);
  const rows = Math.max(2, Math.floor(height / GRID_SIZE) + 1);
  const segments = pointsToSegments(points);
  segments.forEach((seg) => addPenaltyFromSegment(seg, cols, rows, penaltyMap));
}

function addNodePenaltyFromRoute(points, width, height, penaltyMap) {
  if (!penaltyMap || points.length === 0) return;
  const cols = Math.max(2, Math.floor(width / GRID_SIZE) + 1);
  const rows = Math.max(2, Math.floor(height / GRID_SIZE) + 1);
  const addPenalty = (x, y, value) => {
    if (x < 0 || y < 0 || x >= cols || y >= rows) return;
    const key = `${x},${y}`;
    penaltyMap.set(key, (penaltyMap.get(key) || 0) + value);
  };
  points.forEach((pt) => {
    const x = Math.round(pt.x / GRID_SIZE);
    const y = Math.round(pt.y / GRID_SIZE);
    addPenalty(x, y, COST.node);
    addPenalty(x - 1, y, COST.nodeNear);
    addPenalty(x + 1, y, COST.nodeNear);
    addPenalty(x, y - 1, COST.nodeNear);
    addPenalty(x, y + 1, COST.nodeNear);
  });
}

function addPenaltyFromSegment(seg, cols, rows, penaltyMap) {
  const addPenalty = (x, y, value) => {
    if (x < 0 || y < 0 || x >= cols || y >= rows) return;
    const key = `${x},${y}`;
    penaltyMap.set(key, (penaltyMap.get(key) || 0) + value);
  };

  if (seg.orientation === "H") {
    const y = Math.round(seg.a.y / GRID_SIZE);
    const startX = Math.round(seg.a.x / GRID_SIZE);
    const endX = Math.round(seg.b.x / GRID_SIZE);
    for (let x = startX; x <= endX; x += 1) {
      addPenalty(x, y, COST.wire);
      addPenalty(x, y - 1, COST.wireNear);
      addPenalty(x, y + 1, COST.wireNear);
      addPenalty(x - 1, y, COST.wireFar);
      addPenalty(x + 1, y, COST.wireFar);
    }
  } else {
    const x = Math.round(seg.a.x / GRID_SIZE);
    const startY = Math.round(seg.a.y / GRID_SIZE);
    const endY = Math.round(seg.b.y / GRID_SIZE);
    for (let y = startY; y <= endY; y += 1) {
      addPenalty(x, y, COST.wire);
      addPenalty(x - 1, y, COST.wireNear);
      addPenalty(x + 1, y, COST.wireNear);
      addPenalty(x, y - 1, COST.wireFar);
      addPenalty(x, y + 1, COST.wireFar);
    }
  }
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

function rotateSide(side, rotation = 0) {
  const angle = ((rotation || 0) % 360 + 360) % 360;
  if (angle === 0) return side;
  const map90 = { left: "bottom", bottom: "right", right: "top", top: "left" };
  const map180 = { left: "right", right: "left", top: "bottom", bottom: "top" };
  const map270 = { left: "top", top: "right", right: "bottom", bottom: "left" };
  if (angle === 90) return map90[side] || side;
  if (angle === 180) return map180[side] || side;
  if (angle === 270) return map270[side] || side;
  return side;
}

function getPortSide(block, port, rotatedPoint) {
  const angle = ((block.rotation || 0) % 360 + 360) % 360;
  if (angle === 0) return port.side;
  const center = { x: block.x + block.width / 2, y: block.y + block.height / 2 };
  const dx = rotatedPoint.x - center.x;
  const dy = rotatedPoint.y - center.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? "left" : "right";
  return dy < 0 ? "top" : "bottom";
}

function snapAnchor(anchor) {
  return { x: snap(anchor.x), y: snap(anchor.y) };
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

function getBlockBodyBounds(block) {
  return getRotatedBounds(block);
}

function getBlockBounds(block) {
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
  return { left, right, top, bottom };
}

function anchorFromPort(port, side, _index = 0, lane = 0) {
  const offset = GRID_SIZE;
  const laneShift = laneOffset(lane) * GRID_SIZE;
  if (side === "left") return { x: port.x - offset - laneShift, y: port.y };
  if (side === "right") return { x: port.x + offset + laneShift, y: port.y };
  if (side === "top") return { x: port.x, y: port.y - offset - laneShift };
  return { x: port.x, y: port.y + offset + laneShift };
}

function laneOffset(index) {
  if (index === 0) return 0;
  const step = Math.ceil(index / 2);
  return index % 2 === 1 ? step : -step;
}

function sideToDir(side, mode) {
  if (mode === "in") {
    if (side === "left") return "r";
    if (side === "right") return "l";
    if (side === "top") return "d";
    return "u";
  }
  if (side === "left") return "l";
  if (side === "right") return "r";
  if (side === "top") return "u";
  return "d";
}

function pointsToSegments(points) {
  const segments = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    if (a.x === b.x && a.y === b.y) continue;
    if (a.x === b.x) {
      const minY = Math.min(a.y, b.y);
      const maxY = Math.max(a.y, b.y);
      segments.push({ orientation: "V", a: { x: a.x, y: minY }, b: { x: b.x, y: maxY } });
    } else {
      const minX = Math.min(a.x, b.x);
      const maxX = Math.max(a.x, b.x);
      segments.push({ orientation: "H", a: { x: minX, y: a.y }, b: { x: maxX, y: b.y } });
    }
  }
  return segments;
}

function buildPathWithHops(segments, otherSegments) {
  if (segments.length === 0) return "";
  const commands = [];
  let current = segments[0].a;
  commands.push(`M ${current.x} ${current.y}`);

  segments.forEach((seg) => {
    if (current.x !== seg.a.x || current.y !== seg.a.y) {
      const mid = { x: seg.a.x, y: current.y };
      if (current.x !== mid.x || current.y !== mid.y) {
        commands.push(`L ${mid.x} ${mid.y}`);
      }
      if (mid.x !== seg.a.x || mid.y !== seg.a.y) {
        commands.push(`L ${seg.a.x} ${seg.a.y}`);
      }
      current = seg.a;
    }

    if (seg.orientation === "H") {
      const crossings = getCrossingsOnHorizontal(seg, otherSegments)
        .filter((x) => x > seg.a.x + HOP_RADIUS && x < seg.b.x - HOP_RADIUS)
        .sort((a, b) => a - b)
        .map((x) => ({ x }));

      crossings.forEach((cross) => {
        commands.push(`L ${cross.x - HOP_RADIUS} ${seg.a.y}`);
        commands.push(`a ${HOP_RADIUS} ${HOP_RADIUS} 0 0 1 ${HOP_RADIUS * 2} 0`);
      });
      commands.push(`L ${seg.b.x} ${seg.b.y}`);
    } else {
      const crossings = getCrossingsOnVertical(seg, otherSegments)
        .filter((y) => y > seg.a.y + HOP_RADIUS && y < seg.b.y - HOP_RADIUS)
        .sort((a, b) => a - b)
        .map((y) => ({ y }));
      crossings.forEach((cross) => {
        commands.push(`L ${seg.a.x} ${cross.y - HOP_RADIUS}`);
        commands.push(`a ${HOP_RADIUS} ${HOP_RADIUS} 0 0 1 0 ${HOP_RADIUS * 2}`);
      });
      commands.push(`L ${seg.b.x} ${seg.b.y}`);
    }
    current = seg.b;
  });

  return commands.join(" ");
}

function getCrossingsOnHorizontal(seg, otherSegments) {
  const hits = [];
  const y = seg.a.y;
  const minX = Math.min(seg.a.x, seg.b.x);
  const maxX = Math.max(seg.a.x, seg.b.x);
  otherSegments.forEach((other) => {
    if (other.orientation !== "V") return;
    const x = other.a.x;
    const minY = Math.min(other.a.y, other.b.y);
    const maxY = Math.max(other.a.y, other.b.y);
    if (x <= minX || x >= maxX) return;
    if (y <= minY || y >= maxY) return;
    hits.push(x);
  });
  return hits;
}

function getCrossingsOnVertical(seg, otherSegments) {
  const hits = [];
  const x = seg.a.x;
  const minY = Math.min(seg.a.y, seg.b.y);
  const maxY = Math.max(seg.a.y, seg.b.y);
  otherSegments.forEach((other) => {
    if (other.orientation !== "H") return;
    const y = other.a.y;
    const minX = Math.min(other.a.x, other.b.x);
    const maxX = Math.max(other.a.x, other.b.x);
    if (y <= minY || y >= maxY) return;
    if (x <= minX || x >= maxX) return;
    hits.push(y);
  });
  return hits;
}

function segmentsFromPoints(points) {
  const segments = [];
  if (!points || points.length < 2) return segments;
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    if (a.x === b.x && a.y === b.y) continue;
    const orientation = a.x === b.x ? "V" : "H";
    segments.push({ a, b, orientation });
  }
  return segments;
}

function edgeKey(a, b) {
  const ax = a.x;
  const ay = a.y;
  const bx = b.x;
  const by = b.y;
  if (ax < bx || (ax === bx && ay <= by)) return `${ax},${ay}|${bx},${by}`;
  return `${bx},${by}|${ax},${ay}`;
}

function addEdgesFromPoints(points, edgeSet) {
  if (!points || points.length < 2) return;
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    if (a.x !== b.x && a.y !== b.y) continue;
    const ax = Math.round(a.x / GRID_SIZE);
    const ay = Math.round(a.y / GRID_SIZE);
    const bx = Math.round(b.x / GRID_SIZE);
    const by = Math.round(b.y / GRID_SIZE);
    const dx = Math.sign(bx - ax);
    const dy = Math.sign(by - ay);
    let x = ax;
    let y = ay;
    while (x !== bx || y !== by) {
      const nx = x + dx;
      const ny = y + dy;
      edgeSet.add(edgeKey({ x, y }, { x: nx, y: ny }));
      x = nx;
      y = ny;
    }
  }
}

function addOccupiedNodes(points, nodeMap) {
  if (!points || points.length < 2) return;
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    if (a.x !== b.x && a.y !== b.y) continue;
    const ax = Math.round(a.x / GRID_SIZE);
    const ay = Math.round(a.y / GRID_SIZE);
    const bx = Math.round(b.x / GRID_SIZE);
    const by = Math.round(b.y / GRID_SIZE);
    const dx = Math.sign(bx - ax);
    const dy = Math.sign(by - ay);
    const orientation = dx !== 0 ? "H" : "V";
    let x = ax;
    let y = ay;
    while (x !== bx || y !== by) {
      const key = `${x},${y}`;
      const entry = nodeMap.get(key) || { H: 0, V: 0 };
      entry[orientation] += 1;
      nodeMap.set(key, entry);
      x += dx;
      y += dy;
    }
  }
}

function buildCrossPenalty(nodeMap, offset, width, height) {
  if (!nodeMap) return null;
  const minX = Math.floor(offset.x / GRID_SIZE);
  const minY = Math.floor(offset.y / GRID_SIZE);
  const maxX = Math.floor((offset.x + width) / GRID_SIZE);
  const maxY = Math.floor((offset.y + height) / GRID_SIZE);
  return (x, y, dir) => {
    const gx = x + minX;
    const gy = y + minY;
    if (gx < minX || gx > maxX || gy < minY || gy > maxY) return 0;
    const entry = nodeMap.get(`${gx},${gy}`);
    if (!entry) return 0;
    if (dir === "l" || dir === "r") return entry.V > 0 ? COST.cross : 0;
    if (dir === "u" || dir === "d") return entry.H > 0 ? COST.cross : 0;
    return 0;
  };
}

function buildEdgePenalty(edgeSet, penalty, allowedEdges = null, offset = { x: 0, y: 0 }, width = 0, height = 0) {
  if (!edgeSet || edgeSet.size === 0) return null;
  const allowedLocal =
    allowedEdges && allowedEdges.size > 0 ? toLocalEdges(allowedEdges, offset, width, height) : null;
  return (edgeKey) => {
    if (allowedLocal && allowedLocal.has(edgeKey)) return 0;
    return edgeSet.has(edgeKey) ? penalty : 0;
  };
}

function buildEdgeBlocker(edgeSet, allowedEdges, offset, width, height) {
  if (!edgeSet || edgeSet.size === 0) return null;
  const local = toLocalEdges(edgeSet, offset, width, height);
  if (!allowedEdges || allowedEdges.size === 0) return (edgeKey) => local.has(edgeKey);
  const allowedLocal = toLocalEdges(allowedEdges, offset, width, height);
  return (edgeKey) => local.has(edgeKey) && !allowedLocal.has(edgeKey);
}

function addStubEdgesForPort(points, edgesByPort, blockId, type, index, isFrom) {
  if (!points || points.length < 2) return;
  const key = portKey(blockId, type, index);
  const set = edgesByPort.get(key) || new Set();
  const stubPoints = isFrom ? points.slice(0, 3) : points.slice(-3);
  addEdgesFromPoints(stubPoints, set);
  edgesByPort.set(key, set);
}

function allowedEdgeSet(edgesByPort, conn) {
  const fromKey = portKey(conn.from, "out", conn.fromIndex ?? 0);
  const toKey = portKey(conn.to, "in", conn.toIndex);
  const allowed = new Set();
  const fromEdges = edgesByPort.get(fromKey);
  const toEdges = edgesByPort.get(toKey);
  if (fromEdges) fromEdges.forEach((edge) => allowed.add(edge));
  if (toEdges) toEdges.forEach((edge) => allowed.add(edge));
  return allowed;
}

function portKey(id, type, index) {
  return `${id}:${type}:${index}`;
}

function toLocalEdges(edgeSet, offset, width, height) {
  const local = new Set();
  const minX = Math.floor(offset.x / GRID_SIZE);
  const minY = Math.floor(offset.y / GRID_SIZE);
  const maxX = Math.floor((offset.x + width) / GRID_SIZE);
  const maxY = Math.floor((offset.y + height) / GRID_SIZE);
  edgeSet.forEach((key) => {
    const [aRaw, bRaw] = key.split("|");
    const [ax, ay] = aRaw.split(",").map(Number);
    const [bx, by] = bRaw.split(",").map(Number);
    if (ax < minX || ax > maxX || ay < minY || ay > maxY) return;
    if (bx < minX || bx > maxX || by < minY || by > maxY) return;
    const a = { x: ax - minX, y: ay - minY };
    const b = { x: bx - minX, y: by - minY };
    local.add(edgeKey(a, b));
  });
  return local;
}

function buildPointsWithHops(points, otherSegments) {
  if (!points || points.length < 2) return points || [];
  const hopPoints = [];
  const pushPoint = (pt) => {
    const last = hopPoints[hopPoints.length - 1];
    if (!last || last.x !== pt.x || last.y !== pt.y) {
      hopPoints.push({ x: pt.x, y: pt.y });
    }
  };
  const hop = (start, end, crossings, axis) => {
    pushPoint(start);
    crossings.forEach((cross) => {
      if (axis === "H") {
        pushPoint({ x: cross.x - HOP_RADIUS, y: start.y });
        pushPoint({ x: cross.x + HOP_RADIUS, y: start.y });
      } else {
        pushPoint({ x: start.x, y: cross.y - HOP_RADIUS });
        pushPoint({ x: start.x, y: cross.y + HOP_RADIUS });
      }
    });
    pushPoint(end);
  };

  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    if (a.x === b.x && a.y === b.y) continue;
    const isStubSegment = i === 0 || i === points.length - 2;
    if (isStubSegment) {
      pushPoint(a);
      pushPoint(b);
      continue;
    }
    const isVertical = a.x === b.x;
    const isHorizontal = a.y === b.y;
    if (!isVertical && !isHorizontal) {
      pushPoint(a);
      pushPoint(b);
      continue;
    }
    if (isVertical) {
      const minY = Math.min(a.y, b.y);
      const maxY = Math.max(a.y, b.y);
      const crossings = otherSegments
        .filter((s) => s.orientation === "H")
        .map((s) => ({ y: s.a.y, x1: s.a.x, x2: s.b.x }))
        .filter((s) => s.y > minY + HOP_RADIUS && s.y < maxY - HOP_RADIUS)
        .filter((s) => s.x1 <= a.x && s.x2 >= a.x)
        .sort((c1, c2) => (a.y < b.y ? c1.y - c2.y : c2.y - c1.y));
      hop(a, b, crossings, "V");
    } else {
      const minX = Math.min(a.x, b.x);
      const maxX = Math.max(a.x, b.x);
      const crossings = otherSegments
        .filter((s) => s.orientation === "V")
        .map((s) => ({ x: s.a.x, y1: s.a.y, y2: s.b.y }))
        .filter((s) => s.x > minX + HOP_RADIUS && s.x < maxX - HOP_RADIUS)
        .filter((s) => s.y1 <= a.y && s.y2 >= a.y)
        .sort((c1, c2) => (a.x < b.x ? c1.x - c2.x : c2.x - c1.x));
      hop(a, b, crossings, "H");
    }
  }

  return simplifyPointsPreserveEnds(hopPoints);
}

function simplifyPointsLocked(points, locked) {
  if (!points || points.length <= 2) return points || [];
  const simplified = [points[0]];
  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = simplified[simplified.length - 1];
    const curr = points[i];
    const next = points[i + 1];
    if (locked.has(pointKey(curr))) {
      simplified.push(curr);
      continue;
    }
    const sameX = prev.x === curr.x && curr.x === next.x;
    const sameY = prev.y === curr.y && curr.y === next.y;
    if (sameX || sameY) continue;
    simplified.push(curr);
  }
  simplified.push(points[points.length - 1]);
  return simplified;
}

function simplifyPointsPreserveEnds(points) {
  if (!points || points.length <= 4) return points || [];
  const head = points.slice(0, 2);
  const tail = points.slice(-2);
  const mid = points.slice(2, -2);
  const simplifiedMid = simplifyPoints(mid);
  return [...head, ...simplifiedMid, ...tail];
}

function pointKey(point) {
  return `${point.x},${point.y}`;
}

function stubPointFromPort(port, side) {
  if (side === "left") return { x: port.x - GRID_SIZE, y: port.y };
  if (side === "right") return { x: port.x + GRID_SIZE, y: port.y };
  if (side === "top") return { x: port.x, y: port.y - GRID_SIZE };
  return { x: port.x, y: port.y + GRID_SIZE };
}

function segmentClear(a, b, obstacles, blockedEdges) {
  if (a.x !== b.x && a.y !== b.y) return false;
  if (obstacles.some((rect) => segmentHitsRect(a, b, rect))) return false;
  if (!blockedEdges || blockedEdges.size === 0) return true;
  const ax = Math.round(a.x / GRID_SIZE);
  const ay = Math.round(a.y / GRID_SIZE);
  const bx = Math.round(b.x / GRID_SIZE);
  const by = Math.round(b.y / GRID_SIZE);
  const dx = Math.sign(bx - ax);
  const dy = Math.sign(by - ay);
  let x = ax;
  let y = ay;
  while (x !== bx || y !== by) {
    const nx = x + dx;
    const ny = y + dy;
    if (blockedEdges.has(edgeKey({ x, y }, { x: nx, y: ny }))) return false;
    x = nx;
    y = ny;
  }
  return true;
}

function segmentClearAllowed(a, b, obstacles, blockedEdges, allowedEdges) {
  if (a.x !== b.x && a.y !== b.y) return false;
  if (obstacles.some((rect) => segmentHitsRect(a, b, rect))) return false;
  if (!blockedEdges || blockedEdges.size === 0) return true;
  const ax = Math.round(a.x / GRID_SIZE);
  const ay = Math.round(a.y / GRID_SIZE);
  const bx = Math.round(b.x / GRID_SIZE);
  const by = Math.round(b.y / GRID_SIZE);
  const dx = Math.sign(bx - ax);
  const dy = Math.sign(by - ay);
  let x = ax;
  let y = ay;
  while (x !== bx || y !== by) {
    const nx = x + dx;
    const ny = y + dy;
    const key = edgeKey({ x, y }, { x: nx, y: ny });
    if (blockedEdges.has(key) && !(allowedEdges && allowedEdges.has(key))) return false;
    x = nx;
    y = ny;
  }
  return true;
}

function findTwoTurnPathAllowed(start, end, obstacles, blockedEdges, allowedEdges) {
  if (start.x === end.x || start.y === end.y) return [start, end];
  const candidates = [];
  const xs = new Set([start.x, end.x]);
  const ys = new Set([start.y, end.y]);
  obstacles.forEach((rect) => {
    xs.add(snap(rect.left - GRID_SIZE));
    xs.add(snap(rect.right + GRID_SIZE));
    ys.add(snap(rect.top - GRID_SIZE));
    ys.add(snap(rect.bottom + GRID_SIZE));
  });
  xs.forEach((x) => {
    const p1 = { x, y: start.y };
    const p2 = { x, y: end.y };
    if (
      segmentClearAllowed(start, p1, obstacles, blockedEdges, allowedEdges) &&
      segmentClearAllowed(p1, p2, obstacles, blockedEdges, allowedEdges) &&
      segmentClearAllowed(p2, end, obstacles, blockedEdges, allowedEdges)
    ) {
      candidates.push([start, p1, p2, end]);
    }
  });
  ys.forEach((y) => {
    const p1 = { x: start.x, y };
    const p2 = { x: end.x, y };
    if (
      segmentClearAllowed(start, p1, obstacles, blockedEdges, allowedEdges) &&
      segmentClearAllowed(p1, p2, obstacles, blockedEdges, allowedEdges) &&
      segmentClearAllowed(p2, end, obstacles, blockedEdges, allowedEdges)
    ) {
      candidates.push([start, p1, p2, end]);
    }
  });
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => pathLength(a) - pathLength(b));
  return simplifyPoints(candidates[0]);
}

function pathLength(points) {
  let length = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    length += Math.abs(points[i].x - points[i + 1].x) + Math.abs(points[i].y - points[i + 1].y);
  }
  return length;
}

function countTurns(points) {
  let turns = 0;
  let prevDir = null;
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    if (a.x === b.x && a.y === b.y) continue;
    const dir = a.x === b.x ? "V" : a.y === b.y ? "H" : null;
    if (!dir) continue;
    if (prevDir && dir !== prevDir) turns += 1;
    prevDir = dir;
  }
  return turns;
}

function computeRouteWindow(from, to, obstacles, worldW, worldH, margin = GRID_SIZE * 30) {
  const base = {
    minX: Math.min(from.x, to.x),
    maxX: Math.max(from.x, to.x),
    minY: Math.min(from.y, to.y),
    maxY: Math.max(from.y, to.y),
  };
  const expanded = {
    left: Math.max(0, base.minX - margin),
    right: Math.min(worldW, base.maxX + margin),
    top: Math.max(0, base.minY - margin),
    bottom: Math.min(worldH, base.maxY + margin),
  };
  const align = (value, mode) => {
    const scaled = value / GRID_SIZE;
    return mode === "floor"
      ? Math.floor(scaled) * GRID_SIZE
      : Math.ceil(scaled) * GRID_SIZE;
  };
  const aligned = {
    left: align(expanded.left, "floor"),
    right: align(expanded.right, "ceil"),
    top: align(expanded.top, "floor"),
    bottom: align(expanded.bottom, "ceil"),
  };
  const filtered = obstacles.filter(
    (rect) =>
      rect.right >= aligned.left &&
      rect.left <= aligned.right &&
      rect.bottom >= aligned.top &&
      rect.top <= aligned.bottom
  );
  const window = {
    left: aligned.left,
    right: aligned.right,
    top: aligned.top,
    bottom: aligned.bottom,
  };
  return {
    offset: { x: window.left, y: window.top },
    width: Math.max(GRID_SIZE * 2, window.right - window.left),
    height: Math.max(GRID_SIZE * 2, window.bottom - window.top),
    obstacles: filtered,
    usedLocal: true,
  };
}

function getRouteStats(points) {
  let length = 0;
  let turns = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    length += Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    if (i > 0) {
      const p = points[i - 1];
      const dir1 = a.x === p.x ? "V" : "H";
      const dir2 = b.x === a.x ? "V" : "H";
      if (dir1 !== dir2) turns += 1;
    }
  }
  return { length, turns };
}
