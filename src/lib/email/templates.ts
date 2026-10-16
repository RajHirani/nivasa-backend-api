import { env, type EmailKind } from '../../config/env.js';

// The words of every email. To add an email: add its kind to EMAIL_KINDS (config/env.ts), its data here and its text below.
export interface EmailData {
  /** The mobile app's sign in code, also mailed when that email is switched on. */
  MOBILE_OTP: { code: string };
  /** The Platform Console sign in code (the only way staff receive it). */
  PLATFORM_OTP: { code: string };
  STAFF_INVITE: { name: string; roleName: string };
  /** "Send invite" on the Admins tab. `neverSignedIn`: the person has not used the app yet, so they are told how to sign in. */
  SOCIETY_ADMIN_INVITE: { name: string; societyName: string; neverSignedIn: boolean };
}

const minutes = () => Math.round(env.otp.ttlSeconds / 60);

const TEMPLATES: { [K in EmailKind]: (data: EmailData[K]) => { subject: string; text: string } } = {
  MOBILE_OTP: ({ code }) => ({
    subject: 'Your Nivaas verification code',
    text: `${code} is your Nivaas verification code. It expires in ${minutes()} minutes. Do not share it with anyone.`,
  }),
  PLATFORM_OTP: ({ code }) => ({
    subject: 'Your Nivaas platform console sign in code',
    text: `${code} is your Nivaas platform console sign in code. It expires in ${minutes()} minutes. Do not share it with anyone.`,
  }),
  STAFF_INVITE: ({ name, roleName }) => ({
    subject: 'You have been invited to the Nivaas Platform Console',
    text: `Hi ${name},\n\nYou have been added to the Nivaas Platform Console as ${roleName}.\n\nSign in at ${env.platform.consoleUrl} with this email address. We will email you a one-time code each time you sign in.\n`,
  }),
  SOCIETY_ADMIN_INVITE: ({ name, societyName, neverSignedIn }) => ({
    subject: `You are the administrator of ${societyName} on Nivaas`,
    text: neverSignedIn
      ? `Hi ${name},\n\nYou have been added as the President (administrator) of ${societyName} on Nivaas.\n\nOpen the Nivaas app and sign in with your mobile number to get started.\n`
      : `Hi ${name},\n\nYou are now the President (administrator) of ${societyName} on Nivaas.\n\nOpen the Nivaas app and choose ${societyName} to manage it.\n`,
  }),
};

export const renderEmail = <K extends EmailKind>(kind: K, data: EmailData[K]): { subject: string; text: string } => TEMPLATES[kind](data);
