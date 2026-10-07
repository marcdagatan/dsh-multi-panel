# Third-party notices

Original multi-panel code is copyright (c) 2026 Marc Uy Dagatan and is licensed under the MIT license in [LICENSE](LICENSE). This package also redistributes modified upstream code. The original copyright and full license texts for those portions are preserved below; they are not replaced by the project's copyright.

## Embedded upstream components

The build embeds pinned DSH 0.2.0-rc.2 conversation, right-sidebar and attachment client artifacts. It also extracts and modifies the native dockkit segment of that version's Web frontend shell. These are MIT-licensed DeepSeek components, copyright (c) 2026 DeepSeek. See [the full DeepSeek license](third-party-licenses/deepseek-MIT.txt).

The native artifacts contain these additional embedded dependencies:

| Component                                                                                                                                                | Embedded version | Where embedded                                   | Copyright and full license                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ------------------------------------------------ | -------------------------------------------------------------------------------- |
| `@deepseek-ai/cosmokit`                                                                                                                                  | 1.8.5            | Conversation client, `vendor/cosmokit` region    | 2021-present Shigma; [MIT](third-party-licenses/shigma-MIT.txt)                  |
| `@deepseek-ai/schemastery`                                                                                                                               | 3.18.4           | Conversation client, `vendor/schemastery` region | 2021-present Shigma; [MIT](third-party-licenses/shigma-MIT.txt)                  |
| `lexical`, `@lexical/selection`, `@lexical/extension`, `@lexical/html`, `@lexical/clipboard`, `@lexical/plain-text`, `@lexical/history`, `@lexical/text` | 0.49.0           | Conversation editor                              | Meta Platforms, Inc. and affiliates; [MIT](third-party-licenses/lexical-MIT.txt) |
| `clsx`                                                                                                                                                   | 2.1.1            | Conversation and attachment clients              | Luke Edwards; [MIT](third-party-licenses/clsx-MIT.txt)                           |
| `zod`                                                                                                                                                    | 4.4.3            | Right-sidebar client                             | 2025 Colin McDonnell; [MIT](third-party-licenses/zod-MIT.txt)                    |
| `picomatch`                                                                                                                                              | 4.0.4            | Right-sidebar client                             | 2017-present Jon Schlinkert; [MIT](third-party-licenses/picomatch-MIT.txt)       |

The conversation and right-sidebar artifacts also contain small bundler helpers marked `rolldown/runtime.js`. The exact Rolldown version is not identified in those artifacts. For conservative notice coverage, this distribution includes [Rolldown's MIT license](third-party-licenses/rolldown-MIT.txt), copyright (c) 2024-present VoidZero Inc. & Contributors, and [its third-party notices](third-party-licenses/rolldown-THIRD-PARTY-LICENSE.txt) for Rollup contributors and esbuild's Evan Wallace. These notice sources are not asserted to identify an exact bundled tool version.

React, React DOM and native DSH services/UI primitives are resolved from the host runtime. Their implementations are not copied into this package by its build.

## Provenance

- Native package metadata identifies `@deepseek-ai/dsh-client-ui-conversation`, `@deepseek-ai/dsh-client-ui-sidebar-right` and `@deepseek-ai/dsh-client-ui-attachment` as version 0.2.0-rc.2, licensed MIT, with repository <https://github.com/deepseek-ai/deepseek-harness>. Their installed package `LICENSE` files supply the preserved DeepSeek license.
- The installed ASAR contains `dsh/node_modules/@deepseek-ai/dsh-web-frontend/package.json` and `LICENSE`. The metadata identifies version 0.2.0-rc.2, MIT, and repository directory `apps/web`; its license matches the preserved DeepSeek license. Dockkit is embedded in this licensed shell rather than installed as a separate package artifact. The private fork is internal to this plugin; that description does not change the upstream MIT license.
- [The build](scripts/build.mjs), [conversation and attachment patches](scripts/conversation-fork.mjs), [sidebar patches](scripts/sidebar-fork.mjs), and [dockkit extraction](scripts/sidebar-dockkit.mjs) identify the copied artifacts, hash-check them, and apply the modifications. The dependency versions above come from the native artifacts' embedded region markers, supplemented by installed vendor package metadata.
- The Shigma license was verified in the installed cosmokit 1.8.5 and schemastery 3.18.4 packages; both contain the same MIT text and copyright.
- Exact versioned official license sources: [Lexical 0.49.0](https://raw.githubusercontent.com/facebook/lexical/v0.49.0/LICENSE), [clsx 2.1.1](https://raw.githubusercontent.com/lukeed/clsx/v2.1.1/license), [Zod 4.4.3](https://raw.githubusercontent.com/colinhacks/zod/v4.4.3/LICENSE), and [Picomatch 4.0.4](https://raw.githubusercontent.com/micromatch/picomatch/4.0.4/LICENSE).
- Unversioned official helper-notice sources: [Rolldown license](https://raw.githubusercontent.com/rolldown/rolldown/main/LICENSE) and [Rolldown third-party notices](https://raw.githubusercontent.com/rolldown/rolldown/main/THIRD-PARTY-LICENSE).

The MIT licenses permit modification and redistribution while requiring preservation of copyright and permission notices. They do not require publication of original upstream source, an attribution UI, or a file specifically named `NOTICE`. Keep this document and the complete license texts with distributions containing the embedded code.
