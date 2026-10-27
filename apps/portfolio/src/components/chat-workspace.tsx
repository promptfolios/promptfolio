"use client";

import {
  AssistantRuntimeProvider,
  AuiConfig,
  Suggestions,
  useLocalRuntime,
  useRemoteThreadListRuntime,
} from "@assistant-ui/react";
import { MenuIcon, XIcon } from "lucide-react";
import { type FC, useEffect, useMemo, useState } from "react";
import { createPlaceholderModel } from "@/chat/placeholder-model";
import { TitledInMemoryThreadListAdapter } from "@/chat/thread-list-adapter";
import { Thread } from "@/components/assistant-ui/elements/thread.aui";
import { ThreadList } from "@/components/assistant-ui/elements/thread-list.aui";
import { TooltipProvider } from "@/components/ui/tooltip";
import { STARTERS } from "@/config/starters";

const placeholderModel = createPlaceholderModel();
const config = AuiConfig({ suggestions: Suggestions(STARTERS) });

/** Runtime for a single thread. Called by the thread-list runtime once per thread. */
function useThreadRuntime() {
  return useLocalRuntime(placeholderModel);
}

export interface ChatWorkspaceProps {
  ownerName: string;
  headline: string;
}

/**
 * The chat workspace: a list of conversations and the active conversation.
 * Thread state and switching are managed by assistant-ui; threads live in memory
 * and reset on reload (persistence is planned for M6).
 */
export function ChatWorkspace({ ownerName, headline }: ChatWorkspaceProps) {
  // The adapter must stay stable across renders.
  const [threadListAdapter] = useState(() => new TitledInMemoryThreadListAdapter());
  const runtime = useRemoteThreadListRuntime({
    runtimeHook: useThreadRuntime,
    adapter: threadListAdapter,
  });
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // On narrow screens the sidebar is an overlay; Escape closes it.
  useEffect(() => {
    if (!sidebarOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSidebarOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [sidebarOpen]);

  // Created once per owner, so React does not remount the welcome screen on every render.
  const Welcome = useMemo<FC>(
    () =>
      function Welcome() {
        return (
          <div className="mb-6 flex flex-col gap-1 px-2">
            <p className="text-2xl font-medium tracking-tight">Ask about {ownerName}</p>
            <p className="text-muted-foreground">{headline}</p>
          </div>
        );
      },
    [ownerName, headline],
  );

  return (
    <AssistantRuntimeProvider runtime={runtime} config={config}>
      <TooltipProvider>
        <div className="flex h-dvh">
          {sidebarOpen && (
            <button
              type="button"
              aria-label="Close conversations"
              tabIndex={-1}
              className="fixed inset-0 z-10 bg-black/30 md:hidden"
              onClick={() => setSidebarOpen(false)}
            />
          )}
          <nav
            id="conversations"
            aria-label="Conversations"
            className={`${sidebarOpen ? "flex" : "hidden"} bg-sidebar fixed inset-y-0 left-0 z-20 w-72 max-w-[85vw] flex-col gap-2 border-r p-3 md:static md:flex`}
          >
            <button
              type="button"
              aria-label="Hide conversations"
              className="self-end rounded-md p-1 md:hidden"
              onClick={() => setSidebarOpen(false)}
            >
              <XIcon className="size-5" />
            </button>
            <ThreadList />
          </nav>
          <main className="flex min-w-0 flex-1 flex-col">
            <header className="flex items-center gap-2 border-b px-4 py-2">
              <button
                type="button"
                className="rounded-md p-1 md:hidden"
                aria-controls="conversations"
                aria-expanded={sidebarOpen}
                aria-label="Show conversations"
                onClick={() => setSidebarOpen(true)}
              >
                <MenuIcon className="size-5" />
              </button>
              <span className="font-medium">{ownerName}</span>
              <span className="text-muted-foreground truncate text-sm">· Promptfolio</span>
            </header>
            <div className="min-h-0 flex-1">
              <Thread components={{ Welcome }} />
            </div>
          </main>
        </div>
      </TooltipProvider>
    </AssistantRuntimeProvider>
  );
}
