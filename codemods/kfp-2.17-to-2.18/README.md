# kfp-2.17-to-2.18

Add explicit namespaces for Kubeflow Pipelines private-pipeline APIs that changed in **KFP 2.18**.

See the upstream [2.18 upgrade guide](https://github.com/kubeflow/pipelines/blob/release-2.18/docs/operator-guides/upgrade-2.18.md) and [RBAC / client migration notes](https://github.com/kubeflow/pipelines/blob/release-2.18/docs/operator-guides/rbac-migration-2.18.md).

## Problem

In KFP 2.18:

- `kfp.Client.get_pipeline_id()` does **not** inherit `Client(namespace=...)`. Omitting `namespace` searches shared pipelines only.
- Direct pipeline-by-name REST/gRPC lookups (`/apis/v2beta1/pipelines/names/`, `GetPipelineByName`, `pipeline_service_get_pipeline_by_name`) must supply the owning namespace for private pipelines.
- `upload_pipeline()` / `upload_pipeline_from_pipeline_func()` likewise require an explicit `namespace=` for private uploads; the client default is not used.

## Solution

This package runs three deterministic JSSG steps:

1. **get_pipeline_id** — copy a statically resolvable `Client(..., namespace="...")` value onto matching `get_pipeline_id(...)` calls that omit it.
2. **GetPipelineByName** — when a file has exactly one statically resolvable client namespace, add it to `GetPipelineByNameRequest`, `pipeline_service_get_pipeline_by_name`, and static REST URL strings.
3. **upload_pipeline** — add the same client namespace to private upload helpers that omit it.

Calls without a statically resolvable owning namespace are left unchanged for manual review (optional AI step).

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

Cardinalities include `change-type` (`added-namespace`, `skipped-unresolved`, `skipped-existing`, `skipped-ambiguous`) plus method/surface tags.

## Tricky cases (`run_ai_step=true`)

- Namespace passed through a local constant (`NS = "team-a"`) rather than a string literal in `Client(...)`
- Attribute-held clients (`self.client = ...`)
- Clear private-pipeline intent without a safe static namespace (emit a TODO comment; never invent one)

## What gets fixed

### Automated

```python
# before
client = kfp.Client(namespace="team-a")
client.get_pipeline_id("training")
client.upload_pipeline(pipeline_package_path="p.yaml", pipeline_name="training")
GetPipelineByNameRequest(name="training")

# after
client = kfp.Client(namespace="team-a")
client.get_pipeline_id("training", namespace="team-a")
client.upload_pipeline(
    pipeline_package_path="p.yaml",
    pipeline_name="training",
    namespace="team-a",
)
GetPipelineByNameRequest(name="training", namespace="team-a")
```

### Skipped

- Existing `namespace=` arguments
- Clients whose namespace is dynamic (`os.environ`, function calls, …)
- Files with multiple distinct client namespaces (GetPipelineByName step)
- Intentional shared-pipeline usage (no resolvable private owning namespace)

## License

MIT
