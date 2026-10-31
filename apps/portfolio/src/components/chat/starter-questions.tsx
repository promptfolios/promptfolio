"use client";

import { useAui } from "@assistant-ui/react";
import type { StarterQuestion } from "@promptfolio/ai";
import type { FC } from "react";

/** Each label is drawn as plain text, and a click sends its question like a typed message. */
export const StarterQuestions: FC<{ starters: StarterQuestion[] }> = ({ starters }) => {
  const aui = useAui();
  if (starters.length === 0) return null;
  return (
    <fieldset
      aria-label="Suggested questions"
      className="mx-auto flex max-w-136 min-w-0 flex-wrap items-center justify-center gap-2"
    >
      {starters.map(({ label, question }) => (
        <button
          key={label}
          type="button"
          title={question}
          className="border-foreground/10 bg-background text-muted-foreground hover:border-foreground/25 hover:text-foreground focus-visible:ring-ring/50 h-8 cursor-pointer rounded-md border px-3 text-[13px] transition-colors outline-none focus-visible:ring-[3px]"
          onClick={() => aui.thread().append(question)}
        >
          {label}
        </button>
      ))}
    </fieldset>
  );
};
