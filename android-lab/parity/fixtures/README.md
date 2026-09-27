# Per-package parity fixtures

One TypeScript generator per feature package, so packages never edit the same file:

- `parity/fixtures/<feature>.ts` imports the web's own function (`../../../shared/strokes`,
  `../../../shared/lesson/answer-check`, …), runs it over seeded cases and writes
  `<feature>.json` (or `<feature>-*.json`) into the directory given as `process.argv[2]`.
- `core/src/test/kotlin/…/<Feature>ParityTest.kt` reads it via `System.getProperty("parity.dir")`
  (copy the `fixture()` helper from `ParityTest.kt`) and asserts the Kotlin port matches exactly.

`parity/generate.sh` runs every file here after `generate-fixtures.ts`; Gradle re-runs it
whenever anything under `shared/`, `frontend/src/utils/` or this folder changes.
