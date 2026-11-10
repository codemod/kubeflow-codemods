/**
 * Default entrypoint for tooling that expects `scripts/codemod.ts`.
 * The workflow runs the three step scripts separately:
 * - add-namespace-get-pipeline-id.ts
 * - add-namespace-get-pipeline-by-name.ts
 * - add-namespace-upload-pipeline.ts
 */
export { default } from "./add-namespace-get-pipeline-id.ts";
