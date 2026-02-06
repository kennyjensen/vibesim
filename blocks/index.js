import { sourceLibrary, createSourceTemplates } from "./source.js";
import { continuousLibrary, createContinuousTemplates } from "./continuous.js";
import { mathLibrary, createMathTemplates } from "./math.js";
import { discreteLibrary, createDiscreteTemplates } from "./discrete.js";
import { nonlinearLibrary, createNonlinearTemplates } from "./nonlinear.js";
import { sinkLibrary, createSinkTemplates } from "./sink.js";
import { utilityLibrary, createUtilityTemplates } from "./utility.js";

export const blockLibrary = [
  sourceLibrary,
  continuousLibrary,
  mathLibrary,
  discreteLibrary,
  nonlinearLibrary,
  utilityLibrary,
  sinkLibrary,
];

export const buildBlockTemplates = (helpers) => ({
  ...createSourceTemplates(helpers),
  ...createContinuousTemplates(helpers),
  ...createMathTemplates(helpers),
  ...createDiscreteTemplates(helpers),
  ...createNonlinearTemplates(helpers),
  ...createUtilityTemplates(helpers),
  ...createSinkTemplates(helpers),
});
