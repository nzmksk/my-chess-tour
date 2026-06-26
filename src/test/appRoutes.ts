import { readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Test-only helper that derives the set of real App Router page routes from the
 * filesystem (every directory under `src/app` that contains a `page` file) and
 * lets tests assert that a navigation link actually resolves to one of them.
 *
 * The point: if the folder structure changes (a page is moved, renamed, or its
 * dynamic segment is renamed) the derived route set changes too, so any link
 * that still points at the old path fails its test before reaching production.
 */

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../app");

const PAGE_FILES = new Set(["page.tsx", "page.ts", "page.jsx", "page.js"]);

// A path segment wrapped in parentheses, e.g. "(marketing)", is a route group:
// it organizes files without adding a URL segment.
const isRouteGroup = (segment: string) => /^\(.*\)$/.test(segment);

/** Walk `src/app` and collect one route template per directory holding a page. */
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

/** Turn a route template into an anchored regex matching concrete URLs. */
function templateToRegex(template: string): RegExp {
  if (template === "/") return /^\/$/;

  const parts = template
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      // [[...slug]] optional catch-all — matches zero or more segments.
      if (/^\[\[\.\.\..+\]\]$/.test(segment)) return "(?:/.*)?";
      // [...slug] catch-all — matches one or more segments.
      if (/^\[\.\.\..+\]$/.test(segment)) return "/.+";
      // [param] dynamic segment — matches exactly one segment.
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

/**
 * True when `href` (an internal, concrete path such as
 * `/my/organizations/abc/members`) resolves to a real page route. Query strings
 * and hashes are ignored.
 */
export function isValidRoute(href: string): boolean {
  const path = href.split(/[?#]/)[0];
  return routeMatchers().some((re) => re.test(path));
}
