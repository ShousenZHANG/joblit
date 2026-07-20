import ts from "typescript";

/**
 * Return unqualified platform-fetch calls in production server TypeScript.
 * Method calls such as `adapter.fetch()` are deliberately ignored; direct
 * `fetch()`, `global.fetch()`, and `globalThis.fetch()` must go through the
 * reviewed safe outbound gateway instead.
 */
export function findDirectServerFetchCalls(
  sourceText,
  fileName = "source.ts",
) {
  const source = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const calls = [];

  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const expression = node.expression;
      const directIdentifier =
        ts.isIdentifier(expression) && expression.text === "fetch";
      const directGlobalProperty =
        ts.isPropertyAccessExpression(expression) &&
        expression.name.text === "fetch" &&
        ts.isIdentifier(expression.expression) &&
        ["global", "globalThis", "window"].includes(
          expression.expression.text,
        );

      if (directIdentifier || directGlobalProperty) {
        const position = source.getLineAndCharacterOfPosition(
          expression.getStart(source),
        );
        calls.push({
          line: position.line + 1,
          column: position.character + 1,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return calls;
}
