"use client";

import { useChat } from "@ai-sdk/react";
import { useAISDKRuntime } from "@assistant-ui/ai-sdk";
import {
  AssistantRuntimeProvider,
  useAuiState,
  useRemoteThreadListRuntime,
} from "@assistant-ui/react";
import type { StarterQuestion } from "@promptfolio/ai";
import { MenuIcon, MessagesSquareIcon, PanelLeftIcon, XIcon } from "lucide-react";
import { type FC, useEffect, useMemo, useState } from "react";
import {
  createChatTransport,
  createServerThreadListAdapter,
  useStableThread,
} from "@/chat/threads/server-thread-list-adapter";
import { Thread } from "@/components/assistant-ui/elements/thread.aui";
import { ThreadList } from "@/components/assistant-ui/elements/thread-list.aui";
import { ProfileLinksProvider } from "@/components/chat/profile-link";
import { StarterQuestions } from "@/components/chat/starter-questions";
import { ContactDialog } from "@/components/contact/contact-dialog";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * Runtime for a single thread, called by the thread-list runtime once per thread:
 * an AI SDK chat, adapted for assistant-ui. (`useChatRuntime` would bundle this, but it
 * manages its own thread list and cannot use our adapter.) Its transport names this
 * thread, because the server holds the conversation.
 */
function useThreadRuntime() {
  const getThread = useStableThread();
  const transport = useMemo(() => createChatTransport(getThread), [getThread]);
  const chat = useChat({ transport });
  // The runtime offers file attachments by default, but the server accepts only text.
  return useAISDKRuntime(chat, { adapters: { attachments: undefined } });
}

/** The open conversation's title, as in the list of conversations. */
const CurrentThreadTitle: FC = () => {
  const title = useAuiState((s) => s.threadListItem.title);
  return <h1 className="truncate text-sm font-medium">{title || "New chat"}</h1>;
};

export interface ChatWorkspaceProps {
  ownerName: string;
  headline: string;
  /** Whether the server has a complete contact configuration. */
  contactEnabled: boolean;
  /** The URLs answers may link to. All of them are public profile data. */
  profileLinks: string[];
  /** Written by the model when the page was built. */
  starters: StarterQuestion[];
  /** How many days the server keeps a conversation after its last message. */
  retentionDays: number;
}

/**
 * The chat workspace: a list of conversations and the active conversation.
 * Thread state and switching are managed by assistant-ui; conversations are kept on the
 * server, under this browser's owner cookie.
 */
export function ChatWorkspace({
  ownerName,
  headline,
  contactEnabled,
  profileLinks,
  starters,
  retentionDays,
}: ChatWorkspaceProps) {
  // The adapter must stay stable across renders.
  const [threadListAdapter] = useState(createServerThreadListAdapter);
  const runtime = useRemoteThreadListRuntime({
    runtimeHook: useThreadRuntime,
    adapter: threadListAdapter,
  });
  // Two separate states: an overlay opened on narrow screens, and a column hidden on wide ones.
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

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
          <div className="mb-6 flex flex-col gap-1.5 px-2 text-center">
            <p className="text-[1.5rem] leading-snug font-[550] tracking-[-0.01em] text-balance lg:text-[1.75rem]">
              Ask about {ownerName}
            </p>
            <p className="text-muted-foreground text-sm text-balance">{headline}</p>
          </div>
        );
      },
    [ownerName, headline],
  );

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <TooltipProvider>
        <ProfileLinksProvider urls={profileLinks}>
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
              className={`${sidebarOpen ? "flex" : "hidden"} ${sidebarCollapsed ? "md:hidden" : "md:flex"} bg-sidebar fixed inset-y-0 left-0 z-20 w-64 max-w-[85vw] flex-col border-r md:static`}
            >
              <div className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
                <MessagesSquareIcon className="size-4 shrink-0" aria-hidden />
                <span className="truncate text-sm font-medium">{ownerName}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Hide conversations"
                  className="ml-auto md:hidden"
                  onClick={() => setSidebarOpen(false)}
                >
                  <XIcon />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Hide conversations"
                  className="ml-auto hidden md:inline-flex"
                  onClick={() => setSidebarCollapsed(true)}
                >
                  <PanelLeftIcon />
                </Button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-3">
                <ThreadList />
              </div>
              <p className="text-muted-foreground border-t px-4 py-3 text-xs">
                Conversations are kept on this site's server for {retentionDays} days after the last
                message, for this browser only. You can delete them from this list.
              </p>
            </nav>
            <main className="flex min-w-0 flex-1 flex-col">
              <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="md:hidden"
                  aria-controls="conversations"
                  aria-expanded={sidebarOpen}
                  aria-label="Show conversations"
                  onClick={() => setSidebarOpen(true)}
                >
                  <MenuIcon />
                </Button>
                {sidebarCollapsed && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="hidden md:inline-flex"
                    aria-controls="conversations"
                    aria-expanded={false}
                    aria-label="Show conversations"
                    onClick={() => setSidebarCollapsed(false)}
                  >
                    <PanelLeftIcon />
                  </Button>
                )}
                <CurrentThreadTitle />
                <div className="ml-auto flex shrink-0 items-center gap-1">
                  {contactEnabled && <ContactDialog ownerName={ownerName} />}
                  <ThemeToggle />
                </div>
              </header>
              <div className="min-h-0 flex-1">
                <Thread
                  Welcome={Welcome}
                  newChatFooter={<StarterQuestions starters={starters} />}
                />
              </div>
            </main>
          </div>
        </ProfileLinksProvider>
      </TooltipProvider>
    </AssistantRuntimeProvider>
  );
}
