# kfp-2.17-to-2.18

Add explicit namespaces for Kubeflow Pipelines private-pipeline APIs that changed in **KFP 2.18**.

See the upstream [2.18 upgrade guide](https://github.com/kubeflow/pipelines/blob/release-2.18/docs/operator-guides/upgrade-2.18.md) and [RBAC / client migration notes](https://github.com/kubeflow/pipelines/blob/release-2.18/docs/operator-guides/rbac-migration-2.18.md).

## Problem

In KFP 2.18:

- `kfp.Client.get_pipeline_id()` / `list_pipelines()` do **not** inherit `Client(namespace=...)`. Omitting `namespace` searches shared pipelines only.
- Direct pipeline-by-name REST/gRPC lookups (`/apis/v2beta1/pipelines/names/`, `GetPipelineByName`, `pipeline_service_get_pipeline_by_name`) must supply the owning namespace for private pipelines.
- `upload_pipeline()` / `upload_pipeline_from_pipeline_func()` likewise require an explicit `namespace=` for private uploads; the client default is not used.
- `upload_pipeline_version(..., pipeline_name=...)` resolves the parent via shared-only `get_pipeline_id` — private parents need a namespaced lookup then `pipeline_id=`.
- `namespace="kubeflow"` creates a **private** pipeline in that namespace; it is not shared visibility.

## Solution

This package runs five deterministic JSSG steps:

1. **get_pipeline_id** — copy a statically resolvable `Client(..., namespace=...)` value onto matching `get_pipeline_id(...)` calls that omit it.
2. **GetPipelineByName** — add namespace to `GetPipelineByNameRequest`, `pipeline_service_get_pipeline_by_name`, and executable static REST URLs (by-name + upload). Per-API bindings work across multi-client files; unbound requests abort only when namespaces are ambiguous.
3. **upload_pipeline** — add the client namespace to private upload helpers that omit it.
4. **upload_pipeline_version** — rewrite `pipeline_name=` to `pipeline_id=<receiver>.get_pipeline_id(..., namespace=...)`.
5. **list_pipelines** — same per-receiver heuristic as `get_pipeline_id`.

Namespace resolution covers string literals, same-file constants (`NS = "team-a"`), and attribute-held clients (`self._client = Client(...)`).

Calls without a statically resolvable owning namespace are left unchanged for manual review (optional AI step).

### Shared vs private intent

Auto-add assumes private intent when a Client namespace is statically resolvable. To keep a call **shared**, mark it:

```python
# kfp-shared
client.upload_pipeline(...)
```

Accepted markers: `# kfp-shared`, `# kfp:shared`, `# intentional shared` (same line or previous line).

## Usage

```bash
npx codemod@latest workflow run \
  -w codemods/kfp-2.17-to-2.18/workflow.yaml \
  -t /path/to/your/project
```

Or run an individual transform:

```bash
npx codemod@latest jssg run -l python \
  ./scripts/add-namespace-get-pipeline-id.ts /path/to/project
```

## Params

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| commit_per_step | boolean | false | Commit after each change-producing step |
| run_ai_step | boolean | false | AI assist for unresolved private-pipeline namespaces |
| publish_pr | boolean | false | Push branch and open a PR |
| main_branch | string | main | PR base branch |
| api_token | string | — | GitHub token when `gh` is unavailable |
| pr_title / pr_body | string | — | Optional PR metadata |

## Metrics

- `kfp-get-pipeline-id-namespace`
- `kfp-get-pipeline-by-name-namespace`
- `kfp-upload-pipeline-namespace`
- `kfp-upload-pipeline-version-namespace`
- `kfp-list-pipelines-namespace`

Cardinalities include `change-type` (`added-namespace`, `rewrote-pipeline-name`, `skipped-unresolved`, `skipped-existing`, `skipped-ambiguous`, `skipped-shared-intent`) plus method/surface tags.

## Tricky cases (`run_ai_step=true`)

- Factory helpers / re-exported clients without a direct `Client(...)` assignment
- Dynamic REST URLs / multi-tenant ambiguity the AST skipped
- Clear private-pipeline intent without a safe static namespace (emit a TODO comment; never invent one)

## What gets fixed

### Automated

```python
# before
NS = "team-a"
client = kfp.Client(namespace=NS)
client.get_pipeline_id("training")
client.upload_pipeline(pipeline_package_path="p.yaml", pipeline_name="training")
client.upload_pipeline_version(
    pipeline_package_path="p.yaml",
    pipeline_version_name="v2",
    pipeline_name="training",
)
client.list_pipelines()
GetPipelineByNameRequest(name="training")

# after
NS = "team-a"
client = kfp.Client(namespace=NS)
client.get_pipeline_id("training", namespace="team-a")
client.upload_pipeline(
    pipeline_package_path="p.yaml",
    pipeline_name="training",
    namespace="team-a",
)
client.upload_pipeline_version(
    pipeline_package_path="p.yaml",
    pipeline_version_name="v2",
    pipeline_id=client.get_pipeline_id("training", namespace="team-a"),
)
client.list_pipelines(namespace="team-a")
GetPipelineByNameRequest(name="training", namespace="team-a")
```

### Skipped

- Existing `namespace=` / `pipeline_id=` arguments
- Clients whose namespace is dynamic (`os.environ`, function calls, …)
- Unbound GetPipelineByNameRequest / REST when multiple distinct client namespaces exist
- Intentional shared usage marked with `# kfp-shared` (or aliases above)
- REST path strings only in docstrings / non-executable contexts

## License

MIT
