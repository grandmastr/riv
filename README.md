# Riv

Riv is a Chromium-first browser copilot built as a TypeScript monorepo with:

- `apps/extension`: WXT + React browser extension
- `apps/api`: Hono API and orchestration backend
- `packages/contracts`: shared runtime contracts
- `packages/agent`: model/tool orchestration

## Getting Started

```bash
pnpm install
pnpm dev:api
pnpm dev:extension
```
