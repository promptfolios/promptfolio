# M12.10 plan: build-time starters and assistant-ui styling

- **Status:** Done (2026-11-01), in review.
- **Date:** 2026-11-01
- **Decision:** [ADR 0015](../adr/0015-generated-starter-questions.md). Replaces the runtime route from
  [M12.9](m12-9-generated-starter-questions.md).

## Objective

Generate starters while the site is built, so no visitor can cause the model call and nothing moves on load, and match the styling
of assistant-ui's own demo.

## Scope

- **Generation:** `page.tsx` generates while prerendering, cached in `.next/cache` by profile fingerprint.
- **Removed:** `/api/starters`, the browser fetch, the Redis store, and the lock.
- **Starters:** a short label and a full question each, six of them, asking broadly rather than about one repository.
- **Styling,** using values measured from the live site: a 28 px heading (24 px on smaller screens) at weight 550, a message box
  with 16 px corners and its send button on its own row, a 28 px send button with 8 px corners, and 32 px chips with 13 px text.

## Exclusions

- The focus ring on the message box stays, because it was added deliberately. The demo only darkens its border.
- No model picker, attachment button, or microphone.

## Verification

- `pnpm verify`.
- Real builds: `/` stayed static (`○`), and the labels were in the raw HTML. A second build left the cache untouched. A build with
  a bad key succeeded with no chips, and logged only the error's type.
- In the browser: dark on desktop and light on a phone, and a click sent the full question. The only layout shift left is the
  sidebar's placeholder, about 0.003.
