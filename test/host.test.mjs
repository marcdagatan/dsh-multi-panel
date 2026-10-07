import test from "node:test";
import assert from "node:assert/strict";
import { Config, apply } from "../lib/index.js";
import { PREFERENCE_FIELDS } from "../client/preferences.mjs";

test("Host settings load independently of CLI native-peer aliases and retain the native live defaults", () => {
  assert.equal(Object.keys(Config.dict).length, PREFERENCE_FIELDS.length + 1);
  assert.equal(Config.dict.busyEnter.meta.default, "queue");
  assert.equal(Config.dict.focusHighlight.meta.default, false);
  assert.equal(Config.dict.undoDuration.meta.default, 3);
  for (const field of Object.values(Config.dict))
    assert.equal(field.meta.volatile, true);
  const calls = [];
  const fiber = {};
  apply({
    fiber,
    inject(names, callback) {
      assert.deepEqual(names, ["settings"]);
      callback({
        effect: (register) => register(),
        settings: {
          configure: (options, owner) => calls.push([options, owner]),
        },
      });
    },
  });
  assert.deepEqual(calls, [[{ auto: false }, fiber]]);
});
