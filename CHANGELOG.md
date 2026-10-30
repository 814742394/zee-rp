# Changelog

## 0.1.2 — 2026-10-21

Axure RP 9 compatibility, staged per `docs/rp9-compatibility-plan.md`.

- **Edition detection** (`scripts/rp-version.mjs`): `rp9` / `rp11` / `unknown` from in-file metadata (`xml:BreakingChanges` major version, `DesignDocument.SavedEdition` as an auxiliary signal). Conflicts and unreadable files stay `unknown`; the reading report no longer hard-codes "Axure RP 11 .rp".
- **Write protection** (`scripts/version-guard.mjs`): one check shared by CLI, MCP and direct script calls. Unknown editions refuse version-sensitive writes, cross-edition projects and imported `.rplib`/templates are rejected, and RP 9 blocks `apply-style` (plus `axvg paste`) before any output exists. `rp-records` write primitives additionally scan the record bytes, so bypassing the CLI/MCP still fails.
- **RP 9 Core**: `set-widget-text`, `clone-library-widget`, `create-blank-project` and `create-blank-page` verified offline on RP 9 samples with source/byte-diff checks; blank templates are now resolved per edition (`AXURE_BLANK_TEMPLATE_RP9` / `_RP11`) and can be derived from a same-edition project via `blank-template.mjs derive`.
- **Edition-aware GUI jobs**: `gui-roundtrip.swift` takes the edition and verifies the launched bundle, `jobs.mjs` records `editionVerified` / `editionPreserved`, so an RP 9 file can never be "accepted" after being saved by RP 11.
- **Native acceptance**: the derived template and the end-to-end demo (blank project → library clone → text rewrite) open in Axure RP 9, and a manual open → save → close → reopen kept the page, the widget geometry and the rewritten text with the edition unchanged. Saving adds an `Axure:DocumentSettings` record that derived files do not carry; that is normal and does not affect loading.
- **New checks**: `npm run test:rp9` (offline Core + rejection paths) and `npm run test:rp9-native` (native open/save/close/reopen; missing permission is reported as a missing prerequisite, not a pass). New `rp-fingerprint` helper for structural evidence.
- **Docs**: `docs/rp9-baseline.md` (stage 0 baseline), `docs/rp9-capabilities.md` (per-command matrix), `docs/rp9-acceptance-runbook.md` (four-level acceptance walkthrough), plus updates to capabilities, validation, README (both languages) and the skill file.
- **Fix** (derived templates rejected by RP 9, reported as "This file may be corrupted"): `blank-template.mjs derive` had three defects, each found by bisecting with real Axure RP 9 opens. (1) It remapped only child manifest parts, leaving the root `DesignDocument` / `<version>.version` references past the end of the derived file — files created from such a template could no longer be extended and RP 9's version lookup read an empty stream. (2) It trimmed `PackageInfos` down to the target page, but RP 9 resolves every manifest leaf package (page *and* HTML/Word/CSV/Print configuration) through `PackageInfos`; missing entries make it reject the file. (3) It left the removed list entries' objects in the DesignDocument object pool; RP 9 requires every pooled object to be reachable (healthy files: reachable set == pool). The remap is now recursive, non-page `PackageInfos` are preserved, unreachable pool objects are pruned, and `derive` self-checks all four invariants (blank structure, manifest part/record coverage, no pool orphans, leaf packages == `PackageInfos`). `test/rp9-core-check.mjs` gained cases that fail on the old template.

## 0.1.1 — 2026-10-13
## 0.1.1 — 2026-10-13

- Sync the previously omitted expression/condition contracts, rich-text links/list/spacing/full style keys, multi-run table cells, custom/nested connector cloning, and recent page/panel/master fixes from the current implementation.
- Publish expression/widget schema probes, the capabilities generator, global-variable writer, and all historical test source with configurable native input locations and compact fixture fingerprints.
- Register the global-variable writer in CLI/MCP; fix MCP default-value forwarding and rich-text paragraph schemas. Move the rich-text CLI invocation after hyperlink template initialization.
- Add public, native-free checks, locally generated native demos/tests, and real MCP transport tests. Separate historical fixture tests from default public tests.
- Preserve implementations and tests in release packaging; include bilingual documentation, correct executable examples, and generated command reference.
- Replace the old repository screenshot with an authored specification and deterministic reference SVG. Previous Git history is preserved.

## 0.1.0

Initial public release. Its README's 225-check claim did not describe the public `npm test` entry point; its distribution lagged the local implementation. Those claims and omissions are corrected in 0.1.1.
