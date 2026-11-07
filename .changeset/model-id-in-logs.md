---
"@promptfolio/ai": patch
---

Chat logs now name the model. The `finished` line includes `model`: the id the provider reports for the model that answered, or the configured model's id when it reports none. The `model error` line includes the configured model's id. A failover model also logs `[failover] continuing with <label>` when it has moved on and the next model starts answering.
