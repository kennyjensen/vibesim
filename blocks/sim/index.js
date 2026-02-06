import { sourceSimHandlers, resolveLabelSourcesOnce } from "./source.js";
import { mathSimHandlers } from "./math.js";
import { nonlinearSimHandlers } from "./nonlinear.js";
import { continuousSimHandlers } from "./continuous.js";
import { discreteSimHandlers } from "./discrete.js";
import { sinkSimHandlers } from "./sink.js";
import { utilitySimHandlers } from "./utility.js";

export const simHandlers = {
  ...sourceSimHandlers,
  ...mathSimHandlers,
  ...nonlinearSimHandlers,
  ...continuousSimHandlers,
  ...discreteSimHandlers,
  ...utilitySimHandlers,
  ...sinkSimHandlers,
};

export { resolveLabelSourcesOnce };
