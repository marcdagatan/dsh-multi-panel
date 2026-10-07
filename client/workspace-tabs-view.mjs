import React from "react";
import { leaves, findLeaf } from "./split-model.mjs";
import { MultiWorkspace } from "./workspace.mjs";

const h = React.createElement;

const useStore = (store) =>
  React.useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );

/** Tab label and live activity, derived from that tab's own pane layout. */
export function tabSummary(state, sessions) {
  const panes = leaves(state.tree);
  const sessionIds = panes.map((pane) => pane.sessionId).filter(Boolean);
  const focused = findLeaf(state.tree, state.activeId)?.sessionId;
  return {
    title:
      sessions.byId[focused ?? sessionIds[0]]?.title ||
      (sessionIds.length ? "Untitled chat" : "New workspace"),
    panes: panes.length,
    running: sessionIds.filter((id) => sessions.byId[id]?.running).length,
  };
}

function Tab({ tab, selected, closable, tabs, sessions }) {
  const state = useStore(tab.workspace);
  const { title, panes, running } = tabSummary(state, sessions);
  return h(
    "div",
    { className: "dshMulti-tab", "data-selected": selected || undefined },
    h(
      "button",
      {
        type: "button",
        role: "tab",
        className: "dshMulti-tabSelect",
        "aria-selected": selected,
        title,
        onClick: () => tabs.select(tab.id),
      },
      running
        ? h("span", {
            className: "dshMulti-tabActivity",
            role: "img",
            "aria-label": `${running} chat${running > 1 ? "s" : ""} running`,
          })
        : null,
      h("span", { className: "dshMulti-tabTitle" }, title),
      panes > 1 ? h("small", { "aria-label": `${panes} panes` }, panes) : null,
    ),
    closable
      ? h(
          "button",
          {
            type: "button",
            className: "dshMulti-tabClose",
            "aria-label": `Close ${title} tab`,
            title: "Close tab (chats keep running)",
            onClick: () => tabs.close(tab.id),
          },
          "×",
        )
      : null,
  );
}

/**
 * Tab bar over independent pane workspaces. Every tab's workspace stays
 * mounted (inactive panels are only hidden), so background chats, drafts
 * and streams keep running while another tab is shown.
 */
export function WorkspaceTabs({ tabs, ...props }) {
  const { tabs: list, activeId } = useStore(tabs);
  const sessions = props.useSessions((value) => value);
  return h(
    "div",
    { className: "dshMulti-tabs" },
    h(
      "div",
      {
        className: "dshMulti-tabBar",
        role: "tablist",
        "aria-label": "Workspaces",
      },
      list.map((tab) =>
        h(Tab, {
          key: tab.id,
          tab,
          selected: tab.id === activeId,
          closable: list.length > 1,
          tabs,
          sessions,
        }),
      ),
      h(
        "button",
        {
          type: "button",
          className: "dshMulti-tabAdd",
          "aria-label": "New workspace tab",
          title: "New workspace tab",
          onClick: () => tabs.add(),
        },
        "+",
      ),
    ),
    list.map((tab) =>
      h(
        "div",
        {
          key: tab.id,
          className: "dshMulti-tabPanel",
          role: "tabpanel",
          hidden: tab.id !== activeId,
        },
        h(MultiWorkspace, { ...props, workspace: tab.workspace }),
      ),
    ),
  );
}
