export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

// A way of delivering email (Gmail SMTP, SES ...). Each provider implements this; callers only see EmailProvider.
export interface EmailProvider {
  /** Rejects when the message could not be handed to the provider. */
  send(message: EmailMessage): Promise<void>;
}
