import { randomBytes, createHash } from 'node:crypto';
export function generateCodeVerifier() {
    return randomBytes(32)
        .toString('base64url')
        .slice(0, 43);
}
export function generateCodeChallenge(verifier) {
    return createHash('sha256')
        .update(verifier)
        .digest('base64url');
}
export function generateState() {
    return randomBytes(16).toString('hex');
}
//# sourceMappingURL=pkce.js.map