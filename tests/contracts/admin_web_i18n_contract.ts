import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { translations } from "../../apps/admin-web/src/config/i18n";

const repoRoot = process.cwd();
const sourceRoots = [
  "apps/admin-web/src/pages",
  "apps/admin-web/src/shell",
  "apps/admin-web/src/components/shared",
  "apps/admin-web/src/AppFrame.tsx",
  "apps/admin-web/src/ui.tsx"
];

const visibleAttributes = new Set(["aria-label", "title", "placeholder", "alt"]);
const technicalExact = new Set([
  "",
  "Agent",
  "AgentLoop",
  "Ask Maple",
  "Base URL",
  "Bearer token",
  "Cron",
  "E2B",
  "E2B_API_KEY",
  "ID",
  "JSON",
  "Key",
  "Loop",
  "MCP",
  "MCP OAuth",
  "Maple",
  "OAuth",
  "OpenAI",
  "Provider",
  "Schedule",
  "Scopes",
  "Timezone",
  "URL",
  "VeFaaS",
  "YAML",
  "cURL",
  "curl"
]);

const uiEnglishPattern = /\b(Add|Archive|Back|Cancel|Close|Config|Continue|Copy|Create|Creating|Debug|Delete|Details|Disabled|Done|Download|Edit|Environment|Environments|Event details|Last used|Loading|Name|Never|New|No |Not |Optional|Preview|Refresh|Remove|Run|Save|Search|Select|Session|Sessions|Settings|Skills|Source|Status|Tool|Transcript|Updated|Upload|Users|Vault|Version|Workspace)\b/;

function walk(path: string): string[] {
  const fullPath = join(repoRoot, path);
  if (statSync(fullPath).isFile()) return [fullPath];
  return readdirSync(fullPath).flatMap((entry) => {
    const child = join(fullPath, entry);
    if (statSync(child).isDirectory()) return walk(relative(repoRoot, child));
    return child.endsWith(".tsx") || child.endsWith(".ts") ? [child] : [];
  });
}

function scanFiles() {
  return sourceRoots.flatMap(walk)
    .filter((file) => file.endsWith(".tsx"))
    .filter((file) => !relative(repoRoot, file).startsWith("apps/admin-web/src/pages/docs/"));
}

function callName(node: ts.Expression) {
  return node.getText().replace(/\s+/g, "");
}

function isLocalized(node: ts.Node) {
  for (let current: ts.Node | undefined = node.parent; current; current = current.parent) {
    if (ts.isCallExpression(current)) {
      const name = callName(current.expression);
      if (name === "L" || name === "props.L" || name === "t") return true;
    }
  }
  return false;
}

function jsxTagName(node: ts.Node) {
  if (ts.isJsxElement(node)) return node.openingElement.tagName.getText();
  if (ts.isJsxSelfClosingElement(node)) return node.tagName.getText();
  return "";
}

function insideCodeLike(node: ts.Node) {
  for (let current: ts.Node | undefined = node.parent; current; current = current.parent) {
    const tag = jsxTagName(current);
    if (["code", "pre", "HighlightedCode", "Code", "MarkdownText"].includes(tag)) return true;
  }
  return false;
}

function enclosingJsxAttribute(node: ts.Node) {
  for (let current: ts.Node | undefined = node.parent; current; current = current.parent) {
    if (ts.isJsxAttribute(current)) return current.name.getText();
    if (ts.isJsxElement(current) || ts.isJsxSelfClosingElement(current)) return "";
  }
  return "";
}

function isTechnical(text: string) {
  const trimmed = text.trim();
  if (technicalExact.has(trimmed)) return true;
  if (/^[-/._:$@{}[\]\w]+$/.test(trimmed) && !/\s/.test(trimmed)) return true;
  if (/^(GET|POST|PUT|PATCH|DELETE|HTTP)\b/.test(trimmed)) return true;
  if (/^[A-Z0-9_]+$/.test(trimmed)) return true;
  if (/^https?:\/\//.test(trimmed)) return true;
  return false;
}

function isForbiddenVisibleText(text: string) {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (!trimmed || !/[A-Za-z]/.test(trimmed)) return false;
  if (isTechnical(trimmed)) return false;
  return uiEnglishPattern.test(trimmed);
}

function location(file: ts.SourceFile, node: ts.Node) {
  const { line, character } = file.getLineAndCharacterOfPosition(node.getStart(file));
  return `${relative(repoRoot, file.fileName)}:${line + 1}:${character + 1}`;
}

function assertPageUsesI18n(fileName: string, source: string) {
  const rel = relative(repoRoot, fileName);
  if (!rel.startsWith("apps/admin-web/src/pages/") && !rel.startsWith("apps/admin-web/src/shell/")) return;
  if (!/<(PageFrame|ModalShell|DrawerLayer|button|label|h[1-6]|p)\b|aria-label=|placeholder=|title=/.test(source)) return;
  const hasI18n = /useI18n|useL|props\.L| L:|const L =|const \{[^}]*t[^}]*\} = useI18n/.test(source);
  assert.equal(hasI18n, true, `${rel} renders UI but does not wire i18n; use useL(), useI18n(), or an L prop`);
}

function assertNoVisibleEnglish(fileName: string) {
  const source = readFileSync(fileName, "utf8");
  assertPageUsesI18n(fileName, source);
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const failures: string[] = [];

  function visit(node: ts.Node) {
    if (ts.isJsxText(node)) {
      const text = node.getText(sourceFile);
      if (!insideCodeLike(node) && !isLocalized(node) && isForbiddenVisibleText(text)) {
        failures.push(`${location(sourceFile, node)} visible text "${text.trim()}"`);
      }
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const attr = enclosingJsxAttribute(node);
      const inVisibleAttr = visibleAttributes.has(attr) || attr === "headers";
      if (inVisibleAttr && !insideCodeLike(node) && !isLocalized(node) && isForbiddenVisibleText(node.text)) {
        failures.push(`${location(sourceFile, node)} ${attr} "${node.text}"`);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  assert.deepEqual(failures, [], `Unlocalized visible English UI text found:\n${failures.join("\n")}`);
}

const zhKeys = Object.keys(translations.zh).sort();
const enKeys = Object.keys(translations.en).sort();
assert.deepEqual(enKeys, zhKeys, "i18n translation keys must stay aligned between zh and en");

for (const file of scanFiles()) {
  assertNoVisibleEnglish(file);
}

console.log("admin web i18n contract passed");
