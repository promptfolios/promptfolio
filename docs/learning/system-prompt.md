# System prompt

First appears in: **M4** (first AI integration). Status: **planned**.

## 1. What it is

The system prompt is the instruction text sent to the model alongside the conversation, separate
from the visitor's messages. It sets the assistant's role and rules ("answer about this profile
only; say when something is not in the profile") and, in Promptfolio, carries the profile context.

## 2. Why it matters in Promptfolio

It is where the "don't invent facts" requirement is first expressed to the model, and where the
profile's records and their basis are presented. But it is guidance, not enforcement: the spec and
`CLAUDE.md` both say a prompt is not an authorization boundary.

## 3. How it works

Planned shape for M4: the server builds the system prompt; the browser never supplies it.

```mermaid
flowchart LR
    browser["browser"] -- "POST { messages }" --> route["route /api/chat (server)"]
    route --> ignore["ignore any system / tools in the body (untrusted)"]
    route --> system["system = instructions + rendered profile (from loadAppProfile)"]
    route --> request["model request: { system, messages }"]
```

A rendered profile line might look like:

```text
[project service-catalog | self-reported] Service catalog — Built a service catalog used by internal teams.
```

so the model sees the id (for citing) and the basis (for "Jordan reports…" phrasing).

## 4. Where it lives in the code

- Server-side prompt construction: **planned** (M4, `/api/chat` route and `@promptfolio/ai`)
- Profile input it will render: [packages/core/src/profile/types.ts](../../packages/core/src/profile/types.ts)
- Why the client's `system` field must be ignored: [ADR 0007](../adr/0007-chat-ui-assistant-ui.md), consequences

## 5. Common pitfalls and misconceptions

- "The prompt says don't do X, so X can't happen." Models can ignore instructions, and visitor
  messages can try to override them (prompt injection). Limits, tool permissions, and confirmations
  live in code.
- Accepting a system prompt from the browser lets any visitor rewrite the assistant's rules.
- Putting secrets or private configuration in the prompt: assume anything in it can be repeated
  back to a visitor.
- Dumping the whole profile in every request works for a small profile but costs tokens on each
  turn; M5 replaces most of this with tool lookups.

## 6. Further reading

- [AI SDK: prompts (system, messages)](https://ai-sdk.dev/docs/foundations/prompts)
- [Anthropic: giving Claude a role with a system prompt](https://docs.claude.com/en/docs/build-with-claude/prompt-engineering/system-prompts)
  (the model provider is not chosen yet; the concept is the same across providers)
