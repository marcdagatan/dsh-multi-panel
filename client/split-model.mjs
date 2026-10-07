/**
 * Pure binary pane layouts. Mutation APIs accept validated trees and return the
 * original root for invalid requests or no-ops. Only changed ancestors are copied.
 * Restore external data with validateLayout before calling tree operations.
 *
 * @typedef {{type: 'leaf', id: string, sessionId: string | null}} Leaf
 * @typedef {{type: 'split', id: string, axis: 'horizontal' | 'vertical', ratio: number, first: Node, second: Node}} Split
 * @typedef {Leaf | Split} Node
 * @typedef {'left' | 'right' | 'top' | 'bottom'} Edge
 */

const MIN_RATIO = 0.15;
const MAX_RATIO = 0.85;
const MAX_DEPTH = 32;
const MAX_PANES = 64;
const EDGES = ["left", "right", "top", "bottom"];

const validId = (value) => typeof value === "string" && value.trim().length > 0;
const validSession = (value) => value === null || typeof value === "string";

function updateNode(tree, matches, update) {
  if (matches(tree)) return update(tree);
  if (tree.type === "leaf") return tree;

  const first = updateNode(tree.first, matches, update);
  const second = updateNode(tree.second, matches, update);
  return first === tree.first && second === tree.second
    ? tree
    : { ...tree, first, second };
}

/**
 * First/second depth-first order; original leaf references.
 * @param {Node} tree
 * @returns {Leaf[]}
 */
export function leaves(tree) {
  if (tree.type === "leaf") return [tree];
  return [...leaves(tree.first), ...leaves(tree.second)];
}

/**
 * @param {Node} tree
 * @param {string} id
 * @returns {Leaf | null}
 */
export function findLeaf(tree, id) {
  if (tree.type === "leaf") return tree.id === id ? tree : null;
  return findLeaf(tree.first, id) ?? findLeaf(tree.second, id);
}

/**
 * Insert newLeaf beside targetId with an even split. Top/left put the new pane
 * first; bottom/right put it second. Duplicate IDs or layout-limit violations
 * leave the tree unchanged. The new leaf itself is retained by reference.
 * @param {Node} tree
 * @param {string} targetId
 * @param {Leaf} newLeaf
 * @param {Edge} edge
 * @param {string} splitId
 * @returns {Node}
 */
export function splitLeaf(tree, targetId, newLeaf, edge, splitId) {
  if (!EDGES.includes(edge) || !validId(splitId)) return tree;
  if (validateLayout(newLeaf)?.type !== "leaf") return tree;

  const before = edge === "left" || edge === "top";
  const result = updateNode(
    tree,
    (node) => node.type === "leaf" && node.id === targetId,
    (target) => ({
      type: "split",
      id: splitId,
      axis: edge === "left" || edge === "right" ? "horizontal" : "vertical",
      ratio: 0.5,
      first: before ? newLeaf : target,
      second: before ? target : newLeaf,
    }),
  );

  return result === tree || validateLayout(result) === null ? tree : result;
}

function removeNode(tree, id) {
  if (tree.type === "leaf") return tree.id === id ? null : tree;

  const first = removeNode(tree.first, id);
  const second = removeNode(tree.second, id);
  if (first === null) return second;
  if (second === null) return first;
  return first === tree.first && second === tree.second
    ? tree
    : { ...tree, first, second };
}

/**
 * Promote the sibling when a pane is removed. A missing ID or the last pane is
 * never removed.
 * @param {Node} tree
 * @param {string} id
 * @returns {Node}
 */
export function removeLeaf(tree, id) {
  return removeNode(tree, id) ?? tree;
}

/**
 * Atomically remove and reinsert the same leaf, collapsing its old branch.
 * Self-moves and failed insertions leave the original tree unchanged. splitId
 * must be unique in the surviving tree; a collapsed branch ID may be reused.
 * @param {Node} tree
 * @param {string} sourceId
 * @param {string} targetId
 * @param {Edge} edge
 * @param {string} splitId
 * @returns {Node}
 */
export function moveLeaf(tree, sourceId, targetId, edge, splitId) {
  if (sourceId === targetId) return tree;
  const source = findLeaf(tree, sourceId);
  if (source === null || findLeaf(tree, targetId) === null) return tree;

  const reduced = removeLeaf(tree, sourceId);
  const result = splitLeaf(reduced, targetId, source, edge, splitId);
  return result === reduced ? tree : result;
}

/**
 * Clamp finite ratios to [0.15, 0.85]. Non-numbers and nonfinite numbers are
 * rejected without changing the tree. Ratios measure the first child's share.
 * @param {Node} tree
 * @param {string} id
 * @param {number} ratio
 * @returns {Node}
 */
export function resizeSplit(tree, id, ratio) {
  if (!Number.isFinite(ratio)) return tree;
  const bounded = Math.max(MIN_RATIO, Math.min(MAX_RATIO, ratio));
  return updateNode(
    tree,
    (node) => node.type === "split" && node.id === id,
    (node) => (node.ratio === bounded ? node : { ...node, ratio: bounded }),
  );
}

// A run is a chain of same-axis splits; it renders as one row or column.
function runLength(node, axis) {
  return node.type === "split" && node.axis === axis
    ? runLength(node.first, axis) + runLength(node.second, axis)
    : 1;
}

function runRatios(node, axis) {
  if (node.type !== "split" || node.axis !== axis) return [];
  const first = runLength(node.first, axis);
  return [
    [node.id, first / (first + runLength(node.second, axis))],
    ...runRatios(node.first, axis),
    ...runRatios(node.second, axis),
  ];
}

/**
 * Ratios that give every pane in the split's same-axis run an equal share, so
 * nested columns read as equal thirds rather than 50/25/25. Cross-axis
 * children count as one pane and keep their own ratios. Parent-first order;
 * leaves and missing IDs return []. Callers clamp with resizeSplit.
 * @param {Node} tree
 * @param {string} id
 * @returns {Array<[string, number]>}
 */
export function equalizedRatios(tree, id) {
  function runTop(node, top) {
    if (node.type === "leaf") return null;
    const current = top?.axis === node.axis ? top : node;
    if (node.id === id) return current;
    return runTop(node.first, current) ?? runTop(node.second, current);
  }
  const top = runTop(tree, null);
  return top ? runRatios(top, top.axis) : [];
}

/**
 * @param {Node} tree
 * @param {string} id
 * @param {string | null} sessionId
 * @returns {Node}
 */
export function setLeafSession(tree, id, sessionId) {
  if (!validSession(sessionId)) return tree;
  return updateNode(
    tree,
    (node) => node.type === "leaf" && node.id === id,
    (node) => (node.sessionId === sessionId ? node : { ...node, sessionId }),
  );
}

function ownData(node, key) {
  const descriptor = Object.getOwnPropertyDescriptor(node, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

/**
 * Validate untrusted persisted data and return a fresh canonical tree, or null.
 * Allows at most 64 panes and 32 split levels (root depth 0). All node IDs must
 * be unique, nonblank strings. Leaf sessions are strings or null; split ratios
 * must already be finite and within [0.15, 0.85]. Unknown fields are discarded.
 * Cycles, shared node objects, inherited fields and accessors are rejected.
 * @param {unknown} value
 * @returns {Node | null}
 */
export function validateLayout(value) {
  const ids = new Set();
  const seen = new WeakSet();
  let nodeCount = 0;
  let paneCount = 0;

  function visit(node, depth) {
    if (depth > MAX_DEPTH || node === null || typeof node !== "object")
      return null;
    if (Array.isArray(node) || seen.has(node)) return null;
    if (++nodeCount > MAX_PANES * 2 - 1) return null;
    seen.add(node);

    const type = ownData(node, "type");
    const id = ownData(node, "id");
    if (!validId(id) || ids.has(id)) return null;
    ids.add(id);

    if (type === "leaf") {
      const sessionId = ownData(node, "sessionId");
      if (!validSession(sessionId) || ++paneCount > MAX_PANES) return null;
      return { type: "leaf", id, sessionId };
    }
    if (type !== "split") return null;

    const axis = ownData(node, "axis");
    const ratio = ownData(node, "ratio");
    if (axis !== "horizontal" && axis !== "vertical") return null;
    if (!Number.isFinite(ratio) || ratio < MIN_RATIO || ratio > MAX_RATIO)
      return null;

    const first = visit(ownData(node, "first"), depth + 1);
    if (first === null) return null;
    const second = visit(ownData(node, "second"), depth + 1);
    if (second === null) return null;
    return { type: "split", id, axis, ratio, first, second };
  }

  try {
    return visit(value, 0);
  } catch {
    // Hostile proxies can throw during reflection; persisted input must not.
    return null;
  }
}

/**
 * Coordinates are relative to the pane. Return the nearest edge by normalized
 * distance within the inclusive 25% perimeter, or null in the middle/outside.
 * Corner ties prefer left/right over top/bottom, independent of aspect ratio.
 * @param {number} x
 * @param {number} y
 * @param {number} width
 * @param {number} height
 * @returns {Edge | null}
 */
export function edgeAt(x, y, width, height) {
  if (
    ![x, y, width, height].every(Number.isFinite) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }
  if (x < 0 || x > width || y < 0 || y > height) return null;

  const distances = [
    x / width,
    (width - x) / width,
    y / height,
    (height - y) / height,
  ];
  let nearest = 0;
  for (let index = 1; index < distances.length; index += 1) {
    if (distances[index] < distances[nearest]) nearest = index;
  }
  return distances[nearest] <= 0.25 ? EDGES[nearest] : null;
}
