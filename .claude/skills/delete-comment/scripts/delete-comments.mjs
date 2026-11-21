#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { commentsIn } from "./comments.mjs";

const [listFile] = process.argv.slice(2);
if (!listFile) {
  console.error(
    "usage: delete-comments.mjs <keys-file>  (one file:line:col per line)",
  );
  process.exit(1);
}

const keys = new Set(
  readFileSync(listFile, "utf8")
    .split("\n")
    .map((l) => l.replace(/\s+#.*$/, "").trim())
    .filter(Boolean),
);

const byFile = new Map();
for (const key of keys) {
  const file = key.replace(/:\d+:\d+$/, "");
  if (!byFile.has(file)) byFile.set(file, []);
  byFile.get(file).push(key);
}

const isBlank = (line) => line !== undefined && line.trim() === "";
const opens = (line) => line === undefined || /[{([]\s*$/.test(line.trimEnd());
const closes = (line) => line !== undefined && /^\s*[})\]]/.test(line);

function lineStart(t, i) {
  return t.lastIndexOf("\n", i - 1) + 1;
}
function lineEnd(t, i) {
  const e = t.indexOf("\n", i);
  return e < 0 ? t.length : e;
}

function removeOne(t, start, end) {
  let ls = lineStart(t, start);
  let le = lineEnd(t, end);
  let before = t.slice(ls, start);
  let after = t.slice(end, le);

  const jsxOpen = before.match(/\{\s*$/);
  const jsxClose = after.match(/^\s*\}/);
  if (jsxOpen && jsxClose) {
    start -= jsxOpen[0].length;
    end += jsxClose[0].length;
    before = t.slice(ls, start);
    after = t.slice(end, le);
  }

  if (!before.trim() && !after.trim()) {
    const lines = t.split("\n");
    const first = t.slice(0, ls).split("\n").length - 1;
    const last = t.slice(0, le).split("\n").length - 1;
    const prev = lines[first - 1];
    const next = lines[last + 1];
    let from = first;
    let count = last - first + 1;
    if (isBlank(next) && (isBlank(prev) || opens(prev))) count += 1;
    else if (isBlank(prev) && (closes(next) || next === undefined)) {
      from -= 1;
      count += 1;
    }
    lines.splice(from, count);
    return lines.join("\n");
  }

  if (!after.trim()) {
    const ws = before.match(/\s*$/)[0].length;
    return t.slice(0, start - ws) + t.slice(end);
  }

  const trailing = t.slice(end).match(/^[ \t]*/)[0].length;
  return t.slice(0, start) + t.slice(end + trailing);
}

let removed = 0;
for (const [file, fileKeys] of byFile) {
  const { text, comments } = commentsIn(file);
  const wanted = comments.filter((c) => fileKeys.includes(c.key));
  const missing = fileKeys.filter((k) => !wanted.some((c) => c.key === k));
  if (missing.length) {
    console.error(
      `not found, file changed since listing?\n  ${missing.join("\n  ")}`,
    );
    process.exitCode = 1;
  }
  let t = text;
  for (const c of wanted.sort((a, b) => b.start - a.start)) {
    t = removeOne(t, c.start, c.end);
    removed += 1;
  }
  t = t.replace(/\n+$/, "\n");
  if (t !== text) writeFileSync(file, t);
}
console.log(`removed ${removed} comments from ${byFile.size} files`);
