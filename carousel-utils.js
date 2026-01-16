export const lockAxis = (dx, dy, bias = 0.7) => {
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  if (adx < 1 && ady < 1) return null;
  if (adx > ady * bias) return "x";
  if (ady > adx * bias) return "y";
  return null;
};

export const shouldCollapse = (dy, threshold = 24) => dy > threshold;

export const shouldExpand = (dy, threshold = 16) => dy < -threshold;

export const getSnapOffset = (scrollLeft, offsets) => {
  if (!offsets || offsets.length === 0) return 0;
  let best = offsets[0];
  let bestDist = Math.abs(scrollLeft - best);
  for (let i = 1; i < offsets.length; i += 1) {
    const dist = Math.abs(scrollLeft - offsets[i]);
    if (dist < bestDist) {
      bestDist = dist;
      best = offsets[i];
    }
  }
  return best;
};
