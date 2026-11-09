import assert from "node:assert/strict";
import {
  CHAT_LIMITS,
  type ChatHistory,
  createFailoverModel,
  createMemoryChatStore,
  handleChatRequest,
} from "@promptfolio/ai";
import { evaluateQuestion, scoreEvaluationTurn } from "@promptfolio/ai/evaluation";
import { loadStructuredProfile, type Profile, profileFingerprint } from "@promptfolio/core";
import { mergeGitHubSnapshot, parseGitHubConfig } from "@promptfolio/source-github";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";

/*
 * What an outside project does with the packages, run by `scripts/test-tarballs.mjs` against
 * installed tarballs: type-checked as a consumer's code would be, then run in Node. It covers every
 * entry point, including a package reading `@promptfolio/core` and the peer dependency on `ai`.
 */

const loaded = loadStructuredProfile(
  { schemaVersion: 1, identity: { name: "Avery", headline: "Engineer", summary: "Builds tools." } },
  { sourceId: "owner", label: "Owner", observedAt: new Date("2026-10-01") },
);
assert.ok(loaded.ok);
const profile: Profile = loaded.profile;
assert.match(await profileFingerprint(profile), /^sha256:/);

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};
const model = () =>
  new MockLanguageModelV4({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "t" },
          { type: "text-delta", id: "t", delta: "Hello from the tarball" },
          { type: "text-end", id: "t" },
          { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage },
        ],
      }),
    }),
  });
const silent = { info: () => {}, error: () => {} };
// One simulated visitor, so a fixed owner is enough.
const history: ChatHistory = { store: createMemoryChatStore(), identifyOwner: async () => "owner" };
const chatRequest = (chatId: string) =>
  new Request("http://localhost/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: chatId,
      message: { id: "u", role: "user", parts: [{ type: "text", text: "Hi" }] },
      parentId: null,
    }),
  });

const response = await handleChatRequest(chatRequest("chat-1"), {
  model: model(),
  profile,
  limit: null,
  history,
  additionalInstructions: "Be brief.",
  limits: { maxSteps: CHAT_LIMITS.maxSteps - 1 },
  logger: silent,
});
assert.equal(response.status, 200);
assert.match(await response.text(), /Hello from the tarball/);

const failing = new MockLanguageModelV4({
  doStream: async () => {
    throw new Error("overloaded");
  },
});
const movedOn = await handleChatRequest(chatRequest("chat-2"), {
  model: createFailoverModel({
    models: [
      { label: "failing", model: failing },
      { label: "working", model: model() },
    ],
    attemptFirstChunkMs: 1_000,
    logger: silent,
  }),
  profile,
  limit: null,
  limits: { maxRetries: 0 },
  history,
  logger: silent,
});
assert.match(await movedOn.text(), /Hello from the tarball/);

const turn = await evaluateQuestion("Hi", { model: model(), profile, logger: silent });
assert.ok(scoreEvaluationTurn(turn, {}).every((check) => check.passed));

const config = parseGitHubConfig({ formatVersion: 1, user: "avery" });
assert.ok(config.ok);
assert.equal(mergeGitHubSnapshot(profile, config.config, {}).ok, false);

console.log("consumer: every entry point works");
