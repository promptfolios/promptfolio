"use client";

import type { ContactField } from "@promptfolio/contact";
import { useReducer, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  canSend,
  confirmContact,
  contactFlowReducer,
  initialContactFlow,
  prepareContact,
  reviewStatus,
} from "@/contact/contact-flow";

export interface ContactDialogProps {
  ownerName: string;
}

/**
 * The contact form: compose, review the exact email, then send. It only displays what the server
 * returns, and the server enforces the rest: validation, the recipient, and the confirmation.
 */
export function ContactDialog({ ownerName }: ContactDialogProps) {
  const [flow, dispatch] = useReducer(contactFlowReducer, undefined, initialContactFlow);
  const honeypot = useRef<HTMLInputElement>(null);

  async function prepare() {
    if (flow.step !== "compose" || flow.preparing) return;
    dispatch({ type: "prepare-start" });
    const result = await prepareContact(flow.draft, honeypot.current?.value ?? "");
    dispatch({ type: "prepare-finished", result });
  }

  async function send() {
    if (!canSend(flow)) return;
    dispatch({ type: "send-start" });
    const result = await confirmContact(flow.preview.token);
    dispatch({ type: "send-finished", result });
  }

  return (
    <Dialog
      onOpenChange={(open) => {
        // The draft stays until it has been sent, so closing by accident loses nothing.
        if (!open && flow.step === "sent") dispatch({ type: "reset" });
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="ml-auto">
          Contact
        </Button>
      </DialogTrigger>
      {/* Scrolls on short screens, where a long review would otherwise push its buttons out of reach. */}
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
        {flow.step === "compose" && (
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void prepare();
            }}
          >
            <DialogHeader>
              <DialogTitle>Contact {ownerName}</DialogTitle>
              <DialogDescription>
                You can review your message before it is sent. It is delivered by email through a
                third-party service and is not saved on this site. To limit messages to one a day, a
                coded form of your IP address is kept by a storage service for 24 hours.
              </DialogDescription>
            </DialogHeader>
            <Field
              label="Your name"
              field="name"
              error={flow.fields.name}
              value={flow.draft.name}
              onChange={(value) => dispatch({ type: "edit", field: "name", value })}
              autoComplete="name"
            />
            <Field
              label="Your email"
              field="email"
              type="email"
              error={flow.fields.email}
              value={flow.draft.email}
              onChange={(value) => dispatch({ type: "edit", field: "email", value })}
              autoComplete="email"
            />
            <div className="grid gap-1.5">
              <label htmlFor="contact-message" className="font-medium">
                Message
              </label>
              <Textarea
                id="contact-message"
                rows={6}
                className="max-h-60"
                value={flow.draft.message}
                aria-invalid={flow.fields.message ? true : undefined}
                aria-describedby={flow.fields.message ? "contact-message-error" : undefined}
                onChange={(event) =>
                  dispatch({ type: "edit", field: "message", value: event.target.value })
                }
              />
              {flow.fields.message && (
                <p id="contact-message-error" className="text-destructive">
                  {flow.fields.message}
                </p>
              )}
            </div>
            {/* The honeypot: hidden from people, filled by simple bots, rejected by the server. */}
            <div aria-hidden="true" className="absolute -left-[9999px] h-0 overflow-hidden">
              <label htmlFor="contact-website">Website</label>
              <input
                ref={honeypot}
                id="contact-website"
                name="website"
                tabIndex={-1}
                autoComplete="off"
              />
            </div>
            {flow.message && (
              <p role="alert" className="text-destructive">
                {flow.message}
              </p>
            )}
            <DialogFooter>
              <Button type="submit" disabled={flow.preparing}>
                {flow.preparing ? "Checking…" : "Review message"}
              </Button>
            </DialogFooter>
          </form>
        )}

        {flow.step === "review" && (
          <>
            <DialogHeader>
              <DialogTitle>Review your message</DialogTitle>
              <DialogDescription>{reviewStatus(flow)}</DialogDescription>
            </DialogHeader>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <dt className="text-muted-foreground">To</dt>
              <dd>{flow.preview.recipientName} (profile owner)</dd>
              <dt className="text-muted-foreground">Your name</dt>
              <dd className="break-words">{flow.preview.name}</dd>
              <dt className="text-muted-foreground">Your email</dt>
              <dd className="break-all">{flow.preview.replyTo}</dd>
            </dl>
            <pre className="bg-muted max-h-60 overflow-y-auto rounded-md p-3 font-sans break-words whitespace-pre-wrap">
              {flow.preview.message}
            </pre>
            {flow.notice && (
              <p role="alert" className="text-destructive">
                {flow.notice.message}
              </p>
            )}
            <DialogFooter>
              <Button
                variant="outline"
                disabled={flow.sending}
                onClick={() => dispatch({ type: "back" })}
              >
                Edit
              </Button>
              {flow.notice?.kind !== "limited" && (
                <Button disabled={flow.sending} onClick={() => void send()}>
                  {flow.sending ? "Sending…" : flow.notice ? "Try again" : "Send message"}
                </Button>
              )}
            </DialogFooter>
          </>
        )}

        {flow.step === "sent" && (
          <DialogHeader>
            <DialogTitle>Message sent</DialogTitle>
            {/* The provider confirmed it accepted the email, which is not proof of delivery. */}
            <DialogDescription role="status">
              The email service accepted your message for {flow.recipientName}. If{" "}
              {flow.recipientName} replies, it will come to {flow.replyTo}.
            </DialogDescription>
          </DialogHeader>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  field,
  error,
  value,
  onChange,
  type = "text",
  autoComplete,
}: {
  label: string;
  field: ContactField;
  error: string | undefined;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "email";
  autoComplete: string;
}) {
  const id = `contact-${field}`;
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      <Input
        id={id}
        type={type}
        value={value}
        autoComplete={autoComplete}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {error && (
        <p id={`${id}-error`} className="text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
