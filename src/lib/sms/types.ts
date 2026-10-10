export interface SmsMessage {
  /** Recipient, E.164. */
  to: string;
  text: string;
  /** Our own reference for the message (the otp_request id), echoed back by providers that acknowledge delivery. */
  messageId: number;
}

// A way of delivering SMS (Twilio ...). Each provider implements this; callers only see SmsProvider.
export interface SmsProvider {
  /** Rejects when the message could not be handed to the provider. */
  send(message: SmsMessage): Promise<void>;
}
