# Known limitations

What Promptfolio does not do or guarantee, as of M13. Each item says what happens and what limits the damage.

## Answers

- **Nothing answers without the model.** Prepared answers were removed in M12.5, and generated starter questions are answered live. So when the provider
  fails, every question fails, and each one counts against the daily limits.
- **A model can write a tool call as text.** On `nemotron-3.5-lightning`, 2 of 17 answers were literal `<tool_call>`
  text. The server now stops `<tool_call` and `<function=` and shows the generic error, so the visitor gets no answer on
  a turn that still counts. Other models may use other forms, which would still get through.
- **The chosen model failed its evaluation.** The developer moved to `gateway:openai/gpt-4o-mini` by 2026-11-02, because
  `ling-3.1-flash-1019` timed out more often in use and kept reaching the 2,000-token limit on the open-source contributions
  question. Mini is a priced model, so its calls draw on AI Gateway credit. In its run, all 3 forged-history answers repeated
  the forged award as fact. A visitor can only forge their own conversation, so this misleads that visitor or a screenshot,
  not others. One of 6 injection runs printed the injected README, though not as a link. 11 of 95 attempts hit a rate limit
  or timeout, and a visitor gets no script retry. Answers also called internal and unlicensed work open source.
  See [the evaluation](evaluation/README.md#the-run-on-gpt-4o-mini-failed-the-gate).
- **Ling failed its evaluation.** About 1 in 3 recorded attempts timed out or hit a rate limit. One of 6 injection runs quoted
  injected text while refusing it, and answers could narrate, mention injected text unprompted, and add their own sources.
  See [the evaluation](evaluation/README.md#the-run-on-ling-failed-the-gate).
- **A link is not proof that a sentence is right.** It shows the record exists. It cannot show that the record supports the
  sentence, and the model can attach a real profile URL to the wrong name.
- **Nothing shows which record a fact relies on.** Removing citations in M12.7 means a claim with no support shows no
  warning, and no count records it. Roles, education, and the identity summary usually have no URL, so they carry no link.
  Model text streams as it arrives, so it cannot be corrected afterwards. See
  [ADR 0014](adr/0014-markdown-links-instead-of-sources-panel.md).
- **A failed starter generation lasts until the next build.** That page has no chips.
- **A starter question can get a bad answer.** Questions are written without any lookup, and a click is answered like anything
  typed. In the first test of M12.9, "Which languages does Amanx5 use in the ecommerce repository?" got the answer that no such repository
  is in the profile, after one lookup, though there is one. A question can also assume something, such as a role in a repository.
  See [ADR 0015](adr/0015-generated-starter-questions.md).
- **The basis and observation date show only when asked.** They remain in every tool result.
- **Long answers can be cut off.** On a real profile with many repositories, an answer can reach the whole-reply limit, now 55
  seconds, which shows the error after the text so far. Or it can reach the 2,000-token
  limit per step and simply stop. A prompt rule asking for short answers would be the fix, and would need a new evaluation.
- **Threads saved before M12.7 show raw `[record-id]` text** in their old answers.
- **The evaluation is small.** It covers one fictional profile. The full set on the final prompt ran on one model, which
  failed, and the default model has not been run.
- **Prompt rules guide the model and enforce nothing.** Anything that must hold is enforced in code; wording rules,
  such as what counts as open source, can still be broken.

- **A consumer's `additionalInstructions` can make answers worse.** They guide the model and widen nothing it can do, but
  the evaluation here says nothing about a consumer's own text or model.
- **Everything in the prompt is English.** A consumer can ask for answers in another language, which no run has tried.

## Packages

- **Not on npm yet.** They are `private: true` until the publishing milestone.
- **One AI SDK.** `@promptfolio/ai` works with the Vercel AI SDK only; see
  [the future idea](ROADMAP.md#supporting-other-ai-sdks).
- **Only the newest matching `ai` is tested** in the tarball test, and 7.0.154 in the workspace. Versions in between are not.
- **A logger that throws can still reject `handleChatRequest`.** Every other failure before the stream starts returns a `Response`.
- **Package tests use saved GitHub responses,** so they cannot notice GitHub changing. A live refresh is on the release
  checklist.

## Abuse and cost

- **A visitor is an IP address.** People sharing one share 30 live answers a day, and someone who changes address gets
  more. One person with many addresses can use up the site's 200, which stops live answers for everyone until the
  counter expires.
- **Provider quotas are separate.** A provider's limit, such as a free tier's requests per minute, can be reached before
  ours. Visitors then see the generic "could not answer" message, and the turn still counts.
- **Refused requests still use Redis commands,** so heavy traffic could use up the free plan. Live chat and the contact
  form stop if the store stops answering.
- **The firewall rule is not applied yet,** and the deployed IP header has not been seen. Both wait for a later deployment (M12.3, not started).
- **Another host must overwrite the IP headers.** Vercel does. Without that, anyone can get around the limits.

## Prompt injection

- **The package does not check links; the page does.** Injected text could get the model to write a link that carries
  conversation text. The reference app makes only exact profile URLs clickable, and shows anything else as plain text. A
  consumer with its own UI must do the same, as the `@promptfolio/ai` README says, because the stream holds whatever the
  model wrote. A repository's homepage is on the allowed list, and its owner can point it anywhere.
- **A model can still be misled by source text.** The evaluation found no injected text in answers on the model tested,
  which is evidence about that model and those attempts, not a guarantee.
- **No script Content-Security-Policy.** The policy covers images and framing. Limiting scripts would need a nonce on
  every Next.js script.

## Contact form

- The visitor's name and reply address are not verified, and "sent" means the provider accepted the email.
- See [the setup guide](guides/contact-setup.md) for what remains the owner's to watch.

## Accessibility

Assessed in M11.3 from Biome's accessibility rules on the vendored UI, and the page's structure. No screen reader test
was run.

- **Findings:** the components with Biome findings (load earlier, attachments, images, and media) were removed in M12.6.
  Biome does not check the vendored UI, so this was not assessed again. Adding one of them back means reviewing it first.
- **Checked on the page:** `lang` is set, `main` and `nav` landmarks exist, and every button has a name.
- **Biome's rules are narrower than a full audit.** Color contrast and keyboard order have not been reviewed.

## Interface

- **The version switcher can disappear.** After a failed reply is retried, viewing the failed version hides the switcher,
  so a visitor has to retry or reload to get back. This comes from the vendored assistant-ui code. It was seen in M4,
  and is not reproduced or fixed here.
- **Conversations stay in one browser.** They are not synced, and clearing site data removes them.
