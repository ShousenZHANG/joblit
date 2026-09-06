import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// Read literal fixtures without executing application code or contacting an API.
const fixtureUrl = new URL("../../components/landing/ApplicationDemo.data.ts", import.meta.url);
const source = ts.createSourceFile(
  fileURLToPath(fixtureUrl),
  readFileSync(fixtureUrl, "utf8"),
  ts.ScriptTarget.Latest,
  true,
);

function literal(node) {
  if (ts.isAsExpression(node)) return literal(node.expression);
  if (ts.isStringLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(literal);
  if (ts.isObjectLiteralExpression(node)) {
    return Object.fromEntries(node.properties.map((property) => {
      if (!ts.isPropertyAssignment(property)) throw new Error("Expected a literal fixture property.");
      return [property.name.text, literal(property.initializer)];
    }));
  }
  throw new Error(`Expected a literal fixture, received ${ts.SyntaxKind[node.kind]}.`);
}

const expected = ["DEMO_PROFILE", "DEMO_SKILLS", "DEMO_JOBS"];
const fixtures = {};
for (const statement of source.statements) {
  if (!ts.isVariableStatement(statement)) continue;
  for (const declaration of statement.declarationList.declarations) {
    const name = declaration.name.getText(source);
    if (expected.includes(name)) fixtures[name] = literal(declaration.initializer);
  }
}
if (expected.some((name) => !(name in fixtures))) throw new Error("Demo fixtures are incomplete.");

const result = spawnSync(
  process.env.DEMO_PYTHON || "python",
  [fileURLToPath(new URL("generate.py", import.meta.url))],
  { input: JSON.stringify(fixtures), encoding: "utf8", stdio: ["pipe", "inherit", "inherit"] },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
