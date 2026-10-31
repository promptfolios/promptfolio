# M12.8 plan: chat layout, with light and dark modes

- **Status:** Done (2026-11-01), in review.
- **Date:** 2026-11-01

## Objective

Match the look of assistant-ui's own demo, keeping Promptfolio's content, and let visitors choose light or dark.

## Scope

- **Sidebar:** the owner's name and a collapse button on wide screens, an outlined New Thread button, and the browser-only
  notice at the bottom. Narrow screens keep the overlay.
- **Top bar:** the open conversation's title, Contact, and the theme button.
- **New chat:** a centred greeting and headline, with the composer below them.
- **Dark colors:** a near-black background, shared by the sidebar and the conversation.
- **Theme:** follows the system until the visitor chooses, then remembers the choice in this browser.

## Exclusions

- The model picker, attachment button, microphone, and sign-in: visitors do not choose a model, send only text, and have no
  accounts.
- Starter chips, removed on purpose in M12.5.
- The demo's outer frame and "Explore other examples" link, which belong to its marketing page.
- "New Thread" keeps its current wording, which was set deliberately.

## Dependency

`next-themes` 0.4.6 keeps the choice and sets the theme before the page paints. It supports React 19. Its last release was
March 2025.

React's development build warns about any `<script>` rendered in the browser, and Next.js renders the tree in the browser
too. A hand-written script in the server layout triggered the warning just the same, so the library was kept. See
[the note](../learning/theme-before-paint.md).

## Verification

- `pnpm verify`.
- In the browser, in light and dark, at desktop and phone widths: the new-chat screen, a saved conversation, the sidebar
  collapse and overlay, and the contact dialog opened but not sent.
- A chosen theme survives a reload, and overrides the system's setting. No console errors on a fresh load.
