# Multi-panel chats for DeepSeek Harness

Native chat workspaces with nested horizontal and vertical splits. Each pane keeps its own chat, native Chat/Trajectory/Usage/MCPs views, composer, approvals and sidebar tabs. One shared session-list sidebar remains on the left.

An independent community plugin, not an official DeepSeek product. Currently pinned to **DSH 0.2.0-rc.2**.

## Use

- Click **Split** in a pane, choose Above/Below/Left/Right, then an existing chat or **New chat**. New chat creates a distinct native session in the originating chat's workspace; it never shares another pane's blank composer.
- Drag a chat from the session list, or the grip beside a pane title, onto another pane's edge. The highlighted half shows the exact split. The center is not a split target; Escape cancels the preview.
- Drag a divider to resize; focused dividers also accept the corresponding arrow keys.
- Click a pane to focus it. Session-list navigation and native global shortcuts target that focused pane.
- In a focused new chat, use the native agent-mode dropdown beside the workspace picker to choose Standard, PTC, Creator, or any installed agent preset before sending. Selection belongs to that chat; native Developer tools visibility and started-chat restrictions remain unchanged.
- Drop files into the intended chat pane. While dragging, that pane gets a light overlay tint and **Drop files in this chat** label, with no file-drop borders—even with the normal focus highlight turned off. Blocked drops show the native unavailable message with an error-colored tint. Feedback follows the file target, clears on leaving/dropping, and never changes keyboard focus. Only the target pane receives files; drops outside the chat panes do not attach to any chat.
- Use **Maximize**, **Restore**, **Close pane**, or **Undo layout change**. Undo appears for 3 seconds with a shrinking countdown bar; another layout change restarts the countdown. Closing a pane does not archive the chat or stop an agent.
- Open a chat's right sidebar normally. Right-click a sidebar tab for **Split to left/right/above/below**, or drag a tab onto another sidebar pane's edge. Sidebar splits, widths and fullscreen are local to their owning chat.

Selecting a chat already visible focuses its existing pane. Dropping it moves that pane; the same session is not duplicated, because the native composer and browser-tab ownership are session-scoped.

Layouts and widths are saved in this browser. Invalid, removed or ephemeral blank chat references restore as empty panes. The safety bounds are 64 chat panes / 32 nested split levels and 16 docked sidebar panes per chat; practical space and the native minimum-size rules determine which sidebar splits are available.

## Settings

Open **Settings → Multi-panel**. There are 25 profile-wide preferences, with extra appearance and behavior controls under **Advanced**:

- Focus highlight (off by default), highlight color/thickness, neutral borders, inactive opacity, divider hit area, compact toolbar and titles.
- Undo duration (3 seconds), countdown bar, position, enable/disable, and optional pause while hovered or keyboard-focused.
- Default chat split direction, new pane's share (0.5 is 50/50), minimum width/height, pane limit and whether new panes take focus.
- Sidebar default width, minimum width, default split direction, new pane's share and per-chat pane limit. Manually resized per-session widths take precedence over the default.
- Restore the last layout on startup (on). This option applies on the next page load; changing limits never closes existing chats.

Settings use DSH's native Host settings storage and update open panes without replacing their composers. **Reset multi-panel settings** resets only this feature's fields, not native composer or other plugin preferences. Numeric edits save when you leave the field or press Enter; Escape cancels the edit.

For the eight pane commands, open **Settings → General → Edit shortcuts** and search **Multi-panel**. Assign split/default/right/below, focus next/previous, maximize/restore, close pane, and Undo keys there. These commands are unbound by default to preserve existing shortcuts. Split shortcuts create a fresh blank native chat; closing a pane does not stop or archive its chat. Pane commands do not run while a settings/dialog modal is open.

Minimum chat sizes default to 0 (flexible, preserving existing behavior). Nonzero sizes prevent splits that cannot fit and constrain divider dragging and keyboard resizing. A shrinking window never destroys mounted chats or drafts.

## Installation and rollback

This package is pinned to DSH **0.2.0-rc.2**. It replaces the native conversation, right-sidebar and attachment presentation owners, preserving their services, extension slots and image rendering. Builds refuse changed native artifact hashes. It does not edit the installed desktop application and does not use iframes or run a replacement server.

Install and enable the built package with the Harness plugin manager. Its bundle disables only `include:ui-conversation`, `include:ui-sidebar-right` and `include:ui-attachment` while the combined replacement is enabled, so the native slots have exactly one owner at startup. Keep the browser element-context extension, Usage/MCP dashboards, terminal/files/document providers and iOS integration enabled as before. Restart DSH after installing an updated bundle, then refresh/reconnect the existing GUI if needed. Do not override the original owners back on while this replacement is enabled.

Rollback: disable `dsh-multi-panel`, re-enable those three native entries, then restart DSH and reconnect. The native sidebar persistence namespace is read as a fallback but never overwritten by this package. Chats and their logs are untouched.

Local directory installs may be cached by pnpm; for updates, pack a versioned tarball and install that exact tarball instead of reinstalling the same directory specifier.

## Development

Prerequisites: **Node.js 22 or newer**, **pnpm 11.7.0**, **Python 3**, and the supported **DSH 0.2.0-rc.2 desktop installation**. React is provided by DSH in production; the development dependencies support the build and tests.

Run these commands from this plugin's repository root:

```sh
pnpm install --frozen-lockfile --ignore-scripts
python3 scripts/extract-runtime.py --asar "/Applications/DeepSeek Harness.app/Contents/Resources/app.asar"
pnpm run build
pnpm test
pnpm run format:check
pnpm pack
```

Use `--asar` to supply the application archive's path on another installation. On macOS, the extractor defaults to the path shown above. It reads selected artifacts into the project-local `runtime-evidence` directory; it does not modify the installed application. A different runtime fails the build's SHA-256 checks rather than silently producing an incompatible plugin.

The docking builtin lives in the pinned Web shell bundle, not a separate package artifact. The build embeds narrowly patched native owners and an internal all-axis dockkit fork. Generated output lives in `lib`; neither generated output nor runtime extraction is committed. A fresh clone therefore requires extraction before building or running the full test suite.

Without the desktop artifacts, run `pnpm run test:portable` and `pnpm run format:check`. GitHub Actions runs these portable checks; they do **not** replace native integration verification. `pnpm pack` runs build, full tests and formatting first. See [CONTRIBUTING.md](CONTRIBUTING.md) and [RELEASING.md](RELEASING.md) for contribution and release steps.

### Why the panes are flat

The split trees describe geometry, not the React component hierarchy. Chat leaves and native dockkit tab hosts stay keyed under a stable parent. Moving/splitting/resizing changes their rectangles without remounting editors, scroll containers or browser/terminal bodies. A pane's explicit native SessionProvider resolves its retained session independently of the globally selected chat.

### Verification

Deterministic Node and React/jsdom checks cover split validation/operations, session-reference ownership and reentrant navigation, scoped tabs/drafts, all-axis native sidebar planning, persistence, and stable DOM identity while moving/resizing/hiding panes. Manual verification uses the existing GUI and a task-owned browser session; it does not create an E2E test suite. Native desktop guest behavior should also be checked on the actual desktop surface, not inferred from browser-only tests.

## License

Plugin-authored code is MIT-licensed. The generated bundle also contains modified native DSH code and third-party modules with their own notices. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Preserve the bundled notices when redistributing.

See [CHANGELOG.md](CHANGELOG.md) for version history.
