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

/** Inline name editor: Enter or blur saves, Escape cancels. */
function TabNameInput({ initial, onDone }) {
  const [value, setValue] = React.useState(initial);
  const done = React.useRef(false);
  const finish = (name) => {
    if (done.current) return;
    done.current = true;
    onDone(name);
  };
  return h("input", {
    className: "dshMulti-tabName",
    "aria-label": "Tab name",
    value,
    maxLength: 60,
    ref: (input) => input?.focus(),
    onChange: (event) => setValue(event.target.value),
    onBlur: () => finish(value),
    onKeyDown: (event) => {
      if (event.key === "Enter") finish(value);
      else if (event.key === "Escape") finish(undefined);
      else return;
      event.preventDefault();
      event.stopPropagation();
    },
  });
}

function Tab({ tab, selected, closable, tabs, sessions }) {
  const state = useStore(tab.workspace);
  const summary = tabSummary(state, sessions);
  const { panes, running } = summary;
  const title = tab.name ?? summary.title;
  const [editing, setEditing] = React.useState(false);
  return h(
    "div",
    { className: "dshMulti-tab", "data-selected": selected || undefined },
    editing
      ? h(TabNameInput, {
          initial: tab.name ?? "",
          onDone: (name) => {
            setEditing(false);
            if (name !== undefined) tabs.rename(tab.id, name);
          },
        })
      : h(
          "button",
          {
            type: "button",
            role: "tab",
            className: "dshMulti-tabSelect",
            "aria-selected": selected,
            title: `${title} (double-click to rename)`,
            onClick: () => tabs.select(tab.id),
            onDoubleClick: () => setEditing(true),
          },
          running
            ? h("span", {
                className: "dshMulti-tabActivity",
                role: "img",
                "aria-label": `${running} chat${running > 1 ? "s" : ""} running`,
              })
            : null,
          h("span", { className: "dshMulti-tabTitle" }, title),
          panes > 1
            ? h("small", { "aria-label": `${panes} panes` }, panes)
            : null,
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
