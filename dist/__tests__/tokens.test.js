import { describe, it, expect, vi } from 'vitest';
import { TendioAuth } from '../core/client.js';
function makeAuth() {
    const auth = new TendioAuth({
        clientId: 'test-client',
        clientSecret: 'test-secret',
        redirectUri: 'http://localhost/callback',
        tendiocentralUrl: 'https://central.example.com',
    });
    return auth;
}
function makeTokens(expiresInSeconds) {
    return {
        access_token: 'at_test',
        refresh_token: 'rt_test',
        id_token: 'idt_test',
        expires_at: Math.floor(Date.now() / 1000) + expiresInSeconds,
    };
}
describe('shouldRefreshTokens', () => {
    const auth = makeAuth();
    it('returns true when token expires in less than 5 minutes', () => {
        const tokens = makeTokens(200);
        expect(auth.shouldRefreshTokens(tokens)).toBe(true);
    });
    it('returns false when token expires in more than 5 minutes', () => {
        const tokens = makeTokens(600);
        expect(auth.shouldRefreshTokens(tokens)).toBe(false);
    });
    it('returns true when token is already expired', () => {
        const tokens = makeTokens(-60);
        expect(auth.shouldRefreshTokens(tokens)).toBe(true);
    });
});
describe('refresh mutex', () => {
    it('concurrent calls with same refresh token return the same promise', async () => {
        const auth = makeAuth();
        const mockTokenSet = {
            access_token: 'new_at',
            refresh_token: 'new_rt',
            id_token: 'new_idt',
            expires_at: Math.floor(Date.now() / 1000) + 3600,
        };
        const mockAppConfig = {
            appId: 'app1',
            appName: 'Test',
            environment: 'production',
            homepageUrl: null,
            ssoLoginUrl: null,
            redirectUris: ['http://localhost/callback'],
            logoUrl: null,
            isActive: true,
            ssoBaseUrl: 'https://sso.example.com',
            authorizeUrl: 'https://sso.example.com/authorize',
            tokenUrl: 'https://sso.example.com/token',
            userinfoUrl: 'https://sso.example.com/userinfo',
            discoveryUrl: 'https://sso.example.com/.well-known',
            jwksUri: 'https://sso.example.com/.well-known/jwks.json',
            revokeUrl: 'https://sso.example.com/revoke',
            allowsCaregivers: false,
            serverVersion: '1.0.0',
            webhookConfigured: false,
            autoRegisterUris: true,
            roles: [],
        };
        auth.appConfig = mockAppConfig;
        let resolveFetch;
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise((resolve) => { resolveFetch = resolve; }));
        const tokens = makeTokens(100);
        const promise1 = auth.refreshTokens(tokens);
        const promise2 = auth.refreshTokens(tokens);
        resolveFetch(new Response(JSON.stringify(mockTokenSet), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        }));
        const [result1, result2] = await Promise.all([promise1, promise2]);
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        expect(result1.access_token).toBe(result2.access_token);
        expect(result1.refresh_token).toBe(result2.refresh_token);
        fetchSpy.mockRestore();
    });
});
//# sourceMappingURL=tokens.test.js.map