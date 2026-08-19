import { unifiedApi } from "../../unifiedApi.js";

export const GAM_REGISTRATION_DEFAULTS_KEY = "form.defaults.gam-registration";
export const SUBSCRIPTION_DEFAULTS_KEY = "form.defaults.subscription";

type SystemSetting = {
  key: string;
  value?: Record<string, unknown>;
};

export interface GamRegistrationDefaults {
  groupId?: string;
  country: string;
  mailGroup?: string;
}

export interface SubscriptionDefaults {
  promoEnabled: boolean;
  promoCode?: string;
}

export async function loadGamRegistrationDefaults(): Promise<GamRegistrationDefaults> {
  const value = await settingValue(GAM_REGISTRATION_DEFAULTS_KEY);
  return normalizeGamRegistrationDefaults(value);
}

export async function saveGamRegistrationDefaults(value: GamRegistrationDefaults): Promise<void> {
  await unifiedApi.saveSystemSetting(GAM_REGISTRATION_DEFAULTS_KEY, compact({
    groupId: optionalText(value.groupId),
    country: countryCode(value.country) ?? "US",
    mailGroup: optionalText(value.mailGroup),
  }));
}

export async function loadSubscriptionDefaults(): Promise<SubscriptionDefaults> {
  return normalizeSubscriptionDefaults(await settingValue(SUBSCRIPTION_DEFAULTS_KEY));
}

export async function saveSubscriptionDefaults(value: SubscriptionDefaults): Promise<void> {
  await unifiedApi.saveSystemSetting(SUBSCRIPTION_DEFAULTS_KEY, compact({
    promoEnabled: value.promoEnabled === true,
    promoCode: optionalText(value.promoCode),
  }));
}

export function normalizeGamRegistrationDefaults(value?: Record<string, unknown>): GamRegistrationDefaults {
  const groupId = optionalText(value?.groupId);
  const mailGroup = optionalText(value?.mailGroup);
  return {
    country: countryCode(value?.country) ?? "US",
    ...(groupId ? { groupId } : {}),
    ...(mailGroup ? { mailGroup } : {}),
  };
}

export function normalizeSubscriptionDefaults(value?: Record<string, unknown>): SubscriptionDefaults {
  const promoCode = optionalText(value?.promoCode);
  return {
    promoEnabled: value?.promoEnabled === true,
    ...(promoCode ? { promoCode } : {}),
  };
}

async function settingValue(key: string): Promise<Record<string, unknown> | undefined> {
  const settings: SystemSetting[] = await unifiedApi.systemSettings();
  return settings.find((setting) => setting.key === key)?.value;
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function countryCode(value: unknown): string | undefined {
  const code = optionalText(value)?.toUpperCase();
  return code && /^[A-Z]{2}$/.test(code) ? code : undefined;
}

function compact<T extends Record<string, unknown>>(value: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}
