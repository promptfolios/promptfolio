import { describe, expect, it } from "vitest";
import { profileInputJsonSchema } from "./json-schema.ts";
import { loadStructuredProfile } from "./load.ts";

type JsonObject = { [key: string]: unknown };

const source = {
  sourceId: "owner-profile",
  label: "Owner-provided profile",
  observedAt: new Date("2026-11-12T00:00:00.000Z"),
};

/** Every object schema (one with `properties`) in the tree. */
function objectSchemas(node: unknown, found: JsonObject[] = []): JsonObject[] {
  if (Array.isArray(node)) {
    for (const item of node) objectSchemas(item, found);
  } else if (node && typeof node === "object") {
    const object = node as JsonObject;
    if (object.type === "object") found.push(object);
    for (const value of Object.values(object)) objectSchemas(value, found);
  }
  return found;
}

function property(schema: JsonObject, ...path: string[]): JsonObject {
  let node = schema;
  for (const key of path) {
    const next = key === "items" ? node.items : (node.properties as JsonObject)[key];
    node = next as JsonObject;
  }
  return node;
}

describe("profileInputJsonSchema", () => {
  it("matches the snapshot, so a change from a zod upgrade shows in review", () => {
    expect(profileInputJsonSchema()).toMatchSnapshot();
  });

  it("declares draft 7 and rejects unknown keys in every object", () => {
    const schema = profileInputJsonSchema();
    expect(schema.$schema).toBe("http://json-schema.org/draft-07/schema#");
    const objects = objectSchemas(schema);
    expect(objects.length).toBeGreaterThan(5);
    for (const object of objects) expect(object.additionalProperties).toBe(false);
  });

  it("requires what the loader requires, and leaves defaulted lists optional", () => {
    const schema = profileInputJsonSchema() as JsonObject;
    expect(schema.required).toEqual(["schemaVersion", "identity"]);
    expect(property(schema, "schemaVersion").const).toBe(1);
    expect(property(schema, "identity").required).toEqual(["name", "headline", "summary"]);
    expect(property(schema, "experience", "items").required).toEqual([
      "id",
      "organization",
      "title",
      "start",
    ]);
  });

  it("has a date pattern that agrees with the loader", () => {
    const schema = profileInputJsonSchema() as JsonObject;
    const pattern = new RegExp(property(schema, "experience", "items", "start").pattern as string);
    for (const start of ["2024", "2024-06", "2024-13", "June 2024", "2024-6"]) {
      const loaded = loadStructuredProfile(
        {
          schemaVersion: 1,
          identity: { name: "Jordan Example", headline: "Engineer", summary: "Builds things." },
          experience: [{ id: "acme", organization: "Acme", title: "Engineer", start }],
        },
        source,
      );
      expect(pattern.test(start), start).toBe(loaded.ok);
    }
  });

  it("labels every property for forms, including nested and list-item ones", () => {
    const unlabeled: string[] = [];
    function visit(node: JsonObject, path: string): void {
      const properties = (node.properties ?? {}) as { [key: string]: JsonObject };
      for (const [key, child] of Object.entries(properties)) {
        if (typeof child.title !== "string" || child.title === "") unlabeled.push(`${path}${key}`);
        visit(child, `${path}${key}.`);
        if (child.items) visit(child.items as JsonObject, `${path}${key}[].`);
      }
    }
    visit(profileInputJsonSchema() as JsonObject, "");
    expect(unlabeled).toEqual([]);
  });

  it("describes the fields whose rules a label cannot show", () => {
    const schema = profileInputJsonSchema() as JsonObject;
    const role = property(schema, "experience", "items");
    // The format has fields named `title` and `description`: these read the keywords on their schemas.
    expect(role.title).toBe("Role");
    expect(property(role, "title").title).toBe("Title");
    expect(property(role, "start").description).toMatch(/YYYY or YYYY-MM/);
    expect(property(role, "end").description).toMatch(/current role/);
    expect(property(schema, "projects", "items", "roleId").description).toMatch(
      /role in experience/,
    );
    expect(property(schema, "projects", "items", "description").title).toBe("Description");
    expect(property(schema, "education", "items", "id").description).toMatch(/Unique/);
  });

  it("returns a new copy on each call", () => {
    const first = profileInputJsonSchema() as JsonObject;
    (first.properties as JsonObject).schemaVersion = "changed";
    first.extra = true;
    const second = profileInputJsonSchema() as JsonObject;
    expect(second.extra).toBeUndefined();
    expect(property(second, "schemaVersion").const).toBe(1);
  });
});
