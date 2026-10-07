import { STORAGE_KEY } from "./workspace-state.mjs";

export const TABS_STORAGE_KEY = "dsh.multi-panel.tabs.v1";
const DEFAULT_TAB = "default";
const MAX_NAME = 60;

const cleanName = (value) =>
  typeof value === "string"
    ? value.trim().slice(0, MAX_NAME) || undefined
    : undefined;

// The first tab keeps the pre-tabs layout key so existing layouts carry over.
const layoutKey = (tabId) =>
  tabId === DEFAULT_TAB ? STORAGE_KEY : `${STORAGE_KEY}:${tabId}`;

function readIndex(storage) {
  try {
    const saved = JSON.parse(storage?.getItem(TABS_STORAGE_KEY) ?? "null");
    const ids = saved?.tabs;
    if (
      !Array.isArray(ids) ||
      !ids.length ||
      !ids.every((tabId) => typeof tabId === "string" && tabId) ||
      new Set(ids).size !== ids.length
    )
      return null;
    return {
      ids,
      activeId: ids.includes(saved.activeId) ? saved.activeId : ids[0],
      names: saved.names && typeof saved.names === "object" ? saved.names : {},
    };
  } catch (error) {
    console.warn("Multi-panel tab restoration failed:", error);
    return null;
  }
}

/**
 * Owns the list of workspace tabs. Each tab is an independent pane layout
 * from createWorkspace({storageKey, isActive, adoptMainView}). Switching tabs
 * never disposes a workspace, so chats in background tabs stay retained and
 * mounted; only closing a tab releases its chats (they keep running natively).
 */
export function createWorkspaceTabs({
  storage,
  createWorkspace,
  restore = true,
  id = () => crypto.randomUUID(),
}) {
  const saved = restore ? readIndex(storage) : null;
  let activeId = saved?.activeId ?? DEFAULT_TAB;
  const listeners = new Set();

  function open(tabId, adoptMainView, name) {
    return {
      id: tabId,
      name: cleanName(name),
      workspace: createWorkspace({
        storageKey: layoutKey(tabId),
        isActive: () => activeId === tabId,
        adoptMainView,
      }),
    };
  }

  let snapshot = {
    tabs: (saved?.ids ?? [DEFAULT_TAB]).map((tabId) =>
      open(tabId, tabId === activeId, saved?.names[tabId]),
    ),
    activeId,
  };

  function publish(tabs) {
    snapshot = { tabs, activeId };
    try {
      storage?.setItem(
        TABS_STORAGE_KEY,
        JSON.stringify({
          tabs: tabs.map((tab) => tab.id),
          activeId,
          names: Object.fromEntries(
            tabs.filter((tab) => tab.name).map((tab) => [tab.id, tab.name]),
          ),
        }),
      );
    } catch (error) {
      console.warn("Multi-panel tab save failed:", error);
    }
    for (const listener of listeners) listener();
  }

  function activate(tabId, tabs = snapshot.tabs) {
    activeId = tabId;
    publish(tabs);
    tabs.find((tab) => tab.id === tabId).workspace.activate();
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    active: () =>
      snapshot.tabs.find((tab) => tab.id === snapshot.activeId).workspace,
    /** Open a blank workspace tab and switch to it. */
    add() {
      const tabId = id();
      const tab = open(tabId, false);
      activate(tabId, [...snapshot.tabs, tab]);
      return tabId;
    },
    select(tabId) {
      if (tabId === activeId || !snapshot.tabs.some((tab) => tab.id === tabId))
        return;
      activate(tabId);
    },
    /** Name a tab; a blank name falls back to the focused chat's title. */
    rename(tabId, value) {
      if (!snapshot.tabs.some((tab) => tab.id === tabId)) return;
      publish(
        snapshot.tabs.map((tab) =>
          tab.id === tabId ? { ...tab, name: cleanName(value) } : tab,
        ),
      );
    },
    /** The last tab cannot be closed; a closed active tab hands focus to a neighbour. */
    close(tabId) {
      const index = snapshot.tabs.findIndex((tab) => tab.id === tabId);
      if (index < 0 || snapshot.tabs.length < 2) return;
      const tab = snapshot.tabs[index];
      const tabs = snapshot.tabs.filter((other) => other !== tab);
      tab.workspace.dispose();
      try {
        storage?.removeItem(layoutKey(tabId));
      } catch (error) {
        console.warn("Multi-panel tab cleanup failed:", error);
      }
      if (tabId === activeId)
        activate(tabs[Math.min(index, tabs.length - 1)].id, tabs);
      else publish(tabs);
    },
    dispose() {
      listeners.clear();
      for (const tab of snapshot.tabs) tab.workspace.dispose();
    },
  };
}
