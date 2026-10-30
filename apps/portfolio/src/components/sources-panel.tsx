import type { FC } from "react";
import { chatSourcesSchema } from "@/chat/sources";

function unverifiedNote(count: number): string {
  return count === 1
    ? "1 citation could not be matched to a lookup in this answer."
    : `${count} citations could not be matched to a lookup in this answer.`;
}

/**
 * Where an answer's cited facts come from, built by the server from profile records. It is drawn
 * apart from the answer's text, so a section the model writes cannot pass for it. Everything is
 * shown as plain text: record names can come from public sources.
 */
export const SourcesPanel: FC<{ data: unknown }> = ({ data }) => {
  const parsed = chatSourcesSchema.safeParse(data);
  if (!parsed.success) return null;
  const { sources, unverifiedCitations } = parsed.data;
  if (sources.length === 0 && unverifiedCitations === 0) return null;

  return (
    <div
      data-slot="sources-panel"
      className="border-border/60 text-muted-foreground mt-3 border-t pt-2 text-xs"
    >
      {sources.length > 0 && (
        <details open>
          <summary className="cursor-pointer font-medium">Sources ({sources.length})</summary>
          <ol className="mt-1.5 ms-4 flex list-decimal flex-col gap-1.5">
            {sources.map((source) => (
              <li
                key={source.id}
                data-source-id={source.id}
                // A citation marker moves focus here, which also scrolls to it and highlights it.
                tabIndex={-1}
                className="focus:bg-accent rounded outline-none"
              >
                <span className="text-foreground break-words">{source.record}</span>
                {source.evidence.map((evidence) => (
                  <div key={`${evidence.source}:${evidence.basis}`}>
                    {evidence.basis} · {evidence.source} · observed{" "}
                    {evidence.observedAt.slice(0, 10)}
                  </div>
                ))}
              </li>
            ))}
          </ol>
        </details>
      )}
      {unverifiedCitations > 0 && <p className="mt-1.5">{unverifiedNote(unverifiedCitations)}</p>}
    </div>
  );
};
