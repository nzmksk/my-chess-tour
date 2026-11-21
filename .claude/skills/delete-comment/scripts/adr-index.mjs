#!/usr/bin/env node
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = "docs/adr";
const readme = join(dir, "README.md");

const rows = readdirSync(dir)
  .filter((f) => /^\d{4}-.*\.md$/.test(f))
  .sort()
  .map((f) => {
    const text = readFileSync(join(dir, f), "utf8");
    const [, num, title] = text.match(/^# (\d{4})\. (.+)$/m);
    const status = text.match(/^- Status: (.+)$/m)?.[1].trim() ?? "";
    return [num, `[${title.trim()}](${f})`, status];
  });

const header = ["#", "Decision", "Status"];
const widths = header.map((h, i) =>
  Math.max(h.length, ...rows.map((r) => r[i].length)),
);
const line = (cells) =>
  `| ${cells.map((c, i) => c.padEnd(widths[i])).join(" | ")} |`;
const table = [
  line(header),
  line(widths.map((w) => "-".repeat(w))),
  ...rows.map(line),
].join("\n");

const current = readFileSync(readme, "utf8");
const next = current.replace(/## Index\r?\n[\s\S]*$/, `## Index\n\n${table}\n`);
writeFileSync(readme, next);
console.log(`${rows.length} records indexed`);
