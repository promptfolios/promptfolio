import { describe, expect, it } from "vitest";
import { findContactDetails } from "./contact-details.ts";

const EMAIL = "Looks like an email address";
const PHONE = "Looks like a phone number";

describe("findContactDetails", () => {
  it("reports email addresses and phone numbers in free text, with their paths", () => {
    const data = {
      identity: { summary: "Reach me at jordan.example+jobs@example.com." },
      experience: [
        { highlights: ["Built check-in workflows.", "Call +1 (555) 010-0199 for references."] },
      ],
    };

    expect(findContactDetails(data)).toEqual([
      { path: "identity.summary", message: EMAIL },
      { path: "experience[0].highlights[1]", message: PHONE },
    ]);
  });

  it("reports mailto and tel links, and numbers inside other links", () => {
    const links = [
      { label: "Email", url: "mailto:someone" },
      { label: "Phone", url: "tel:5550100" },
      { label: "Chat", url: "https://chat.example.com/5550100199" },
    ];

    expect(findContactDetails({ links })).toEqual([
      { path: "links[0].url", message: EMAIL },
      { path: "links[1].url", message: PHONE },
      { path: "links[2].url", message: PHONE },
    ]);
  });

  it("checks fields the schema would reject", () => {
    expect(findContactDetails({ identity: { phone: "555.010.0199" } })).toEqual([
      { path: "identity.phone", message: PHONE },
    ]);
  });

  it("does not report dates, years, counts, short ids, or ordinary links", () => {
    const data = {
      experience: [
        {
          start: "2024-01",
          end: "2025-10",
          summary: "From 2021 to 2023, built modules used by 10+ enterprise clients.",
          links: [
            { label: "Activity", url: "https://example.com/u?from=2025-01-01&to=2025-12-31" },
            { label: "Issue", url: "https://example.com/issues/335331" },
            { label: "Profile", url: "https://example.com/@jordan" },
          ],
        },
      ],
    };

    expect(findContactDetails(data)).toEqual([]);
  });

  it("uses the 10 to 15 digit range for phone numbers", () => {
    expect(findContactDetails(["555 010 019"])).toEqual([]);
    expect(findContactDetails(["555 010 0199"])).toEqual([{ path: "[0]", message: PHONE }]);
    expect(findContactDetails(["1234567890123456"])).toEqual([]);
  });

  it("reports a string at the root with an empty path, and nothing for non-text values", () => {
    expect(findContactDetails("jordan@example.com")).toEqual([{ path: "", message: EMAIL }]);
    expect(findContactDetails(5550100199)).toEqual([]);
    expect(findContactDetails(null)).toEqual([]);
    expect(findContactDetails(undefined)).toEqual([]);
  });

  it("stops at cycles instead of looping", () => {
    const data: Record<string, unknown> = { note: "jordan@example.com" };
    data.self = data;

    expect(findContactDetails(data)).toEqual([{ path: "note", message: EMAIL }]);
  });
});
