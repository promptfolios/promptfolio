"use client";

import { useAuiState } from "@assistant-ui/react";
import type { FC, MouseEvent } from "react";
import { citationDisplay } from "@/chat/citation-links";

/** Opens the panel if it is collapsed, and moves to the source's entry, which highlights it. */
function showSource(event: MouseEvent<HTMLButtonElement>, id: string) {
  const entry = event.currentTarget
    .closest('[data-slot="aui_assistant-message-root"]')
    ?.querySelector<HTMLElement>(`[data-source-id="${CSS.escape(id)}"]`);
  const panel = entry?.closest("details");
  if (panel) panel.open = true;
  entry?.focus();
}

/** One citation in an answer's text: a number that leads to its entry in the sources panel. */
export const CitationMarker: FC<{ id: string }> = ({ id }) => {
  const sources = useAuiState((s) => {
    const part = s.message.parts.find((item) => item.type === "data" && item.name === "sources");
    return part?.type === "data" ? part.data : undefined;
  });
  const running = useAuiState((s) => s.message.status?.type === "running");
  const display = citationDisplay(id, sources, running);

  switch (display.kind) {
    case "hidden":
      return null;
    case "raw":
      return <>[{id}]</>;
    case "source":
      return (
        <sup className="ms-0.5">
          <button
            type="button"
            aria-label={`Source ${display.number}: ${display.record}`}
            title={display.record}
            className="cursor-pointer font-medium text-blue-600 hover:underline dark:text-blue-400"
            onClick={(event) => showSource(event, id)}
          >
            {/* Brackets, because neighbouring markers would otherwise read as one number. */}
            {`[${display.number}]`}
          </button>
        </sup>
      );
  }
};
