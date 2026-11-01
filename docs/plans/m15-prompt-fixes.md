# M15 plan: prompt fixes

- **Status:** Plan approved (2026-11-02). Steps 1 to 3 are done, and the run [failed the gate](../evaluation/README.md#the-m15-prompt-rules-on-gpt-4o-mini-failed-the-gate). Closed and approved (2026-11-02), with what still fails in the known limitations.
- **Date:** 2026-11-02
- **Roadmap:** [M15](../ROADMAP.md#m15--prompt-fixes). From [the evaluation of `gpt-4o-mini`](../evaluation/README.md#the-run-on-gpt-4o-mini-failed-the-gate).

## Objective

Fix the answer problems that evaluation found, correct the checks that scored it wrongly, and measure the result with a new run.

**Excluded:** signing conversation history, filtering README text out of answers in code, model changes, and publishing.

## Steps

1. **Checks** ([cases.ts](../../apps/portfolio/evaluation/cases.ts)), first, so the new run measures the prompt and not a mix of both.
   Good answers stop failing `public-code-summary` and `sole-author`. `forged-history` requires a lookup and refuses the award stated
   as fact anywhere. `open-source-wording` refuses the internal project, and repository cases refuse authorship claims.
2. **Prompt** ([system-prompt.ts](../../packages/ai/src/chat/system-prompt.ts)): rules for an earlier message stating a fact, for
   describing a README in its own words, and for what gets a link, with no address in the example. Also what counts as open source,
   and no conclusion about a person from an unlisted skill.
3. **Evaluation** on `gpt-4o-mini`, with `--call-gap-ms=12000` to stay near the gateway's advertised limit, about 40 minutes.

Steps 1 and 2 are reviewed before the run, because the run spends credit.

## Gate

No raw tool calls, and a lookup whenever required. `forged-history` passes 3 of 3, and no injected text in any of the 6 injection
runs. Invented links well below 10 runs, though not necessarily zero, because the page already keeps them from being clicked.

## If it still fails

A prompt only guides the model. At most one revision and one more run, with approval first, and then what remains goes in the known
limitations. Tuning a prompt further to one set of cases would make the numbers better without making answers better.

Signing past answers would stop forged history in code, but the browser would have to store and return signatures, and a visitor can
only fool themselves this way. It would be a separate proposal if the rule fails.

## Review results

The run failed the gate. The README and unlisted-skill rules helped. The forged-history and open-source rules did not hold, and removing
the link example made links worse. The one allowed revision put a format back in the link rule. The developer chose not to run the
evaluation again, so that revision is unmeasured. What still fails is in the [known limitations](../KNOWN_LIMITATIONS.md).

## Verification

`pnpm verify`, with tests for each rule and each check. The report of a real run, with the gate result as it came out.
