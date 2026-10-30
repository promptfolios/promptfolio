/**
 * Prepares the answers to the conversation starters for the configured profile and writes
 * them to `profile/<profile>.answers.json`. Run by the owner after changing the profile:
 *
 *   pnpm --filter portfolio prepare-answers
 *
 * Uses the same environment as the app (`.env.local`: profile file, model, API key) and the
 * same chat pipeline as a live answer. Read the generated file before committing it: every
 * visitor who selects a starter will see these answers while they are current.
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  generatePreparedAnswer,
  type PreparedAnswer,
  type PreparedAnswersFile,
} from "@promptfolio/ai";
import { STARTERS } from "../src/config/starters";
import { isContactEnabled } from "../src/server/contact";
import { createChatModel } from "../src/server/model";
import { preparedAnswersFileName } from "../src/server/prepared-answers";
import { loadAppProfile } from "../src/server/profile";

async function main(): Promise<number> {
  const chatModel = createChatModel();
  if (!chatModel.ok) {
    console.error(`Model not configured: ${chatModel.problem}`);
    return 1;
  }
  const { fileName, result } = await loadAppProfile();
  if (!result.ok) {
    console.error(`Profile ${fileName} could not be loaded:`, result.issues);
    return 1;
  }
  const modelLabel = `${chatModel.provider}:${chatModel.modelId}`;
  console.log(`Preparing ${STARTERS.length} answers for ${fileName} with ${modelLabel}\n`);

  // One at a time: each answer takes several model calls, and free tiers limit requests per minute.
  const answers: PreparedAnswer[] = [];
  for (const starter of STARTERS) {
    const question = typeof starter === "string" ? starter : starter.prompt;
    const generated = await generatePreparedAnswer(question, {
      model: chatModel.model,
      providerOptions: chatModel.providerOptions,
      profile: result.profile,
      modelLabel,
      contactFormAvailable: isContactEnabled(),
    });
    if (generated.ok) {
      answers.push(generated.answer);
      console.log(`  accepted  ${question}`);
    } else {
      const detail = generated.detail ? ` (${generated.detail})` : "";
      console.log(`  rejected  ${question}: ${generated.reason}${detail}`);
    }
  }

  if (answers.length === 0) {
    console.error("\nNo answer was accepted; the file was not written.");
    return 1;
  }
  const outFile = preparedAnswersFileName(fileName);
  const file: PreparedAnswersFile = { formatVersion: 1, answers };
  await writeFile(
    path.join(process.cwd(), "profile", outFile),
    `${JSON.stringify(file, null, 2)}\n`,
  );
  console.log(`\nWrote ${answers.length} of ${STARTERS.length} answers to profile/${outFile}.`);
  console.log("Rejected starters are answered live. Review the file, then run pnpm lint:fix.");
  return answers.length === STARTERS.length ? 0 : 2;
}

process.exitCode = await main();
