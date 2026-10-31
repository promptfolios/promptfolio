import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@assistant-ui/react", () => ({
  useAui: () => ({ thread: () => ({ append: () => {} }) }),
}));

const { StarterQuestions } = await import("./starter-questions");

describe("StarterQuestions", () => {
  it("shows each label, with its question as the title", () => {
    const html = renderToStaticMarkup(
      <StarterQuestions starters={[{ label: "Projects", question: "What has Jordan built?" }]} />,
    );

    expect(html).toContain(">Projects</button>");
    expect(html).toContain('title="What has Jordan built?"');
  });

  it("draws text as text, not markup", () => {
    const html = renderToStaticMarkup(
      <StarterQuestions starters={[{ label: "<b>Bold</b>", question: "What?" }]} />,
    );

    expect(html).not.toContain("<b>");
  });

  it("shows nothing without starters", () => {
    expect(renderToStaticMarkup(<StarterQuestions starters={[]} />)).toBe("");
  });
});
