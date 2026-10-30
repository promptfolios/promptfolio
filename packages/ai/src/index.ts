/**
 * Public entry point of `@promptfolio/ai`. Server-only.
 *
 * Only what is exported here is part of the public API.
 */
export {
  type ChatHandlerOptions,
  type ChatLogger,
  type ChatProviderOptions,
  type ChatTimeouts,
  genericErrorMessage,
  handleChatRequest,
} from "./chat-handler";
export type { ChatLimit, ChatTurnDecision, ChatTurnLimiter } from "./chat-limit";
export { type ChatSources, type CitedSource, citedIds, type SourceEvidence } from "./citations";
export { CHAT_LIMITS } from "./limits";
export {
  type GeneratePreparedAnswerOptions,
  type GeneratePreparedAnswerResult,
  generatePreparedAnswer,
  type ParsePreparedAnswersResult,
  PREPARED_ANSWER_LIMITS,
  type PreparedAnswer,
  type PreparedAnswerRejection,
  type PreparedAnswersFile,
  parsePreparedAnswers,
  profileFingerprint,
} from "./prepared-answers";
export { buildSystemPrompt, type SystemPromptOptions } from "./system-prompt";
