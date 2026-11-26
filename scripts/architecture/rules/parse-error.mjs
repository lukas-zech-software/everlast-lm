import ts from "typescript-compiler";

export const parseErrorRule = {
  id: "parse-error",
  category: "integrity",
  description: "Fail closed on TypeScript/JavaScript syntax parse errors in workspace sources.",
  docPath: "docs/architecture-rules/parse-error.md",
  checkSourceFile(fileInfo, ctx) {
    for (const error of fileInfo.sf.parseDiagnostics) {
      ctx.add(
        "parse-error",
        fileInfo.from,
        "",
        ts.flattenDiagnosticMessageText(error.messageText, " "),
      );
    }
  },
};
