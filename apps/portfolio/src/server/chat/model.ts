import "server-only";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { ChatProviderOptions } from "@promptfolio/ai";
import { createGateway, type LanguageModel } from "ai";
import type { AppEnv } from "../shared/env";

export type ChatProviderName = "google" | "anthropic" | "openrouter" | "gateway";

interface ProviderConfig {
  /** Environment variable holding the provider's API key. */
  keyVar: string;
  defaultModelId: string;
  createModel(apiKey: string, modelId: string): LanguageModel;
  providerOptions: ChatProviderOptions;
}

/**
 * Supported providers. Short portfolio answers need little thinking, and thinking tokens
 * count against the output cap, so all run with low thinking.
 */
const PROVIDERS: Record<ChatProviderName, ProviderConfig> = {
  google: {
    keyVar: "GOOGLE_GENERATIVE_AI_API_KEY",
    defaultModelId: "gemini-3.8-flash",
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

export type ChatModelResult =
  | {
      ok: true;
      provider: ChatProviderName;
      model: LanguageModel;
      modelId: string;
      providerOptions: ChatProviderOptions;
    }
  | { ok: false; problem: string };

/**
 * Creates the chat model from environment variables. Server-only: API keys must never
 * reach the browser, and importing this module from client code fails the build.
 *
 * `PROMPTFOLIO_MODEL=provider:model` (for example `google:gemini-3.8-flash`) selects both;
 * `provider` alone uses that provider's default model. Only the first `:` separates them, so
 * OpenRouter ids keep their own suffix (`openrouter:google/gemma-4-31b-it:free`). Without
 * it, the first provider whose key is set is used with its default model.
 *
 * Checked per request rather than at startup, so the app builds and renders without a key.
 */
export function createChatModel(env: AppEnv = process.env): ChatModelResult {
  const setting = env.PROMPTFOLIO_MODEL?.trim();
  if (!setting) {
    const provider = FALLBACK_ORDER.find((name) => env[PROVIDERS[name].keyVar]?.trim());
    if (!provider) {
      const keyVars = FALLBACK_ORDER.map((name) => PROVIDERS[name].keyVar).join(" or ");
      return { ok: false, problem: `no model API key is set (${keyVars})` };
    }
    return create(env, provider, PROVIDERS[provider].defaultModelId);
  }

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
