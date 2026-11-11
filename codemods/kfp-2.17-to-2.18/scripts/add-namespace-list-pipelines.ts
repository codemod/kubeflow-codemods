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
//   method: "list_pipelines"

const metric = useMetricAtom("kfp-list-pipelines-namespace");

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
          regex: "^list_pipelines$",
        },
      },
    },
  });

  for (const call of calls) {
    if (getCallMethodName(call) !== "list_pipelines") {
      continue;
    }

    if (hasSharedIntentMarker(call)) {
      metric.increment({
        "change-type": "skipped-shared-intent",
        method: "list_pipelines",
      });
      continue;
    }

    const receiver = getCallReceiverText(call);
    if (!receiver) {
      metric.increment({
        "change-type": "skipped-unresolved",
        method: "list_pipelines",
      });
      continue;
    }

    const namespace = clientNamespaces.get(receiver);
    if (!namespace) {
      metric.increment({
        "change-type": "skipped-unresolved",
        method: "list_pipelines",
      });
      continue;
    }

    // list_pipelines(page_token, page_size, sort_by, filter, namespace) — 5th positional.
    const edit = addNamespaceKeyword(call, namespace, rootNode, 5);
    if (!edit) {
      metric.increment({
        "change-type": "skipped-existing",
        method: "list_pipelines",
      });
      continue;
    }

    edits.push(edit);
    metric.increment({
      "change-type": "added-namespace",
      method: "list_pipelines",
    });
  }

  if (edits.length === 0) {
    return null;
  }

  return rootNode.commitEdits(edits);
};

export default codemod;
