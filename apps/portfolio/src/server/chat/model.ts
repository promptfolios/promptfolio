import "server-only";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import {
  CHAT_LIMITS,
  type ChatLimitOverrides,
  type ChatProviderOptions,
  createFailoverModel,
  type FailoverEntry,
} from "@promptfolio/ai";
import { createGateway } from "ai";
import type { AppEnv } from "../shared/env";

export type ChatProviderName = "google" | "anthropic" | "openrouter" | "gateway";

interface ProviderConfig {
  /** Environment variable holding the provider's API key. */
  keyVar: string;
  defaultModelId: string;
  createModel(apiKey: string, modelId: string): FailoverEntry["model"];
  providerOptions: ChatProviderOptions;
}

/**
 * How long a model that is not the last on the list may take to send its first content. Long enough
 * for a working provider, and short enough that the next one can still answer within the time limits.
 */
const ATTEMPT_FIRST_CHUNK_MS = 8_000;

/**
 * Supported providers. Short portfolio answers need little thinking, and thinking tokens
 * count against the output cap, so all run with low thinking.
 */
const PROVIDERS: Record<ChatProviderName, ProviderConfig> = {
  google: {
    keyVar: "GOOGLE_GENERATIVE_AI_API_KEY",
    defaultModelId: "gemini-3.5-flash-lite",
    createModel: (apiKey, modelId) => createGoogleGenerativeAI({ apiKey })(modelId),
    providerOptions: { google: { thinkingConfig: { thinkingLevel: "low" } } },
  },
  anthropic: {
    keyVar: "ANTHROPIC_API_KEY",
    defaultModelId: "claude-haiku-5-5",
    createModel: (apiKey, modelId) => createAnthropic({ apiKey })(modelId),
    // Do not set temperature/top_p/top_k: Anthropic rejects them.
    providerOptions: { anthropic: { effort: "low" } },
  },
  openrouter: {
    keyVar: "OPENROUTER_API_KEY",
    // A free model: no credits needed, but daily quotas apply and free models come and go.
    defaultModelId: "google/gemma-4-31b-it:free",
    createModel: (apiKey, modelId) => createOpenRouter({ apiKey }).chat(modelId),
    // This adapter ignores the call-level `reasoning` option, so it is set here. OpenRouter
    // drops it for models without reasoning.
    providerOptions: { openrouter: { reasoning: { effort: "low" } } },
  },
  gateway: {
    keyVar: "AI_GATEWAY_API_KEY",
    // A $0 model. None of its upstreams agrees not to train on prompts, so
    // `gateway.disallowPromptTraining` is not set: the gateway would refuse every request.
    defaultModelId: "nvidia/nemotron-3.5-lightning-free",
    // The key is passed explicitly, so an ambient VERCEL_OIDC_TOKEN is never used.
    createModel: (apiKey, modelId) => createGateway({ apiKey })(modelId),
    // The gateway runs the upstream provider and passes its options through by vendor name.
    // Models from other vendors keep their default reasoning.
    providerOptions: {
      anthropic: { effort: "low" },
      google: { thinkingConfig: { thinkingLevel: "low" } },
    },
  },
};

/** Used when PROMPTFOLIO_MODEL is not set: the first provider whose key is set. */
const FALLBACK_ORDER: readonly ChatProviderName[] = [
  "google",
  "anthropic",
  "openrouter",
  "gateway",
];

interface CreatedChatModel {
  ok: true;
  provider: ChatProviderName;
  model: FailoverEntry["model"];
  modelId: string;
  providerOptions: ChatProviderOptions;
  /** For a list of models: what the chat request needs so that moving on works. */
  limits?: ChatLimitOverrides;
}

export type ChatModelResult = CreatedChatModel | { ok: false; problem: string };

export interface CreateChatModelOptions {
  /** `false` uses only the first model on a list, so an evaluation reports on one model. */
  failover?: boolean;
}

/**
 * Creates the chat model from environment variables. Server-only: API keys must never
 * reach the browser, and importing this module from client code fails the build.
 *
 * `PROMPTFOLIO_MODEL=provider:model` (for example `google:gemini-3.5-flash-lite`) selects both;
 * `provider` alone uses that provider's default model. Only the first `:` separates them, so
 * OpenRouter ids keep their own suffix (`openrouter:google/gemma-4-31b-it:free`). Without
 * it, the first provider whose key is set is used with its default model.
 *
 * A comma-separated list moves to the next model when one fails before its answer starts. A list is
 * always written out, because a fallback receives the visitor's conversation. An entry that cannot
 * be used is logged and skipped, so one missing key does not stop the others.
 *
 * Checked per request rather than at startup, so the app builds and renders without a key. Per
 * request is also what a failover model needs, because it stays on the model that worked for one turn.
 */
export function createChatModel(
  env: AppEnv = process.env,
  { failover = true }: CreateChatModelOptions = {},
): ChatModelResult {
  const settings = (env.PROMPTFOLIO_MODEL ?? "")
    .split(",")
    .map((setting) => setting.trim())
    .filter(Boolean);
  const [first] = settings;
  if (first === undefined) {
    const provider = FALLBACK_ORDER.find((name) => env[PROVIDERS[name].keyVar]?.trim());
    if (!provider) {
      const keyVars = FALLBACK_ORDER.map((name) => PROVIDERS[name].keyVar).join(" or ");
      return { ok: false, problem: `no model API key is set (${keyVars})` };
    }
    return create(env, provider, PROVIDERS[provider].defaultModelId);
  }
  if (!failover || settings.length === 1) return fromSetting(env, first);

  const usable: CreatedChatModel[] = [];
  const problems: string[] = [];
  for (const setting of settings) {
    const created = fromSetting(env, setting);
    if (created.ok) usable.push(created);
    else problems.push(created.problem);
  }
  const [firstUsable] = usable;
  if (firstUsable === undefined) return { ok: false, problem: problems.join("; ") };
  for (const problem of problems) console.warn(`[chat] skipping a model: ${problem}`);
  if (usable.length === 1) return firstUsable;

  const entries = usable.map((created) => ({
    label: `${created.provider}:${created.modelId}`,
    model: created.model,
  }));
  return {
    ok: true,
    provider: firstUsable.provider,
    model: createFailoverModel({ models: entries, attemptFirstChunkMs: ATTEMPT_FIRST_CHUNK_MS }),
    modelId: entries.map((entry) => entry.label).join(","),
    // Options are per vendor, so they can sit together. The earlier model wins a clash.
    providerOptions: Object.assign(
      {},
      ...usable.toReversed().map((created) => created.providerOptions),
    ),
    limits: {
      // A retry would run the whole list again, and the next model is a better retry.
      maxRetries: 0,
      // This limit cancels the whole call, so it must leave room for every attempt before the last.
      timeouts: {
        firstChunkMs:
          ATTEMPT_FIRST_CHUNK_MS * (usable.length - 1) + CHAT_LIMITS.timeouts.firstChunkMs,
      },
    },
  };
}

function fromSetting(env: AppEnv, setting: string): ChatModelResult {
  const separator = setting.indexOf(":");
  const providerName = separator === -1 ? setting : setting.slice(0, separator);
  const modelId = separator === -1 ? "" : setting.slice(separator + 1).trim();
  if (!isProviderName(providerName)) {
    const names = Object.keys(PROVIDERS).join(" or ");
    return {
      ok: false,
      problem: `PROMPTFOLIO_MODEL must be "provider:model" with provider ${names}, got "${setting}"`,
    };
  }
  return create(env, providerName, modelId || PROVIDERS[providerName].defaultModelId);
}

function create(env: AppEnv, provider: ChatProviderName, modelId: string): ChatModelResult {
  const config = PROVIDERS[provider];
  const apiKey = env[config.keyVar]?.trim();
  if (!apiKey) {
    return {
      ok: false,
      problem: `PROMPTFOLIO_MODEL selects ${provider}, but ${config.keyVar} is not set`,
    };
  }
  return {
    ok: true,
    provider,
    model: config.createModel(apiKey, modelId),
    modelId,
    providerOptions: config.providerOptions,
  };
}

function isProviderName(name: string): name is ChatProviderName {
  return Object.hasOwn(PROVIDERS, name);
}
