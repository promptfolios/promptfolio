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
    expect(html).not.toContain("could not be matched");
  });

  it.each([
    [1, "1 citation could not be matched"],
    [2, "2 citations could not be matched"],
  ])("reports %i unverified citations, even with no sources", (count, message) => {
    const html = render({ sources: [], unverifiedCitations: count });

    expect(html).toContain(message);
    expect(html).not.toContain("Sources (");
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
