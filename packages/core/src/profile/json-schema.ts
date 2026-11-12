import { z } from "zod";
import { profileInputSchema } from "./schema.ts";

/*
 * Generated from the internal zod schema, so it cannot drift from what the loader accepts. Built
 * once; zod's default for anything it cannot express (a transform) is to throw, which is kept on
 * purpose: a schema change that adds one fails the tests and needs a decision here.
 */
const schema = z.toJSONSchema(profileInputSchema, { io: "input", target: "draft-7" });

/**
 * A JSON Schema (draft 7) of the profile authoring format, `ProfileInput`, for editor autocomplete
 * and hover help, or for generating forms. Each call returns a new copy.
 *
 * It is looser than `loadStructuredProfile`, which remains the validator: rules that only code can
 * check are not in it, such as record-id format, unique ids, an end date not before its start, unique
 * skill names, and trimming. Text that passes the schema can still fail to load.
 */
export function profileInputJsonSchema(): { readonly [key: string]: unknown } {
  return structuredClone(schema);
}
