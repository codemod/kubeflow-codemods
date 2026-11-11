---
schema_version: '1.0'

name: 'kfp-2.17-to-2.18'
version: '0.2.0'
description: 'KFP 2.17 to 2.18 — add explicit namespaces for private pipeline lookup and upload APIs'
author: 'Codemod Authors'
license: 'MIT'
workflow: 'workflow.yaml'
category: 'migration'
repository: 'https://github.com/codemod/kubeflow-codemods/tree/main/codemods/kfp-2.17-to-2.18'

targets:
  languages: ['python']

keywords:
  - 'upgrade'
  - 'breaking-change'
  - 'kubeflow'
  - 'kfp'
  - 'pipelines'
  - 'namespace'

registry:
  access: 'public'
  visibility: 'public'
---

# Agent instructions

## Read the workflow graph

Parse `workflow.yaml`. Execution order:

1. `apply-transforms` — five sequential `js-ast-grep` steps (get_pipeline_id → GetPipelineByName → upload_pipeline → upload_pipeline_version → list_pipelines), each with an optional commit gated by `params.commit_per_step`
2. `ai-tricky-cases` — depends on `apply-transforms`; AI step gated by `params.run_ai_step`
3. `publish` — depends on `ai-tricky-cases`; push/PR gated by `params.publish_pr`

## Minimal adaptation

- Adjust `include` / `exclude` globs if the target repo keeps Python clients outside `**/*.py` defaults (for example notebooks exported as `.py` under generated folders).
- Do not broaden namespace inference to environment variables, cluster defaults, or pipeline names.
- Shared helpers live in `scripts/shared.ts`; keep Client-resolution logic there when touching more than one step script.
- Honor `# kfp-shared` / `# kfp:shared` / `# intentional shared` markers — do not rewrite those call sites to private scope.

## Step-by-step execution

1. Validate: `npx codemod workflow validate workflow.yaml`
2. Run package tests: `pnpm test` from this package (or `pnpm --filter kfp-2.17-to-2.18 test` from the repo root)
3. Typecheck from repo root: `pnpm run check-types`
4. Dry-run against the target tree before apply
5. Review diffs after each JSSG step when `commit_per_step` is enabled
6. Only enable `run_ai_step` for remaining private-pipeline cases the AST steps skipped
7. Never set `publish_pr` unless the user explicitly asks to open a PR

## AI steps

Treat the AI prompt as guidance for unresolved but intentional private-pipeline call sites. Prefer a TODO comment over inventing a namespace. Do not modify intentional shared-pipeline lookups or uploads (including `# kfp-shared` markers).
