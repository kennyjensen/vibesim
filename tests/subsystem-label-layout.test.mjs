import assert from "node:assert/strict";
import {
  computeSubsystemPortLabelFrame,
  SUBSYSTEM_PORT_LABEL_EDGE_PAD,
} from "../blocks/utility.js";

const blockWidth = 240;
const blockHeight = 100;
const portY = 37;

const left = computeSubsystemPortLabelFrame({
  blockWidth,
  blockHeight,
  portY,
  side: "left",
});

const right = computeSubsystemPortLabelFrame({
  blockWidth,
  blockHeight,
  portY,
  side: "right",
});

assert.equal(left.y + left.height / 2, portY, "left label should be vertically centered on port");
assert.equal(right.y + right.height / 2, portY, "right label should be vertically centered on port");

assert.equal(left.x, SUBSYSTEM_PORT_LABEL_EDGE_PAD, "left label box should start at left edge padding");
assert.equal(
  right.x + right.width,
  blockWidth - SUBSYSTEM_PORT_LABEL_EDGE_PAD,
  "right label box should end at right edge padding"
);

console.log("subsystem label layout test passed");
