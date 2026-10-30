---
name: zee-rp
description: Read and edit Axure RP 9 and RP 11 prototypes using the CLI, optional MCP sessions, and macOS GUI jobs — with per-edition capability gating.
---

# zee-rp

Read [README](README.md), [capabilities](references/capabilities.md), and [validation](docs/validation.md) before producing a prototype. Query actual commands using `node bin/axure.mjs --help` or the MCP tool schemas.

Use a user-supplied blank template and local native libraries; these assets are not bundled. All `.rp` mutations use new output names. Respect configured `AXURE_WRITE_ROOT` and `AXURE_PROTECTED_PATHS` through the unified CLI/MCP.

Report structure, native loading, preview behavior, and GUI edit/save/reopen separately. A successful command or three-zero structure check is not native acceptance. Public recipes and tests are included; historical fixture binaries are external and unavailable prerequisites must be reported explicitly.

## Axure RP 9

Check the edition before promising anything: every CLI/MCP result carries it, and `node bin/axure.mjs rp-read <file>` prints the evidence in the second line. The edition comes from `xml:BreakingChanges` + `DesignDocument.SavedEdition`, never from the filename.

- RP 9 Core (has RP 9 evidence): `rp-read`, `set-widget-text`, `clone-library-widget`, `create-blank-project`, `create-blank-page`. Everything else runs with an explicit "unverified on RP 9" notice — do not describe it as compatible.
- Never emit `apply-style` or run `axvg paste` for RP 9: RP 9 refuses the whole file (`Unrecognized Type: Axure:InteractionApplyStyleInfo`) and its canvas cannot read the RP 11 clipboard format. Both are rejected before output.
- RP 9 blank projects/pages need a real RP 9 template (`AXURE_BLANK_TEMPLATE_RP9`) or one derived from an RP 9 project: `node scripts/blank-template.mjs derive <rp9.rp> <blankPageName> <out.rp>`. A template or `.rplib` from another edition is rejected.
- When a target is unreadable, `unknown` is not `rp11`: version-sensitive writes stop unless `AXURE_TARGET_EDITION` is declared explicitly, and that declaration is reported as a declaration rather than file evidence.
- RP 9 evidence levels and the per-command matrix live in [docs/rp9-capabilities.md](docs/rp9-capabilities.md); the structural baseline is in [docs/rp9-baseline.md](docs/rp9-baseline.md).
