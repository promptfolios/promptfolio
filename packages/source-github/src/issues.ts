import type { ProfileIssue } from "@promptfolio/core";
import type { z } from "zod";

/** zod issues as `{ path, message }`, with paths written like `repositories[0].name`. */
export function issuesFrom(error: z.ZodError): ProfileIssue[] {
  return error.issues.map((issue) => ({ path: formatPath(issue.path), message: issue.message }));
}

function formatPath(path: readonly PropertyKey[]): string {
  let result = "";
  for (const segment of path) {
    if (typeof segment === "number") {
      result += `[${segment}]`;
    } else {
      result += result === "" ? String(segment) : `.${String(segment)}`;
    }
  }
  return result === "" ? "(root)" : result;
}
