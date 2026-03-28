import crypto from 'crypto';
import type { PKCECodes } from './types.js';

export function generatePKCE(): PKCECodes {
  const buf = crypto.randomBytes(64);
  const codeVerifier = buf.toString('base64url');
  const hash = crypto.createHash('sha256').update(codeVerifier).digest();
  const codeChallenge = hash.toString('base64url');
  return { codeVerifier, codeChallenge };
}

export function generateState(): string {
  return crypto.randomBytes(32).toString('hex');
}
