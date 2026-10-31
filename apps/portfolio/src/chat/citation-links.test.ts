import { citedIds } from "@promptfolio/ai";
import { describe, expect, it } from "vitest";
import {
  citationDisplay,
  citationIdFromHref,
  type MarkdownNode,
  remarkCitations,
} from "./citation-links";

function paragraph(...children: MarkdownNode[]): MarkdownNode {
  return { type: "root", children: [{ type: "paragraph", children }] };
}

function transformed(tree: MarkdownNode): MarkdownNode[] {
  remarkCitations()(tree);
  return tree.children?.[0]?.children ?? [];
}

const text = (value: string): MarkdownNode => ({ type: "text", value });

function linkedIds(nodes: MarkdownNode[]): Array<string | undefined> {
  return nodes.filter((node) => node.type === "link").map((node) => citationIdFromHref(node.url));
}

describe("remarkCitations", () => {
  it("turns a citation into a link, and takes the space before it", () => {
    const nodes = transformed(paragraph(text("It lists a catalog [service-catalog].")));

    expect(nodes.map((node) => node.type)).toEqual(["text", "link", "text"]);
    expect(nodes[0]?.value).toBe("It lists a catalog");
    expect(linkedIds(nodes)).toEqual(["service-catalog"]);
    expect(nodes[2]?.value).toBe(".");
  });

  it("gives a drifted [a, b] two markers", () => {
    expect(linkedIds(transformed(paragraph(text("See [a, b]."))))).toEqual(["a", "b"]);
  });

  it("keeps a source key whole", () => {
    const id = "github.com/owner/name/commit/abc123";

    expect(linkedIds(transformed(paragraph(text(`See [${id}]`))))).toEqual([id]);
  });

  it("reads each text node's citations as the server does", () => {
    const value =
      "A [one], B [two, three] and [one] again, then [ , ], [ four ], [fi\u2011ve], [six; seven], and [source: public data].";

    expect([...new Set(linkedIds(transformed(paragraph(text(value)))))]).toEqual(citedIds(value));
  });

  it("leaves code and real links alone", () => {
    const code = { type: "inlineCode", value: "items[0]" };
    const link = {
      type: "link",
      url: "https://example.com",
      children: [text("[not a citation]")],
    };
    const nodes = transformed(paragraph(code, link));

    expect(nodes).toEqual([code, link]);
  });

  it("finds citations inside emphasis and lists", () => {
    const tree: MarkdownNode = {
      type: "root",
      children: [
        { type: "list", children: [{ type: "strong", children: [text("Bold [inner]")] }] },
      ],
    };
    remarkCitations()(tree);

    expect(linkedIds(tree.children?.[0]?.children?.[0]?.children ?? [])).toEqual(["inner"]);
  });

  it("leaves text without citations as it was", () => {
    expect(transformed(paragraph(text("No citations.")))).toEqual([text("No citations.")]);
  });
});

describe("citationIdFromHref", () => {
  it.each([[undefined], ["https://example.com"], ["#something-else"], ["#citation-%E0%A4%A"]])(
    "is undefined for %s",
    (href) => {
      expect(citationIdFromHref(href)).toBeUndefined();
    },
  );
});

describe("citationDisplay", () => {
  const data = {
    sources: [
      { id: "one", record: "Record one", evidence: [] },
      { id: "two", record: "Record two", evidence: [] },
    ],
    unverifiedCitations: 1,
  };

  it("numbers a citation by its entry in the panel", () => {
    expect(citationDisplay("two", data, false)).toEqual({
      kind: "source",
      number: 2,
      record: "Record two",
    });
  });

  it("shows numbers as soon as the sources arrive, even while still running", () => {
    expect(citationDisplay("one", data, true).kind).toBe("source");
  });

  it("hides a citation the panel does not list, as there is no source to lead to", () => {
    expect(citationDisplay("invented", data, false)).toEqual({ kind: "hidden" });
  });

  it("hides every citation when none could be matched, rather than showing raw ids", () => {
    const none = { sources: [], unverifiedCitations: 2 };

    expect(citationDisplay("invented", none, false)).toEqual({ kind: "hidden" });
  });

  it("hides citations while streaming, before the sources arrive", () => {
    expect(citationDisplay("one", undefined, true)).toEqual({ kind: "hidden" });
  });

  it("keeps the raw text when a finished answer has no sources", () => {
    expect(citationDisplay("one", undefined, false)).toEqual({ kind: "raw" });
  });

  it("keeps the raw text when saved sources are invalid", () => {
    expect(citationDisplay("one", { sources: "many" }, false)).toEqual({ kind: "raw" });
  });
});
