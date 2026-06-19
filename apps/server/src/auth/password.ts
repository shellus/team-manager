import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';

const defaultScrypt = {
  N: 16384,
  r: 8,
  p: 1,
  keyLength: 32
};

export type HashPasswordOptions = {
  salt?: string;
};

export async function hashPassword(password: string, options: HashPasswordOptions = {}) {
  const salt = options.salt ?? randomBytes(16).toString('base64url');
  const derived = await scrypt(password, salt, defaultScrypt.keyLength, {
    N: defaultScrypt.N,
    r: defaultScrypt.r,
    p: defaultScrypt.p
  });

  return `$scrypt$N=${defaultScrypt.N},r=${defaultScrypt.r},p=${defaultScrypt.p}$${salt}$${derived.toString('base64url')}`;
}

export async function verifyPasswordHash(password: string, storedHash: string) {
  const parsed = parseScryptHash(storedHash);
  if (!parsed) {
    return false;
  }

  const derived = await scrypt(password, parsed.salt, Buffer.from(parsed.hash, 'base64url').length, {
    N: parsed.N,
    r: parsed.r,
    p: parsed.p
  });
  const expected = Buffer.from(parsed.hash, 'base64url');

  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

function scrypt(password: string, salt: string, keyLength: number, options: { N: number; r: number; p: number }) {
  return new Promise<Buffer>((resolve, reject) => {
    scryptCallback(password, salt, keyLength, options, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(derivedKey as Buffer);
    });
  });
}

function parseScryptHash(storedHash: string) {
  const [empty, scheme, params, salt, hash] = storedHash.split('$');
  if (empty !== '' || scheme !== 'scrypt' || !params || !salt || !hash) {
    return null;
  }

  const parsedParams = Object.fromEntries(params.split(',').map((part) => part.split('=')));
  const N = Number(parsedParams.N);
  const r = Number(parsedParams.r);
  const p = Number(parsedParams.p);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) {
    return null;
  }

  return { N, r, p, salt, hash };
}
