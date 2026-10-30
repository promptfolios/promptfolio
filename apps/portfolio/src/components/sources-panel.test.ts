import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SourcesPanel } from "./sources-panel";

function render(data: unknown) {
  return renderToStaticMarkup(createElement(SourcesPanel, { data }));
}

const entry = {
  id: "service-catalog",
  record: "Service Catalog",
  evidence: [
    { basis: "self-reported", source: "Owner's file", observedAt: "2026-10-01T00:00:00.000Z" },
  ],
};

describe("SourcesPanel", () => {
  it("shows each record with its basis, source, and observation date", () => {
    const html = render({ sources: [entry], unverifiedCitations: 0 });

    expect(html).toContain("Sources (1)");
    expect(html).toContain("Service Catalog");
    // The id is how a citation marker finds this entry; visitors see the number instead.
    expect(html).toContain('data-source-id="service-catalog"');
    expect(html).not.toContain("[service-catalog]");
    expect(html).toContain("<ol");
    expect(html).toContain("self-reported");
    expect(html).toContain("Owner&#x27;s file");
    expect(html).toContain("2026-10-01");
    expect(html).not.toContain("<a ");
  });

  it("links a record that has an address, opening in a new tab", () => {
    const url = "https://github.com/jordan-example/markdown-linter";
    const html = render({ sources: [{ ...entry, url }], unverifiedCitations: 0 });

    expect(html).toContain(`href="${url}"`);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
    expect(html).toContain(">Service Catalog</a>");
  });

  it.each(["javascript:alert(1)", "data:text/html,hi", "not a url"])(
    "shows the name as plain text for the unsafe address %s",
    (url) => {
      const html = render({ sources: [{ ...entry, url }], unverifiedCitations: 0 });

      expect(html).not.toContain("<a ");
      expect(html).not.toContain(url);
      expect(html).toContain("Service Catalog");
    },
  );

  it("shows nothing when no citation could be matched", () => {
    expect(render({ sources: [], unverifiedCitations: 2 })).toBe("");
  });

  it("says nothing about unmatched citations next to real sources", () => {
    const html = render({ sources: [entry], unverifiedCitations: 2 });

    expect(html).toContain("Sources (1)");
    expect(html).not.toContain("citation");
  });

  it("shows record text as plain text, so a source cannot inject markup", () => {
    const html = render({
      sources: [{ ...entry, record: '<img src="https://attacker.example/x.png">' }],
      unverifiedCitations: 0,
    });

    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it.each([
    ["nothing to show", { sources: [], unverifiedCitations: 0 }],
    ["a wrong shape", { sources: "many" }],
    ["an unknown basis", { sources: [{ ...entry, evidence: [{ basis: "proven" }] }] }],
    ["no data", undefined],
  ])("renders nothing for %s", (_label, data) => {
    expect(render(data)).toBe("");
  });
});
