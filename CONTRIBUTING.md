# Contributing

This is an independent plugin repository. Keep changes scoped to this plugin; do not modify DSH installations or other plugins.

## Setup and checks

Follow the prerequisites and extraction instructions in [README.md](README.md). The full build and native integration tests require the exact supported DSH runtime artifacts. They are extracted locally, not checked into Git.

Before submitting changes:

```sh
pnpm run format
pnpm run format:check
pnpm run test:portable
pnpm run build
pnpm test
```

Portable tests do not replace the full native integration suite. State which checks you ran and any missing runtime prerequisite. Include a deterministic regression for fixes to session ownership, native registration order, pane lifetime or file intake.

## Boundaries

- Reuse native controllers, services and slots. Do not duplicate session or composer ownership.
- Preserve mounted editor and sidebar instances when changing layout.
- Do not change pinned artifact hashes just to make a new DSH version build. Review native contract changes and validate integration first.
- Do not commit runtime extracts, dependencies, archives, credentials, local handoff logs or screenshots with private session names.
- Manual screenshots are evidence, not an automated visual-test suite. Use sanitized demo content if adding public images.

## Reporting bugs

Include plugin version, DSH version, operating system, a minimal reproduction, expected behavior and actual behavior. Remove session IDs, message contents, file paths, credentials and tokens from logs before sharing. For security-sensitive reports, do not put exploit details or credentials in a public issue; contact the repository maintainer privately.

Contributions are provided under the project's MIT license. Preserve all applicable third-party notices.
