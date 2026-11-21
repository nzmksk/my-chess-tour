import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(join(process.cwd(), "package.json"));
const { parse } = require("@typescript-eslint/typescript-estree");

export const DIRECTIVES = [
  /^\s*eslint(-disable|-enable|-disable-line|-disable-next-line)?(\s|$)/,
  /^\s*@ts-(expect-error|nocheck|check)(\s|$)/,
  /^\s*@vitest-environment\s/,
  /^\/\s*<reference\s/,
];

const LINTED = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

export function lintedFiles(paths) {
  const listed = execSync(
    `git ls-files -- ${paths.map((p) => `"${p}"`).join(" ")}`,
    {
      encoding: "utf8",
    },
  )
    .split("\n")
    .filter(
      (f) =>
        LINTED.test(f) && !f.startsWith(".claude/") && !f.startsWith("wiki/"),
    );
  return listed;
}

export function commentsIn(file) {
  const text = readFileSync(file, "utf8");
  const ast = parse(text, {
    comment: true,
    jsx: /x$/.test(file),
    range: true,
    loc: true,
  });
  return {
    text,
    comments: ast.comments
      .filter((c) => !DIRECTIVES.some((d) => d.test(c.value)))
      .map((c) => ({
        key: `${file}:${c.loc.start.line}:${c.loc.start.column + 1}`,
        file,
        start: c.range[0],
        end: c.range[1],
        line: c.loc.start.line,
        endLine: c.loc.end.line,
        source: text.slice(c.range[0], c.range[1]),
      })),
  };
}
