# Feature Request: PNG → SVG Vectorization Pipeline for 3dsvg

## Context

This is the `3dsvg` monorepo (https://github.com/renatoworks/3dsvg). Structure:

```
3dsvg/
├── packages/
│   ├── engine/   # npm package "3dsvg" — <SVG3D> React component, Three.js scene, materials, animations
│   └── web/      # Next.js visual editor (3dsvg.design) — currently supports 4 input methods:
│                 # Text, Pixel Editor, SVG Code, File Upload (SVG only)
```

Right now, users can only feed the editor a **logo that is already an SVG**. Most real-world logos start life as a **PNG** (exported from Photoshop/Figma, downloaded from the web, a scanned mark, etc.), so users currently have to go find a separate online vectorizer, convert it themselves, then come back and upload the result. This breaks the workflow.

## Goal

Add a **PNG → SVG conversion step** as a new input path in `packages/web`, positioned _before_ the SVG ever reaches the existing 3D pipeline. The user should be able to:

1. Upload a **PNG** (or JPG) logo.
2. See a **live, interactive preview** of the vectorized result overlaid/side-by-side with the original raster.
3. Tweak **conversion settings** and see the preview update in real time (debounced).
4. Get the resulting SVG **optimized for small file size** before it's handed off.
5. Click "Continue" to send the final SVG into the **existing** `<SVG3D svg={...}>` flow — no changes needed downstream, the 3D/material/animation pipeline stays untouched.

This should feel like a **new step in the existing input flow**, not a separate app: `Upload PNG → Adjust & Preview → Confirm → 3D Editor (existing UI)`.

## Functional Requirements

### 1. Two distinct vectorization modes (user-selectable, radio/segmented control)

**A. "Smooth Trace" mode (default, best for logos/icons)**

- Traces the raster into clean vector paths with smooth bezier curves (potrace-style algorithm — corner detection + curve fitting), not literal pixel boundaries.
- Best for logos, wordmarks, icons with flat color regions.

**B. "Pixel Grid" mode (new, distinct request)**

- Treats the image **literally pixel by pixel**: each pixel (or each cell of a downsampled grid) becomes its own `<rect>` in the SVG, preserving a blocky/mosaic look.
- Must support a **grid resolution control** (e.g. downsample to 16×16, 32×32, 64×64, 128×128, or "original") since a literal 1:1 pixel trace of a large PNG would generate an enormous, unusable SVG.
- Adjacent same-color pixels should be merged into larger rects where possible (simple run-length merging, horizontally then vertically) to reduce node count — this is also a file-size optimization, not just a style choice.

Both modes share the same downstream pipeline (color quantization → path/rect generation → optimization).

### 2. Pre-conversion customization (before the SVG is ever finalized)

Expose these as a settings panel (reuse the existing `Collapsible` section pattern from `DESIGN.md` / `settings-panel.tsx` for visual consistency):

- **Color quantization**: slider for target palette size (2–64 colors, or "original/full color"). Use a k-means (or median-cut) color quantizer to posterize the image before tracing — this is the single biggest lever for both visual cleanliness and file size.
- **Color mode**: Full color / Grayscale / Black & white (with adjustable threshold slider for B&W).
- **Background removal**: auto-detect and strip a solid/near-solid background color (treat as transparent) with a tolerance slider. Also support "transparent PNG passthrough" (respect existing alpha channel).
- **Smoothing / curve fit tolerance** (Smooth Trace mode only): controls how aggressively corners are rounded vs preserved — expose as a simple "Sharp ↔ Smooth" slider rather than raw algorithm parameters.
- **Speckle/noise removal** (Smooth Trace mode only): minimum area threshold to discard tiny stray regions (potrace calls this "turdsize") — prevents noisy scans/compressed PNGs from generating hundreds of tiny junk paths.
- **Grid resolution** (Pixel Grid mode only): as described above.
- **Live before/after preview**: show original PNG and traced SVG (toggle or slider-wipe comparison), updating on setting change with debounce (~200–300ms) so the UI doesn't lag while dragging sliders.
- **Live file size readout**: show the current SVG's size in KB as settings change, so the user can see the size/quality tradeoff directly instead of guessing.

### 3. File size optimization pipeline (runs automatically before handoff, always on)

After tracing (either mode), before the SVG is passed downstream:

- Merge adjacent same-fill paths/rects where safe.
- Round all path coordinates to a sane, configurable decimal precision (e.g. 1–2 decimals) — this alone often cuts SVG size significantly with no visible quality loss.
- Strip all non-rendering metadata (editor cruft, comments, unnecessary groups/IDs, XML declarations if not needed).
- Run this through an SVGO-equivalent minification pass.
- Show a clear "Original PNG: X KB → Optimized SVG: Y KB" summary before the user confirms.

### 4. Handoff to existing pipeline

- On confirm, the resulting SVG string is passed to the **existing** SVG input path exactly as if the user had pasted/uploaded it directly (i.e. it becomes the `svg` prop value for `<SVG3D>`), so no changes to `engine/` are required for the 3D rendering itself.

## Non-Functional / Engineering Requirements

- **Do not bloat the `engine` package.** This feature lives entirely in `packages/web`. Do not add vectorization dependencies to `packages/engine/package.json`.
- **Run vectorization off the main thread.** Use a **Web Worker** for the trace + quantization + optimization steps — PNGs can be large, and this must not freeze the settings-panel sliders or the rest of the editor UI.
- **Lazy-load** the vectorization library/worker only when the user actually opens the PNG-upload flow (dynamic `import()`), not on initial app load, to keep the base editor bundle size unaffected.
- **Debounce** live-preview re-tracing on slider input (don't re-trace on every pixel of a drag).
- **Progress indication** for larger images (e.g. a progress bar/spinner while the worker processes), since tracing large images can take a noticeable moment.
- **Sane input limits**: warn (don't silently fail) if the uploaded image exceeds a reasonable size (e.g. > 4000×4000px or > 10MB) and suggest downscaling first.
- **Drag & drop + file picker** support, consistent with the existing "File Upload" input method's UX.
- Keep this feature **isolated and toggleable** — e.g. behind a clearly separated component/module — so it's easy to review, test, and (if needed) disable independently of the rest of the app.

## Suggested Implementation Approach

- New folder: `packages/web/src/lib/png-to-svg/` containing:
  - `trace-smooth.ts` — smooth/potrace-style tracer (evaluate a small, permissively-licensed JS potrace/imagetracer implementation vs. a minimal custom implementation; pick whichever keeps bundle size and license clean)
  - `trace-pixel-grid.ts` — custom pixel/grid-based rect generator with run-length merging
  - `quantize.ts` — color quantization (k-means or median-cut) shared by both modes
  - `optimize-svg.ts` — the minification/optimization pass
  - `worker.ts` — Web Worker entry point wiring the above together, message-based API (`{ imageData, mode, options } → { svg, sizeBytes }`)
- New component: `packages/web/src/components/png-to-svg-panel.tsx` — the settings UI + live preview, following the existing `Collapsible` section visual pattern from `settings-panel.tsx`.
- New step in the input-method flow (alongside Text / Pixel Editor / SVG Code / File Upload): **"PNG/Image Upload"**, which opens this panel before handing off to the existing 3D settings flow.

## Mandatory: Autonomous Hands-On Testing & Iteration Loop

Writing the code is not the finish line. You have Playwright (and any other browser/testing tools available to you, e.g. "ponytail") — **use them**. Do not consider this task done until you have personally driven the feature through a real browser like a user would, repeatedly, until it is genuinely bug-free.

Follow this loop:

1. **Run it for real.** Start the dev server (`npm run dev:web`, rebuilding `engine` first if needed). Don't just read the code and assume it works.
2. **Drive it with Playwright, end-to-end, every time:**
   - Upload a real PNG (use a few different kinds — a flat-color logo, one with a transparent background, a larger/more detailed image, a small icon).
   - Switch between "Smooth Trace" and "Pixel Grid" modes.
   - Actually move every slider/control (color count, threshold, smoothing, speckle removal, grid resolution, background removal) and confirm the live preview updates correctly and the debounce doesn't break anything.
   - Confirm the live file-size readout updates and the before/after optimization numbers make sense (optimized should be ≤ original, and never 0 or NaN).
   - Click through to confirm/continue and verify the resulting SVG actually renders correctly in the existing `<SVG3D>` 3D pipeline (shape, material, animation still work on the generated SVG).
   - Take screenshots at each key step so you can visually confirm the preview looks correct, not just that no exception was thrown.
3. **Capture everything that goes wrong**, not just crashes:
   - Browser console errors/warnings.
   - Failed network requests.
   - UI states that look broken, frozen, or visually wrong in screenshots even if no error was thrown (e.g. preview not updating, spinner stuck, layout broken, slider fighting the debounce).
   - Worker not terminating, memory/perf red flags on repeated runs.
   - Edge cases: very large image, tiny image, pure black&white image, fully transparent PNG, non-square image, uploading a non-image file.
4. **Fix, then re-run the entire loop from step 2 again** — not just a spot-check of the one thing you fixed. A fix can introduce a new regression elsewhere in the flow.
5. **Repeat until a full pass is clean**: zero console errors, zero visually broken states across all the test images and both modes, correct handoff into the existing 3D pipeline, and sane file-size numbers throughout.
6. Only once you've had one complete, clean end-to-end pass with no bugs found, report back what you tested and confirm it's done. If you're not sure something is fully working, don't say it's done — test it again.

Do not skip this loop or shortcut it because the code "looks right." The only acceptable evidence that this feature works is an actual Playwright run that exercised it and came back clean.

## Where This Feature Lives in the Existing UI (be explicit, don't improvise)

- Extend the **existing "File Upload" input method** rather than bolting on a disconnected fifth tab. On file upload, detect the MIME type / file signature:
  - If it's already an SVG → keep the current behavior exactly as-is (no regression).
  - If it's a raster image (PNG/JPG) → automatically route into the new PNG→SVG panel described above, then continue into the same downstream 3D flow once confirmed.
- This keeps the mental model simple for the user: "Upload a logo" always works, regardless of what format it started as.

## Security / Input Validation

- Do not trust the file extension or the declared MIME type alone. **Validate the actual file signature/magic bytes** (and that it decodes successfully as an image) before attempting to process it — reject anything that isn't a genuine raster image with a clear error message, instead of passing an arbitrary uploaded file into the decoder/worker.
- Enforce the file size and dimension limits (already specified above) _before_ decoding, not after, to avoid wasting resources on obviously invalid input.

## Memory & Resource Cleanup

- **Terminate the Web Worker** when: the user uploads a new image (kill the previous worker before starting a new one), closes/leaves the PNG-to-SVG panel, or navigates away from the editor. Don't let old workers keep running in the background.
- **Revoke any `Object URL`s** (`URL.createObjectURL` / `URL.revokeObjectURL`) created for image previews once they're no longer needed, to avoid leaking memory across repeated uploads during testing and normal use.
- This matters especially given the testing loop above involves uploading many images back-to-back in the same session — a leak that's invisible on one upload will become obvious (and must be caught) after a dozen.

## Code Quality Gates (in addition to the Playwright loop — not a substitute for it)

Browser testing alone does not catch everything. Before considering any pass of the loop "clean," also run and pass:

- **TypeScript typecheck** (`tsc --noEmit` or the project's existing typecheck script) with zero errors.
- **Lint** (the project's existing ESLint config) with zero errors (warnings should be reviewed, not just ignored).
- **Production build** (`npm run build` for `packages/web`, and the engine's build if touched) must complete successfully — a feature that only works in dev mode is not done.
- Treat a clean Playwright run _and_ clean typecheck/lint/build as the joint definition of "done." Either one alone is not sufficient.

## Cross-Browser Testing

This feature leans on `<canvas>`, image decoding, and Web Workers, which can behave subtly differently across engines. Run the full Playwright test pass (from the loop above) on **at least Chromium and Firefox** (WebKit too if convenient), not just one browser — don't declare the loop "clean" based on a single browser's results.

## Keep the Repo Clean

- Any screenshots, temporary test images, or Playwright trace/output artifacts generated during the testing loop are for your own verification only. **Do not commit them** to the repository — clean them up afterward, and add appropriate entries to `.gitignore` if the test tooling generates files in predictable locations (e.g. `test-results/`, `playwright-report/`).
- Keep the diff focused on the feature itself: no unrelated formatting changes, no leftover `console.log` debug statements, no commented-out dead code.

## Amendments (Post-Implementation Refinements)

These are follow-up refinements requested after the initial implementation was reviewed and confirmed working. Apply these on top of the existing feature — do not rebuild from scratch.

### 1. Raise max color palette from 64 → up to 256 (full color)

- The color quantization slider currently caps at 64 colors. Raise the max to **256**, and make it clear in the UI that the top of the range means "effectively full color / no meaningful quantization" (i.e. don't force posterization when the user explicitly wants max fidelity).
- Add a **"Full Color" mode** (skip quantization entirely) as the top-end option, separate from "256 colors" if the two aren't functionally identical — some source PNGs may have fewer than 256 unique colors already, so quantization should be a no-op in that case rather than degrading the image.
- Verify performance at high color counts: quantization and tracing at 256 colors on a large image is meaningfully heavier than at 16–64. Confirm this still runs in the Web Worker without freezing the UI, and that the progress indicator reflects longer processing time honestly (don't let the UI look stuck).
- Re-verify the live file-size readout still makes sense at high color counts — more colors means more paths/regions means bigger files; make sure the before/after optimization numbers are still accurate at this end of the range, not just at the low end.

### 2. Improve "Pixel Grid" mode quality

The current pixel-grid output should be visibly better/crisper. Specifically:

- Increase the max grid resolution ceiling beyond what's currently offered (allow finer grids, up to native/original pixel resolution as an explicit "Maximum Detail" option, with a clear file-size warning since this can generate a very large SVG).
- Improve the **rect-merging algorithm**: the current simple row-then-column run-length merge leaves more nodes than necessary. Use a proper 2D rectangular merging approach (e.g. greedy largest-rectangle merging over same-color regions, not just 1D runs) to meaningfully reduce path/rect count at the same visual resolution — this improves both quality-per-byte and raw file size.
- Support **per-cell alpha/transparency** (partially transparent pixels shouldn't be forced to fully opaque or fully transparent — preserve semi-transparency where the source PNG has it) rather than only solid-vs-transparent.
- Add an option to toggle **crisp edges** (no anti-aliasing/blending between cells, true blocky look) vs a **softened** variant (slight blending at cell boundaries) so the user can choose the aesthetic, not just the technical grid size.

### 3. General SVG output quality / detail

- Add a clear **quality preset** alongside the existing granular controls — e.g. "Balanced" (current default) vs **"High Quality / Max Detail"** — where the high-quality preset uses: higher/full color count, finer curve-fit tolerance in Smooth Trace mode (less aggressive simplification, more path points preserved), lower speckle-removal threshold (keep more fine detail instead of discarding small regions), and higher grid resolution in Pixel Grid mode.
- Make explicit in the UI that the "High Quality" preset trades a larger file size for more fidelity — pair it with the existing before/after size readout so the user sees that tradeoff directly rather than being surprised by a bigger file.
- Confirm the optimization pass (path merging, coordinate rounding, metadata stripping) still runs on high-quality/high-color-count output — optimization should reduce size without perceptibly reducing quality, at every quality level, not just the default one.
- Re-run the full Playwright testing loop (per the Autonomous Hands-On Testing & Iteration Loop section above) specifically covering: 256-color mode, "Full Color" mode, Maximum Detail pixel grid, and the new "High Quality" preset — on top of the original test matrix, not instead of it.

### 4. Perceptual color accuracy (Lab color space)

- When quantizing/comparing colors, use a perceptual color space (e.g. CIE Lab, via a standard color-conversion utility) for the distance metric instead of raw RGB Euclidean distance. RGB-based quantization tends to misjudge which colors are "visually close," especially in gradients/shadows — Lab-based comparison produces palettes and merges that match human perception much more closely.

### 5. Manual brand-color lock (eyedropper)

- Add an eyedropper/color-picker tool over the original source image preview: the user can click a pixel to sample its exact color and "lock" it as a must-keep color in the output palette.
- Locked colors must be preserved exactly (no quantization drift) even as other palette/quantization settings change — critical for brand logos where a specific hex value (e.g. a trademarked brand color) has to match exactly, not just "close enough."
- Support locking multiple colors at once; show the locked swatches clearly in the UI with an easy way to remove a lock.

### 6. Eliminate seams between adjacent color regions (anti-gap fix)

- A common vectorization artifact is a thin visible gap/line (usually white or background-colored) between two adjacent traced regions, caused by anti-aliasing at the original raster edges. Apply a small overlap/expansion between adjacent same-boundary shapes (a "shape bleed," similar to print-industry trapping) so no seam is visible at normal zoom levels — this matters even more once the SVG is extruded into 3D, where a seam becomes a visible crack in the model.

## Universal Brand-Logo Support

The goal of this section: the tool should handle **any real-world brand logo**, not just simple flat-color icons. Add support for:

### 7. Gradient detection and preservation

- Detect linear/radial gradients in the source image instead of flattening them into banded flat-color regions (which looks unprofessional and is very common in brand logos).
- Represent detected gradients as real SVG `<linearGradient>` / `<radialGradient>` definitions in the output, not as multiple discrete color bands.

### 8. Correct aspect ratio / viewBox handling

- The output SVG's `viewBox` must exactly preserve the original image's aspect ratio and dimensions — no unintended stretch, squash, or cropping, regardless of the source PNG's shape or size.

### 9. Geometric shape-primitive detection

- Detect when a traced region closely approximates a simple geometric primitive (circle, ellipse, rectangle, rounded rectangle) and represent it as a native SVG `<circle>`, `<ellipse>`, or `<rect>` element instead of an approximated Bézier `<path>`.
- This is common in icon-style brand marks (circular badges, square app-icon-style logos) and gives both a smaller file size and mathematically exact shapes instead of curve-fit approximations.

### 10. Stroke-based / line-icon logo handling

- Detect thin, consistent-width linework (common in line-art/outline-style logos) and preserve it as an SVG `stroke` with an appropriate `stroke-width`, rather than treating the line as a filled region — filling thin strokes as flat shapes distorts or thickens them incorrectly.

### 11. Color profile normalization (ICC/CMYK → sRGB)

- Some PNGs (especially those exported from design tools like Photoshop) embed a non-sRGB color profile (or were originally CMYK). Normalize color data to sRGB before any color processing, so the traced/quantized colors visually match the source logo rather than shifting due to an unhandled profile.

### 12. Logical grouping of output elements

- Where a logo visually separates into distinct parts (e.g. an icon/symbol plus a separate wordmark/text), attempt to group the corresponding paths into separate SVG `<g>` elements rather than one flat, undifferentiated set of paths.
- This gives the user (and the downstream 3D pipeline, if extended later) the ability to target/animate the icon and the wordmark independently instead of only as one fused shape.

## UX, Reliability, and Edge-Case Additions

### 13. Preserve the original raster for later re-editing

- Keep the originally uploaded raster image available for the duration of the session (not just the traced SVG), so if the user comes back to adjust a setting later, they re-trace from the original image rather than needing to re-upload it.

### 14. Standalone "Download SVG" option

- In addition to continuing into the 3D pipeline, provide a direct "Download SVG" action so the user can save the vectorized file for use elsewhere, independent of the 3D workflow.

### 15. Reject/warn on animated PNG (APNG)

- Detect APNG input explicitly. Either extract and use the first frame with a clear notice to the user, or reject the file with an explicit error message — do not silently process it in a way that produces unexpected/wrong results.

### 16. "Auto / Smart Settings" analysis on upload

- On upload, before the user touches any control, analyze the image (actual unique color count, presence of gradients, flat-design vs. photographic/complex) and pre-select a sensible starting mode (Smooth Trace vs. Pixel Grid) and starting settings accordingly. The user can still freely adjust everything afterward — this only sets a better default starting point instead of a generic one-size-fits-all default.

### 17. Respect already-indexed/paletted PNGs

- If the uploaded PNG is already an indexed/paletted PNG (common for simple icons) with a small, precise existing color set, detect this and use that exact palette directly rather than re-running color quantization on it and potentially degrading already-precise colors.

### 18. Visual similarity score

- After tracing, compute and display an approximate similarity score (e.g. a percentage, via a simple pixel-sampling comparison between the rendered SVG and the source raster) so the user has an objective number to weigh against file size, instead of judging quality by eye alone.

### 19. Saveable settings presets

- Let the user save their current panel settings as a named preset (e.g. "My Brand Style") and reapply it later in one click, useful for anyone processing multiple logos that should be treated consistently.

### 20. Render sanity check before handoff

- Before handing the SVG off to the 3D pipeline (or offering it for download), validate that it's well-formed (valid XML, no malformed paths) by actually rendering it internally (e.g. into an offscreen `<img>`/canvas) and confirming it rendered successfully, rather than assuming the tracer's output is always valid.

### 21. Accessibility for the new panel

- All new sliders, buttons, and controls in the PNG-to-SVG panel must be keyboard-navigable and carry appropriate `aria-label`s, consistent with the rest of the editor's accessibility standard — this should not be the one part of the tool that's mouse-only.

## Acceptance Criteria

- [ ] User can upload a PNG/JPG and choose between "Smooth Trace" and "Pixel Grid" modes.
- [ ] All listed customization controls are present, live-update the preview (debounced), and show a live estimated file size.
- [ ] Pixel Grid mode respects the chosen grid resolution and merges adjacent same-color cells.
- [ ] Final SVG passed downstream is optimized (size comparison shown to user) and renders correctly in the existing `<SVG3D>` pipeline with no changes to `packages/engine`.
- [ ] Vectorization runs in a Web Worker; UI remains responsive (sliders, scroll, etc.) while a large image is processing.
- [ ] `packages/engine`'s dependencies and bundle size are unaffected.
- [ ] Reasonable image size limits are enforced with a clear warning message, not a silent failure or crash.
- [ ] Uploaded files are validated by actual content/signature, not just extension/MIME string; non-image files are rejected cleanly.
- [ ] Existing SVG upload behavior is unchanged; raster uploads (PNG/JPG) are auto-routed into the new panel from the same "File Upload" entry point.
- [ ] Web Workers are properly terminated and Object URLs revoked on new upload / panel close / navigation — no memory growth across repeated uploads.
- [ ] `tsc` typecheck, lint, and production build all pass with zero errors.
- [ ] Full Playwright test pass completed cleanly on at least Chromium and Firefox.
- [ ] No test artifacts (screenshots, traces, temp images) committed to the repo; diff is scoped to the feature only.
- [ ] Color palette slider goes up to 256 / "Full Color", with quantization correctly skipped/no-op when the source image already has fewer unique colors.
- [ ] Pixel Grid mode uses proper 2D rectangle merging (not just row/column runs) and supports a "Maximum Detail" resolution option and per-cell alpha.
- [ ] A "High Quality / Max Detail" preset exists and visibly increases output fidelity, with the size tradeoff shown to the user.
- [ ] Full Playwright loop re-run and clean for the new high-color-count and high-detail code paths specifically, in addition to the original test matrix.
- [ ] Color distance/quantization uses a perceptual color space (Lab), not raw RGB.
- [ ] User can lock specific sampled colors via eyedropper; locked colors remain exact through quantization changes.
- [ ] No visible seams/gaps appear between adjacent traced regions at normal zoom.
- [ ] Gradients in the source image are detected and output as real SVG gradient defs, not flattened color bands.
- [ ] Output `viewBox` always matches the source image's true aspect ratio, with no stretch/crop.
- [ ] Near-circular/rectangular regions are represented as native `<circle>`/`<rect>`/`<ellipse>`, not approximated paths.
- [ ] Thin consistent-width linework is preserved as `stroke`, not filled/distorted.
- [ ] Non-sRGB color profiles (ICC/CMYK) are normalized to sRGB before processing.
- [ ] Distinct visual parts of a logo (icon vs. wordmark) are grouped into separate `<g>` elements where detectable.
- [ ] Original raster stays available for re-tracing without re-upload for the duration of the session.
- [ ] A standalone "Download SVG" action exists independent of the 3D handoff.
- [ ] APNG input is explicitly detected and handled (first-frame extraction with notice, or clean rejection) — never silently mis-processed.
- [ ] On upload, sensible mode/settings are auto-suggested based on actual image analysis, and remain user-adjustable.
- [ ] Already-indexed/paletted PNGs use their exact existing palette rather than being re-quantized.
- [ ] A similarity score is computed and shown after tracing.
- [ ] Users can save and reapply named settings presets.
- [ ] The final SVG is validated by an actual internal render check before handoff/download, not assumed valid.
- [ ] All new PNG-to-SVG panel controls are keyboard-navigable with correct `aria-label`s.
