# README Media

The supplied 16:9 walkthrough is included unchanged, as requested by its owner. The earlier assets are excerpts from real DSH desktop recordings, not generated UI mockups. Those full-workspace clips retain the actual nested pane geometry; their opaque editorial covers hide private content, not replacement chats or fabricated UI. The basic split and settings demos use tighter crops.

## What the Clips Show

| Asset                                                                                  | Visible actions                                                                                                                                                                        |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Full walkthrough](dsh-multi-panel-v2-16x9.mp4) / [Still](dsh-multi-panel-v2-16x9.png) | User-supplied 52.2-second 1920×1080 export: native chat splits, pane rearrangement, sidebar tools and workspace tabs. Included byte-for-byte unchanged; still extracted at 48 seconds. |
| [Complex layouts](complex-layouts.mp4) / [GIF](complex-layouts.gif)                    | Eight native chat panes, a browser dock inside a chat, pane rearrangement and divider resizing. The recording-C hero uses an explicitly declared cut.                                  |
| [Targeted file drop](targeted-file-drop.mp4) / [GIF](targeted-file-drop.gif)           | One completed attachment appears only in an unfocused chat. The earlier hover in a different chat is a moving drag ghost, not another attachment.                                      |
| [Permission modes](permission-modes.mp4) / [GIF](permission-modes.gif)                 | One chat changes from Workspace Write to Full access while its neighbor stays Workspace Write; actual confirmation and focus change are retained.                                      |
| [Sidebar splits](sidebar-splits.mp4) / [GIF](sidebar-splits.gif)                       | A real tool launcher, followed by the later nested browser/files/terminal layout and divider resizing; the cut is declared.                                                            |
| [Maximize and restore](layout-controls.mp4) / [GIF](layout-controls.gif)               | A maximized chat and the restored eight-chat layout, with an explicit cut. The Restore-button click is not shown; this does not show close/Undo.                                       |
| [Layout restoration](layout-restoration.mp4) / [GIF](layout-restoration.gif)           | The eight-chat arrangement before/after restart. The cut excludes startup/desktop footage; the browser returns as a native Restore page placeholder, not a live page.                  |
| [Rearrange panes](rearrange-panes.mp4) / [GIF](rearrange-panes.gif)                    | The earlier six-chat recording A: focused edge-drag and pane reflow, keeping the full workspace visible.                                                                               |
| [Split panes](split-panes.mp4) / [GIF](split-panes.gif)                                | Open the direction menu, cut to two blank native chats, resize their divider.                                                                                                          |
| [Settings](settings.mp4) / [GIF](settings.gif)                                         | Browse the Multi-panel settings and scroll into Advanced.                                                                                                                              |
| [Split snapshot](split-panes.png)                                                      | Two blank native chat panes, each with a composer.                                                                                                                                     |
| [Settings overview](settings.png) / [Advanced](settings-advanced.png)                  | Actual native preference controls.                                                                                                                                                     |

These clips do **not** demonstrate every feature. The supplied walkthrough shows workspace tabs and layout controls, but its recorded plugin version is unconfirmed; it is not proof of the latest ownership or equalization fixes. The following limitations apply to the older excerpts: recording C was captured with **0.2.6**. Its permission-mode change is not an agent-preset change. Agent-preset selection, chat close/Undo, shortcuts, workspace tabs, tab renaming, divider equalization and same-pane browser/terminal retention still need separate footage. The later 0.2.10 features are documented in the [main README](../../README.md), not demonstrated by this older recording. Use the [capture prompt](../capture-prompt.md) for future scenes.

## Editing and Privacy

**Supplied walkthrough exception:** The owner explicitly chose **Use as supplied** after being told that account balances, local paths and private workspace/chat details remain visible. This applies only to [the supplied MP4](dsh-multi-panel-v2-16x9.mp4) and [its still preview](dsh-multi-panel-v2-16x9.png). No further redaction, cropping or retiming was applied. The MP4 was not re-encoded; the still is an unaltered extracted frame. The MP4 has no audio track. Its embedded C2PA content credentials are retained unchanged; their signature was not verified. Original export/source editing and recorded plugin version are not inferred from those credentials. Review used a full-timeline visual survey and targeted OCR checks, not a complete manual review of all 1,566 frames. The privacy covers and metadata handling below describe the older edited clips, not this export.

Full-workspace clips keep the real pane positions, nesting, sidebar regions and divider motion. Private working-thread bodies, titles, workspace lists, local paths, browser page/address content, terminal output and file names are covered with opaque masks. Benign original availability replies, capture instructions and generic plugin-work text remain visible; these are real working chats, not fabricated dummy conversations. Actual native controls, composers and focus borders stay visible where safe.

The file-drop crop excludes the upper app, workspace list and browser. Private moving screenshot/tooltip content and the completed attachment thumbnail are also covered. The permission crop hides both chat bodies and unrelated approval content while retaining the actual mode menu, confirmation, composer labels and focus change. No file was made harmless by editing: the clip honestly shows opaque covers over one real attachment.

Browser footage demonstrates sidebar geometry, not private-page interaction or uninterrupted guest rendering. The restart excerpt retains the native “Previously opened” / “Restore page” placeholder and hides its URL; it shows the saved layout, not a live restored web page.

The basic split and settings crops exclude unrelated content. The basic chat-picker interval is removed, not blurred. Rounded crop corners are masked against an opaque background. MP4s contain no audio track and do not copy original recording metadata.

Raw source recordings and intermediate frames remain local under the ignored cache or their original location. Do not copy unreviewed raw recordings into this public directory. The explicitly approved supplied walkthrough above is a separate finished export, included unchanged under the exception described above. For newly edited or redacted clips, review **every frame** before adding or replacing media.

The [manifest](manifest.json) records cuts, dimensions, durations and asset hashes. The split clip contains an explicit jump cut between choosing the direction and the resulting two panes; it is not evidence of the hidden picker interaction. Opening/ending states are briefly held for readability.

## Regeneration

The renderers are documentation tooling only, not plugin runtime dependencies or build prerequisites. Requirements: macOS 13+, Xcode Command Line Tools (Swift/AVFoundation), Python 3 and Pillow; the full-workspace redactor also needs NumPy.

### Full-Workspace Redaction

The [full-workspace renderer](../../scripts/render-complex-readme-media.py) is intentionally limited to the reviewed recording A, dimensions and 43–57-second interval. It starts with opaque covers and restores inspected native chrome, empty composers and blank chats. It is not a general-purpose anonymizer. Do not apply its geometry assumptions to other footage without a new review.

```sh
mkdir -p .cache/readme-complex/regenerate/swift-cache
swiftc -parse-as-library \
  -module-cache-path .cache/readme-complex/regenerate/swift-cache \
  scripts/readme-media.swift -o .cache/readme-complex/regenerate/media

.cache/readme-complex/regenerate/media extract "RECORDING_A.mov" \
  .cache/readme-complex/regenerate/source 8 43 57 0,0,3440,1440 3440

python3 scripts/render-complex-readme-media.py \
  --source .cache/readme-complex/regenerate/source \
  --output .cache/readme-complex/regenerate/redacted --start 43 --fps 8
```

This recipe produces the earlier recording-A geometry, not the recording-C complex-layouts demo. Its retained rearrangement excerpt uses frames 40–87 (A48–54), plus eight copies of each endpoint for one-second holds: 8 seconds at 8 fps, with a 1280×611 GIF. Do not apply the A renderer to C.

The earlier complex-layouts demo uses C19–25 and C35–43: 112 reviewed states plus two one-second holds, giving matching 16-second MP4/GIF exports. The full native workspace is normalized to 1920×804, with editorial title/footer bands giving a 1920×900 MP4 and 1280×600 GIF. C masks were reviewed separately; they cover private content rather than reconstructing native UI. All 112 states and all recognized text were reviewed, then the actual encoded GIF/MP4 frames were checked independently. Unchanged GIF hold frames may coalesce without changing the clock. New scenes require their own geometry and privacy review, not reuse of either renderer's assumptions.

For 8 fps GIFs, alternating 120/130 ms delays preserve the MP4 clock. Review every frame and all recognized text before copying exports into this directory; a scan for known private labels alone can miss a transient leak.

### Basic Split and Settings

The recipes match the two reviewed **3440×1440** source recordings. Crop coordinates use the initial 1920-pixel-wide review viewport and are scaled to full source resolution. Do not reuse them on different footage without inspecting and updating the crops.

From the plugin repository root, substitute the two private recording paths locally:

```sh
mkdir -p .cache/readme-regenerate/swift-cache
swiftc -parse-as-library \
  -module-cache-path .cache/readme-regenerate/swift-cache \
  scripts/readme-media.swift -o .cache/readme-regenerate/media

.cache/readme-regenerate/media extract "RECORDING_A.mov" \
  .cache/readme-regenerate/split-menu 10 28 30 1260,412,660,390 1920
.cache/readme-regenerate/media extract "RECORDING_A.mov" \
  .cache/readme-regenerate/split-resize 10 32 35 1260,412,660,390 1920
.cache/readme-regenerate/media extract "RECORDING_B.mov" \
  .cache/readme-regenerate/settings-crop 10 6 15.4 740,195,440,433 1920

python3 scripts/render-readme-media.py \
  --frames .cache/readme-regenerate \
  --helper .cache/readme-regenerate/media \
  --work .cache/readme-regenerate/composed \
  --output .cache/readme-regenerate/review-output
```

The tools refuse to replace existing frames/videos. Choose fresh intermediate/output directories for another render. Review outputs before copying approved assets into this directory. The split card also crops unused blank space below the composers; the settings card retains the full reviewed settings crop.

The static [badge row](badges.svg) is source SVG, not a live npm or CI status badge. No package/repository publication is implied.
