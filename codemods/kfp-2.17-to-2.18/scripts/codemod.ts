/**
 * Default entrypoint for tooling that expects `scripts/codemod.ts`.
 * The workflow runs the step scripts separately:
 * - add-namespace-get-pipeline-id.ts
 * - add-namespace-get-pipeline-by-name.ts
 * - add-namespace-upload-pipeline.ts
 * - add-namespace-upload-pipeline-version.ts
 * - add-namespace-list-pipelines.ts
 */
export { default } from "./add-namespace-get-pipeline-id.ts";
