import assert from "assert";
import { getSnapOffset, lockAxis, shouldCollapse, shouldExpand } from "../carousel-utils.js";

assert.strictEqual(lockAxis(0, 0), null);
assert.strictEqual(lockAxis(10, 1), "x");
assert.strictEqual(lockAxis(1, 10), "y");
assert.strictEqual(lockAxis(5, 5), null);

assert.strictEqual(shouldCollapse(10), false);
assert.strictEqual(shouldCollapse(30), true);
assert.strictEqual(shouldExpand(-10), false);
assert.strictEqual(shouldExpand(-20), true);

assert.strictEqual(getSnapOffset(0, [0, 200, 400]), 0);
assert.strictEqual(getSnapOffset(150, [0, 200, 400]), 200);
assert.strictEqual(getSnapOffset(399, [0, 200, 400]), 400);
assert.strictEqual(getSnapOffset(100, [200, 500]), 200);

console.log("carousel-utils tests passed");
