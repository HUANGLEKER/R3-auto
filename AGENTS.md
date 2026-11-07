# Repository Guidelines

## Project Structure & Module Organization

- `src/core/` contains configuration, persistence, locks, caches, and logging.
- `src/platform/` implements Changdu OpenAPI and Playwright/CDP integration; `src/coordinator/` resolves dramas and manages the pipeline.
- `src/runner.ts` orchestrates automation; `R3-Web.exe` is the sole user launch entry.
- `src/web/` contains the HTTP/SSE server, launcher entry, and bridge; `src/web/public/` holds HTML, CSS, and JavaScript assets.
- `tests/unit/` and `tests/integration/` hold tests. `data/` stores operational configuration and records; `tools/` contains launcher utilities.
- Current behavior is documented in `README.md` and `docs/changdu_native_api_implementation.md`. The current Changdu integration only queries content and validates eligibility.

## Build, Test, and Development Commands

Use Node.js 24+ with native TypeScript stripping; no compilation step is required.

- `pnpm install`: install dependencies.
- Double-click `R3-Web.exe` to launch the desktop console.
- `pnpm run build:exe`: rebuild the Windows desktop launcher.
- `pnpm test`: run the registered unit and integration suites.
- `pnpm run typecheck`: check TypeScript without emitting files.

On Windows, the bundled runtime can run `.\node\node.exe tests/run_all_tests.ts`. Browser automation expects CDP on port 9224.

## Coding Style & Naming Conventions

Follow existing four-space indentation, single quotes, and semicolons. Use strict TypeScript, ESM imports with explicit `.ts` extensions, and erasable syntax. Prefer camelCase functions, PascalCase classes/interfaces, and descriptive snake_case module filenames. No formatter or linter is configured; match surrounding code.

## Testing Guidelines

Tests use `node:test` and `node:assert/strict`. Name files `*.test.ts` and register new files in `tests/run_all_tests.ts`. Add regression coverage for changed behavior, especially cancellation, conflict replacement, and channel eligibility. No numeric coverage threshold is configured.

The suite sets `R3_DATA_DIR` to a temporary directory and removes it afterward. Individual test invocations must also isolate data. Mock external operations; do not submit real platform tasks during tests.

## Commit & Pull Request Guidelines

This checkout has no Git metadata, so historical conventions cannot be verified. Use concise imperative commit subjects describing the change. PRs should explain behavior, relevant issues, validation results, and recovery or configuration impacts. Include screenshots for visible UI changes.

## Automation Safety

Keep long platform IDs as strings. Preserve the single-instance lock and validate work IDs before filling tasks. Prefer StrongLocator and verify actual form values. Preserve blocking failures and current-run slot validation to prevent overwriting completed slots. Checkpoint resume has been removed; each run starts with the current input list and must not read or write legacy checkpoint files. Keep credentials and operational data out of commits.

The native content query preserves long IDs as strings during JSON decoding. Preserve cancellation propagation and drain before releasing the lock; uncertain task submissions must remain blocked. `tools/review_changdu_api.ts` verifies content lookup with mocked HTTP; Standalone business scripts have been removed; run real operations through the desktop console.
