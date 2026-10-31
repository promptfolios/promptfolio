import "server-only";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { generateStarterQuestions, type StarterQuestion } from "@promptfolio/ai";
import { type Profile, profileFingerprint } from "@promptfolio/core";
import { z } from "zod";
import { readJsonFile } from "../profile/profile-files";
import type { AppEnv } from "../shared/env";
import { createChatModel } from "./model";

/*
 * Starter questions, generated while `next build` prerenders the page, so no visitor can ever cause
 * a model call. The result is kept in `.next/cache`, which hosts keep between builds, by profile
 * fingerprint: a build with an unchanged profile makes no model call. `next dev` renders per request
 * and uses the same file.
 */

/** Raise this when the prompt changes, so existing profiles get new starters. */
const CACHE_VERSION = 1;
/** After a failure, `next dev` reloads and quick rebuilds do not ask a failing provider again. */
const FAILURE_TTL_MS = 10 * 60_000;

const cachedSchema = z.object({
  starters: z.array(z.object({ label: z.string(), question: z.string() })).max(6),
  expiresAt: z.number().optional(),
});

export interface CachedStartersOptions {
  profile: Profile;
  generate: () => Promise<StarterQuestion[] | undefined>;
  /** Defaults to the build cache. */
  dir?: string;
  now?: () => number;
}

/**
 * The starters for this version of the profile. An empty list means the page shows none, and a page
 * without starters still works, so a failure here never fails the build.
 */
export async function cachedStarterQuestions({
  profile,
  generate,
  dir = path.join(process.cwd(), ".next", "cache", "promptfolio-starters"),
  now = Date.now,
}: CachedStartersOptions): Promise<StarterQuestion[]> {
  const fingerprint = (await profileFingerprint(profile)).replace(":", "-");
  const file = path.join(/* turbopackIgnore: true */ dir, `v${CACHE_VERSION}-${fingerprint}.json`);

  const read = await readJsonFile(file);
  if (read.status === "ok") {
    const cached = cachedSchema.safeParse(read.data);
    if (cached.success && (cached.data.expiresAt ?? Number.POSITIVE_INFINITY) > now()) {
      return cached.data.starters;
    }
  }

  const starters = await generate();
  await writeCache(dir, file, {
    starters: starters ?? [],
    ...(starters === undefined && { expiresAt: now() + FAILURE_TTL_MS }),
  });
  return starters ?? [];
}

/** A cache that cannot be written only means the next build asks again. */
async function writeCache(dir: string, file: string, data: unknown): Promise<void> {
  try {
    await mkdir(/* turbopackIgnore: true */ dir, { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    await writeFile(/* turbopackIgnore: true */ temporary, JSON.stringify(data));
    await rename(/* turbopackIgnore: true */ temporary, file);
  } catch {
    console.warn("[starters] could not write the build cache");
  }
}

/** The starters for a profile. Without a model configured there are none, and no error. */
export async function loadStarterQuestions(
  profile: Profile,
  env: AppEnv = process.env,
): Promise<StarterQuestion[]> {
  const chatModel = createChatModel(env);
  if (!chatModel.ok) return [];
  return cachedStarterQuestions({
    profile,
    generate: () =>
      generateStarterQuestions({
        model: chatModel.model,
        providerOptions: chatModel.providerOptions,
        profile,
      }),
  });
}
