# @promptfolio/contact

Confirmed contact messages: validates a draft, signs it into a token for the visitor to review, and sends only what
was confirmed, only to the recipient you configure. It names no email provider or store.

Not published. Use it from this workspace as `"@promptfolio/contact": "workspace:*"`.

## Entry point

| Export | Purpose |
| ------ | ------- |
| `handleContactPrepare` | Validates a draft and returns it with a token. Sends nothing |
| `handleContactSend` | Sends the email inside a token |
| `ContactSender`, `ContactSendLimiter` | The email provider and the one-per-visitor store you implement |
| `CONTACT_LIMITS` | Field sizes and time windows |
| Types | Options, and the response shapes a browser reads |

## Example

From [the minimal consumer](../../apps/minimal-consumer/src/consumer.ts):

```ts
const contactOptions: ContactOptions = {
  ...contact, // limiter, tokenSecret, sender
  recipient: { name: profile.identity.name, address: "avery@example.test" },
  from: "Avery's site <site@example.test>",
  identifyVisitor,
};
handleContactPrepare(request, contactOptions);
handleContactSend(request, contactOptions);
```

Nothing in a request can change the recipient. Only your server code reaches these handlers; no model can.
