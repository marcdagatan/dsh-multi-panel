import { leaves } from "./split-model.mjs";

const COMMANDS = [
  ["split", "Split using the default direction"],
  ["split-right", "Split to the right"],
  ["split-below", "Split below"],
  ["focus-next", "Focus next pane"],
  ["focus-previous", "Focus previous pane"],
  ["maximize", "Maximize or restore pane"],
  ["close", "Close pane (keep chat running)"],
  ["undo", "Undo layout change"],
];

function focusPane(root, paneId) {
  queueMicrotask(() => {
    if (!root.isConnected) return;
    const pane = [...root.querySelectorAll("[data-chat-pane]")].find(
      (element) => element.dataset.chatPane === paneId,
    );
    (pane?.querySelector('[contenteditable="true"], textarea') ?? pane)?.focus({
      preventScroll: true,
    });
  });
}

/** Native shortcut catalog owns key recording, persistence, conflicts and keyboard dispatch. */
export function paneShortcutCommands(workspace, preferencesSource) {
  return COMMANDS.map(([action, label]) => ({
    id: `multi-panel.${action}`,
    label: () => `Multi-panel: ${label}`,
    aliases: ["pane", "split", "layout"],
    defaults: {},
    regions: ["page", "editable", "terminal"],
    modals: [],
    resolve(context) {
      const root = context.target?.closest?.(".dshMulti-workspace");
      if (!root || context.modal != null)
        return { status: "blocked", reason: "Focus a chat pane first" };
      const state = workspace.getSnapshot();
      const panes = leaves(state.tree);
      const activeId = state.activeId;
      const preferences = preferencesSource.getSnapshot();
      if (
        (action === "close" || action.startsWith("focus-")) &&
        panes.length < 2
      )
        return { status: "blocked", reason: "Only one chat pane is open" };
      if (action === "undo" && (!state.undo || !preferences.undoEnabled))
        return { status: "blocked", reason: "No layout change to undo" };
      return {
        status: "handled",
        run: () => {
          if (action.startsWith("split")) {
            const edge =
              action === "split-right"
                ? "right"
                : action === "split-below"
                  ? "bottom"
                  : preferences.splitDirection;
            workspace
              .newChat(activeId, edge)
              .catch((error) =>
                console.error("Multi-panel split shortcut failed:", error),
              );
          } else if (action.startsWith("focus-")) {
            const index = panes.findIndex((pane) => pane.id === activeId);
            const next =
              panes[
                (index + (action === "focus-next" ? 1 : panes.length - 1)) %
                  panes.length
              ].id;
            if (state.maximizedId) workspace.maximize(next);
            workspace.focus(next);
            focusPane(root, next);
          } else if (action === "maximize") workspace.maximize(activeId);
          else if (action === "close") {
            workspace.close(activeId);
            focusPane(root, workspace.getSnapshot().activeId);
          } else {
            workspace.undo();
            focusPane(root, workspace.getSnapshot().activeId);
          }
        },
      };
    },
  }));
}

export function registerPaneShortcuts(ctx, workspace, preferencesSource) {
  ctx.inject(["shortcuts"], (scope) => {
    for (const command of paneShortcutCommands(workspace, preferencesSource)) {
      scope.effect(
        () => scope.shortcuts.register(command),
        `multi-panel: ${command.id}`,
      );
    }
  });
}
