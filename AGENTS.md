# Repository Guidelines

## Project Structure & Module Organization

- `src/main` is the Electron system layer: app bootstrap, window lifecycle, IPC, SQLite, cron, channels/plugins, MCP, SSH, and updates.
- `src/preload` exposes the secure bridge used by the renderer.
- `src/renderer/src` is the React 19 UI (`components/`, `stores/`, `hooks/`, `lib/`, `locales/`, `assets/`).
- `src/shared` holds cross-process TypeScript contracts; `src/components`, `src/hooks`, and `src/lib` contain shared utilities.
- `src/dotnet/OpenCowork.Agent` is the .NET sidecar used for agent runtime and benchmarks.
- Bundled runtime assets live in `resources/agents`, `resources/skills`, `resources/prompts`, `resources/commands`, and `resources/sidecar`.
- `docs/` is a separate Next.js + Fumadocs workspace. `dist/` and `out/` are generated outputs; do not edit them.

## Architecture Snapshot

The app is split into four layers: Electron main process, preload bridge, React renderer, and the .NET sidecar. Keep process boundaries explicit: system access stays in `src/main`, UI state stays in `src/renderer/src`, and shared types go through `## Build, Test, and Development Commands

- `npm install` — install root dependencies.
- `npm run dev` — start Electron + Vite with hot reload.
- `npm run start` — preview the built desktop app.
- `npm run lint` — run ESLint with caching.
- `npm run typecheck` — run both `typecheck:node` and `typecheck:web` (TypeScript strict checks for main/preload and renderer).
- `npm run format` — auto-format with Prettier.
- `npm run build` — typecheck, then build the app.
- `npm run build:unpack` — build + sidecar + unpacked app for local packaging checks.
- `npm run build:sidecar[:win|:mac|:linux]` — build the .NET sidecar for a specific platform.
- `npm run benchmark:sidecar` — run sidecar benchmark via `dotnet run`.
- `npm run build:{win|mac|linux}` — full package for the target platform.
- Docs: `npm --prefix docs run dev`, `npm --prefix docs run build`, `npm --prefix docs run types:check`.fix docs run types:check`.

## Coding Style & Naming Conventions

- Follow `.editorconfig`: UTF-8, LF, 2 spaces, final newline, trimmed trailing whitespace.
- Follow `.prettierrc.yaml`: single quotes, no semicolons, 100-column width, no trailing commas.
- Respect `eslint.config.mjs`, especially TypeScript, React, and hooks rules.
- Use PascalCase for React component files (for example `Layout.tsx`) and kebab-case for stores, helpers, and non-component modules (for example `settings-store.ts`).

## Testing Guidelines

- There is no root `npm test` suite yet.
- Minimum validation is `npm run lint` and `npm run typecheck`.
- For UI, IPC, or workflow changes, smoke test with `npm run dev`.
- For sidecar or packaging changes, run the relevant `build:sidecar:*` and `build:*` commands.

## Commit & Pull Request Guidelines

- Follow the current conventional style from history: `feat(scope): ...`, `fix(scope): ...`, `chore(scope): ...`.
- Keep commits focused; avoid mixing refactors with behavior changes.
- PRs should include a short summary, linked issues, verification steps, screenshots for UI changes, and platform impact notes when packaging behavior changes.

## Security & Release Notes

- Never commit secrets, API keys, or local runtime data from `~/.open-cowork/`.
- When bumping the app version, also update the docs homepage version in `docs/src/app/(home)/page.tsx` and keep download links aligned with release assets.
