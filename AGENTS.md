# Repository Guidelines

## Project Structure & Module Organization

This repository uses npm workspaces for a sports coaching platform. `server/` contains the Express + TypeScript API, with `src/models/` for Mongoose models, `src/routes/` for endpoints, `src/services/` for business logic, and `tests/` for Jest integration tests. `mobile/` contains the Expo Router app; screens live in `mobile/src/app/`, shared UI in `mobile/src/components/`, reusable client logic in `mobile/src/lib/`, and static assets in `mobile/assets/`. `backend/pages/api/` provides Next/Vercel API shims, while `apps/` holds deployment support. Architecture, schema, API, and RBAC notes live under `docs/` and `skills/sports-coaching-platform-builder/`.

## Build, Test, and Development Commands

- `npm install`: install root, server, and mobile workspace dependencies.
- `npm run dev`: clean stale dev artifacts, then run the server and Expo app in parallel.
- `npm run dev:server`: start the Express API with `ts-node-dev`.
- `npm run dev:mobile`: start the Expo development server.
- `npm run typecheck`: run TypeScript checks for both workspaces.
- `npm test --workspace server`: run the server Jest suite using `mongodb-memory-server`.
- `npm run build`: compile the server TypeScript output.
- `npm run vercel-build`: build the Expo web export and Vercel/Next API deployment bundle.

## Coding Style & Naming Conventions

Use TypeScript with `strict` mode. Match the existing style: two-space indentation, double quotes, semicolons, and `camelCase` for variables/functions. React components and Mongoose models use `PascalCase`; route, service, and utility files use descriptive local naming. In mobile code, prefer the `@/` path alias and run `npm run lint --workspace mobile` before large UI changes. Read `mobile/AGENTS.md` before editing Expo code.

## Testing Guidelines

Server tests are Jest + `ts-jest` files named `*.test.ts` under `server/tests/`. Add or update tests when changing auth, RBAC, routes, persistence, notifications, or analytics. Mobile tests live beside focused library code in `mobile/src/lib/__tests__/` and run with `npm test --workspace mobile`.

## Commit & Pull Request Guidelines

Git history mostly uses short imperative commits, such as `Add push token registration diagnostics` or `Polish notification copy`. Keep commits focused and describe the behavior changed. Pull requests should include a brief summary, test/typecheck results, linked issue or context, screenshots for UI changes, and notes for any new environment variables, migrations, or deployment steps.

## Security & Configuration Tips

Copy environment templates from `.env.example` and `env.server.yaml.example`; do not commit local secrets such as `.env.local`, API keys, MongoDB URIs, JWT secrets, or keystores. Production deployments must provide non-placeholder JWT and MongoDB configuration.
