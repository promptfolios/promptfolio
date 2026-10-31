import type { GeneratePreparedAnswerResult, PreparedAnswer } from "@promptfolio/ai";
import { describe, expect, it, vi } from "vitest";
import {
  MAX_ATTEMPTS,
  type PrepareAnswersOptions,
  prepareAnswers,
  RETRY_WAIT_MS,
} from "./prepare-answers";

const QUESTIONS = ["One?", "Two?"];

function answer(question: string, text = `Answer to ${question}`): PreparedAnswer {
  return {
    question,
    text,
    profileFingerprint: `sha256:${"a".repeat(64)}`,
    instructionsFingerprint: `sha256:${"b".repeat(64)}`,
    evidenceIds: [],
    model: "mock:model",
    generatedAt: "2026-10-31T00:00:00.000Z",
  };
}

const accepted = (question: string, text?: string): GeneratePreparedAnswerResult => ({
  ok: true,
  answer: answer(question, text),
});
const providerError: GeneratePreparedAnswerResult = { ok: false, reason: "error" };

function setup(overrides: Partial<PrepareAnswersOptions> = {}) {
  const generate = vi.fn(async (question: string) => accepted(question));
  const save = vi.fn(async (_answers: PreparedAnswer[]) => {});
  const sleep = vi.fn(async (_ms: number) => {});
  const options: PrepareAnswersOptions = {
    questions: QUESTIONS,
    existing: [],
    isCurrent: async () => true,
    generate,
    save,
    sleep,
    logger: { log: () => {} },
    ...overrides,
  };
  return { options, generate, save, sleep };
}

describe("prepareAnswers", () => {
  it("generates every starter, in order, and saves after each one", async () => {
    const { options, save, sleep } = setup();

    const result = await prepareAnswers(options);

    expect(result.exitCode).toBe(0);
    expect(result.answers.map((entry) => entry.question)).toEqual(QUESTIONS);
    expect(save).toHaveBeenCalledTimes(2);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("makes no model call for a current answer, and writes nothing if all are kept", async () => {
    const { options, generate, save } = setup({
      existing: [answer("One?"), answer("Two?")],
    });

    const result = await prepareAnswers(options);

    expect(result.exitCode).toBe(0);
    expect(generate).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("regenerates only the stale answer", async () => {
    const { options, generate } = setup({
      existing: [answer("One?", "old"), answer("Two?", "current")],
      isCurrent: async (entry) => entry.text === "current",
    });

    const result = await prepareAnswers(options);

    expect(generate.mock.calls.map(([question]) => question)).toEqual(["One?"]);
    expect(result.answers.map((entry) => entry.text)).toEqual(["Answer to One?", "current"]);
  });

  it("retries a provider error, with the wait, and then succeeds", async () => {
    const generate = vi
      .fn<PrepareAnswersOptions["generate"]>()
      .mockResolvedValueOnce(providerError)
      .mockImplementation(async (question) => accepted(question));
    const { options, sleep } = setup({ generate, questions: ["One?"] });

    const result = await prepareAnswers(options);

    expect(result.exitCode).toBe(0);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledExactlyOnceWith(RETRY_WAIT_MS);
  });

  it("stops after the last attempt, and keeps what earlier starters produced", async () => {
    const generate = vi.fn<PrepareAnswersOptions["generate"]>(async (question) =>
      question === "One?" ? accepted(question) : providerError,
    );
    const { options, save, sleep } = setup({ generate });

    const result = await prepareAnswers(options);

    expect(result.exitCode).toBe(2);
    expect(generate).toHaveBeenCalledTimes(1 + MAX_ATTEMPTS);
    expect(sleep).toHaveBeenCalledTimes(MAX_ATTEMPTS - 1);
    expect(save).toHaveBeenLastCalledWith([answer("One?")]);
  });

  it("does not retry an answer rejected for its content", async () => {
    const generate = vi.fn<PrepareAnswersOptions["generate"]>(async () => ({
      ok: false,
      reason: "unsupported-citation",
      detail: "invented",
    }));
    const { options, sleep } = setup({ generate, questions: ["One?"] });

    const result = await prepareAnswers(options);

    expect(generate).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
    expect(result.exitCode).toBe(1);
  });

  it("with all, regenerates current answers, and keeps one whose replacement fails", async () => {
    const generate = vi.fn<PrepareAnswersOptions["generate"]>(async (question) =>
      question === "One?" ? accepted(question, "new") : providerError,
    );
    const { options } = setup({
      all: true,
      generate,
      existing: [answer("One?", "old"), answer("Two?", "old")],
    });

    const result = await prepareAnswers(options);

    expect(result.answers.map((entry) => entry.text)).toEqual(["new", "old"]);
    expect(result.exitCode).toBe(2);
  });

  it("writes nothing when there are no answers at all", async () => {
    const { options, save } = setup({
      generate: async () => providerError,
      questions: ["One?"],
    });

    const result = await prepareAnswers(options);

    expect(result.exitCode).toBe(1);
    expect(save).not.toHaveBeenCalled();
  });

  it("removes stale answers from the file even if nothing new was accepted", async () => {
    const { options, save } = setup({
      existing: [answer("One?", "current"), answer("Two?", "stale")],
      isCurrent: async (entry) => entry.text === "current",
      generate: async () => providerError,
    });

    const result = await prepareAnswers(options);

    expect(result.exitCode).toBe(2);
    expect(save).toHaveBeenCalledExactlyOnceWith([answer("One?", "current")]);
  });
});
