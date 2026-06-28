#!/usr/bin/env node
import { copyFile, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SEAT_KEY_PATTERN = /^[A-Za-z0-9]{16}$/;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

const args = process.argv.slice(2);
const dataDir = resolve(readArgValue('--data-dir') ?? args.find((arg) => !arg.startsWith('--')) ?? './data');
const backupFile = readArgValue('--backup-file');
const dryRun = args.includes('--dry-run');

function readArgValue(name) {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  return args[index + 1];
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeEmail(value) {
  return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : undefined;
}

function normalizeDate(value) {
  const valueString = readString(value);
  return valueString && DATE_ONLY_PATTERN.test(valueString) ? valueString : undefined;
}

function localDateAfterDays(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function readAccounts(file) {
  if (!file || !existsSync(file)) return [];
  const parsed = JSON.parse(await readFile(file, 'utf8'));
  if (!Array.isArray(parsed)) throw new Error(`${file} is not a JSON array`);
  return parsed;
}

async function findBackupFile() {
  if (backupFile) return resolve(backupFile);
  const entries = await readdir(dataDir).catch(() => []);
  const candidates = entries
    .filter((name) => /^accounts\.json\.bak-/.test(name))
    .sort()
    .reverse();
  return candidates[0] ? join(dataDir, candidates[0]) : undefined;
}

function profileIndex(accounts) {
  const byAccountAndEmail = new Map();
  for (const account of accounts) {
    if (!isRecord(account)) continue;
    const accountKeys = [readString(account.id), readString(account.accountId)].filter(Boolean);
    const profiles = isRecord(account.memberProfiles) ? account.memberProfiles : {};
    for (const [key, rawProfile] of Object.entries(profiles)) {
      if (!isRecord(rawProfile)) continue;
      const email = normalizeEmail(rawProfile.email) ?? normalizeEmail(key);
      if (!email) continue;
      const profile = normalizeProfile(email, rawProfile);
      for (const accountKey of accountKeys) {
        byAccountAndEmail.set(`${accountKey}\n${email}`, profile);
      }
    }
  }
  return byAccountAndEmail;
}

function normalizeProfile(email, rawProfile) {
  const remark = readString(rawProfile.remark) ?? readString(rawProfile.note);
  return {
    email,
    ...(remark ? { remark } : {}),
    expiresOn: normalizeDate(rawProfile.expiresOn) ?? localDateAfterDays(30),
    expireRemove: typeof rawProfile.expireRemove === 'boolean' ? rawProfile.expireRemove : false,
    expireReminder: typeof rawProfile.expireReminder === 'boolean' ? rawProfile.expireReminder : true,
    updatedAt: typeof rawProfile.updatedAt === 'number' && Number.isFinite(rawProfile.updatedAt)
      ? rawProfile.updatedAt
      : Date.now()
  };
}

function mergeProfiles(account, backupProfiles) {
  const merged = new Map();
  const accountKeys = [readString(account.id), readString(account.accountId)].filter(Boolean);
  const currentProfiles = isRecord(account.memberProfiles) ? account.memberProfiles : {};
  for (const [key, rawProfile] of Object.entries(currentProfiles)) {
    if (!isRecord(rawProfile)) continue;
    const email = normalizeEmail(rawProfile.email) ?? normalizeEmail(key);
    if (!email) continue;
    const current = normalizeProfile(email, rawProfile);
    const backup = accountKeys.map((accountKey) => backupProfiles.get(`${accountKey}\n${email}`)).find(Boolean);
    merged.set(email, {
      ...current,
      ...(backup?.remark && !current.remark ? { remark: backup.remark } : {})
    });
  }
  return [...merged.values()];
}

function relationForEmail(account, email) {
  const target = email.toLowerCase();
  const member = Array.isArray(account.membersCache)
    ? account.membersCache.find((item) => normalizeEmail(item?.email) === target)
    : undefined;
  if (member) return { status: 'member', currentUserId: readString(member.userId) };
  const invite = Array.isArray(account.pendingInvitesCache)
    ? account.pendingInvitesCache.find((item) => normalizeEmail(item?.email) === target)
    : undefined;
  if (invite) return { status: 'invited', currentInviteId: readString(invite.inviteId) };
  return { status: 'unknown' };
}

function generateSeatKey(usedKeys) {
  for (;;) {
    const bytes = randomBytes(16);
    let key = '';
    for (const byte of bytes) key += ALPHABET[byte % ALPHABET.length];
    if (!usedKeys.has(key)) {
      usedKeys.add(key);
      return key;
    }
  }
}

function existingSlotByEmail(account) {
  const map = new Map();
  if (!Array.isArray(account.seatSlots)) return map;
  for (const slot of account.seatSlots) {
    if (!isRecord(slot)) continue;
    const email = normalizeEmail(slot.email);
    if (email) map.set(email, slot);
  }
  return map;
}

function collectUsedSeatKeys(accounts) {
  const keys = new Set();
  for (const account of accounts) {
    if (!Array.isArray(account.seatSlots)) continue;
    for (const slot of account.seatSlots) {
      const key = readString(slot?.seatKey);
      if (key && SEAT_KEY_PATTERN.test(key)) keys.add(key);
    }
  }
  return keys;
}

function swapFields(existing) {
  if (!isRecord(existing)) return {};
  const history = [];
  const seen = new Set();
  if (Array.isArray(existing.swapHistory)) {
    for (const item of existing.swapHistory) {
      if (!isRecord(item)) continue;
      const id = readString(item.id);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      history.push(item);
    }
  }

  const lastSwap = isRecord(existing.lastSwap) && readString(existing.lastSwap.id)
    ? existing.lastSwap
    : undefined;
  if (lastSwap) {
    const index = history.findIndex((item) => item.id === lastSwap.id);
    if (index >= 0) {
      history[index] = lastSwap;
    } else {
      history.push(lastSwap);
    }
  }

  return {
    ...(lastSwap ? { lastSwap } : {}),
    ...(history.length ? { swapHistory: history } : {})
  };
}

async function main() {
  const file = join(dataDir, 'accounts.json');
  const backup = await findBackupFile();
  const accounts = await readAccounts(file);
  const backupAccounts = await readAccounts(backup);
  const backupProfiles = profileIndex(backupAccounts);
  const usedKeys = collectUsedSeatKeys(accounts);
  let restoredRemarks = 0;
  let createdSlots = 0;

  for (const account of accounts) {
    if (!isRecord(account)) continue;
    const profiles = mergeProfiles(account, backupProfiles);
    const existingByEmail = existingSlotByEmail(account);
    const slots = [];
    for (const profile of profiles) {
      const existing = existingByEmail.get(profile.email);
      const relation = relationForEmail(account, profile.email);
      const currentProfile = isRecord(account.memberProfiles) ? account.memberProfiles[profile.email] : undefined;
      const currentRemark = isRecord(currentProfile) ? readString(currentProfile.remark) : undefined;
      if (profile.remark && !currentRemark) restoredRemarks += 1;
      slots.push({
        seatKey: readString(existing?.seatKey) && SEAT_KEY_PATTERN.test(existing.seatKey)
          ? existing.seatKey
          : generateSeatKey(usedKeys),
        email: profile.email,
        ...(profile.remark ? { remark: profile.remark } : {}),
        expiresOn: profile.expiresOn,
        ...(readString(existing?.price) ? { price: readString(existing.price) } : {}),
        seat: 'default',
        ...relation,
        expireRemove: profile.expireRemove,
        expireReminder: profile.expireReminder,
        ...swapFields(existing),
        updatedAt: Date.now()
      });
      createdSlots += existing ? 0 : 1;
    }
    account.seatSlots = slots;
    delete account.memberProfiles;
  }

  if (!dryRun) {
    const backupTarget = `${file}.pre-seat-slots-${timestamp()}`;
    await copyFile(file, backupTarget);
    await writeFile(file, `${JSON.stringify(accounts, null, 2)}\n`, 'utf8');
    console.log(`migrated accounts=${accounts.length} createdSlots=${createdSlots} restoredRemarks=${restoredRemarks} backup=${backupTarget}`);
  } else {
    console.log(`dry-run accounts=${accounts.length} createdSlots=${createdSlots} restoredRemarks=${restoredRemarks} backupSource=${backup ?? ''}`);
  }
}

function timestamp() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

main().catch((error) => {
  console.error(`migration failed: ${error.message}`);
  process.exit(1);
});
