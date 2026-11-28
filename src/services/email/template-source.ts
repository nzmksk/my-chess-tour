const templates = import.meta.glob<string>("./templates/*.html", {
  query: "?raw",
  import: "default",
  eager: true,
});

export function loadTemplate(name: string): string {
  const html = templates[`./templates/${name}`];
  if (html === undefined) {
    throw new Error(`Unknown email template: ${name}`);
  }
  return html;
}
