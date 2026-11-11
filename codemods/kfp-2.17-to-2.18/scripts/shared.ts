import type { Edit, SgNode } from "codemod:ast-grep";
import type Python from "codemod:ast-grep/langs/python";

export type PyNode = SgNode<Python>;

const PIPELINE_BY_NAME_PATH = "/apis/v2beta1/pipelines/names/";
const PIPELINE_UPLOAD_PATH = "/apis/v2beta1/pipelines/upload";

/** Marker comments that mean "leave this call shared (omit namespace)". */
const SHARED_INTENT_RE =
  /#\s*(kfp-shared|kfp:shared|intentional\s+shared)\b/i;

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

/**
 * Map simple identifier assignments to static string literals in the file.
 * Used so `NS = "team-a"; Client(namespace=NS)` resolves.
 */
export function resolveStringConstants(root: PyNode): Map<string, string> {
  const constants = new Map<string, string>();
  const ambiguous = new Set<string>();

  for (const assignment of root.findAll({ rule: { kind: "assignment" } })) {
    const left = assignment.field("left");
    const right = assignment.field("right");
    if (!left || !right || left.kind() !== "identifier") {
      continue;
    }

    const name = left.text();
    if (!name) {
      continue;
    }

    const literal = readStringLiteral(right);
    if (literal === null || literal.length === 0) {
      if (constants.has(name) || ambiguous.has(name)) {
        ambiguous.add(name);
        constants.delete(name);
      }
      continue;
    }

    const existing = constants.get(name);
    if (existing !== undefined && existing !== literal) {
      ambiguous.add(name);
      constants.delete(name);
      continue;
    }

    if (ambiguous.has(name)) {
      continue;
    }

    constants.set(name, literal);
  }

  return constants;
}

/** Resolve a namespace expression: string literal or same-file string constant. */
export function resolveNamespaceExpression(
  node: PyNode | null | undefined,
  stringConstants: Map<string, string>,
): string | null {
  if (!node) {
    return null;
  }

  const literal = readStringLiteral(node);
  if (literal !== null) {
    return literal.length > 0 ? literal : null;
  }

  if (node.kind() === "identifier") {
    return stringConstants.get(node.text()) ?? null;
  }

  return null;
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

/** Return the keyword_argument node itself (not just its value). */
export function getKeywordArgNode(call: PyNode, name: string): PyNode | null {
  const args = call.field("arguments");
  if (!args) {
    return null;
  }

  for (const child of args.children()) {
    if (child.kind() !== "keyword_argument") {
      continue;
    }
    if (child.field("name")?.text() === name) {
      return child;
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

function trackNamespaceBinding(
  namespaces: Map<string, string>,
  ambiguous: Set<string>,
  receiver: string,
  namespace: string | null,
): void {
  if (!namespace || namespace.length === 0) {
    ambiguous.add(receiver);
    namespaces.delete(receiver);
    return;
  }

  const existing = namespaces.get(receiver);
  if (existing !== undefined && existing !== namespace) {
    ambiguous.add(receiver);
    namespaces.delete(receiver);
    return;
  }

  if (ambiguous.has(receiver)) {
    return;
  }

  namespaces.set(receiver, namespace);
}

/**
 * Map receiver expression text -> statically resolved nonempty namespace.
 * Supports:
 * - `client = Client(namespace="team-a")`
 * - `client = Client(namespace=NS)` when `NS = "team-a"` in the same file
 * - `self._client = Client(namespace="team-a")` (attribute-held clients)
 * Ambiguous reassignments are omitted.
 */
export function resolveClientNamespaces(root: PyNode): Map<string, string> {
  const { kfpModules, clientCtors } = collectImportAliases(root);
  const stringConstants = resolveStringConstants(root);
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
    const namespace = resolveNamespaceExpression(namespaceNode, stringConstants);
    trackNamespaceBinding(namespaces, ambiguous, receiver, namespace);
  }

  return namespaces;
}

/**
 * Map pipeline-API object text -> namespace when assigned from a Client, e.g.
 * `pipelines_api = client._pipelines_api`.
 */
export function resolvePipelinesApiNamespaces(root: PyNode): Map<string, string> {
  const clientNamespaces = resolveClientNamespaces(root);
  const apiNamespaces = new Map<string, string>();
  const ambiguous = new Set<string>();

  for (const assignment of root.findAll({ rule: { kind: "assignment" } })) {
    const left = assignment.field("left");
    const right = assignment.field("right");
    if (!left || !right || left.kind() === "pattern_list") {
      continue;
    }

    const receiver = left.text();
    if (!receiver) {
      continue;
    }

    if (right.kind() !== "attribute") {
      if (apiNamespaces.has(receiver) || ambiguous.has(receiver)) {
        ambiguous.add(receiver);
        apiNamespaces.delete(receiver);
      }
      continue;
    }

    const attr = right.field("attribute")?.text();
    const obj = right.field("object")?.text();
    if (!obj || (attr !== "_pipelines_api" && attr !== "pipelines_api")) {
      if (apiNamespaces.has(receiver) || ambiguous.has(receiver)) {
        ambiguous.add(receiver);
        apiNamespaces.delete(receiver);
      }
      continue;
    }

    const namespace = clientNamespaces.get(obj) ?? null;
    trackNamespaceBinding(apiNamespaces, ambiguous, receiver, namespace);
  }

  return apiNamespaces;
}

/** Unique statically resolved client namespace values in the file, if any. */
export function uniqueResolvedNamespaces(root: PyNode): string[] {
  return [...new Set(resolveClientNamespaces(root).values())];
}

/**
 * Prefer a single file-wide namespace when unambiguous; otherwise null.
 * Used for GetPipelineByNameRequest / REST when no per-receiver binding exists.
 */
export function uniqueNamespaceOrNull(root: PyNode): string | null {
  const values = uniqueResolvedNamespaces(root);
  return values.length === 1 ? (values[0] ?? null) : null;
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

export function formatNamespaceKeyword(root: PyNode, namespace: string): string {
  const quote = detectQuote(root);
  return `namespace=${quote}${namespace}${quote}`;
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

  const nsArg = formatNamespaceKeyword(root, namespace);
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

/**
 * True when the call (or previous line) is marked as intentional shared usage.
 * Markers: `# kfp-shared`, `# kfp:shared`, `# intentional shared`.
 */
export function hasSharedIntentMarker(node: PyNode): boolean {
  const src = node.getRoot().root().text();
  const start = node.range().start.index;

  const lineStart = src.lastIndexOf("\n", start - 1) + 1;
  const lineEndIdx = src.indexOf("\n", start);
  const lineEnd = lineEndIdx === -1 ? src.length : lineEndIdx;
  const line = src.slice(lineStart, lineEnd);
  if (SHARED_INTENT_RE.test(line)) {
    return true;
  }

  if (lineStart <= 0) {
    return false;
  }

  const prevEnd = lineStart - 1;
  const prevStart = src.lastIndexOf("\n", prevEnd - 1) + 1;
  const prevLine = src.slice(prevStart, prevEnd);
  return SHARED_INTENT_RE.test(prevLine);
}

/**
 * True when a string node is used as an assignment RHS or call argument
 * (not a docstring / unrelated literal elsewhere in the file).
 */
export function isExecutableStringContext(stringNode: PyNode): boolean {
  for (const ancestor of stringNode.ancestors()) {
    const kind = ancestor.kind();
    if (kind === "assignment" || kind === "augmented_assignment") {
      return true;
    }
    if (kind === "call" || kind === "keyword_argument") {
      return true;
    }
    // Stop at statement-ish boundaries that are not executable string uses.
    if (
      kind === "expression_statement" ||
      kind === "function_definition" ||
      kind === "class_definition" ||
      kind === "module"
    ) {
      // expression_statement wrapping a bare string is a docstring / noop.
      if (kind === "expression_statement") {
        return false;
      }
      break;
    }
  }
  return false;
}

export function isPipelineByNamePath(value: string): boolean {
  return value.includes(PIPELINE_BY_NAME_PATH);
}

export function isPipelineUploadPath(value: string): boolean {
  return value.includes(PIPELINE_UPLOAD_PATH);
}

export function pathAlreadyHasNamespace(value: string): boolean {
  return /[?&]namespace=/.test(value);
}

/** Append `namespace=` query param to a static REST pipeline-by-name URL. */
export function withNamespaceQuery(url: string, namespace: string): string | null {
  if (
    (!isPipelineByNamePath(url) && !isPipelineUploadPath(url)) ||
    pathAlreadyHasNamespace(url)
  ) {
    return null;
  }

  const encoded = encodeURIComponent(namespace);
  const joiner = url.includes("?") ? "&" : "?";
  return `${url}${joiner}namespace=${encoded}`;
}

/**
 * Rewrite `pipeline_name=<expr>` to
 * `pipeline_id=<receiver>.get_pipeline_id(<expr>, namespace=<ns>)`.
 */
export function rewritePipelineNameToNamespacedId(
  call: PyNode,
  receiver: string,
  namespace: string,
  root: PyNode,
): Edit | null {
  if (hasKeywordArg(call, "pipeline_id")) {
    return null;
  }

  const pipelineNameNode = getKeywordArgNode(call, "pipeline_name");
  if (!pipelineNameNode) {
    return null;
  }

  const nameValue = pipelineNameNode.field("value");
  if (!nameValue) {
    return null;
  }

  const nsArg = formatNamespaceKeyword(root, namespace);
  return pipelineNameNode.replace(
    `pipeline_id=${receiver}.get_pipeline_id(${nameValue.text()}, ${nsArg})`,
  );
}

export { PIPELINE_BY_NAME_PATH, PIPELINE_UPLOAD_PATH };
