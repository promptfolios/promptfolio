/**
 * Prepares the answers to the conversation starters for the configured profile and writes
 * them to `profile/<profile>.answers.json`. Run by the owner after changing the profile:
 *
 *   pnpm --filter portfolio prepare-answers
 *
 * Answers that are still current are kept, so a rerun only fills the gaps. A provider error is
 * tried again up to three times, a minute or so apart. Pass `--all` to regenerate every answer,
 * for example after changing model.
 *
 * Uses the same environment as the app (`.env.local`: profile file, model, API key) and the
 * same chat pipeline as a live answer. Read the generated file before committing it: every
 * visitor who selects a starter will see these answers while they are current. Whether the contact
 * form is on changes the prompt, so run this with the same setting as the deployed site.
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  generatePreparedAnswer,
  isPreparedAnswerCurrent,
  type PreparedAnswersFile,
} from "@promptfolio/ai";
import { STARTERS } from "../src/config/starters";
import { isContactEnabled } from "../src/server/contact";
import { createChatModel } from "../src/server/model";
import { prepareAnswers } from "../src/server/prepare-answers";
import { loadPreparedAnswers, preparedAnswersFileName } from "../src/server/prepared-answers";
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
  const { profile } = result;
  const modelLabel = `${chatModel.provider}:${chatModel.modelId}`;
  const contactFormAvailable = isContactEnabled();
  console.log(`Preparing ${STARTERS.length} answers for ${fileName} with ${modelLabel}\n`);

  const outFile = preparedAnswersFileName(fileName);
  const { answers, exitCode } = await prepareAnswers({
    questions: STARTERS.map((starter) => (typeof starter === "string" ? starter : starter.prompt)),
    existing: await loadPreparedAnswers(fileName),
    all: process.argv.includes("--all"),
    isCurrent: (answer) => isPreparedAnswerCurrent(answer, profile, { contactFormAvailable }),
    generate: (question) =>
      generatePreparedAnswer(question, {
        model: chatModel.model,
        providerOptions: chatModel.providerOptions,
        profile,
        modelLabel,
        contactFormAvailable,
      }),
    save: async (current) => {
      const file: PreparedAnswersFile = { formatVersion: 1, answers: current };
      await writeFile(
        path.join(process.cwd(), "profile", outFile),
        `${JSON.stringify(file, null, 2)}\n`,
      );
    },
  });

  if (exitCode === 1) {
    console.error("\nNo answer is available; the file was not written.");
    return 1;
  }
  console.log(`\n${answers.length} of ${STARTERS.length} answers in profile/${outFile}.`);
  console.log("Rejected starters are answered live. Review the file, then run pnpm lint:fix.");
  return exitCode;
}

process.exitCode = await main();
