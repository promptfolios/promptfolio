import type { SuggestionConfig } from "@assistant-ui/react";

/**
 * Conversation starters shown on the welcome screen of a new chat. Selecting one sends
 * its prompt as the first message of a real conversation.
 *
 * Profile-independent on purpose: the same starters work for any profile.
 */
export const STARTERS: SuggestionConfig[] = [
  {
    title: "Professional overview",
    label: "who they are and what they do",
    prompt: "Give me a short professional overview.",
  },
  {
    title: "Relevant projects",
    label: "what they have built",
    prompt: "What are the most relevant projects?",
  },
  {
    title: "Technical skills",
    label: "languages, tools, and practices",
    prompt: "What are the main technical skills?",
  },
  {
    title: "Work experience",
    label: "roles and responsibilities",
    prompt: "Summarize the work experience.",
  },
  {
    title: "Open-source work",
    label: "public code and contributions",
    prompt: "What open-source work is there?",
  },
];
