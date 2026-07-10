import { createHmac, timingSafeEqual } from 'node:crypto';

export type TokenType = 'access' | 'refresh';

export type SignTokenInput = {
  subject: string;
  issuer: string;
  tokenType: TokenType;
  ttl?: string;
  secret: string;
};

export type VerifyTokenInput = {
  token: string;
  issuer: string;
  tokenType: TokenType;
  secret: string;
};

export type JwtPayload = {
  sub: string;
  iss: string;
  typ: TokenType;
  iat: number;
  exp?: number;
};

export function signJwt({ subject, issuer, tokenType, ttl, secret }: SignTokenInput) {
  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: 'HS256',
    typ: 'JWT'
  };
  const payload: JwtPayload = {
    sub: subject,
    iss: issuer,
    typ: tokenType,
    iat: now,
    ...(ttl === undefined ? {} : { exp: now + parseTtlSeconds(ttl) })
  };

  const encodedHeader = encodeJson(header);
  const encodedPayload = encodeJson(payload);
  const signature = createHmac('sha256', secret).update(`${encodedHeader}.${encodedPayload}`).digest('base64url');
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

export function verifyJwt({ token, issuer, tokenType, secret }: VerifyTokenInput): JwtPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }

  const [encodedHeader, encodedPayload, signature] = parts;
  const expectedSignature = createHmac('sha256', secret).update(`${encodedHeader}.${encodedPayload}`).digest('base64url');
  if (!safeEqual(signature, expectedSignature)) {
    return null;
  }

  const header = decodeJson(encodedHeader);
  const payload = decodeJson(encodedPayload);
  if (!isJwtHeader(header) || !isJwtPayload(payload)) {
    return null;
  }
  if (header.alg !== 'HS256' || header.typ !== 'JWT') {
    return null;
  }
  if (payload.iss !== issuer || payload.typ !== tokenType) {
    return null;
  }
  if (payload.exp !== undefined && payload.exp <= Math.floor(Date.now() / 1000)) {
    return null;
  }

  return payload;
}

function encodeJson(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function decodeJson(value: string): unknown {
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function isJwtHeader(value: unknown): value is { alg: string; typ: string } {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as Record<string, unknown>;
  return typeof record.alg === 'string' && typeof record.typ === 'string';
}

function isJwtPayload(value: unknown): value is JwtPayload {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.sub === 'string' &&
    typeof record.iss === 'string' &&
    (record.typ === 'access' || record.typ === 'refresh') &&
    typeof record.iat === 'number' &&
    (record.exp === undefined || typeof record.exp === 'number')
  );
}

function parseTtlSeconds(ttl: string) {
  const match = /^(\d+)([smhd])$/.exec(ttl);
  if (!match) {
    throw new Error(`Unsupported token ttl: ${ttl}`);
  }

  const value = Number(match[1]);
  const unit = match[2];
  const multipliers = {
    s: 1,
    m: 60,
    h: 60 * 60,
    d: 24 * 60 * 60
  };

  return value * multipliers[unit as keyof typeof multipliers];
}
