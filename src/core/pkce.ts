import { randomBytes, createHash } from 'node:crypto';

export function generateCodeVerifier(): string {
  return randomBytes(32)
    .toString('base64url')
    .slice(0, 43);
}

export function generateCodeChallenge(verifier: string): string {
  return createHash('sha256')
    .update(verifier)
    .digest('base64url');
}

export function generateState(): string {
  return randomBytes(16).toString('hex');
}
