import type { Codemod, Edit } from "codemod:ast-grep";
import type Python from "codemod:ast-grep/langs/python";
import { useMetricAtom } from "codemod:metrics";

import {
  addNamespaceKeyword,
  getCallMethodName,
  getCallReceiverText,
  hasSharedIntentMarker,
  resolveClientNamespaces,
} from "./shared.ts";

// Cardinalities:
//   change-type: "added-namespace" | "skipped-unresolved" | "skipped-existing" | "skipped-shared-intent"
//   method: "upload_pipeline" | "upload_pipeline_from_pipeline_func"

const metric = useMetricAtom("kfp-upload-pipeline-namespace");

const UPLOAD_METHODS = new Set([
  "upload_pipeline",
  "upload_pipeline_from_pipeline_func",
]);

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
          regex: "^upload_pipeline(_from_pipeline_func)?$",
        },
      },
    },
  });

  for (const call of calls) {
    const method = getCallMethodName(call);
    if (!method || !UPLOAD_METHODS.has(method)) {
      continue;
    }

    if (hasSharedIntentMarker(call)) {
      metric.increment({
        "change-type": "skipped-shared-intent",
        method,
      });
      continue;
    }

    const receiver = getCallReceiverText(call);
    if (!receiver) {
      metric.increment({
        "change-type": "skipped-unresolved",
        method,
      });
      continue;
    }

    const namespace = clientNamespaces.get(receiver);
    if (!namespace) {
      metric.increment({
        "change-type": "skipped-unresolved",
        method,
      });
      continue;
    }

    // upload_pipeline(path, name, description, namespace) — 4th positional.
    const edit = addNamespaceKeyword(call, namespace, rootNode, 4);
    if (!edit) {
      metric.increment({
        "change-type": "skipped-existing",
        method,
      });
      continue;
    }

    edits.push(edit);
    metric.increment({
      "change-type": "added-namespace",
      method,
    });
  }

  if (edits.length === 0) {
    return null;
  }

  return rootNode.commitEdits(edits);
};

export default codemod;
