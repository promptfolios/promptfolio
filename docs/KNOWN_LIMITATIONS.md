# Known limitations

What Promptfolio does not do or guarantee, as of M12.2. Each item says what happens and what limits the damage.

## Answers

- **A model can write a tool call as text.** On `nemotron-3.5-lightning`, 2 of 17 answers were literal `<tool_call>`
  text. The server now stops `<tool_call` and `<function=` and shows the generic error, so the visitor gets no answer on
  a turn that still counts. Other models may use other forms, which would still get through.
- **The chosen model failed its evaluation.** The developer chose `ling-3.1-flash-1019` on 2026-10-31 knowing this. About 1 in
  3 recorded attempts timed out or hit a rate limit, so visitors can get "could not answer" often. One of 6 injection runs
  quoted injected text while refusing it, and answers can narrate, mention injected text unprompted, and add their own
  sources. Its provider is not marked as no-training, and the free model may not stay available.
  See [the evaluation](evaluation/README.md#the-run-on-ling-failed-the-gate).
- **A citation is not proof that a sentence is right.** The server checks that a cited record was looked up in that
  turn. It cannot check that the record supports the sentence. A real answer listed seven technologies and cited one
  repository, and an evaluation run wrote "note-notes" for a note-taking app with a verified citation.
- **Uncited facts carry no warning.** A claim with no citation, or one the server could not match, shows no marker
  and no source. Only the server log's `citations { verified, unverified }` counts record that. Model text streams
  as it arrives, so it cannot be corrected afterwards.
- **Skills and links have no ids,** so they never get a source entry.
- **Long ids can come out garbled,** such as `[github.com/pixel-notes]` or `[queue‑lab]`, or in other brackets such as
  `【id】`. The sentence then has no marker. Look-alike hyphens are handled. See [the evaluation](evaluation/README.md).
- **The evaluation is small.** It covers one fictional profile. The full set on the final prompt ran on one model, which
  failed, and the default model has not been run.
- **Prompt rules guide the model and enforce nothing.** Anything that must hold is enforced in code; wording rules,
  such as what counts as open source, can still be broken.

## Abuse and cost

- **A visitor is an IP address.** People sharing one share 30 live answers a day, and someone who changes address gets
  more. One person with many addresses can use up the site's 200, which stops live answers for everyone until the
  counter expires.
- **Provider quotas are separate.** A provider's limit, such as a free tier's requests per minute, can be reached before
  ours. Visitors then see the generic "could not answer" message, and the turn still counts.
- **Refused requests still use Redis commands,** so heavy traffic could use up the free plan. Live chat and the contact
  form stop if the store stops answering.
- **The firewall rule is not applied yet,** and the deployed IP header has not been seen. Both wait for M12.
- **Another host must overwrite the IP headers.** Vercel does. Without that, anyone can get around the limits.

## Prompt injection

- **Links in answers are not restricted.** Injected text could get the model to write a link. Images cannot load by
  themselves, but a visitor could click a link that carries conversation text.
- **A model can still be misled by source text.** The evaluation found no injected text in answers on the model tested,
  which is evidence about that model and those attempts, not a guarantee.
- **No script Content-Security-Policy.** The policy covers images and framing. Limiting scripts would need a nonce on
  every Next.js script.

## Prepared answers

- **The example's answers come from Ling with the contact form off.** With the form on, they count as stale, because the
  system prompt differs. Generating them took retries: one pass wrote 2 of 5, and the script does not retry by itself.
- **They go stale when the profile or prompt changes,** and starters are then answered live and counted until someone
  runs `prepare-answers`. A scheduled refresh that changes content does this, and regenerating in that job is off by
  default. M12 decides.
- **Only the first message of a new chat qualifies,** and only an exact match with a starter.

## Contact form

- The visitor's name and reply address are not verified, and "sent" means the provider accepted the email.
- See [the setup guide](guides/contact-setup.md) for what remains the owner's to watch.

## Accessibility

Assessed in M11.3 from Biome's accessibility rules on the vendored UI, and the page's structure. No screen reader test
was run.

- **Findings in code visitors can reach:** one, a `div` with `onFocus` around "load earlier" in `thread.aui.tsx`. It
  only tracks focus and is not interactive, so it is not a problem.
- **Findings in code visitors cannot reach:** the rest, in the attachment, image, and media components, which nothing
  renders now that attachments are off. They would need fixing before any of those is turned on.
- **Checked on the page:** `lang` is set, `main` and `nav` landmarks exist, and every button has a name.
- **Biome's rules are narrower than a full audit.** Color contrast and keyboard order have not been reviewed.

## Interface

- **The version switcher can disappear.** After a failed reply is retried, viewing the failed version hides the switcher,
  so a visitor has to retry or reload to get back. This comes from the vendored assistant-ui code. It was seen in M4,
  and is not reproduced or fixed here.
- **The Copy button copies raw `[id]` citations.**
- **Conversations stay in one browser.** They are not synced, and clearing site data removes them.
