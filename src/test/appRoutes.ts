import { readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../app");

const PAGE_FILES = new Set(["page.tsx", "page.ts", "page.jsx", "page.js"]);

const isRouteGroup = (segment: string) => /^\(.*\)$/.test(segment);

export function discoverRouteTemplates(appDir: string = APP_DIR): string[] {
  const templates: string[] = [];

  const walk = (dir: string, segments: string[]) => {
    const entries = readdirSync(dir, { withFileTypes: true });

    if (entries.some((e) => e.isFile() && PAGE_FILES.has(e.name))) {
      const path = segments.filter((s) => !isRouteGroup(s));
      templates.push("/" + path.join("/"));
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      walk(resolve(dir, entry.name), [...segments, entry.name]);
    }
  };

  walk(appDir, []);
  return templates.map((t) => (t === "/" ? t : t.replace(/\/$/, "")));
}

function templateToRegex(template: string): RegExp {
  if (template === "/") return /^\/$/;

  const parts = template
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      if (/^\[\[\.\.\..+\]\]$/.test(segment)) return "(?:/.*)?";
      if (/^\[\.\.\..+\]$/.test(segment)) return "/.+";
      if (/^\[.+\]$/.test(segment)) return "/[^/]+";
      return "/" + segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    });

  return new RegExp("^" + parts.join("") + "$");
}

let cachedMatchers: RegExp[] | null = null;

function routeMatchers(): RegExp[] {
  if (!cachedMatchers) {
    cachedMatchers = discoverRouteTemplates().map(templateToRegex);
  }
  return cachedMatchers;
}

export function isValidRoute(href: string): boolean {
  const path = href.split(/[?#]/)[0];
  return routeMatchers().some((re) => re.test(path));
}
