import type { ChatGptSessionInput } from '@team-manager/shared';
import { createCloakBrowserClient } from './cloakBrowserClient.js';
import { CloakSubaccountRegistrationExecutor } from './cloakSubaccountRegistration.js';
import { createGongXiMailClient } from './gongxiMail.js';

export type SubaccountRegistrationEvent = Record<string, unknown> & { phase?: string };

export interface SubaccountRegistrationOptions {
  jobId?: string;
  mailGroup?: string;
  email?: string;
  password?: string;
  resumeExisting?: boolean;
  cloakProfileId?: string;
  onEvent?: (event: SubaccountRegistrationEvent) => void | Promise<void>;
}

export interface SubaccountRegistrationResult {
  email: string;
  password: string;
  name?: string;
  birthdate?: string;
  callbackUrl?: string;
  session: ChatGptSessionInput;
  events: SubaccountRegistrationEvent[];
  registrationMethod?: 'cloak_browser';
  cloakProfileId?: string;
  cloakProfileName?: string;
}

export interface SubaccountRegistrationMailboxResult {
  email: string;
  group: string;
  events: SubaccountRegistrationEvent[];
}

export interface SubaccountRegistrationExecutor {
  register(options: SubaccountRegistrationOptions): Promise<SubaccountRegistrationResult>;
  completeMailbox(email: string): Promise<SubaccountRegistrationMailboxResult>;
}

export class SubaccountRegistrationError extends Error {
  constructor(
    message: string,
    readonly status: string,
    readonly challenge?: string,
    readonly email?: string,
    readonly password?: string,
    readonly events: SubaccountRegistrationEvent[] = [],
    readonly cloakProfileId?: string,
    readonly cloakProfileName?: string,
    readonly registrationMethod?: 'cloak_browser'
  ) {
    super(message);
    this.name = 'SubaccountRegistrationError';
  }
}

export function createSubaccountRegistrationExecutor(): SubaccountRegistrationExecutor | undefined {
  const cloak = createCloakBrowserClient();
  const mail = createGongXiMailClient();
  if (!cloak || !mail) return undefined;
  return new CloakSubaccountRegistrationExecutor(cloak, mail);
}
