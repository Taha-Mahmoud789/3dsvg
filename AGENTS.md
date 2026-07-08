## Active Feature Task

Read and follow @docs/png-to-svg-feature-prompt.md when working on the PNG-to-SVG feature.

## Standing QA Rules (Read Before Any Testing Task)

### Visual verification is mandatory — numbers are not enough

When testing the PNG-to-SVG feature (or any visual output), a passing
similarity score, a clean console, or "no errors thrown" is NOT sufficient
proof that the output is correct. You must actually open and look at the
generated image/screenshot yourself and visually compare it to the
original source image before declaring any test "passed." A high
similarity score can still correspond to a visibly wrong, distorted, or
incomplete shape — verify with your own visual inspection, every time.

### Real-world test assets over synthetic fixtures

Synthetic test images (tiny solid-color squares, 1x1 pixels, etc.) do not
exercise the same code paths as real logos and have already missed real
bugs in this project. Use the real logo files in `test-assets/logos/` as
the standard regression set for the PNG-to-SVG feature, in addition to
(not instead of) any synthetic unit tests.

### Iterate until actually clean, not until a script exits 0

An automation script finishing without throwing is not the same as the
feature working correctly. After any automated test run, inspect the
actual output (screenshots, generated files) before reporting success.
Fix issues found, then re-run the full test set again — not just the one
case that failed — since a fix can regress something else.

### Server readiness checks

Do not use PowerShell's `Invoke-WebRequest` to check if the dev server is
ready — it fails in non-interactive shells on this machine and produces a
misleading error. Use Playwright's own navigation/wait mechanisms
(`browser_navigate`, `waitForLoadState`, etc.) to confirm the server is
up instead.

### Keep the repo clean

Do not commit test screenshots, Playwright traces, or other generated
test artifacts. Add new output directories (e.g. `test-results/`) to
`.gitignore` as they're created.

### License attribution

This project is a fork/continuation of the original `3dsvg` by Renato
Costa (MIT licensed). Never remove or alter the original copyright
notice in `LICENSE` — this is a legal requirement, not a style choice.
