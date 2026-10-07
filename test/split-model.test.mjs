import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  edgeAt,
  findLeaf,
  leaves,
  moveLeaf,
  removeLeaf,
  resizeSplit,
  setLeafSession,
  splitLeaf,
  validateLayout,
} from "../client/split-model.mjs";

const leaf = (id, sessionId = `session-${id}`) => ({
  type: "leaf",
  id,
  sessionId,
});
const split = (id, first, second, axis = "horizontal", ratio = 0.5) => ({
  type: "split",
  id,
  axis,
  ratio,
  first,
  second,
});
const leafIds = (tree) => leaves(tree).map((pane) => pane.id);

function freezeTree(tree) {
  if (tree.type === "split") {
    freezeTree(tree.first);
    freezeTree(tree.second);
  }
  return Object.freeze(tree);
}

function chain(depth) {
  let tree = leaf("deepest");
  for (let index = 0; index < depth; index += 1) {
    tree = split(`chain-${index}`, tree, leaf(`side-${index}`));
  }
  return tree;
}

function balanced(count, prefix = "balanced") {
  if (count === 1) return leaf(prefix);
  const firstCount = Math.floor(count / 2);
  return split(
    `${prefix}-split`,
    balanced(firstCount, `${prefix}-first`),
    balanced(count - firstCount, `${prefix}-second`),
  );
}

describe("split-tree queries and insertion", () => {
  it("lists leaves in first/second order and finds original leaves, not branches", () => {
    const a = leaf("a", null);
    const b = leaf("b");
    const c = leaf("c");
    const tree = freezeTree(
      split("root", a, split("nested", b, c, "vertical")),
    );

    assert.deepEqual(leaves(tree), [a, b, c]);
    assert.deepEqual(leaves(a), [a]);
    assert.equal(findLeaf(tree, "b"), b);
    assert.equal(findLeaf(tree, "missing"), null);
    assert.equal(findLeaf(tree, "root"), null);
  });

  for (const [edge, axis, before] of [
    ["left", "horizontal", true],
    ["right", "horizontal", false],
    ["top", "vertical", true],
    ["bottom", "vertical", false],
  ]) {
    it(`inserts on the ${edge} without replacing existing leaf content or IDs`, () => {
      const target = freezeTree(leaf("target", "existing-session"));
      const added = freezeTree(leaf("added", null));
      const result = splitLeaf(target, "target", added, edge, "branch");

      assert.deepEqual(
        result,
        split("branch", before ? added : target, before ? target : added, axis),
      );
      assert.equal(findLeaf(result, "target"), target);
      assert.equal(findLeaf(result, "added"), added);
      assert.equal(validateLayout(result)?.type, "split");
    });
  }

  it("copies only the insertion path and preserves sibling subtrees", () => {
    const untouched = split("untouched", leaf("a"), leaf("b"));
    const target = leaf("c");
    const tree = freezeTree(
      split("root", untouched, split("right", target, leaf("d"))),
    );
    const result = splitLeaf(tree, "c", leaf("new"), "top", "new-split");

    assert.notEqual(result, tree);
    assert.equal(result.first, untouched);
    assert.notEqual(result.second, tree.second);
    assert.equal(result.second.second, tree.second.second);
    assert.equal(findLeaf(result, "c"), target);
    assert.deepEqual(leafIds(tree), ["a", "b", "c", "d"]);
  });

  it("rejects missing targets, invalid leaves/edges and all ID collisions as no-ops", () => {
    const tree = freezeTree(split("root", leaf("a"), leaf("b")));
    for (const [target, added, edge, splitId] of [
      ["missing", leaf("new"), "left", "new-split"],
      ["root", leaf("new"), "left", "new-split"],
      ["a", leaf("new"), "middle", "new-split"],
      ["a", leaf("new"), "left", ""],
      ["a", leaf("new"), "left", "   "],
      ["a", leaf("new"), "left", null],
      ["a", leaf("a"), "left", "new-split"],
      ["a", leaf("root"), "left", "new-split"],
      ["a", leaf("new"), "left", "a"],
      ["a", leaf("new"), "left", "root"],
      ["a", leaf("new"), "left", "new"],
      ["a", { type: "leaf", id: "new" }, "left", "new-split"],
      ["a", leaf("new", 42), "left", "new-split"],
      ["a", split("new", leaf("x"), leaf("y")), "left", "new-split"],
      ["a", null, "left", "new-split"],
    ]) {
      assert.equal(splitLeaf(tree, target, added, edge, splitId), tree);
    }
  });
});

describe("removal and moving", () => {
  it("cannot remove the last leaf and does not remove split IDs or missing leaves", () => {
    const only = freezeTree(leaf("only", null));
    assert.equal(removeLeaf(only, "only"), only);
    assert.equal(removeLeaf(only, "missing"), only);
    const tree = freezeTree(split("root", leaf("a"), leaf("b")));
    assert.equal(removeLeaf(tree, "root"), tree);
    assert.equal(removeLeaf(tree, "missing"), tree);
  });

  it("promotes either sibling directly, preserving its identity", () => {
    const subtree = split("nested", leaf("a"), leaf("b"), "vertical");
    const c = leaf("c");
    const tree = freezeTree(split("root", subtree, c));
    assert.equal(removeLeaf(tree, "c"), subtree);
    assert.equal(removeLeaf(subtree, "a"), subtree.second);
    assert.equal(removeLeaf(subtree, "b"), subtree.first);
    assert.equal(removeLeaf(split("other", c, subtree), "c"), subtree);
  });

  it("promotes a nested sibling and copies only remaining ancestors", () => {
    const sibling = split("sibling", leaf("c"), leaf("d"));
    const left = leaf("a");
    const tree = freezeTree(
      split("root", left, split("nested", leaf("b"), sibling)),
    );
    const result = removeLeaf(tree, "b");
    assert.notEqual(result, tree);
    assert.equal(result.first, left);
    assert.equal(result.second, sibling);
    assert.deepEqual(leafIds(result), ["a", "c", "d"]);
    assert.deepEqual(leafIds(tree), ["a", "b", "c", "d"]);
  });

  for (const edge of ["left", "right", "top", "bottom"]) {
    it(`moves an existing leaf to the ${edge}, collapsing its previous ancestors`, () => {
      const a = leaf("a", "session-to-preserve");
      const b = leaf("b");
      const c = leaf("c");
      const tree = freezeTree(
        split("root", a, split("survivor", b, c, "vertical", 0.7)),
      );
      const result = moveLeaf(tree, "a", "c", edge, "moved-split");
      const before = edge === "left" || edge === "top";

      assert.equal(result.id, "survivor");
      assert.equal(result.ratio, 0.7);
      assert.equal(result.first, b);
      assert.deepEqual(
        result.second,
        split(
          "moved-split",
          before ? a : c,
          before ? c : a,
          edge === "left" || edge === "right" ? "horizontal" : "vertical",
        ),
      );
      assert.equal(findLeaf(result, "a"), a);
      assert.equal(findLeaf(result, "c"), c);
      assert.equal(leaves(result).length, 3);
      assert.deepEqual(leafIds(tree), ["a", "b", "c"]);
    });
  }

  it("moves siblings in either direction and permits reusing the collapsed split ID", () => {
    const a = leaf("a");
    const b = leaf("b");
    const tree = freezeTree(split("root", a, b));
    const firstMoved = moveLeaf(tree, "a", "b", "bottom", "root");
    const secondMoved = moveLeaf(tree, "b", "a", "left", "root");
    assert.deepEqual(firstMoved, split("root", b, a, "vertical"));
    assert.deepEqual(secondMoved, split("root", b, a));
    assert.equal(findLeaf(firstMoved, "a"), a);
    assert.equal(findLeaf(secondMoved, "b"), b);
  });

  it("keeps moves atomic for self/missing moves and failed insertion arguments", () => {
    const tree = freezeTree(
      split("root", leaf("a"), split("nested", leaf("b"), leaf("c"))),
    );
    for (const [source, target, edge, splitId] of [
      ["a", "a", "left", "new"],
      ["missing", "a", "left", "new"],
      ["a", "missing", "left", "new"],
      ["root", "a", "left", "new"],
      ["a", "nested", "left", "new"],
      ["a", "b", "middle", "new"],
      ["a", "b", "left", "nested"],
      ["a", "b", "left", "c"],
      ["a", "b", "left", ""],
    ]) {
      assert.equal(moveLeaf(tree, source, target, edge, splitId), tree);
    }
    const only = freezeTree(leaf("only"));
    assert.equal(moveLeaf(only, "only", "only", "right", "new"), only);
  });

  it("supports a mixed sequence of nested splits, moves, removal, session changes and resize", () => {
    const a = leaf("a");
    const b = leaf("b");
    const c = leaf("c");
    const d = leaf("d");
    const initial = freezeTree(
      split("root", a, split("right", b, c, "vertical")),
    );
    const inserted = freezeTree(splitLeaf(initial, "b", d, "top", "top"));
    const moved = freezeTree(moveLeaf(inserted, "a", "c", "bottom", "bottom"));
    assert.equal(moved.id, "right");
    assert.equal(moved.first, inserted.second.first);
    assert.deepEqual(leafIds(moved), ["d", "b", "c", "a"]);

    const removed = freezeTree(removeLeaf(moved, "c"));
    assert.equal(removed.second, a);
    const changed = freezeTree(setLeafSession(removed, "d", null));
    assert.equal(findLeaf(changed, "d").sessionId, null);
    assert.equal(findLeaf(changed, "d").id, "d");
    assert.equal(findLeaf(changed, "b"), b);
    const resized = resizeSplit(changed, "right", 0.8);
    assert.equal(resized.first, changed.first);
    assert.equal(resized.second, a);
    assert.equal(resized.ratio, 0.8);
    assert.deepEqual(leafIds(resized), ["d", "b", "a"]);
    assert.deepEqual(
      validateLayout(JSON.parse(JSON.stringify(resized))),
      resized,
    );
    assert.deepEqual(leafIds(initial), ["a", "b", "c"]);
    assert.equal(d.sessionId, "session-d");
  });
});

describe("resizing and leaf sessions", () => {
  it("clamps resizing to inclusive bounds and preserves other branches", () => {
    const tree = freezeTree(
      split("root", leaf("a"), split("nested", leaf("b"), leaf("c"))),
    );
    for (const [input, expected] of [
      [-10, 0.15],
      [0, 0.15],
      [0.15, 0.15],
      [0.65, 0.65],
      [0.85, 0.85],
      [1, 0.85],
      [10, 0.85],
    ]) {
      const result = resizeSplit(tree, "nested", input);
      assert.equal(result.second.ratio, expected);
      assert.equal(result.first, tree.first);
      assert.equal(result.second.first, tree.second.first);
      assert.equal(result.second.second, tree.second.second);
      assert.equal(tree.second.ratio, 0.5);
    }
    const rootResized = resizeSplit(tree, "root", 0.7);
    assert.equal(rootResized.first, tree.first);
    assert.equal(rootResized.second, tree.second);
  });

  it("treats invalid ratios, absent branches and unchanged ratios as no-ops", () => {
    const tree = freezeTree(split("root", leaf("a"), leaf("b")));
    for (const value of [
      NaN,
      Infinity,
      -Infinity,
      "0.6",
      null,
      undefined,
      {},
      true,
    ]) {
      assert.equal(resizeSplit(tree, "root", value), tree);
    }
    assert.equal(resizeSplit(tree, "missing", 0.6), tree);
    assert.equal(resizeSplit(tree, "a", 0.6), tree);
    assert.equal(resizeSplit(tree, "root", 0.5), tree);
  });

  it("updates sessions immutably, accepts null/string content and rejects other types", () => {
    const tree = freezeTree(
      split("root", leaf("a"), split("nested", leaf("b"), leaf("c"))),
    );
    const result = setLeafSession(tree, "b", "new-session");
    assert.equal(findLeaf(result, "b").sessionId, "new-session");
    assert.equal(findLeaf(result, "b").id, "b");
    assert.equal(result.first, tree.first);
    assert.equal(result.second.second, tree.second.second);
    assert.equal(findLeaf(tree, "b").sessionId, "session-b");
    assert.equal(
      findLeaf(setLeafSession(tree, "a", null), "a").sessionId,
      null,
    );
    assert.equal(findLeaf(setLeafSession(tree, "a", ""), "a").sessionId, "");
    assert.equal(setLeafSession(tree, "b", "session-b"), tree);
    assert.equal(setLeafSession(tree, "missing", "session"), tree);
    assert.equal(setLeafSession(tree, "root", "session"), tree);
    for (const value of [undefined, 1, false, {}, []]) {
      assert.equal(setLeafSession(tree, "a", value), tree);
    }
  });
});

describe("persisted layout validation", () => {
  it("restores canonical independent trees, preserving IDs, axes, bounds and leaf content", () => {
    const source = freezeTree(
      split(
        "root",
        leaf("a", null),
        split(
          "nested",
          leaf("b", ""),
          leaf("c", "same-session"),
          "vertical",
          0.85,
        ),
        "horizontal",
        0.15,
      ),
    );
    const restored = validateLayout(source);
    assert.deepEqual(restored, source);
    assert.notEqual(restored, source);
    assert.notEqual(restored.second, source.second);
    assert.notEqual(findLeaf(restored, "a"), source.first);
    assert.deepEqual(validateLayout(leaf("empty", null)), leaf("empty", null));
    assert.deepEqual(
      validateLayout(
        split("shared-session", leaf("x", "same"), leaf("y", "same")),
      ),
      split("shared-session", leaf("x", "same"), leaf("y", "same")),
    );
  });

  it("strips unknown data and accepts null-prototype records with own schema fields", () => {
    const source = Object.assign(Object.create(null), leaf("a", null), {
      extra: "discard",
    });
    assert.deepEqual(validateLayout(source), leaf("a", null));
    const tree = {
      ...split("root", { ...leaf("a"), extra: 1 }, leaf("b")),
      extra: 2,
    };
    assert.deepEqual(validateLayout(tree), split("root", leaf("a"), leaf("b")));
  });

  it("rejects malformed roots, missing children, bad discriminants and invalid leaf content", () => {
    for (const value of [
      null,
      undefined,
      false,
      0,
      "layout",
      [],
      () => {},
      {},
      { ...leaf("a"), type: "chat" },
      { ...leaf("a"), id: "" },
      { ...leaf("a"), id: "   " },
      { ...leaf("a"), id: 1 },
      { type: "leaf", id: "a" },
      { ...leaf("a"), sessionId: undefined },
      leaf("a", 1),
      leaf("a", false),
      leaf("a", {}),
      leaf("a", []),
      Object.create(leaf("a")),
      { ...split("root", leaf("a"), leaf("b")), axis: "diagonal" },
      { ...split("root", leaf("a"), leaf("b")), axis: "left" },
      { ...split("root", leaf("a"), leaf("b")), first: undefined },
      { ...split("root", leaf("a"), leaf("b")), second: null },
    ]) {
      assert.equal(validateLayout(value), null);
    }
  });

  it("rejects persisted ratios outside bounds and nonfinite/non-number ratios without clamping", () => {
    for (const ratio of [
      0,
      1,
      0.149,
      0.851,
      NaN,
      Infinity,
      -Infinity,
      "0.5",
      null,
      undefined,
    ]) {
      assert.equal(
        validateLayout({ ...split("root", leaf("a"), leaf("b")), ratio }),
        null,
      );
    }
  });

  it("requires globally unique IDs across leaves and splits", () => {
    assert.equal(
      validateLayout(split("root", leaf("same"), leaf("same"))),
      null,
    );
    assert.equal(validateLayout(split("root", leaf("root"), leaf("b"))), null);
    assert.equal(
      validateLayout(
        split("root", leaf("a"), split("root", leaf("b"), leaf("c"))),
      ),
      null,
    );
    assert.equal(
      validateLayout(
        split("root", leaf("nested"), split("nested", leaf("b"), leaf("c"))),
      ),
      null,
    );
  });

  it("rejects cycles, shared nodes, accessors and hostile proxies without throwing", () => {
    const cyclic = split("root", leaf("a"), leaf("b"));
    cyclic.second = cyclic;
    const deepCycle = split(
      "outer",
      leaf("a"),
      split("inner", leaf("b"), leaf("c")),
    );
    deepCycle.second.first = deepCycle;
    const shared = leaf("shared");
    let getterCalls = 0;
    const accessor = {
      type: "leaf",
      id: "getter",
      get sessionId() {
        getterCalls += 1;
        throw new Error("getter");
      },
    };
    const throwing = new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          throw new Error("proxy");
        },
      },
    );
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    for (const value of [
      cyclic,
      deepCycle,
      split("root", shared, shared),
      accessor,
      throwing,
      revoked.proxy,
    ]) {
      assert.doesNotThrow(() => assert.equal(validateLayout(value), null));
    }
    assert.equal(getterCalls, 0);
  });

  it("supports at least 16 panes and caps restoration at 64 panes and depth 32", () => {
    assert.equal(leaves(validateLayout(balanced(16))).length, 16);
    assert.equal(leaves(validateLayout(balanced(64))).length, 64);
    assert.equal(validateLayout(balanced(65)), null);
    assert.equal(leaves(validateLayout(chain(32))).length, 33);
    assert.equal(validateLayout(chain(33)), null);
    assert.equal(validateLayout(chain(1000)), null);
  });

  it("prevents edits from creating layouts that cannot be persisted", () => {
    const full = freezeTree(balanced(64));
    assert.equal(
      splitLeaf(full, leaves(full)[0].id, leaf("new"), "right", "new-split"),
      full,
    );
    const deep = freezeTree(chain(32));
    assert.equal(
      splitLeaf(deep, "deepest", leaf("new"), "top", "new-split"),
      deep,
    );
    const deepWithSource = freezeTree({
      ...deep,
      second: split("source-parent", leaf("source"), leaf("other")),
    });
    assert.notEqual(validateLayout(deepWithSource), null);
    assert.equal(
      moveLeaf(deepWithSource, "source", "deepest", "right", "moved"),
      deepWithSource,
    );
    assert.equal(
      findLeaf(deepWithSource, "source").sessionId,
      "session-source",
    );
  });
});

describe("edge previews", () => {
  it("recognizes all four edges, the inclusive 25% boundary and a null middle", () => {
    for (const [x, y, expected] of [
      [0, 50, "left"],
      [25, 50, "left"],
      [75, 50, "right"],
      [100, 50, "right"],
      [50, 0, "top"],
      [50, 25, "top"],
      [50, 75, "bottom"],
      [50, 100, "bottom"],
      [50, 50, null],
      [25.01, 50, null],
      [74.99, 50, null],
      [50, 25.01, null],
      [50, 74.99, null],
    ]) {
      assert.equal(edgeAt(x, y, 100, 100), expected, `at ${x},${y}`);
    }
  });

  it("uses the nearest normalized edge and resolves all corner ties horizontally", () => {
    for (const [x, y, expected] of [
      [0, 0, "left"],
      [0, 100, "left"],
      [100, 0, "right"],
      [100, 100, "right"],
      [10, 10, "left"],
      [90, 10, "right"],
      [10, 90, "left"],
      [90, 90, "right"],
      [20, 10, "top"],
      [10, 20, "left"],
      [80, 10, "top"],
      [90, 20, "right"],
      [20, 90, "bottom"],
      [10, 80, "left"],
      [80, 90, "bottom"],
      [90, 80, "right"],
    ]) {
      assert.equal(edgeAt(x, y, 100, 100), expected, `at ${x},${y}`);
    }
    assert.equal(edgeAt(100, 10, 1000, 100), "left");
    assert.equal(edgeAt(100, 5, 1000, 100), "top");
    assert.equal(edgeAt(10, 100, 100, 1000), "left");
  });

  it("rejects outside coordinates, invalid numbers and unusable rectangles", () => {
    for (const args of [
      [-1, 50, 100, 100],
      [101, 50, 100, 100],
      [50, -1, 100, 100],
      [50, 101, 100, 100],
      [0, 0, 0, 100],
      [0, 0, 100, 0],
      [0, 0, -100, 100],
      [0, 0, 100, -100],
      [NaN, 0, 100, 100],
      [0, Infinity, 100, 100],
      [0, 0, Infinity, 100],
      [0, 0, 100, NaN],
      ["0", 0, 100, 100],
      [0, 0, "100", 100],
      [undefined, 0, 100, 100],
      [0, null, 100, 100],
    ]) {
      assert.equal(edgeAt(...args), null);
    }
  });
});
