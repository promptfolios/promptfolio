/**
 * Refreshes the fetched sources of the configured profile (today: its public GitHub data):
 *
 *   pnpm --filter portfolio refresh
 *
 * Configure once: `profile/<profile>.github.json` with `{ "formatVersion": 1, "user": "…" }`.
 * Uses `.env.local` like the app (`PROMPTFOLIO_PROFILE_FILE`, optional `GITHUB_TOKEN`).
 *
 * Written to run unattended, by hand or from a scheduled job (see
 * docs/guides/scheduled-refresh.md): no prompts, and the exit code says what happened:
 * 0 success, 2 partial (written, with some earlier data kept), 1 failed (nothing written).
 * The snapshot is rewritten only when the profile version changed; the refresh status
 * (`profile/<profile>.refresh-status.json`) is written on every run.
 */
import { runRefresh } from "../src/server/refresh";

const result = await runRefresh({ token: process.env.GITHUB_TOKEN?.trim() || undefined });
process.exitCode = result.exitCode;
