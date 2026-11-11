import type { Codemod, Edit } from "codemod:ast-grep";
import type Python from "codemod:ast-grep/langs/python";
import { useMetricAtom } from "codemod:metrics";

import {
  addNamespaceKeyword,
  getCallMethodName,
  getCallReceiverText,
  getKeywordArg,
  hasSharedIntentMarker,
  isExecutableStringContext,
  isPipelineByNamePath,
  isPipelineUploadPath,
  pathAlreadyHasNamespace,
  readStringLiteral,
  resolvePipelinesApiNamespaces,
  uniqueNamespaceOrNull,
  uniqueResolvedNamespaces,
  withNamespaceQuery,
} from "./shared.ts";

// Cardinalities:
//   change-type: "added-namespace" | "skipped-unresolved" | "skipped-existing" | "skipped-ambiguous" | "skipped-shared-intent"
//   surface: "request" | "python-client" | "rest-url"

const metric = useMetricAtom("kfp-get-pipeline-by-name-namespace");

function unresolvedOrAmbiguous(
  fileNamespace: string | null,
  clientNamespaceCount: number,
): "skipped-unresolved" | "skipped-ambiguous" {
  if (fileNamespace === null && clientNamespaceCount > 1) {
    return "skipped-ambiguous";
  }
  return "skipped-unresolved";
}

const codemod: Codemod<Python> = async (root) => {
  const rootNode = root.root();
  const edits: Edit[] = [];

  // File-wide namespace only when exactly one Client namespace is resolvable.
  // Per-call API receivers can still resolve via pipelines_api → client binding
  // even when multiple client namespaces exist.
  const fileNamespace = uniqueNamespaceOrNull(rootNode);
  const clientNamespaceCount = uniqueResolvedNamespaces(rootNode).length;
  const apiNamespaces = resolvePipelinesApiNamespaces(rootNode);

  // 1) GetPipelineByNameRequest(...)
  const requestCalls = rootNode.findAll({
    rule: {
      kind: "call",
      has: {
        field: "function",
        kind: "identifier",
        regex: "^GetPipelineByNameRequest$",
      },
    },
  });

  for (const call of requestCalls) {
    if (getCallMethodName(call) !== "GetPipelineByNameRequest") {
      continue;
    }

    if (hasSharedIntentMarker(call)) {
      metric.increment({
        "change-type": "skipped-shared-intent",
        surface: "request",
      });
      continue;
    }

    if (getKeywordArg(call, "namespace")) {
      metric.increment({
        "change-type": "skipped-existing",
        surface: "request",
      });
      continue;
    }

    if (!fileNamespace) {
      metric.increment({
        "change-type": unresolvedOrAmbiguous(
          fileNamespace,
          clientNamespaceCount,
        ),
        surface: "request",
      });
      continue;
    }

    const edit = addNamespaceKeyword(
      call,
      fileNamespace,
      rootNode,
      Number.POSITIVE_INFINITY,
    );
    if (!edit) {
      continue;
    }

    edits.push(edit);
    metric.increment({
      "change-type": "added-namespace",
      surface: "request",
    });
  }

  // 2) *.pipeline_service_get_pipeline_by_name(...)
  const clientCalls = rootNode.findAll({
    rule: {
      kind: "call",
      has: {
        field: "function",
        kind: "attribute",
        has: {
          field: "attribute",
          kind: "identifier",
          regex: "^pipeline_service_get_pipeline_by_name$",
        },
      },
    },
  });

  for (const call of clientCalls) {
    if (getCallMethodName(call) !== "pipeline_service_get_pipeline_by_name") {
      continue;
    }

    if (hasSharedIntentMarker(call)) {
      metric.increment({
        "change-type": "skipped-shared-intent",
        surface: "python-client",
      });
      continue;
    }

    if (getKeywordArg(call, "namespace")) {
      metric.increment({
        "change-type": "skipped-existing",
        surface: "python-client",
      });
      continue;
    }

    const receiver = getCallReceiverText(call);
    const namespace =
      (receiver ? apiNamespaces.get(receiver) : undefined) ??
      fileNamespace ??
      null;

    if (!namespace) {
      metric.increment({
        "change-type": unresolvedOrAmbiguous(
          fileNamespace,
          clientNamespaceCount,
        ),
        surface: "python-client",
      });
      continue;
    }

    const edit = addNamespaceKeyword(
      call,
      namespace,
      rootNode,
      Number.POSITIVE_INFINITY,
    );
    if (!edit) {
      continue;
    }

    edits.push(edit);
    metric.increment({
      "change-type": "added-namespace",
      surface: "python-client",
    });
  }

  // 3) Static REST strings for by-name lookup or pipeline upload, only in
  // executable contexts (assignment RHS / call args), and only when the file
  // has a unique client namespace.
  const strings = rootNode.findAll({ rule: { kind: "string" } });
  for (const stringNode of strings) {
    const value = readStringLiteral(stringNode);
    if (
      !value ||
      (!isPipelineByNamePath(value) && !isPipelineUploadPath(value))
    ) {
      continue;
    }

    if (!isExecutableStringContext(stringNode)) {
      continue;
    }

    if (hasSharedIntentMarker(stringNode)) {
      metric.increment({
        "change-type": "skipped-shared-intent",
        surface: "rest-url",
      });
      continue;
    }

    if (pathAlreadyHasNamespace(value)) {
      metric.increment({
        "change-type": "skipped-existing",
        surface: "rest-url",
      });
      continue;
    }

    if (!fileNamespace) {
      metric.increment({
        "change-type": unresolvedOrAmbiguous(
          fileNamespace,
          clientNamespaceCount,
        ),
        surface: "rest-url",
      });
      continue;
    }

    const updated = withNamespaceQuery(value, fileNamespace);
    if (!updated) {
      continue;
    }

    const raw = stringNode.text();
    const prefixMatch = raw.match(/^([rRuUbB]*)(['"])/);
    const prefix = prefixMatch?.[1] ?? "";
    const q = (prefixMatch?.[2] as '"' | "'" | undefined) ?? '"';
    edits.push(stringNode.replace(`${prefix}${q}${updated}${q}`));
    metric.increment({
      "change-type": "added-namespace",
      surface: "rest-url",
    });
  }

  if (edits.length === 0) {
    return null;
  }

  return rootNode.commitEdits(edits);
};

export default codemod;
