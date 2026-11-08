import "server-only";
import type { ReplyDetails } from "@promptfolio/ai";

/** A model name worth showing: letters, digits, and the punctuation model ids use. */
const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;

/**
 * The model's name as visitors see it, from the id its provider reports or a failover label:
 * `gateway:openai/gpt-4o-mini` and `openai/gpt-4o-mini` both show as `gpt-4o-mini`. The provider,
 * the route (`openai/`), a variant such as `:free`, and a failover list are never shown.
 */
export function modelDisplayName(modelId: string): string | undefined {
  // A failover model's own id lists every label, which is the failover order.
  if (modelId.includes(",")) return undefined;
  // A label starts with `provider:`; an OpenRouter id ends with `:variant`.
  const withoutProvider = /^[a-z]+:/.test(modelId)
    ? modelId.slice(modelId.indexOf(":") + 1)
    : modelId;
  const name = (withoutProvider.split("/").at(-1) ?? "").split(":")[0] ?? "";
  return MODEL_NAME.test(name) ? name : undefined;
}

/** What visitors see besides the answer: each lookup, and the model that answered. */
export const CHAT_REPLY_DETAILS: ReplyDetails = { tools: true, model: modelDisplayName };
