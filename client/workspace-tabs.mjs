import { STORAGE_KEY } from "./workspace-state.mjs";
import { leaves } from "./split-model.mjs";

export const TABS_STORAGE_KEY = "dsh.multi-panel.tabs.v1";
const DEFAULT_TAB = "default";
const MAX_NAME = 60;

const cleanName = (value) =>
  typeof value === "string"
    ? value.trim().slice(0, MAX_NAME) || undefined
    : undefined;

const mountedIn = (workspace) => {
  const snapshot = workspace.getSnapshot?.();
  return [
    ...(snapshot?.tree
      ? leaves(snapshot.tree)
          .map((leaf) => leaf.sessionId)
          .filter(Boolean)
      : []),
    ...Object.keys(snapshot?.background ?? {}),
  ];
};

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
 * mounted unless transferred to another tab. Closing releases the tab's chats
 * without stopping them natively. A chat and its held sidebars belong to at most
 * one tab: each chat has one composer editor, and a
 * second mounted copy would steal it, leaving the visible composer inert
 * (typed text drawn over a placeholder that never hides). The tab that most
 * recently showed a chat keeps it; at startup the active tab wins.
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
  const watched = new Map();

  // Include hidden keep-mounted sidebars: their native hosts are session-owned
  // too. Newly mounted chats leave other tabs; at startup the active tab wins.
  function watch(tab, yieldToOthers = false) {
    const entry = { workspace: tab.workspace, mounted: new Set() };
    const sync = () => {
      const now = mountedIn(entry.workspace);
      const added = now.filter((sessionId) => !entry.mounted.has(sessionId));
      entry.mounted = new Set(now);
      for (const other of [...watched.values()]) {
        if (other === entry) continue;
        const duplicates = added.filter((sessionId) =>
          other.mounted.has(sessionId),
        );
        if (!duplicates.length) continue;
        if (yieldToOthers) entry.workspace.release?.(duplicates);
        else other.workspace.release?.(duplicates);
      }
    };
    watched.set(tab.id, entry);
    // Startup self-release publishes synchronously; observe it before seeding
    // membership so a later re-selection is recognized as a fresh acquisition.
    entry.off = entry.workspace.subscribe?.(sync);
    sync();
    yieldToOthers = false;
  }

  function unwatch(tabId) {
    watched.get(tabId)?.off?.();
    watched.delete(tabId);
  }

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
  const startup = snapshot.tabs.find((tab) => tab.id === activeId);
  for (const tab of [startup, ...snapshot.tabs.filter((t) => t !== startup)])
    watch(tab, true);

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
      watch(tab);
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
      unwatch(tabId);
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
      for (const tabId of [...watched.keys()]) unwatch(tabId);
      for (const tab of snapshot.tabs) tab.workspace.dispose();
    },
  };
}
