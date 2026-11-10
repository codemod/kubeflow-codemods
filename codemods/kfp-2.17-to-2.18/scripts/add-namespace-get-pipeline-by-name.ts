import type { Codemod, Edit } from "codemod:ast-grep";
import type Python from "codemod:ast-grep/langs/python";
import { useMetricAtom } from "codemod:metrics";

import {
  addNamespaceKeyword,
  getCallMethodName,
  getKeywordArg,
  pathAlreadyHasNamespace,
  readStringLiteral,
  uniqueResolvedNamespaces,
  withNamespaceQuery,
} from "./shared.ts";

// Cardinalities:
//   change-type: "added-namespace" | "skipped-unresolved" | "skipped-existing" | "skipped-ambiguous"
//   surface: "request" | "python-client" | "rest-url"

const metric = useMetricAtom("kfp-get-pipeline-by-name-namespace");

const codemod: Codemod<Python> = async (root) => {
  const rootNode = root.root();
  const namespaces = uniqueResolvedNamespaces(rootNode);
  const edits: Edit[] = [];

  if (namespaces.length > 1) {
    metric.increment({
      "change-type": "skipped-ambiguous",
      surface: "request",
    });
    return null;
  }

  const namespace = namespaces[0];
  if (!namespace) {
    // No statically resolvable client namespace in this file.
    // Still scan so metrics capture unresolved direct API usage.
  }

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

    if (getKeywordArg(call, "namespace")) {
      metric.increment({
        "change-type": "skipped-existing",
        surface: "request",
      });
      continue;
    }

    if (!namespace) {
      metric.increment({
        "change-type": "skipped-unresolved",
        surface: "request",
      });
      continue;
    }

    const edit = addNamespaceKeyword(call, namespace, rootNode, Number.POSITIVE_INFINITY);
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

    if (getKeywordArg(call, "namespace")) {
      metric.increment({
        "change-type": "skipped-existing",
        surface: "python-client",
      });
      continue;
    }

    if (!namespace) {
      metric.increment({
        "change-type": "skipped-unresolved",
        surface: "python-client",
      });
      continue;
    }

    const edit = addNamespaceKeyword(call, namespace, rootNode, Number.POSITIVE_INFINITY);
    if (!edit) {
      continue;
    }

    edits.push(edit);
    metric.increment({
      "change-type": "added-namespace",
      surface: "python-client",
    });
  }

  // 3) Static REST strings containing /apis/v2beta1/pipelines/names/
  const strings = rootNode.findAll({ rule: { kind: "string" } });
  for (const stringNode of strings) {
    const value = readStringLiteral(stringNode);
    if (!value || !value.includes("/apis/v2beta1/pipelines/names/")) {
      continue;
    }

    if (pathAlreadyHasNamespace(value)) {
      metric.increment({
        "change-type": "skipped-existing",
        surface: "rest-url",
      });
      continue;
    }

    if (!namespace) {
      metric.increment({
        "change-type": "skipped-unresolved",
        surface: "rest-url",
      });
      continue;
    }

    const updated = withNamespaceQuery(value, namespace);
    if (!updated) {
      continue;
    }

    const quote = stringNode.text()[0] === "'" ? "'" : '"';
    // Preserve the original quote character from the literal's opening delimiter.
    const raw = stringNode.text();
    const prefixMatch = raw.match(/^([rRuUbB]*)(['"])/);
    const prefix = prefixMatch?.[1] ?? "";
    const q = (prefixMatch?.[2] as '"' | "'" | undefined) ?? quote;
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
