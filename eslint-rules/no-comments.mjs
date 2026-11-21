const DIRECTIVES = [
  /^\s*eslint(-disable|-enable|-disable-line|-disable-next-line)?(\s|$)/,
  /^\s*@ts-(expect-error|nocheck|check)(\s|$)/,
  /^\s*@vitest-environment\s/,
  /^\/\s*<reference\s/,
];

const rule = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Disallow code comments other than tool directives. See docs/adr/0001-no-code-comments.md.",
    },
    schema: [],
    messages: {
      noComment:
        "Comments are not allowed. Make the code say it, or record the decision in docs/adr/ (run /delete-comment).",
    },
  },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          if (comment.type === "Shebang") continue;
          if (DIRECTIVES.some((d) => d.test(comment.value))) continue;
          context.report({ loc: comment.loc, messageId: "noComment" });
        }
      },
    };
  },
};

const plugin = {
  rules: { "no-comments": rule },
};

export default plugin;
