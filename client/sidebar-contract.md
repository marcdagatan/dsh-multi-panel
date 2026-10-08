# Sidebar boundary and verification

## Integration contract

The parent conversation entry declares `dsh.multi.sidebar` as a **session-scoped single slot**, then renders it under the native explicit `SessionProvider({session: SessionReference})`.

Owner props: `{paneId, visible, focused, width, viewportWidth, canShow:true, preferences}`. `width` is the full chat leaf width. The sidebar shell owns its in-flow width and persistent ratio. The leaf must be `position:relative`; the shell's fullscreen overlay fills that leaf, not the window. `visible`, not `focused`, drives native tab activity. Parent-enforced unique mounted session ownership across workspace tabs, including hidden retained sidebars, prevents two browser occurrences competing for one native session/tab identity. Parent keeps each leaf's React key stable when rearranging the split tree. Owner props also carry `retainTab(tabId, signal)`, bound to the chat, so native keep-mounted tabs (the desktop browser's webview, terminals) hold it. Replacing a chat that holds such tabs keeps its sidebar mounted but hidden behind the same pane, because removing a webview from the page destroys and reloads its guest; returning the chat to that pane shows the same sidebar. Closing the pane, closing the last held tab, or replacing a chat without such tabs unmounts its sidebar. Opening the chat in another workspace tab transfers ownership: the old tab releases both shown and hidden sidebar copies, even if they held native tabs. The destination mounts its own sidebar; unlike returning to the same pane, this can reload the Electron webview.

Build API: `buildSidebarFork(nativeClientSource[, shellSource])` returns the original native module-loader wrapper with ID `dsh-multi-panel-sidebar`, for capture into the parent's unified client factory. It embeds the private dockkit fork; no extra runtime module or iframe is introduced. Both input hashes and patch boundaries fail closed.

Native original sidebar **apply** must be disabled before applying the fork. Its ordinary module can remain available to other plugins. The parent remains the sole owner of chat splits, session selection, and the shared main left sidebar.

## Live settings wiring

Parent wiring has two required parts:

```js
sidebar.apply(ctx, { preferencesSource });
// Under the existing stable, session-bound chat leaf:
renderSlot("dsh.multi.sidebar", { ...ownerProps, preferences });
```

`preferences` is the current normalized plain snapshot from the parent's stable `preferencesSource`. The source exposes `getSnapshot()` and `subscribe(listener)`; the parent subscribes for live owner props. Native actions read `getSnapshot()` at action time, so changing profile settings does not require replacing leaf keys, services, stores, or tabs. No source/props supplied retains all existing defaults.

- `sidebarWidth` (default `.4`, range `0.15–0.75`) is a **default**, not an override. Untouched sidebars react to live changes; startup reads and manual resizing retain `dsh.multi.sidebar.ratio.<sessionId>` without writing the default into storage. Failed storage writes still retain the current local manual choice.
- `sidebarMinWidth` (default `320`, range `0..600` pixels) applies live to saved, manual, and default widths. The effective minimum is clipped to half the chat leaf; the outer width is always capped at three quarters. Minimum/default changes never rewrite a saved ratio. Fullscreen still fills only its chat leaf.
- `sidebarSplitDirection` (default `right`, choices `right/bottom/left/top`) affects toolbar/shortcut/controller splits and `preferNewPane` opens. Explicit directional menus and drag edges take precedence. Native toolbar room checks use the configured axis.
- `sidebarSplitRatio` (default `.5`, range `0.15–0.85`) is the **incoming pane's share** of the target pane. For new binary splits, left/top put that share first; right/bottom put its complement first. Native same-axis flattening preserves other sibling shares and divides only the targeted pane's share. Native resize operations record the change with the split, preserving undo/redo and tab occurrences. Existing split sizes are never rewritten by setting changes.
- `sidebarMaxPanes` (default `16`, range `1..16`) limits new docked splits across controls, native store actions, edge drops, and `preferNewPane` opens. Native floating-tab behavior is unchanged. Lowering it never closes existing panes or invalidates their saved layouts. Center moves remain available. A cross-pane edge move of a sole docked tab also remains available at/above the cap, including the hard limit: settlement collapses its emptied source, so the final pane count does not increase. Native preview and commit use the same predicate. Same-pane seeded splits, multi-tab sources, and floating arrivals still require a new-pane allowance. An open preferring a new pane falls back to the native existing-pane path when capped. The persisted-layout safety limit remains `16`.

The parent owns normalization, Host schema, settings page, and source subscription. The fork adds no settings writes, provider changes, or new Service method. Prop-only width settings work independently, but split settings require the matching source passed to `apply`.

## Evidence

The runtime links below resolve after local extraction. Upstream runtime artifacts are not checked into this repository; see the root README for setup.

Pinned native sidebar: `@deepseek-ai/dsh-client-ui-sidebar-right@0.2.0-rc.2`, SHA-256 `4895dade6651ef34c33cf2f61d7933cc43c9933900c9d1ef76e5ad2f09abefff`.

- [Native sidebar client:5519–5554](../runtime-evidence/dsh/node_modules/@deepseek-ai/dsh-client-ui-sidebar-right/lib/client.js#L5519-L5554): keyed native tab slots carry occurrence signal/actions and keep-mounted retention.
- [Native sidebar client:5849–5879](../runtime-evidence/dsh/node_modules/@deepseek-ai/dsh-client-ui-sidebar-right/lib/client.js#L5849-L5879): native root has one selected session, but already uses explicit retained session references.
- [Native sidebar client:6275–6323](../runtime-evidence/dsh/node_modules/@deepseek-ai/dsh-client-ui-sidebar-right/lib/client.js#L6275-L6323): stores, inventory, and tab occurrence reconciliation are per session; on-screen command target is singleton.
- [Native sidebar client:5339–5347](../runtime-evidence/dsh/node_modules/@deepseek-ai/dsh-client-ui-sidebar-right/lib/client.js#L5339-L5347): product store independently rejects top/bottom drops and more than two panes. Those restrictions must change in addition to rendering.
- [Native renderer:684–701](../runtime-evidence/dsh/node_modules/@deepseek-ai/dsh-client-ui-renderer/lib/client.js#L684-L701): explicit `SessionProvider` resolves its own scope binding.
- [Native slot declaration discipline:44–46](../runtime-evidence/dsh/node_modules/@deepseek-ai/dsh-client-ui-slots/README.md#L44-L46): existing child slots cannot be redeclared or rendered by unrelated entries. The fork retains original sidebar child declarations on its new owning seat.
- [Native browser:149–172](../runtime-evidence/dsh/node_modules/@deepseek-ai/dsh-client-ui-sidebar-browser/lib/client.js#L149-L172): browser attachment and new-tab callbacks follow the native occurrence. No browser implementation is copied or replaced.
- [Native terminal:375–383](../runtime-evidence/dsh/node_modules/@deepseek-ai/dsh-client-ui-sidebar-terminal/lib/client.js#L375-L383) and [452–453](../runtime-evidence/dsh/node_modules/@deepseek-ai/dsh-client-ui-sidebar-terminal/lib/client.js#L452-L453): terminal view/close ownership follows session and tab identity.

Pinned Web shell: [installed shell:124–126](../runtime-evidence/dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/index-5SrrfWpU.js#L124-L126), SHA-256 `af3ff948cf3f132edbddebea93e2f9f02233b390a94bd4c9842182300be811bb`.

Its builtin native dockkit model supports row/column splits and all four edge drop zones, but `DockLayout` rejects anything except one pane or exactly two horizontal panes. Its `DockSurface` supports recursive trees but would remount tab bodies when moving them through the tree. The fork instead keeps the native flat sorted, tab-ID-keyed host list and changes only their geometry plus divider positioning. The native maximum is raised from 4 to **16**; geometry-based minimum body/header sizing still limits unavailable split directions.

## Exact runtime imports

- `react`, `react/jsx-runtime`, `react-dom`
- `@deepseek-ai/dsh-client-ui-primitives`: `IconCloseFillRegular`, `IconCloseOutlineRegular`, `IconPanelLeftOutlineRegular`, `IconPlusOutlineRegular`, `MenuSurface`, `Tooltip`, `focusWithoutRing`, `modalSelector`, `observeComposition`
- Native sidebar's unchanged `@deepseek-ai/dsh-client-store`

Dockkit free names are collected with Acorn at build time and matched against that exact shell's primitive export map. Unmapped imports reject the build. Native shell CSS class names are reused only under the matching pinned shell hash.

## Preservation and changes

Preserved: native tab registry, browser/files/terminal providers, resource pinning, tab occurrence cancellation, keep-mounted tab hosts, native drag previews, menu extension slots, history, and session adoption. Session-bound UI methods do not navigate the globally focused chat. Existing global commands still target the focused session through native `mainView`.

Changed: pane-local width/fullscreen/visibility, all-axis split menus and drag commits, nested split geometry, accessible pointer/keyboard dividers, and validator support for nested row/column layouts. Global layout rightbar presentation is not used.

Persistence writes to `dsh.multi.sidebar.v1.<sessionId>` and reads the native `dsh.sidebar-right.v1.<sessionId>` namespace as a fallback, leaving that rollback copy untouched. Ratios use `dsh.multi.sidebar.ratio.<sessionId>`.

## Verification and remaining manual checks

[Sidebar regression tests](../test/sidebar-fork.test.mjs) cover the native sidebar boundary. They exercise actual patched native planners/store/controllers with a small observable-store contract double, plus actual React/jsdom native dockkit and pane-shell components. Tab body DOM nodes and mount counts remain unchanged across nested top/left splits, resizing, hiding, and moving.

Settings checks cover live untouched defaults, saved/manual widths across remounts, safe minimum clipping at narrow/zero leaf widths, all four incoming split shares, same-axis sibling preservation and undo/redo, toolbar room checks for a narrow but tall pane, live budgets, preferred-open fallback/splitting, and retained dragged occurrences. React state ownership follows [React's state-structure guidance](https://react.dev/learn/choosing-the-state-structure): only manual overrides are state; defaults are derived from props.

Recovery checks additionally use the exact installed `SlotCore`, enforce the sidebar's declared context dependencies, and prove that `sidebarRight`/`sidebarRightTabs` publish before its seats. The sidebar fork starts clean with native owner declarations absent. An enabled original `rightbar.session` claiming `sidebar.right.pane.tab` reproducibly conflicts with the fork's child declaration; two combined owners also collide. These are verified collision conditions, not a diagnosis of an incident without its first boot error. Browser/terminal/iOS provider settings must remain unchanged; these providers consume the preserved tab slots/services rather than claim the sidebar root.

Browser-only verification does not prove native desktop browser-guest or terminal behavior. Before releasing changes to this boundary, manual QA must check:

1. Two visible sessions show independent browser/files/terminal tabs while only one session is focused.
2. All four tab edge previews commit, menu splits work, nested horizontal/vertical dividers resize, and native browser/terminal content follows their own session.
3. Sidebar width/closed state and nested layouts restore after restart; fullscreen stays within its chat leaf.
4. Closing/replacing a chat releases its native sidebar view; mere chat focus/split/movement does not remount it.
5. Changing each sidebar setting live affects the intended controls while browser/terminal/iOS session content and manually saved widths remain intact.
