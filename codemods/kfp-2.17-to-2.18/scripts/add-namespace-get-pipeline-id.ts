import type { Codemod, Edit } from "codemod:ast-grep";
import type Python from "codemod:ast-grep/langs/python";
import { useMetricAtom } from "codemod:metrics";

import {
  addNamespaceKeyword,
  getCallMethodName,
  getCallReceiverText,
  resolveClientNamespaces,
} from "./shared.ts";

// Cardinalities:
//   change-type: "added-namespace" | "skipped-unresolved" | "skipped-existing"
//   method: "get_pipeline_id"

const metric = useMetricAtom("kfp-get-pipeline-id-namespace");

const codemod: Codemod<Python> = async (root) => {
  const rootNode = root.root();
  const clientNamespaces = resolveClientNamespaces(rootNode);
  const edits: Edit[] = [];

  const calls = rootNode.findAll({
    rule: {
      kind: "call",
      has: {
        field: "function",
        kind: "attribute",
        has: {
          field: "attribute",
          kind: "identifier",
          regex: "^get_pipeline_id$",
        },
      },
    },
  });

  for (const call of calls) {
    if (getCallMethodName(call) !== "get_pipeline_id") {
      continue;
    }

    const receiver = getCallReceiverText(call);
    if (!receiver) {
      metric.increment({
        "change-type": "skipped-unresolved",
        method: "get_pipeline_id",
      });
      continue;
    }

    const namespace = clientNamespaces.get(receiver);
    if (!namespace) {
      metric.increment({
        "change-type": "skipped-unresolved",
        method: "get_pipeline_id",
      });
      continue;
    }

    const edit = addNamespaceKeyword(call, namespace, rootNode, 2);
    if (!edit) {
      metric.increment({
        "change-type": "skipped-existing",
        method: "get_pipeline_id",
      });
      continue;
    }

    edits.push(edit);
    metric.increment({
      "change-type": "added-namespace",
      method: "get_pipeline_id",
    });
  }

  if (edits.length === 0) {
    return null;
  }

  return rootNode.commitEdits(edits);
};

export default codemod;
