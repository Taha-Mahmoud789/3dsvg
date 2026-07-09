# AGENTS.md

Project context and standing rules for any AI agent (opencode, Claude Code, etc.) working on this repo.

## Active Feature Task

Read and follow `@docs/png-to-svg-feature-prompt.md` when working on the PNG-to-SVG feature. This file is the single source of truth for that feature's requirements — if it's been updated, re-read it before continuing any related work; do not rely on memory of an earlier version.

## Project Identity

This repo is an independently maintained fork/continuation of the original `3dsvg` by Renato Costa (MIT licensed). It now includes functionality beyond the original project (PNG-to-SVG conversion, multi-color 3D export, etc.).

## Standing Engineering Principles

### Prefer targeted fixes over rewrites

When asked to fix a specific, identified bug, fix it in place in the existing file(s) — do not propose deleting existing working code or rebuilding a feature from scratch with new libraries unless there is a clearly explained, specific technical reason the current approach cannot be patched. If you find yourself concluding "the cleanest path is to start over," stop and explain the specific blocker in detail first, and wait for confirmation before deleting or replacing any existing, working files.

### Root-cause bugs, don't mask them

When something throws an error, find the actual cause via the real stack trace/console output — don't guess, and don't wrap the symptom in a try/catch that merely swallows the error without fixing what produced it.

### Don't bloat `packages/engine`

The engine package is published to npm as `3dsvg` and must stay lean. Feature-specific dependencies (vectorization libraries, image processing, etc.) belong in `packages/web` only, unless a change is fundamentally about the engine's own rendering/3D pipeline.

### Isolate and lazy-load heavy features

New heavy functionality (vectorization, worker-based processing, etc.) should be lazy-loaded (dynamic `import()`) so it doesn't affect the base editor's initial bundle size, and should run off the main thread (Web Worker) when it could block the UI.

## Standing QA Rules (Read Before Any Testing Task)

### Visual verification is mandatory — numbers are not enough

A passing similarity score, a clean console, or "no errors thrown" is NOT sufficient proof that visual output is correct. You must actually open and look at the generated image/screenshot/3D render yourself and visually compare it to the source before declaring any test "passed." A high similarity score or a script exiting 0 can still correspond to a visibly wrong, distorted, incomplete, or flattened (e.g. single-color-instead-of-multi-color) result.

### Real-world test assets over synthetic fixtures

Synthetic test images (tiny solid-color squares, 1x1 pixels, etc.) do not exercise the same code paths as real logos and have already missed real bugs in this project (e.g. a `RangeError: Invalid array length` on a real 2000×2000 gradient logo that no synthetic fixture caught). Use the real logo files in `test-assets/logos/` as the standing regression set for the PNG-to-SVG and 3D-rendering pipelines, in addition to (not instead of) synthetic unit tests. When you encounter a new real-world logo that breaks something, add it to `test-assets/logos/` so the bug can't silently regress later.

### Named regression fixtures

| Fixture file | Named key | What it regression-tests |
|---|---|---|
| `test-assets/html5-original-wordmark.svg` | `html5-wordmark-regression` | View-dependent specular noise/shimmer on white surfaces. The white "5" on the orange shield historically exhibited pixel-level shimmering that changed with camera rotation, caused by low-res PMREM environment map. Always test this file at 3+ camera angles (front, angled, grazing) when touching materials, environment maps, lighting, or renderer settings. Playwright E2E: `packages/web/tests/html5-wordmark-regression.spec.ts` |

### Iterate until actually clean, not until a script exits 0

An automation script finishing without throwing is not the same as the feature working correctly. After any automated test run, inspect the actual output (screenshots, generated files, exported 3D models) before reporting success. Fix issues found, then re-run the full test set again — not just the one case that failed — since a fix can regress something else elsewhere.

### Server readiness checks

Do not use PowerShell's `Invoke-WebRequest` to check if the dev server is ready — it fails in non-interactive shells on this machine and produces a misleading error. Use Playwright's own navigation/wait mechanisms (`browser_navigate`, `waitForLoadState`, etc.) to confirm the server is up instead.

### Cross-browser testing

UI/rendering features (canvas, Web Workers, WebGL/Three.js) can behave subtly differently across engines. Run the full test pass on at least Chromium and Firefox before declaring a feature's testing loop "clean."

## Session & Workflow Hygiene

### Long sessions degrade — don't push through them

If a session's context usage is high (roughly 40%+) and the agent appears stuck, slow, or repeating itself, prefer starting a fresh session with a short, precise handoff summary (what's done, what's in progress, what's next) over continuing to push in the same long session.

### Commit incrementally, not in one giant diff at the end

After each logical chunk of work is implemented and verified clean, make a commit with a clear message describing what changed. This creates real rollback points instead of one massive commit that's hard to bisect if something breaks later.

### Keep the repo clean

Do not commit test screenshots, Playwright traces, temporary test scripts' output, or other generated test artifacts. Add new output directories (e.g. `test-results/`, `qa-screenshots/`) to `.gitignore` as they're created. Keep diffs scoped to the requested feature — no unrelated formatting changes, no leftover `console.log` debug statements, no commented-out dead code.

### License attribution

Never remove or alter the original MIT copyright notice in `LICENSE` for Renato Costa — this is a legal requirement of the license, not a style choice, regardless of how much the codebase has since changed. A note that the repo is now an independently maintained fork is fine and encouraged; removing the original notice is not.

## Known Architectural Gotchas

### SVG `<clipPath>` is not flattened before reaching the 3D engine

Real-world SVGs from tools like Illustrator/Inkscape often place a fill on a plain `<rect>` and define the actual visible shape via a `<clipPath>` rather than directly on a `<path>`. The engine's SVG-to-3D pipeline does not currently apply `<clipPath>` clipping, so such shapes render as solid, uncropped rectangles instead of their real form. Any SVG entering the 3D pipeline (from direct SVG upload/paste **or** from the PNG-to-SVG output) should have clip-paths flattened into real path geometry before being handed to `<SVG3D>`.

### 3D output should preserve original multi-color fills, not one uniform material color

The 3D extrusion currently applies one flat material color to the whole shape. The correct behavior: each distinct fill color in the source SVG should render as its own colored part in the 3D scene — original colors are never overridden. Material presets (Gold, Chrome, Glass, etc.) affect surface properties only (metalness, roughness, reflectivity) and must never replace or override the original SVG colors. This applies across preview and all export formats: PNG/video preview shows true multi-color; GLB export uses real multi-material; OBJ export uses an accompanying `.mtl`; PLY export uses per-vertex color. STL has no color support at all (a format limitation, not a bug) — the UI must clearly warn the user of this when STL is selected as the export format.

## Where Things Live

```
3dsvg/
├── packages/
│   ├── engine/                     # npm package "3dsvg" — <SVG3D> component, Three.js scene, materials
│   └── web/                        # Next.js visual editor
│       └── src/lib/png-to-svg/     # PNG→SVG vectorization pipeline (trace-smooth.ts, trace-pixel-grid.ts, quantize.ts, optimize-svg.ts, worker.ts)
├── test-assets/logos/              # Real-world brand logo test corpus (do not delete; add new problem logos here)
└── docs/png-to-svg-feature-prompt.md  # Full feature spec — read before working on PNG-to-SVG
```
