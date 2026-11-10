# AGENTS.md

Project instructions for AI agents working in the Kubeflow Pipelines codemod monorepo.

## Overview

Each codemod lives under `codemods/<slug>/` with `workflow.yaml`, `codemod.yaml`, `scripts/`, tests, and `SKILL.md`.

## Commands

```bash
pnpm install
pnpm test
pnpm run check-types
npx codemod workflow validate codemods/<slug>/workflow.yaml
```

## Creating or changing packages

1. Prefer `codemod init` + Codemod MCP / `codemod ai docs` guidance.
2. Keep transforms AST-first with `js-ast-grep` and language `python` for KFP client migrations.
3. Do not invent namespaces from env vars, repo names, or pipeline names.
4. Add positive, negative, and edge fixtures before calling the work done.
5. Run `pnpm test` and `pnpm run check-types` before finishing.
