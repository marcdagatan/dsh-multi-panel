# Releasing

This repository contains only the multi-panel plugin. Its source and build inputs are separate from other plugins and from a user's DSH profile.

## Current candidate

Version **0.2.7** is the first public-release candidate. It keeps the verified 0.2.6 runtime behavior and adds release tooling, documentation and attribution. No public GitHub release or npm publication has happened as part of preparation.

Supported runtime: **DSH 0.2.0-rc.2** only. Other versions must be reviewed and validated before changing the pinned artifact hashes.

## Before release

1. Confirm the intended GitHub owner/repository and npm package availability. Add the real `repository`, `homepage` and `bugs` URLs to package metadata; never use guessed URLs.
2. Obtain the supported DSH desktop archive, install the locked development dependencies and extract the runtime as described in README.
3. Run the full checks and build:

   ```sh
   pnpm run format:check
   pnpm run test:portable
   pnpm run build
   pnpm test
   pnpm pack --pack-destination release
   ```

   Packaging repeats build/full tests/formatting through `prepack`. Inspect the final tarball file list. It should contain only the generated `lib`, package manifest, Cordis patch, README and applicable license/notice files. Do not upload old development tarballs.

4. Manually verify cold startup, the native agent menu, distinct chat drafts, target-only file intake, nested pane splits, sidebar splits, maximize/restore and rollback in the existing DSH GUI. Check the actual desktop surface for desktop guest/file behavior; browser-only evidence is not a desktop test.
5. Record the verified runtime, check results and known limitations in release notes. The 0.2.6 behavior passed 135 tests and four-pane native browser verification before this public-release preparation; run the checks again for the exact release archive.
6. Confirm third-party notices accompany the archive. Do not relicense the native upstream code or omit its notices. See THIRD_PARTY_NOTICES.md.
7. Commit the release state, verify a clean working tree, and create an annotated version tag after the release destination is confirmed.

## Publish only after confirmation

Publication is a separate action. Do not automatically push, create a public repository, release, or publish to npm from a local packaging command.

For a GitHub release, use the confirmed repository, push the reviewed commit/tag, attach the versioned tarball and its SHA-256 checksum, and include installation/rollback instructions. Source archives alone are not installable without the native extraction/build prerequisites.

For npm, first verify namespace ownership, package metadata and the packed contents. Then explicitly publish the reviewed archive with public access. Do not store registry tokens in this repository or put them in shell commands/logs.

## Install and rollback

Install and enable the versioned tarball using DSH's plugin manager. Restart DSH and reconnect the existing GUI. The bundle disables only the original conversation, right-sidebar and attachment presentation owners.

To roll back, disable this bundle, re-enable those three original owners, restart DSH and reconnect. Do not enable the original owners while this replacement is enabled. Sessions and their logs are not removed.

## Repository hygiene

Generated bundles, native extraction, dependencies, cache, local QA scripts, private handoff notes, archives and screenshots with session/sidebar content remain local and ignored. Keep release assets outside Git history. If adding public screenshots later, use a separate sanitized demo profile.
