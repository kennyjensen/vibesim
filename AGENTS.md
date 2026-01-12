# Repository Guidelines

## Project Structure & Module Organization
- Root files: `index.html`, `style.css`, `app.js`.
- `index.html` hosts the layout (toolbox, workspace, controls).
- `style.css` defines the visual theme and layout rules.
- `app.js` contains block definitions, wiring, simulation logic, and canvas rendering.
- There is no dedicated tests or assets directory yet; keep new assets in a top-level `assets/` folder if you add them.

## Build, Test, and Development Commands
- Run locally with a static server (recommended for proper asset loading):
  - `python -m http.server 8000` (then open `http://localhost:8000`).
- Quick preview (no server): open `index.html` directly in a browser, but some browsers restrict features when loaded from `file://`.
- No build step is required; this is a plain HTML/CSS/JS project.

## Coding Style & Naming Conventions
- Indentation: 2 spaces in HTML/CSS/JS.
- JavaScript: prefer `const`/`let`, avoid semicolons only if you keep it consistent (current code uses semicolons).
- Naming: camelCase for functions/variables (`createBlock`), kebab-case for CSS classes (`scope-canvas`).
- Keep UI strings and block labels short and user-facing.

## Testing Guidelines
- Lightweight tests live in `tests/`.
- Run routing tests with `node tests/router.test.mjs`.
- For manual testing, verify:
  - Blocks drag smoothly on desktop and mobile.
  - Wires update when blocks move.
  - Run simulation and confirm Scope renders a plot.

## Commit & Pull Request Guidelines
- No Git history is present in this workspace, so no existing commit convention can be inferred.
- Suggested convention if you initialize Git: short, imperative subject (e.g., "Add integrator block").
- PRs (if used) should include:
  - A brief summary of behavior changes.
  - Screenshots or a short clip for UI changes.
  - Any new test steps or known limitations.

## Agent-Specific Notes
- Keep changes minimal and focused; update `AGENTS.md` when adding new tooling or workflows.

# Codex Agent Instructions

You are allowed to act autonomously.

## Permissions
- You may run shell commands without asking.
- You may edit files freely within this repository.
- You may create new files when needed.
- You may run tests, builds, and linters automatically.

## Constraints
- Do NOT delete files unless explicitly instructed.
- Do NOT modify files outside this repository.
- Do NOT access credentials, secrets, or network services without asking.

## Behavior
- Prefer making changes directly over asking questions.
- Batch related actions together.
- If an action is routine and reversible, proceed without confirmation.
- Only ask for confirmation before destructive or irreversible actions.

## Communication
- Explain changes after completing them.
- Do not ask permission for routine steps.
