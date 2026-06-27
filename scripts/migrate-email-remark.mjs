#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const dataDir = resolve(process.argv[2] ?? './data');

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function moveString(record, from, to) {
  const value = readString(record[from]);
  delete record[from];
  if (value && !readString(record[to])) record[to] = value;
}

function removeKeys(record, keys) {
  for (const key of keys) delete record[key];
}

function migrateMemberProfiles(profiles) {
  if (!isRecord(profiles)) return profiles;
  for (const profile of Object.values(profiles)) {
    if (!isRecord(profile)) continue;
    moveString(profile, 'note', 'remark');
  }
  return profiles;
}

function migrateMembers(members) {
  if (!Array.isArray(members)) return members;
  for (const member of members) {
    if (!isRecord(member)) continue;
    moveString(member, 'name', 'remoteName');
  }
  return members;
}

async function readJsonArray(file) {
  if (!existsSync(file)) return undefined;
  const parsed = JSON.parse(await readFile(file, 'utf8'));
  if (!Array.isArray(parsed)) throw new Error(`${file} is not a JSON array`);
  return parsed;
}

async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function migrateAccounts() {
  const file = join(dataDir, 'accounts.json');
  const accounts = await readJsonArray(file);
  if (!accounts) return 0;
  let count = 0;
  for (const account of accounts) {
    if (!isRecord(account)) continue;
    moveString(account, 'note', 'remark');
    removeKeys(account, ['label', 'displayName', 'name']);
    if (typeof account.nextRenewalOn === 'string' && !DATE_ONLY_PATTERN.test(account.nextRenewalOn.trim())) {
      delete account.nextRenewalOn;
    }
    migrateMembers(account.membersCache);
    migrateMemberProfiles(account.memberProfiles);
    count += 1;
  }
  await writeJson(file, accounts);
  return count;
}

async function migrateSubaccounts() {
  const file = join(dataDir, 'subaccounts.json');
  const subaccounts = await readJsonArray(file);
  if (!subaccounts) return 0;
  let count = 0;
  for (const subaccount of subaccounts) {
    if (!isRecord(subaccount)) continue;
    moveString(subaccount, 'label', 'remark');
    removeKeys(subaccount, ['note', 'displayName', 'name']);
    count += 1;
  }
  await writeJson(file, subaccounts);
  return count;
}

try {
  const accountCount = await migrateAccounts();
  const subaccountCount = await migrateSubaccounts();
  console.log(`migrated accounts=${accountCount} subaccounts=${subaccountCount} dataDir=${dataDir}`);
} catch (error) {
  console.error(`migration failed: ${error.message}`);
  process.exit(1);
}
