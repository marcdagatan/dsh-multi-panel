import {
  leaves,
  findLeaf,
  splitLeaf,
  removeLeaf,
  moveLeaf,
  resizeSplit,
  equalizedRatios,
  setLeafSession,
  validateLayout,
} from "./split-model.mjs";

import { DEFAULT_PREFERENCES, normalizePreferences } from "./preferences.mjs";

export const STORAGE_KEY = "dsh.multi-panel.layout.v1";
const SPLIT_EDGES = ["left", "right", "top", "bottom"];

function allocationFor(tree, nodeId, width, height) {
  if (tree.id === nodeId) return { node: tree, width, height };
  if (tree.type === "leaf") return null;
  const horizontal = tree.axis === "horizontal";
  return (
    allocationFor(
      tree.first,
      nodeId,
      horizontal ? width * tree.ratio : width,
      horizontal ? height : height * tree.ratio,
    ) ??
    allocationFor(
      tree.second,
      nodeId,
      horizontal ? width * (1 - tree.ratio) : width,
      horizontal ? height : height * (1 - tree.ratio),
    )
  );
}

// Descendant ratios stay fixed when an ancestor moves; summed leaf minima
// alone would let a narrow grandchild fall below the configured size.
function minimumAllocation(tree, preferences) {
  if (tree.type === "leaf")
    return {
      width: preferences.minPaneWidth,
      height: preferences.minPaneHeight,
    };
  const first = minimumAllocation(tree.first, preferences);
  const second = minimumAllocation(tree.second, preferences);
  return tree.axis === "horizontal"
    ? {
        width: Math.max(
          first.width / tree.ratio,
          second.width / (1 - tree.ratio),
        ),
        height: Math.max(first.height, second.height),
      }
    : {
        width: Math.max(first.width, second.width),
        height: Math.max(
          first.height / tree.ratio,
          second.height / (1 - tree.ratio),
        ),
      };
}

function feasibleBounds(tree, width, height, preferences) {
  const first = minimumAllocation(tree.first, preferences);
  const second = minimumAllocation(tree.second, preferences);
  const horizontal = tree.axis === "horizontal";
  const length = horizontal ? width : height;
  const firstMinimum = horizontal ? first.width : first.height;
  const secondMinimum = horizontal ? second.width : second.height;
  const crossMinimum = horizontal
    ? Math.max(first.height, second.height)
    : Math.max(first.width, second.width);
  const crossLength = horizontal ? height : width;
  if (
    crossMinimum > crossLength ||
    (length <= 0 && (firstMinimum > 0 || secondMinimum > 0))
  )
    return null;
  const min = firstMinimum > 0 ? Math.max(0.15, firstMinimum / length) : 0.15;
  const max =
    secondMinimum > 0 ? Math.min(0.85, 1 - secondMinimum / length) : 0.85;
  return min <= max ? { min, max } : null;
}

/**
 * Owns pane identity, session references, focus, and browser-local persistence.
 * createSession, when supplied, must create a fresh native session and publish
 * it in the session catalog before resolving its ID; null origin uses defaults.
 * getPreferences supplies live normalized splitting/resizing settings; only
 * restoreLayout is read at startup. splitRatio is the incoming pane's share.
 * Nonzero pane minima require viewport measurements before adding split panes.
 * Workspace tabs pass a per-tab storageKey and isActive: inactive workspaces
 * keep their chats retained but ignore main-view navigation until activate().
 * adoptMainView false starts blank instead of claiming the open main chat.
 */
export function createWorkspaceState({
  sessions,
  navigation,
  storage,
  createSession,
  getPreferences = () => DEFAULT_PREFERENCES,
  id = () => crypto.randomUUID(),
  storageKey = STORAGE_KEY,
  isActive = () => true,
  adoptMainView = true,
}) {
  const preferences = () => normalizePreferences(getPreferences());
  let viewport = { width: 0, height: 0 };
  let tree = { type: "leaf", id: id(), sessionId: null };
  let activeId = tree.id;
  let warning = null;
  try {
    if (preferences().restoreLayout) {
      const saved = JSON.parse(storage?.getItem(storageKey) ?? "null");
      const restored = validateLayout(saved?.tree);
      if (restored && !hasRepeatedSessions(restored)) {
        tree = restored;
        activeId = findLeaf(tree, saved.activeId)?.id ?? leaves(tree)[0].id;
      }
    }
  } catch (error) {
    warning = "Saved pane layout could not be restored.";
    console.warn("Multi-panel layout restoration failed:", error);
  }
  let snapshot = {
    tree,
    activeId,
    maximizedId: null,
    undo: null,
    warning,
    background: {},
  };
  const listeners = new Set();
  const references = new Map();
  const tabHolds = new Map();
  const pendingChats = new Set();
  let disposed = false;
  let initial = adoptMainView;
  let navigating = false;
  let observedMain = adoptMainView ? undefined : currentMain();
  let reconcilingReferences = false;
  let undoSequence = 0;

  function publish(next, remember = false) {
    if (disposed) return;
    const previous = snapshot;
    snapshot = {
      ...snapshot,
      ...next,
      ...(remember
        ? {
            undo: {
              id: ++undoSequence,
              tree: previous.tree,
              activeId: previous.activeId,
            },
          }
        : {}),
    };
    snapshot.background = nextBackground(previous.tree);
    for (const request of pendingChats) {
      const target = findLeaf(snapshot.tree, request.paneId);
      if (
        !target ||
        (request.replace && target.sessionId !== request.sessionId)
      )
        request.cancelled = true;
    }
    reconcileReferences();
    try {
      storage?.setItem(
        storageKey,
        JSON.stringify({ tree: snapshot.tree, activeId: snapshot.activeId }),
      );
    } catch (error) {
      snapshot = {
        ...snapshot,
        warning: "Layout changes could not be saved in this browser.",
      };
      console.warn("Multi-panel layout save failed:", error);
    }
    for (const listener of listeners) listener();
  }

  /**
   * A chat leaving its pane while its sidebar holds keep-mounted tabs (the
   * browser's webview, terminals) stays behind that pane instead of unmounting,
   * because removing a webview from the page destroys and reloads its guest.
   * Closing the pane, or the last held tab closing, releases it as before.
   */
  function nextBackground(previousTree) {
    const shown = new Set(leaves(snapshot.tree).map((leaf) => leaf.sessionId));
    const list = sessions.list.getSnapshot();
    const keep = (sessionId, paneId) =>
      sessionId &&
      !shown.has(sessionId) &&
      tabHolds.has(sessionId) &&
      findLeaf(snapshot.tree, paneId) &&
      (list.phase !== "ready" || Object.hasOwn(list.byId, sessionId));
    const next = {};
    for (const [sessionId, paneId] of Object.entries(snapshot.background))
      if (keep(sessionId, paneId)) next[sessionId] = paneId;
    for (const leaf of leaves(previousTree))
      if (keep(leaf.sessionId, leaf.id)) next[leaf.sessionId] = leaf.id;
    const same =
      Object.keys(next).length === Object.keys(snapshot.background).length &&
      Object.entries(next).every(
        ([sessionId, paneId]) => snapshot.background[sessionId] === paneId,
      );
    return same ? snapshot.background : next;
  }

  function reconcileReferences() {
    if (reconcilingReferences || sessions.list.getSnapshot().phase !== "ready")
      return;
    reconcilingReferences = true;
    try {
      const wanted = new Set([
        ...leaves(snapshot.tree)
          .map((leaf) => leaf.sessionId)
          .filter(Boolean),
        ...Object.keys(snapshot.background),
      ]);
      // Acquire before releasing old panes so a move never unloads its generation.
      for (const sessionId of wanted) {
        if (references.has(sessionId)) continue;
        try {
          const reference = sessions.retain(sessionId, {
            source: "multiPanel",
          });
          references.set(sessionId, reference);
          reference.ready.catch((error) => {
            if (!disposed && references.get(sessionId) === reference)
              publish({ warning: `Could not open chat: ${error.message}` });
          });
        } catch (error) {
          snapshot = {
            ...snapshot,
            warning: `Could not open chat: ${error.message}`,
          };
        }
      }
      for (const [sessionId, reference] of references) {
        if (wanted.has(sessionId)) continue;
        references.delete(sessionId);
        reference.release();
      }
    } finally {
      reconcilingReferences = false;
    }
  }

  function currentMain() {
    const list = sessions.list.getSnapshot();
    return (
      Object.values(list.byId).find(
        (row) => (row.retainedBy?.mainView ?? 0) > 0,
      )?.id ?? null
    );
  }

  function navigateActive() {
    if (!isActive()) return;
    const leaf = findLeaf(snapshot.tree, snapshot.activeId);
    if (!leaf?.sessionId) return;
    navigating = true;
    try {
      navigation.openSession(leaf.sessionId);
    } finally {
      navigating = false;
      observedMain = currentMain();
      if (observedMain !== null) initial = false;
    }
  }

  function observeNavigation() {
    if (disposed || navigating || reconcilingReferences) return;
    const list = sessions.list.getSnapshot();
    if (list.phase !== "ready") return;
    let restoredTree = snapshot.tree;
    for (const leaf of leaves(restoredTree)) {
      if (leaf.sessionId && !Object.hasOwn(list.byId, leaf.sessionId))
        restoredTree = setLeafSession(restoredTree, leaf.id, null);
    }
    if (restoredTree !== snapshot.tree)
      publish({ tree: restoredTree, warning: null });
    else reconcileReferences();
    if (!isActive()) return;
    const current = currentMain();
    if (initial) {
      if (!current) return;
      initial = false;
      observedMain = current;
      const existing = leaves(snapshot.tree).find(
        (leaf) => leaf.sessionId === current,
      );
      publish(
        existing
          ? { activeId: existing.id }
          : { tree: setLeafSession(snapshot.tree, snapshot.activeId, current) },
      );
      return;
    }
    if (observedMain === current) return;
    observedMain = current;
    const active = findLeaf(snapshot.tree, snapshot.activeId);
    if (active?.sessionId === current) return;
    const existing =
      current &&
      leaves(snapshot.tree).find((leaf) => leaf.sessionId === current);
    publish(
      existing
        ? {
            activeId: existing.id,
            maximizedId: snapshot.maximizedId ? existing.id : null,
          }
        : { tree: setLeafSession(snapshot.tree, snapshot.activeId, current) },
    );
  }

  function planSplit(baseTree, paneId, edge, settings, growing = true) {
    if (!SPLIT_EDGES.includes(edge) || !findLeaf(baseTree, paneId)) return null;
    if (growing && leaves(baseTree).length >= settings.maxPanes) return null;
    const allocation = allocationFor(
      baseTree,
      paneId,
      viewport.width,
      viewport.height,
    );
    const axis =
      edge === "left" || edge === "right" ? "horizontal" : "vertical";
    const bounds = feasibleBounds(
      { axis, first: allocation.node, second: allocation.node },
      allocation.width,
      allocation.height,
      settings,
    );
    if (!bounds) return null;
    const requested =
      edge === "left" || edge === "top"
        ? settings.splitRatio
        : 1 - settings.splitRatio;
    return { ratio: Math.max(bounds.min, Math.min(bounds.max, requested)) };
  }

  function rejectSplit() {
    publish({
      warning: "Pane limit or minimum pane size prevents this split.",
    });
  }

  function getResizeBounds(
    splitId,
    width = viewport.width,
    height = viewport.height,
    tree = snapshot.tree,
  ) {
    const allocation = allocationFor(
      tree,
      splitId,
      Number.isFinite(width) && width >= 0 ? width : viewport.width,
      Number.isFinite(height) && height >= 0 ? height : viewport.height,
    );
    if (!allocation || allocation.node.type !== "split") return null;
    return (
      feasibleBounds(
        allocation.node,
        allocation.width,
        allocation.height,
        preferences(),
      ) ?? { min: allocation.node.ratio, max: allocation.node.ratio }
    );
  }

  const offNavigation = sessions.list.subscribe(observeNavigation);
  observeNavigation();

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    reference(sessionId) {
      return references.get(sessionId);
    },
    /**
     * Hold a chat for one mounted keep-mounted sidebar tab, mirroring the native
     * sidebar's retainTab. Held chats survive replacement in their pane.
     * @param {string} sessionId
     * @param {AbortSignal} signal - tab occurrence lifetime; abort releases.
     * @returns {() => void} idempotent release.
     */
    retainTab(sessionId, signal) {
      if (disposed || signal.aborted) return () => {};
      tabHolds.set(sessionId, (tabHolds.get(sessionId) ?? 0) + 1);
      let held = true;
      const release = () => {
        if (!held) return;
        held = false;
        signal.removeEventListener("abort", release);
        const count = tabHolds.get(sessionId) - 1;
        if (count > 0) tabHolds.set(sessionId, count);
        else tabHolds.delete(sessionId);
        if (count === 0 && Object.hasOwn(snapshot.background, sessionId))
          publish({});
      };
      signal.addEventListener("abort", release, { once: true });
      return release;
    },
    /** Tab switch: show this tab's focused chat; never adopt the previous tab's. */
    activate() {
      if (disposed || !isActive()) return;
      initial = false;
      observedMain = currentMain();
      navigateActive();
    },
    /** Measurements never rewrite layouts or release chats, even when too small. */
    setViewport(width, height) {
      if (
        disposed ||
        !Number.isFinite(width) ||
        !Number.isFinite(height) ||
        width < 0 ||
        height < 0
      )
        return;
      viewport = { width, height };
    },
    /**
     * Live ratio limits include descendant minima at their existing ratios.
     * An impossible/unmeasured layout locks this divider at its current ratio;
     * missing or leaf IDs return null. UI and resize() share these bounds.
     * Optional render measurements affect this query only; invalid dimensions
     * fall back independently to the stored viewport used for action enforcement.
     * @param {string} splitId
     * @param {number} [width=viewport.width]
     * @param {number} [height=viewport.height]
     * @returns {{min: number, max: number} | null}
     */
    getResizeBounds,
    focus(paneId) {
      if (!findLeaf(snapshot.tree, paneId) || snapshot.activeId === paneId)
        return;
      publish({ activeId: paneId });
      navigateActive();
    },
    select(paneId, sessionId) {
      const existing = leaves(snapshot.tree).find(
        (leaf) => leaf.sessionId === sessionId && sessionId !== null,
      );
      if (existing && existing.id !== paneId) {
        this.focus(existing.id);
        return;
      }
      publish({
        tree: setLeafSession(snapshot.tree, paneId, sessionId),
        activeId: paneId,
      });
      navigateActive();
    },
    /**
     * Create before replacing/splitting; never mount two panes on a null shell.
     * Returns the committed native session ID, or null on failure/cancellation.
     * A newer target selection cancels replacement, but not an adjacent split.
     * @param {string} paneId
     * @param {'left' | 'right' | 'top' | 'bottom' | null} [edge=null]
     * @returns {Promise<string | null>}
     */
    async newChat(paneId, edge = null) {
      if (disposed) return null;
      const target = findLeaf(snapshot.tree, paneId);
      if (!target || (edge !== null && !SPLIT_EDGES.includes(edge)))
        return null;
      if (
        edge !== null &&
        !planSplit(snapshot.tree, paneId, edge, preferences())
      ) {
        rejectSplit();
        return null;
      }
      if (typeof createSession !== "function") {
        publish({ warning: "New chat creation is unavailable." });
        return null;
      }
      const catalog = sessions.list.getSnapshot();
      const originSessionId =
        [
          target.sessionId,
          findLeaf(snapshot.tree, snapshot.activeId)?.sessionId,
          ...leaves(snapshot.tree).map((leaf) => leaf.sessionId),
        ].find(
          (sessionId) => sessionId && Object.hasOwn(catalog.byId, sessionId),
        ) ?? null;
      const request = {
        paneId,
        sessionId: target.sessionId,
        replace: edge === null,
        cancelled: false,
      };
      pendingChats.add(request);
      let sessionId;
      try {
        sessionId = await createSession(originSessionId);
      } catch (error) {
        if (!disposed && !request.cancelled)
          publish({
            warning: `Could not create chat: ${error?.message ?? String(error)}`,
          });
        return null;
      } finally {
        pendingChats.delete(request);
      }
      if (disposed || request.cancelled) return null;
      const currentTarget = findLeaf(snapshot.tree, paneId);
      if (
        !currentTarget ||
        (edge === null && currentTarget.sessionId !== target.sessionId)
      )
        return null;
      if (
        typeof sessionId !== "string" ||
        !sessionId.trim() ||
        sessionId === originSessionId ||
        leaves(snapshot.tree).some((leaf) => leaf.sessionId === sessionId) ||
        !Object.hasOwn(sessions.list.getSnapshot().byId, sessionId)
      ) {
        publish({
          warning:
            "New chat creation did not return an available, unique session.",
        });
        return null;
      }

      const settings = preferences();
      let nextTree;
      let nextActiveId;
      if (edge === null) {
        nextTree = setLeafSession(snapshot.tree, paneId, sessionId);
        nextActiveId = paneId;
      } else {
        const plan = planSplit(snapshot.tree, paneId, edge, settings);
        if (!plan) {
          rejectSplit();
          return null;
        }
        const leaf = { type: "leaf", id: id(), sessionId };
        const splitId = id();
        nextTree = splitLeaf(snapshot.tree, paneId, leaf, edge, splitId);
        if (nextTree !== snapshot.tree)
          nextTree = resizeSplit(nextTree, splitId, plan.ratio);
        nextActiveId = settings.focusNewPane ? leaf.id : snapshot.activeId;
      }
      if (nextTree === snapshot.tree) {
        publish({ warning: "The new chat could not be added to this layout." });
        return null;
      }
      publish(
        {
          tree: nextTree,
          activeId: nextActiveId,
          maximizedId: null,
          warning: null,
        },
        edge !== null,
      );
      if (edge === null || settings.focusNewPane) navigateActive();
      return sessionId;
    },
    split(paneId, sessionId, edge = preferences().splitDirection) {
      const settings = preferences();
      const existing =
        sessionId &&
        leaves(snapshot.tree).find((leaf) => leaf.sessionId === sessionId);
      if (existing) {
        if (existing.id === paneId) {
          if (settings.focusNewPane) this.focus(existing.id);
          return;
        }
        this.move(existing.id, paneId, edge);
        return;
      }
      const plan = planSplit(snapshot.tree, paneId, edge, settings);
      if (!plan) {
        rejectSplit();
        return;
      }
      const leaf = { type: "leaf", id: id(), sessionId };
      const splitId = id();
      let nextTree = splitLeaf(snapshot.tree, paneId, leaf, edge, splitId);
      if (nextTree === snapshot.tree) return;
      nextTree = resizeSplit(nextTree, splitId, plan.ratio);
      publish(
        {
          tree: nextTree,
          activeId: settings.focusNewPane ? leaf.id : snapshot.activeId,
          maximizedId: null,
        },
        true,
      );
      if (settings.focusNewPane) navigateActive();
    },
    move(sourceId, targetId, edge = preferences().splitDirection) {
      if (
        sourceId === targetId ||
        !findLeaf(snapshot.tree, sourceId) ||
        !findLeaf(snapshot.tree, targetId)
      )
        return;
      const settings = preferences();
      const reduced = removeLeaf(snapshot.tree, sourceId);
      const plan = planSplit(reduced, targetId, edge, settings, false);
      if (!plan) {
        rejectSplit();
        return;
      }
      const splitId = id();
      let nextTree = moveLeaf(snapshot.tree, sourceId, targetId, edge, splitId);
      if (nextTree === snapshot.tree) return;
      nextTree = resizeSplit(nextTree, splitId, plan.ratio);
      publish(
        {
          tree: nextTree,
          activeId: settings.focusNewPane ? sourceId : snapshot.activeId,
          maximizedId: null,
        },
        true,
      );
      if (settings.focusNewPane) navigateActive();
    },
    close(paneId) {
      const nextTree = removeLeaf(snapshot.tree, paneId);
      if (nextTree === snapshot.tree) return;
      const nextActive =
        findLeaf(nextTree, snapshot.activeId)?.id ?? leaves(nextTree)[0].id;
      publish(
        { tree: nextTree, activeId: nextActive, maximizedId: null },
        true,
      );
      navigateActive();
    },
    resize(splitId, ratio) {
      if (!Number.isFinite(ratio)) return;
      const bounds = getResizeBounds(splitId);
      if (!bounds) return;
      const bounded = Math.max(bounds.min, Math.min(bounds.max, ratio));
      const nextTree = resizeSplit(snapshot.tree, splitId, bounded);
      if (nextTree !== snapshot.tree) publish({ tree: nextTree });
    },
    /** Even out the divider's same-axis run in one layout change. */
    equalize(splitId) {
      let nextTree = snapshot.tree;
      for (const [id, ratio] of equalizedRatios(nextTree, splitId)) {
        const bounds = getResizeBounds(id, undefined, undefined, nextTree);
        if (!bounds) continue;
        const bounded = Math.max(bounds.min, Math.min(bounds.max, ratio));
        nextTree = resizeSplit(nextTree, id, bounded);
      }
      if (nextTree !== snapshot.tree) publish({ tree: nextTree });
    },
    maximize(paneId) {
      publish({ maximizedId: snapshot.maximizedId === paneId ? null : paneId });
    },
    /** Restore layout/focus only; the undo.id toast identity is never root state. */
    undo() {
      if (!snapshot.undo) return;
      const { tree, activeId } = snapshot.undo;
      publish({ tree, activeId, undo: null, maximizedId: null });
      navigateActive();
    },
    /**
     * Dismiss only this exact undo object; a stale toast timer cannot clear a
     * newer layout change. Layout, focus and retained chats are unchanged.
     * @param {{id: number, tree: object, activeId: string} | null} expectedUndo
     */
    dismissUndo(expectedUndo) {
      if (!snapshot.undo || snapshot.undo !== expectedUndo) return;
      publish({ undo: null });
    },
    dispose() {
      disposed = true;
      offNavigation();
      listeners.clear();
      for (const reference of references.values()) reference.release();
      references.clear();
    },
  };
}

function hasRepeatedSessions(tree) {
  const sessions = leaves(tree)
    .map((leaf) => leaf.sessionId)
    .filter(Boolean);
  return new Set(sessions).size !== sessions.length;
}
