import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import * as jsx from "react/jsx-runtime";
import * as ReactDOM from "react-dom";
import * as ReactDOMClient from "react-dom/client";
import { renderToString } from "react-dom/server";
import * as Cordis from "../runtime-evidence/dsh/node_modules/@deepseek-ai/cordis/lib/index.js";
import * as Slots from "../runtime-evidence/dsh/node_modules/@deepseek-ai/dsh-client-ui-slots/lib/index.js";
import * as preferences from "../client/preferences.mjs";
import * as workspaceState from "../client/workspace-state.mjs";
import * as shortcuts from "../client/shortcuts.mjs";
import * as workspaceTabs from "../client/workspace-tabs.mjs";
import { buildConversationFork } from "../scripts/conversation-fork.mjs";

const artifact = (name) =>
  readFileSync(
    new URL(
      `../runtime-evidence/dsh/node_modules/@deepseek-ai/${name}/lib/client.js`,
      import.meta.url,
    ),
    "utf8",
  );

function observable(initial) {
  let value = initial;
  const listeners = new Set();
  return {
    getSnapshot: () => value,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(next) {
      value = next;
      for (const listener of listeners) listener();
    },
  };
}

// Real Cordis, SlotRegistry, fork apply(), and unchanged native preset plugin.
// Only session/remote IO, snapshot storage, and the final workspace view are fixtures.
function loadNative(source, workspaceView) {
  let result;
  const modules = {
    react: React,
    "react/jsx-runtime": jsx,
    "react-dom": ReactDOM,
    "react-dom/client": ReactDOMClient,
    "@deepseek-ai/cordis": Cordis,
    "@deepseek-ai/dsh-client-ui-slots": Slots,
    "@deepseek-ai/dsh-client-ui-primitives": new Proxy(
      {},
      { get: () => () => null },
    ),
    "@deepseek-ai/dsh-client-store": {
      createSnapshotStore: observable,
      defineStore: (spec) => ({ spec }),
      notifySubscribers: (listeners, _label, ...args) => {
        for (const listener of listeners) listener(...args);
      },
    },
    "dsh-multi-panel/preferences": preferences,
    "dsh-multi-panel/workspace-state": workspaceState,
    "dsh-multi-panel/shortcuts": shortcuts,
    "dsh-multi-panel/workspace-tabs": workspaceTabs,
    "dsh-multi-panel/workspace-tabs-view": { WorkspaceTabs: workspaceView },
  };
  new Function("window", source)({
    __ModuleLoader__: {
      load(definition) {
        result = definition.factory((name) => {
          assert.ok(Object.hasOwn(modules, name), `unexpected module ${name}`);
          return modules[name];
        });
      },
    },
  });
  return result;
}

async function settle(ctx) {
  await Promise.all(
    [...ctx.registry.values()].flatMap((runtime) =>
      [...runtime.fibers].map((fiber) => fiber.await()),
    ),
  );
}

test("cold start registers the native preset before rendering and keeps selections on the focused blank session", async () => {
  const ctx = new Cordis.Context();
  const { SlotRegistry } = loadNative(artifact("dsh-client-ui-renderer"));
  const slotsOwner = ctx.plugin(SlotRegistry);
  await slotsOwner.await();
  const slots = ctx.get("slots");
  const layout = slots.register(
    {
      name: "root",
      children: {
        main: { kind: "keyed", scope: "root" },
        "settings.section": { kind: "list", scope: "root" },
        "settings.general.item": { kind: "list", scope: "root" },
      },
    },
    () => null,
  );
  const form = observable({ status: "loading", value: {} });
  const developerTools = observable(true);
  const catalog = observable({
    phase: "ready",
    ids: ["alpha", "beta"],
    byId: Object.fromEntries(
      ["alpha", "beta"].map((id) => [
        id,
        {
          id,
          blank: true,
          retainedBy: { mainView: id === "alpha" ? 1 : 0 },
          projectionValues: { agentPreset: "standard" },
        },
      ]),
    ),
  });
  const updateSession = (id, update) => {
    const snapshot = catalog.getSnapshot();
    catalog.set({
      ...snapshot,
      byId: { ...snapshot.byId, [id]: update(snapshot.byId[id]) },
    });
  };
  const bindings = new Map(
    catalog
      .getSnapshot()
      .ids.map((id) => [id, { sessionId: id, ctx: new Cordis.Context() }]),
  );
  const sessions = {
    list: catalog,
    binding: (id) => bindings.get(id),
    retainInfo: (id) => ({
      getSnapshot: () => ({
        retainedBy: catalog.getSnapshot().byId[id].retainedBy,
      }),
    }),
    retain(id, { source }) {
      const change = (delta) =>
        updateSession(id, (row) => ({
          ...row,
          retainedBy: {
            ...row.retainedBy,
            [source]: (row.retainedBy[source] ?? 0) + delta,
          },
        }));
      change(1);
      return { ready: Promise.resolve(), release: () => change(-1) };
    },
  };
  const navigation = {
    openSession(id) {
      const snapshot = catalog.getSnapshot();
      catalog.set({
        ...snapshot,
        byId: Object.fromEntries(
          Object.entries(snapshot.byId).map(([key, row]) => [
            key,
            {
              ...row,
              retainedBy: { ...row.retainedBy, mainView: +(key === id) },
            },
          ]),
        ),
      });
    },
  };
  const selections = [];
  const agentPresets = {
    async list() {
      return {
        ok: true,
        value: {
          presets: [
            { id: "standard", isDefault: true },
            { id: "ptc" },
            { id: "cordis" },
            { id: "broken", broken: "unavailable dependency" },
          ],
        },
      };
    },
    async select(sessionId, presetId) {
      selections.push([sessionId, presetId]);
      updateSession(sessionId, (row) => ({
        ...row,
        projectionValues: { agentPreset: presetId },
      }));
      return { ok: true, value: presetId };
    },
  };
  const remote = { agentPresets, settings: {}, $on: () => () => {} };
  for (const [name, value] of Object.entries({
    sessions,
    uiSession: { provide() {} },
    uiWorkspace: navigation,
    fileUpload: {},
    locale: {
      register: () => () => {},
      bind: () => (key) => key,
      subscribe: () => () => {},
    },
    configForms: {
      get: () => form,
      developerTools: { enabled: developerTools },
    },
    remote,
    "remote.agentPresets": agentPresets,
    "remote.settings": remote.settings,
  }))
    ctx.reflect.provide(name, value);

  let workspace;
  let tabs;
  const conversation = loadNative(
    buildConversationFork(artifact("dsh-client-ui-conversation")),
    (props) => {
      assert.ok(ctx.get("uiConversation"));
      assert.ok(ctx.get("conversation"));
      tabs = props.tabs;
      workspace = tabs.active();
      return React.createElement("div", null, "ready workspace");
    },
  );
  const preset = loadNative(artifact("dsh-client-ui-agent-preset"));
  const presetOwner = ctx.plugin(preset);
  await presetOwner.await();
  const eagerRenders = [];
  const stopEagerRender = ctx.on("slots/changed", (key) => {
    const main = key === "main" ? slots.entries(key)[0] : undefined;
    if (main)
      eagerRenders.push(
        renderToString(React.createElement(main.component, main.inject())),
      );
  });
  const previousStorage = Object.getOwnPropertyDescriptor(
    globalThis,
    "localStorage",
  );
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: () => null, setItem() {} },
  });
  let conversationOwner;
  try {
    conversationOwner = ctx.plugin({
      inject: conversation.inject,
      apply: (scope) =>
        conversation.apply(scope, {
          maxConcurrentFileUploads: 2,
          multiPanelPreferences: preferences.createPreferencesSource(form),
        }),
    });
    await conversationOwner.await();
    await settle(ctx);
    assert.deepEqual(
      eagerRenders,
      [""],
      "synchronous slot listeners cannot render panes before native services activate",
    );
    const chip = slots.entries("conversation.hero.agentPreset");
    assert.equal(chip.length, 1, "native chip registers without reload/retry");
    assert.equal(
      slots
        .entries("conversation.session.header.actions")
        .filter((entry) => entry.options.id === "agent-preset").length,
      1,
    );
    const main = slots.entries("main")[0];
    const props = main.inject();
    const render = () =>
      renderToString(React.createElement(main.component, props));
    assert.equal(
      render(),
      "",
      "preferences still loading: no eager pane render",
    );
    form.set({ status: "ready", value: { restoreLayout: false } });
    await settle(ctx);
    assert.match(render(), /ready workspace/);

    const alphaPane = workspace.getSnapshot().tree.id;
    workspace.split(alphaPane, "beta", "right");
    const betaPane = workspace.getSnapshot().activeId;
    const alpha = chip[0].inject("alpha");
    const beta = chip[0].inject("beta");
    await Promise.all([alpha.load(), beta.load()]);
    assert.notEqual(alpha.hooks.agentPresetSeat, beta.hooks.agentPresetSeat);
    assert.deepEqual(
      alpha.hooks.agentPresetSeat.getSnapshot().options.map((item) => item.id),
      ["standard", "ptc", "cordis"],
    );
    workspace.focus(alphaPane);
    await alpha.select("ptc");
    workspace.focus(betaPane);
    await beta.select("cordis");
    assert.deepEqual(selections, [
      ["alpha", "ptc"],
      ["beta", "cordis"],
    ]);
    assert.equal(
      catalog.getSnapshot().byId.alpha.projectionValues.agentPreset,
      "ptc",
    );
    assert.equal(
      catalog.getSnapshot().byId.beta.projectionValues.agentPreset,
      "cordis",
    );
    updateSession("beta", (row) => ({ ...row, blank: false }));
    await beta.select("standard");
    workspace.focus(alphaPane);
    developerTools.set(false);
    await alpha.select("standard");
    assert.equal(
      selections.length,
      2,
      "native committed-chat and Developer tools guards remain authoritative",
    );

    // A blank tab never claims or releases the chats kept alive in the first.
    tabs.add();
    assert.equal(tabs.getSnapshot().tabs.length, 2);
    assert.equal(tabs.active().getSnapshot().tree.sessionId, null);
    assert.equal(catalog.getSnapshot().byId.alpha.retainedBy.multiPanel, 1);
    assert.equal(catalog.getSnapshot().byId.beta.retainedBy.multiPanel, 1);
    tabs.select(tabs.getSnapshot().tabs[0].id);
    assert.equal(tabs.active(), workspace);

    await conversationOwner.dispose();
    await settle(ctx);
    assert.equal(
      render(),
      "",
      "disposing native faces retracts pane rendering",
    );
    assert.equal(slots.entries("conversation.hero.agentPreset").length, 0);
    assert.equal(catalog.getSnapshot().byId.alpha.retainedBy.multiPanel, 0);
    assert.equal(catalog.getSnapshot().byId.beta.retainedBy.multiPanel, 0);
  } finally {
    stopEagerRender();
    await conversationOwner?.dispose();
    await presetOwner.dispose();
    layout();
    await slotsOwner.dispose();
    if (previousStorage)
      Object.defineProperty(globalThis, "localStorage", previousStorage);
    else delete globalThis.localStorage;
  }
});
