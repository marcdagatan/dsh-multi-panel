import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  Context,
  Service,
} from "../runtime-evidence/dsh/node_modules/@deepseek-ai/cordis/lib/index.js";
import { buildConversationFork } from "../scripts/conversation-fork.mjs";

const native = readFileSync(
  new URL(
    "../runtime-evidence/dsh/node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js",
    import.meta.url,
  ),
  "utf8",
);

test("native Cordis does not expose a service through get during its owner apply", async () => {
  const root = new Context();
  let duringApply;
  let registered;
  const owner = root.plugin({
    apply(ctx) {
      registered = new Service(ctx, "conversation");
      assert.equal(
        ctx.reflect._getImpl("conversation", false)?.value,
        registered,
      );
      duringApply = ctx.get("conversation");
    },
  });
  await owner.await();
  assert.equal(
    duringApply,
    undefined,
    "eager slot listeners would cache a missing native composer service",
  );
  assert.ok(
    root.get("conversation"),
    "service becomes readable only after activation",
  );
  await owner.dispose();
});

test("conversation presentation waits for active native faces and retracts if the controller unloads", async () => {
  const root = new Context();
  const ready = Promise.withResolvers();
  const trace = [];
  let controller;
  let ownerContext;
  const owner = root.plugin({
    apply(ctx) {
      ownerContext = ctx;
      new Service(ctx, "uiConversation");
      controller = ctx.plugin(
        class extends Service {
          constructor(scope) {
            super(scope, "conversation");
            this.initialized = true;
          }
        },
      );
      ctx.inject(["uiConversation", "conversation"], (mount) => {
        assert.equal(ctx.fiber.state, 2);
        assert.equal(controller.state, 2);
        assert.equal(mount.get("conversation").initialized, true);
        assert.ok(mount.get("uiConversation"));
        mount.effect(() => {
          trace.push("mounted");
          ready.resolve();
          return () => trace.push("unmounted");
        });
      });
    },
  });
  await owner.await();
  await ready.promise;
  assert.deepEqual(trace, ["mounted"]);
  assert.equal(ownerContext.get("conversation").initialized, true);
  await controller.dispose();
  assert.deepEqual(trace, ["mounted", "unmounted"]);
  await owner.dispose();
});

test("pinned native fork preserves controller plugin ownership and rejects unsupported artifacts", () => {
  const fork = buildConversationFork(native);
  assert.ok(fork.includes("ctx.plugin(ConversationController, {"));
  assert.ok(!fork.includes("new ConversationController(ctx,"));
  assert.throws(() => buildConversationFork(native + "\n"), /SHA-256 mismatch/);
});
