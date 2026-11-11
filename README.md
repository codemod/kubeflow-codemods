# Kubeflow Codemods

Migration codemods for [Kubeflow Pipelines](https://github.com/kubeflow/pipelines).

## Packages

| Package | Description |
| --- | --- |
| [`kfp-2.17-to-2.18`](./codemods/kfp-2.17-to-2.18) | Add explicit namespaces for private pipeline lookup, upload, version-by-name, and list APIs changed in KFP 2.18 |

## Running

Commit or stash local changes first. Codemods modify source files.

```bash
# From a package directory or with an absolute workflow path
npx codemod@latest workflow run \
  -w codemods/kfp-2.17-to-2.18/workflow.yaml \
  -t /path/to/your/project
```

## Development

```bash
pnpm install
pnpm test
pnpm run check-types
```

## License

MIT
