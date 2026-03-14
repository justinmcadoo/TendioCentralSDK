import { describe, it, expect } from 'vitest';
import { generateCodeVerifier, generateCodeChallenge, generateState } from '../core/pkce.js';

describe('generatePKCE', () => {
  it('returns a codeVerifier and codeChallenge', () => {
    const verifier = generateCodeVerifier();
    const challenge = generateCodeChallenge(verifier);

    expect(typeof verifier).toBe('string');
    expect(typeof challenge).toBe('string');
  });

  it('codeVerifier is a non-empty string', () => {
    const verifier = generateCodeVerifier();
    expect(verifier.length).toBeGreaterThan(0);
  });

  it('codeChallenge is different from codeVerifier', () => {
    const verifier = generateCodeVerifier();
    const challenge = generateCodeChallenge(verifier);
    expect(challenge).not.toBe(verifier);
  });

  it('codeChallenge is base64url encoded (no +, /, =)', () => {
    const verifier = generateCodeVerifier();
    const challenge = generateCodeChallenge(verifier);

    expect(challenge).not.toMatch(/[+/=]/);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('two calls produce different values (randomness)', () => {
    const verifier1 = generateCodeVerifier();
    const verifier2 = generateCodeVerifier();

    expect(verifier1).not.toBe(verifier2);
  });

  it('generateState produces a hex string', () => {
    const state = generateState();
    expect(state.length).toBe(32);
    expect(state).toMatch(/^[0-9a-f]+$/);
  });
});
