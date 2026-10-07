# Capture Prompt for Codex

Use this prompt when recording the features not clearly demonstrated in the existing excerpts. Save raw captures locally first; review them for privacy before moving any asset into the public repository.

```text
Capture clean, real desktop demos of the dsh-multi-panel plugin for its open-source README.

Use the installed DeepSeek Harness application / its existing GUI. Do not install or update plugins, start a replacement server, change credentials or edit plugin source. If required controls are absent, stop that scene and report what is missing. The plugin currently supports DSH 0.2.0-rc.2.

PRIVACY AND SAFETY
- Use a disposable demo workspace/profile if one is already available. Otherwise create only task-owned blank chats with neutral names such as Demo Build, Demo Review, Demo Notes and Demo Tools.
- Do not expose existing chat lists, messages, project names, workspace paths, customer dashboards, account details, tokens or provider configuration. Hide/crop unrelated UI before recording; do not merely blur readable text.
- Never send a chat message, execute an agent, approve an operation or incur provider charges. Use unsent dummy drafts only.
- Do not modify, archive, close or delete any pre-existing chat. Only remove drafts/attachments you created in the demo chats.
- Ask before restarting the application. If restart is declined, skip the persistence scene and report that it was not captured.
- Do not fake UI states or claim an action succeeded without observing it.

CAPTURE STYLE
- Record only the application window, ideally around 1440×900 or 1600×1000, with readable UI text and no desktop notifications.
- Make each clip 8–12 seconds. Begin and end with about one second of stillness. Move the cursor slowly and pause on the outcome.
- Save silent recordings and one clean PNG of each outcome under the plugin repository's ignored .cache/readme-captures/ directory.

SCENES
1. Complex workspace hero: build six to eight independent chats in an asymmetric nested layout, not just a 2×2 grid. Mix a tall pane, vertically stacked panes and a horizontally split lower row. Include a safe docked sidebar. Put distinct unsent dummy drafts in two panes, move an existing pane to another edge and resize both a horizontal and a vertical divider. Capture the entire layout and show both drafts remain. End on the most interesting arrangement.
2. Targeted file drop: create a harmless demo-note.txt. Keep keyboard focus in pane A while dragging the file over pane B. Show the pane-specific tint/message, then drop it and show the attachment appears only in B. Remove the task-owned attachment afterward. Use an actual desktop drag if possible; report any simulated drag honestly.
3. Per-chat agent modes: in two focused blank chats, use the native dropdown beside the workspace picker. Choose two available modes and show selection remains independent. Do not alter global agent defaults or Developer tools visibility and do not send messages.
4. Sidebar splits: open available native sidebar tools in a demo chat; split right and below, then resize a sidebar divider. Show they belong to that chat, not the neighboring one. Do not expose real terminal output, file trees, browser accounts or customer data. Skip unsafe tool content.
5. Maximize/restore and close/Undo: maximize one demo pane, restore it, close one pane, then click Undo before the countdown ends. Show task-owned draft retention. Closing a pane must not archive a chat or stop a running agent.
6. Keyboard shortcuts: open Settings → General → Edit shortcuts and show the eight Multi-panel commands. They are unbound by default. Only bind/run a shortcut if explicitly authorized, and restore that binding afterward.
7. Layout restoration: with explicit restart approval, set up a distinctive layout using task-owned non-ephemeral chats, restart DSH and show what actually restores. Do not claim ephemeral blank sessions restore; capture/report their real behavior.

DELIVER
- List each filename and what the clip actually proves.
- Include one screenshot of the 2×2 overview and one screenshot of a safe nested sidebar layout.
- Identify any skipped scene or remaining private content.
- Keep all raw captures local. Do not push, publish or upload them.
```
