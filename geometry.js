export const GRID_SIZE = 10;
export const KEEP_OUT = GRID_SIZE;

export function snap(value) {
  return Math.round(value / GRID_SIZE) * GRID_SIZE;
}

export function expandRect(rect, pad) {
  return {
    left: rect.left - pad,
    right: rect.right + pad,
    top: rect.top - pad,
    bottom: rect.bottom + pad,
  };
}

export function buildGrid(obstacles, width, height) {
  const cols = Math.max(2, Math.floor(width / GRID_SIZE) + 1);
  const rows = Math.max(2, Math.floor(height / GRID_SIZE) + 1);
  const blocked = new Set();

  const markNode = (x, y) => {
    if (x < 0 || y < 0 || x >= cols || y >= rows) return;
    blocked.add(`${x},${y}`);
  };

  obstacles.forEach((rect) => {
    const xStart = Math.floor(rect.left / GRID_SIZE);
    const xEnd = Math.ceil(rect.right / GRID_SIZE);
    const yStart = Math.floor(rect.top / GRID_SIZE);
    const yEnd = Math.ceil(rect.bottom / GRID_SIZE);
    for (let x = xStart; x <= xEnd; x += 1) {
      for (let y = yStart; y <= yEnd; y += 1) {
        markNode(x, y);
      }
    }
  });

  return { cols, rows, blocked };
}

export function toNode(point, cols, rows) {
  const x = Math.min(cols - 1, Math.max(0, Math.round(point.x / GRID_SIZE)));
  const y = Math.min(rows - 1, Math.max(0, Math.round(point.y / GRID_SIZE)));
  return { x, y };
}

export function segmentHitsRect(a, b, rect) {
  if (a.x === b.x) {
    const x = a.x;
    const y1 = Math.min(a.y, b.y);
    const y2 = Math.max(a.y, b.y);
    return x > rect.left && x < rect.right && y2 > rect.top && y1 < rect.bottom;
  }
  if (a.y === b.y) {
    const y = a.y;
    const x1 = Math.min(a.x, b.x);
    const x2 = Math.max(a.x, b.x);
    return y > rect.top && y < rect.bottom && x2 > rect.left && x1 < rect.right;
  }
  return false;
}

export function aStarWithTurns(
  start,
  goal,
  blocked,
  cols,
  rows,
  obstacles,
  turnPenalty = 6,
  penaltyFn = null,
  timeLimitMs = 12,
  edgePenaltyFn = null,
  crossPenaltyFn = null,
  edgeBlockedFn = null,
  startDir = "s",
  endDir = null
) {
  const startTime = Date.now();
  const dirs = [
    { x: 1, y: 0, id: "r" },
    { x: -1, y: 0, id: "l" },
    { x: 0, y: 1, id: "d" },
    { x: 0, y: -1, id: "u" },
  ];
  const shortSegmentPenalty = (length) => {
    if (length === 1) return 60;
    if (length === 2) return 50;
    return 0;
  };

  const startKey = `${start.x},${start.y},${startDir},0`;
  const goalCell = `${goal.x},${goal.y}`;
  const open = [{ key: startKey, x: start.x, y: start.y, dir: startDir, runLen: 0, g: 0, f: 0 }];
  const cameFrom = new Map();
  const gScore = new Map([[startKey, 0]]);
  const closed = new Set();

  const heuristic = (x, y) => Math.abs(x - goal.x) + Math.abs(y - goal.y);

  while (open.length > 0) {
    if (Date.now() - startTime > timeLimitMs) return null;
    open.sort((a, b) => a.f - b.f);
    const current = open.shift();
    if (!current) break;

    if (`${current.x},${current.y}` === goalCell) {
      const path = [{ x: current.x, y: current.y, dir: current.dir }];
      let key = current.key;
      while (cameFrom.has(key)) {
        key = cameFrom.get(key);
        const [cx, cy, cdir] = key.split(",");
        path.push({ x: Number(cx), y: Number(cy), dir: cdir });
      }
      return path.reverse();
    }

    closed.add(current.key);

    dirs.forEach((d) => {
      const nx = current.x + d.x;
      const ny = current.y + d.y;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) return;
      const cellKey = `${nx},${ny}`;
      if (blocked.has(cellKey)) return;

      const aPoint = { x: current.x * GRID_SIZE, y: current.y * GRID_SIZE };
      const bPoint = { x: nx * GRID_SIZE, y: ny * GRID_SIZE };
      if (obstacles.some((rect) => segmentHitsRect(aPoint, bPoint, rect))) return;

      const nextDir = d.id;
      const edgeKey = edgeKeyFromNodes(current, { x: nx, y: ny });
      if (edgeBlockedFn && edgeBlockedFn(edgeKey)) return;
      const isTurn = current.dir !== "s" && current.dir !== nextDir;
      const nextRunLen = isTurn ? 1 : Math.min(3, (current.runLen || 0) + 1);
      const turnCost = isTurn ? turnPenalty + shortSegmentPenalty(current.runLen || 0) : 0;
      const endCost =
        endDir && `${nx},${ny}` === goalCell && nextDir !== endDir ? turnPenalty : 0;
      const endShortCost =
        `${nx},${ny}` === goalCell ? shortSegmentPenalty(nextRunLen) : 0;
      const penalty = penaltyFn ? penaltyFn(nx, ny) : 0;
      const edgePenalty = edgePenaltyFn ? edgePenaltyFn(edgeKey) : 0;
      const crossPenalty = crossPenaltyFn ? crossPenaltyFn(nx, ny, nextDir) : 0;
      const tentativeG =
        (gScore.get(current.key) || 0) +
        1 +
        turnCost +
        endCost +
        endShortCost +
        penalty +
        edgePenalty +
        crossPenalty;
      const nextKey = `${nx},${ny},${nextDir},${nextRunLen}`;
      if (closed.has(nextKey)) return;

      if (!gScore.has(nextKey) || tentativeG < gScore.get(nextKey)) {
        cameFrom.set(nextKey, current.key);
        gScore.set(nextKey, tentativeG);
        const f = tentativeG + heuristic(nx, ny);
        const existing = open.find((node) => node.key === nextKey);
        if (existing) {
          existing.g = tentativeG;
          existing.f = f;
          existing.runLen = nextRunLen;
        } else {
          open.push({ key: nextKey, x: nx, y: ny, dir: nextDir, runLen: nextRunLen, g: tentativeG, f });
        }
      }
    });
  }

  return null;
}

export function segmentLengthStats(points) {
  const stats = { length: 0, seg1: 0, seg2: 0, shortPenalty: 0 };
  if (!points || points.length < 2) return stats;
  let runDir = null;
  let runLen = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (dx === 0 && dy === 0) continue;
    const dir = dx === 0 ? "V" : dy === 0 ? "H" : null;
    if (!dir) continue;
    const segLen = Math.abs(dx) + Math.abs(dy);
    if (!runDir) {
      runDir = dir;
      runLen = segLen;
      continue;
    }
    if (dir === runDir) {
      runLen += segLen;
    } else {
      stats.length += runLen;
      const gridLen = Math.round(runLen / GRID_SIZE);
      if (gridLen === 1) stats.seg1 += 1;
      if (gridLen === 2) stats.seg2 += 1;
      runDir = dir;
      runLen = segLen;
    }
  }
  if (runDir) {
    stats.length += runLen;
    const gridLen = Math.round(runLen / GRID_SIZE);
    if (gridLen === 1) stats.seg1 += 1;
    if (gridLen === 2) stats.seg2 += 1;
  }
  stats.shortPenalty = stats.seg1 * 60 + stats.seg2 * 50;
  return stats;
}

export function simplifyPoints(points) {
  if (points.length <= 2) return points;
  const simplified = [points[0]];
  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = simplified[simplified.length - 1];
    const curr = points[i];
    const next = points[i + 1];
    const sameX = prev.x === curr.x && curr.x === next.x;
    const sameY = prev.y === curr.y && curr.y === next.y;
    if (sameX || sameY) continue;
    simplified.push(curr);
  }
  simplified.push(points[points.length - 1]);
  return simplified;
}

export function routeOrthogonal(
  from,
  to,
  obstacles,
  width,
  height,
  penaltyFn = null,
  turnPenalty = 6,
  timeLimitMs = 12,
  edgePenaltyFn = null,
  crossPenaltyFn = null,
  edgeBlockedFn = null,
  startDir = "s",
  endDir = null
) {
  const { cols, rows, blocked } = buildGrid(obstacles, width, height);
  const start = toNode(from, cols, rows);
  const goal = toNode(to, cols, rows);
  blocked.delete(`${start.x},${start.y}`);
  blocked.delete(`${goal.x},${goal.y}`);

  let cells = aStarWithTurns(
    start,
    goal,
    blocked,
    cols,
    rows,
    obstacles,
    turnPenalty,
    penaltyFn,
    timeLimitMs,
    edgePenaltyFn,
    crossPenaltyFn,
    edgeBlockedFn,
    startDir,
    endDir
  );
  if (!cells) {
    cells = bfsShortest(start, goal, blocked, cols, rows, obstacles, timeLimitMs, edgeBlockedFn);
  }
  if (!cells) return null;

  const points = cells.map((cell) => ({ x: cell.x * GRID_SIZE, y: cell.y * GRID_SIZE }));
  points[0] = { x: from.x, y: from.y };
  points[points.length - 1] = { x: to.x, y: to.y };
  return simplifyPoints(points);
}

function bfsShortest(start, goal, blocked, cols, rows, obstacles, timeLimitMs, edgeBlockedFn) {
  const startTime = Date.now();
  const queue = [start];
  const visited = new Set([`${start.x},${start.y}`]);
  const cameFrom = new Map();
  const dirs = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ];

  while (queue.length > 0) {
    if (Date.now() - startTime > timeLimitMs) return null;
    const current = queue.shift();
    if (!current) break;
    if (current.x === goal.x && current.y === goal.y) {
      const path = [current];
      let key = `${current.x},${current.y}`;
      while (cameFrom.has(key)) {
        const prev = cameFrom.get(key);
        path.push(prev);
        key = `${prev.x},${prev.y}`;
      }
      return path.reverse();
    }

    dirs.forEach((d) => {
      const nx = current.x + d.x;
      const ny = current.y + d.y;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) return;
      const cellKey = `${nx},${ny}`;
      if (blocked.has(cellKey) || visited.has(cellKey)) return;
      if (edgeBlockedFn) {
        const edgeKey = edgeKeyFromNodes(current, { x: nx, y: ny });
        if (edgeBlockedFn(edgeKey)) return;
      }

      const aPoint = { x: current.x * GRID_SIZE, y: current.y * GRID_SIZE };
      const bPoint = { x: nx * GRID_SIZE, y: ny * GRID_SIZE };
      if (obstacles.some((rect) => segmentHitsRect(aPoint, bPoint, rect))) return;

      visited.add(cellKey);
      cameFrom.set(cellKey, current);
      queue.push({ x: nx, y: ny });
    });
  }

  return null;
}

function edgeKeyFromNodes(a, b) {
  if (a.x < b.x || (a.x === b.x && a.y <= b.y)) return `${a.x},${a.y}|${b.x},${b.y}`;
  return `${b.x},${b.y}|${a.x},${a.y}`;
}

export function appendOrth(points, from, to) {
  if (from.x === to.x || from.y === to.y) {
    points.push(to);
    return;
  }
  points.push({ x: to.x, y: from.y });
  points.push(to);
}

export function distancePointToSegment(point, a, b) {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const wx = point.x - a.x;
  const wy = point.y - a.y;
  const c1 = vx * wx + vy * wy;
  if (c1 <= 0) return Math.hypot(point.x - a.x, point.y - a.y);
  const c2 = vx * vx + vy * vy;
  if (c2 <= c1) return Math.hypot(point.x - b.x, point.y - b.y);
  const t = c1 / c2;
  const proj = { x: a.x + t * vx, y: a.y + t * vy };
  return Math.hypot(point.x - proj.x, point.y - proj.y);
}
