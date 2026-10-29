import { readFile } from "node:fs/promises";
import path from "node:path";
import { type PreparedAnswer, parsePreparedAnswers } from "@promptfolio/ai";

/** Directory containing profile JSON files, relative to the app root. */
const PROFILE_DIR = path.join(process.cwd(), "profile");

/**
 * The prepared-answers file that belongs to a profile file: `.json` becomes `.answers.json`
 * (`example.profile.json` → `example.profile.answers.json`). Derived from the profile file
 * name, which `loadAppProfile` has already checked to be a plain name inside `profile/`.
 */
export function preparedAnswersFileName(profileFileName: string): string {
  return profileFileName.endsWith(".json")
    ? `${profileFileName.slice(0, -".json".length)}.answers.json`
    : `${profileFileName}.answers.json`;
}

export interface LoadPreparedAnswersOptions {
  /** Defaults to `profile/` in the app. */
  dir?: string;
  logger?: Pick<Console, "error">;
}

/**
 * Reads the prepared answers for a profile file. Server-only: uses the filesystem.
 *
 * Never fails: a missing file means "no prepared answers", and an unreadable or invalid file
 * is logged (without its contents) and also gives none, so every question is answered live.
 */
export async function loadPreparedAnswers(
  profileFileName: string,
  { dir = PROFILE_DIR, logger = console }: LoadPreparedAnswersOptions = {},
): Promise<PreparedAnswer[]> {
  const fileName = preparedAnswersFileName(profileFileName);

  let text: string;
  try {
    text = await readFile(path.join(dir, fileName), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      logger.error(`[chat] prepared answers ${fileName} are unreadable; answering live`);
    }
    return [];
  }

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    logger.error(`[chat] prepared answers ${fileName} are not valid JSON; answering live`);
    return [];
  }

  const parsed = parsePreparedAnswers(data);
  if (!parsed.ok) {
    logger.error(`[chat] prepared answers ${fileName} are invalid; answering live`, {
      issues: parsed.issues.slice(0, 5),
    });
    return [];
  }
  return parsed.answers;
}
