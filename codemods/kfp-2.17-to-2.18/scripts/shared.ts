import type { Edit, SgNode } from "codemod:ast-grep";
import type Python from "codemod:ast-grep/langs/python";

export type PyNode = SgNode<Python>;

const PIPELINE_BY_NAME_PATH = "/apis/v2beta1/pipelines/names/";

/** Collect Client constructor aliases and kfp module aliases from imports. */
export function collectImportAliases(root: PyNode): {
  kfpModules: Set<string>;
  clientCtors: Set<string>;
} {
  const kfpModules = new Set<string>();
  const clientCtors = new Set<string>();

  for (const stmt of root.findAll({ rule: { kind: "import_statement" } })) {
    for (const name of stmt.fieldChildren("name")) {
      if (name.kind() === "dotted_name" && name.text() === "kfp") {
        kfpModules.add("kfp");
      } else if (name.kind() === "aliased_import") {
        const moduleName = name.field("name")?.text();
        const alias = name.field("alias")?.text();
        if (moduleName === "kfp" && alias) {
          kfpModules.add(alias);
        }
      }
    }
  }

  for (const stmt of root.findAll({ rule: { kind: "import_from_statement" } })) {
    const moduleName = stmt.field("module_name")?.text() ?? "";
    if (moduleName !== "kfp" && moduleName !== "kfp.client") {
      continue;
    }

    for (const name of stmt.fieldChildren("name")) {
      if (name.kind() === "dotted_name" && name.text() === "Client") {
        clientCtors.add("Client");
      } else if (name.kind() === "aliased_import") {
        const imported = name.field("name")?.text();
        const alias = name.field("alias")?.text();
        if (imported === "Client" && alias) {
          clientCtors.add(alias);
        }
      }
    }
  }

  return { kfpModules, clientCtors };
}

function isClientConstructorCall(
  call: PyNode,
  kfpModules: Set<string>,
  clientCtors: Set<string>,
): boolean {
  const fn = call.field("function");
  if (!fn) {
    return false;
  }

  if (fn.kind() === "identifier" && clientCtors.has(fn.text())) {
    return true;
  }

  if (fn.kind() === "attribute") {
    const objectText = fn.field("object")?.text();
    const attr = fn.field("attribute")?.text();
    if (attr === "Client" && objectText && kfpModules.has(objectText)) {
      return true;
    }
  }

  return false;
}

/** Read a Python string literal node into its decoded contents. */
export function readStringLiteral(node: PyNode | null | undefined): string | null {
  if (!node || node.kind() !== "string") {
    return null;
  }

  const text = node.text();
  // Reject f/rf/fr strings and concatenations — not statically resolvable here.
  if (/^[fFrRbBuU]*[fF]/.test(text) || text.includes("\\\n")) {
    return null;
  }

  const match = text.match(/^[rRuUbB]*(['"])(.*)\1$/s);
  if (!match) {
    // Triple quotes
    const triple = text.match(/^[rRuUbB]*(['"]{3})([\s\S]*)\1$/);
    if (!triple) {
      return null;
    }
    return triple[2] ?? null;
  }

  return match[2] ?? null;
}

export function getKeywordArg(call: PyNode, name: string): PyNode | null {
  const args = call.field("arguments");
  if (!args) {
    return null;
  }

  for (const child of args.children()) {
    if (child.kind() !== "keyword_argument") {
      continue;
    }
    if (child.field("name")?.text() === name) {
      return child.field("value") ?? null;
    }
  }

  return null;
}

export function hasKeywordArg(call: PyNode, name: string): boolean {
  return getKeywordArg(call, name) !== null;
}

/**
 * True when a positional argument at `namespacePosition` (1-based among
 * positional args) is already present. Use 2 for get_pipeline_id, 4 for
 * upload_pipeline, and omit (Infinity) when only keyword form is expected.
 */
export function hasPositionalNamespace(
  call: PyNode,
  namespacePosition = 2,
): boolean {
  const args = call.field("arguments");
  if (!args) {
    return false;
  }

  const positionals = args
    .children()
    .filter(
      (child) =>
        child.isNamed() &&
        child.kind() !== "keyword_argument" &&
        child.kind() !== "list_splat" &&
        child.kind() !== "dictionary_splat",
    );

  return positionals.length >= namespacePosition;
}

/**
 * Map receiver expression text -> statically resolved nonempty namespace.
 * Ambiguous reassignments are omitted.
 */
export function resolveClientNamespaces(root: PyNode): Map<string, string> {
  const { kfpModules, clientCtors } = collectImportAliases(root);
  const namespaces = new Map<string, string>();
  const ambiguous = new Set<string>();

  const assignments = root.findAll({
    rule: {
      kind: "assignment",
    },
  });

  for (const assignment of assignments) {
    const left = assignment.field("left");
    const right = assignment.field("right");
    if (!left || !right) {
      continue;
    }

    const receiver = left.text();
    if (!receiver || left.kind() === "pattern_list") {
      // Skip tuple unpacking / ambiguous left-hand sides.
      continue;
    }

    if (right.kind() !== "call" || !isClientConstructorCall(right, kfpModules, clientCtors)) {
      if (namespaces.has(receiver) || ambiguous.has(receiver)) {
        ambiguous.add(receiver);
        namespaces.delete(receiver);
      }
      continue;
    }

    const namespaceNode = getKeywordArg(right, "namespace");
    const namespace = readStringLiteral(namespaceNode);
    if (!namespace || namespace.length === 0) {
      ambiguous.add(receiver);
      namespaces.delete(receiver);
      continue;
    }

    const existing = namespaces.get(receiver);
    if (existing !== undefined && existing !== namespace) {
      ambiguous.add(receiver);
      namespaces.delete(receiver);
      continue;
    }

    if (ambiguous.has(receiver)) {
      continue;
    }

    namespaces.set(receiver, namespace);
  }

  return namespaces;
}

/** Unique statically resolved client namespace values in the file, if any. */
export function uniqueResolvedNamespaces(root: PyNode): string[] {
  return [...new Set(resolveClientNamespaces(root).values())];
}

export function getCallMethodName(call: PyNode): string | null {
  const fn = call.field("function");
  if (!fn) {
    return null;
  }
  if (fn.kind() === "attribute") {
    return fn.field("attribute")?.text() ?? null;
  }
  if (fn.kind() === "identifier") {
    return fn.text();
  }
  return null;
}

export function getCallReceiverText(call: PyNode): string | null {
  const fn = call.field("function");
  if (!fn || fn.kind() !== "attribute") {
    return null;
  }
  return fn.field("object")?.text() ?? null;
}

function detectQuote(root: PyNode): '"' | "'" {
  const sample = root.find({ rule: { kind: "string" } });
  if (!sample) {
    return '"';
  }
  const text = sample.text();
  if (text.includes("'") && !text.includes('"')) {
    return "'";
  }
  return '"';
}

/** Insert `namespace=<literal>` into a Python call's argument list. */
export function addNamespaceKeyword(
  call: PyNode,
  namespace: string,
  root: PyNode,
  positionalNamespaceIndex = 2,
): Edit | null {
  if (
    hasKeywordArg(call, "namespace") ||
    hasPositionalNamespace(call, positionalNamespaceIndex)
  ) {
    return null;
  }

  const args = call.field("arguments");
  if (!args) {
    return null;
  }

  const quote = detectQuote(root);
  const nsArg = `namespace=${quote}${namespace}${quote}`;
  const argsText = args.text();

  if (argsText.includes("\n")) {
    const closeIndent = argsText.match(/\n([ \t]*)\)$/)?.[1] ?? "";
    const contentIndent =
      argsText.match(/\n([ \t]+)\S/)?.[1] ?? `${closeIndent}    `;
    const withoutClose = argsText.replace(/\n?[ \t]*\)$/, "");
    const trimmed = withoutClose.replace(/,\s*$/, "");
    return args.replace(`${trimmed},\n${contentIndent}${nsArg},\n${closeIndent})`);
  }

  if (argsText === "()" || /^\(\s*\)$/.test(argsText)) {
    return args.replace(`(${nsArg})`);
  }

  const inner = argsText.slice(1, -1).trim().replace(/,\s*$/, "");
  return args.replace(`(${inner}, ${nsArg})`);
}

export function isPipelineByNamePath(value: string): boolean {
  return value.includes(PIPELINE_BY_NAME_PATH);
}

export function pathAlreadyHasNamespace(value: string): boolean {
  return /[?&]namespace=/.test(value);
}

/** Append `namespace=` query param to a static REST pipeline-by-name URL. */
export function withNamespaceQuery(url: string, namespace: string): string | null {
  if (!isPipelineByNamePath(url) || pathAlreadyHasNamespace(url)) {
    return null;
  }

  const encoded = encodeURIComponent(namespace);
  const joiner = url.includes("?") ? "&" : "?";
  return `${url}${joiner}namespace=${encoded}`;
}

export { PIPELINE_BY_NAME_PATH };
