#!/usr/bin/env node
import { commentsIn, lintedFiles } from "./comments.mjs";

const args = process.argv.slice(2);
const summary = args[0] === "--summary";
const keysOnly = args[0] === "--keys";
const rest = summary || keysOnly ? args.slice(1) : args;
const paths = rest.length ? rest : ["."];

const counts = [];
let ownLines = 0;

for (const file of lintedFiles(paths)) {
  const { text, comments } = commentsIn(file);
  if (!comments.length) continue;
  counts.push([comments.length, file]);
  const lines = text.split("\n");

  for (const c of comments) {
    const lineStart = text.lastIndexOf("\n", c.start - 1) + 1;
    const lineEnd = text.indexOf("\n", c.end);
    const before = text.slice(lineStart, c.start).replace(/\{\s*$/, "");
    const after = text
      .slice(c.end, lineEnd < 0 ? text.length : lineEnd)
      .replace(/^\s*\}/, "");
    if (!before.trim() && !after.trim()) ownLines += c.endLine - c.line + 1;
    if (summary) continue;
    if (keysOnly) {
      console.log(c.key);
      continue;
    }

    const next = lines
      .slice(c.endLine)
      .find((l) => l.trim() && !/^\s*(\/\/|\/?\*)/.test(l));
    console.log(`=== ${c.key}`);
    console.log(c.source);
    console.log(`--> ${next ? next.trim().slice(0, 160) : "(end of file)"}`);
  }
}

if (summary) {
  counts.sort((a, b) => b[0] - a[0]);
  for (const [n, f] of counts) console.log(`${String(n).padStart(5)}  ${f}`);
  const total = counts.reduce((s, [n]) => s + n, 0);
  console.log(
    `${String(total).padStart(5)}  total in ${counts.length} files; ${ownLines} lines hold nothing but a comment`,
  );
}
