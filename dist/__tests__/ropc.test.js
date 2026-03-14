import { describe, it, expect, vi, afterEach } from 'vitest';
import * as jose from 'jose';
import { TendioAuth } from '../core/client.js';
import { TendioAuthError } from '../types.js';
const TEST_CLIENT_ID = 'test-client-id';
const TEST_ISSUER = 'https://sso.example.com';
async function makeSignedIdToken() {
    const { privateKey } = await jose.generateKeyPair('RS256');
    const publicJwk = await jose.exportJWK((await jose.generateKeyPair('RS256')).publicKey);
    const keyPair = await jose.generateKeyPair('RS256');
    const pubJwk = await jose.exportJWK(keyPair.publicKey);
    pubJwk.kid = 'test-key-1';
    pubJwk.use = 'sig';
    pubJwk.alg = 'RS256';
    const jwt = await new jose.SignJWT({
        sub: 'user_123',
        email: 'test@example.com',
        name: 'Test User',
        first_name: 'Test',
        last_name: 'User',
        user_type: 'staff',
        role: 'admin',
        role_id: 'role_1',
        tendio_role: 'Admin',
        tendio_role_id: 'tr_1',
        tenant: 'acme',
        tenant_id: 'tenant_1',
        location: 'HQ',
        location_id: 1,
        primary_location_id: 1,
        primary_location_name: 'HQ',
        locations: [{ id: 1, name: 'HQ', is_primary: true }],
        timezone: 'America/New_York',
        timezone_id: 1,
        tendio_user_id: 'tu_123',
        portal_url: 'https://portal.example.com',
    })
        .setProtectedHeader({ alg: 'RS256', kid: 'test-key-1' })
        .setIssuer(TEST_ISSUER)
        .setAudience(TEST_CLIENT_ID)
        .setExpirationTime('1h')
        .setIssuedAt()
        .sign(keyPair.privateKey);
    return { jwt, jwks: { keys: [pubJwk] } };
}
function makeAuth(allowCredentials = false) {
    return new TendioAuth({
        clientId: TEST_CLIENT_ID,
        clientSecret: 'test-secret',
        redirectUri: 'http://localhost/callback',
        tendiocentralUrl: 'https://central.example.com',
        allowCredentialsLogin: allowCredentials,
        logger: {
            info: () => { },
            error: () => { },
            warn: () => { },
        },
    });
}
function setAppConfig(auth) {
    auth.appConfig = {
        appId: 'app1',
        appName: 'Test',
        environment: 'production',
        homepageUrl: null,
        ssoLoginUrl: null,
        redirectUris: ['http://localhost/callback'],
        logoUrl: null,
        isActive: true,
        ssoBaseUrl: TEST_ISSUER,
        authorizeUrl: `${TEST_ISSUER}/authorize`,
        tokenUrl: `${TEST_ISSUER}/token`,
        userinfoUrl: `${TEST_ISSUER}/userinfo`,
        discoveryUrl: `${TEST_ISSUER}/.well-known`,
        jwksUri: `${TEST_ISSUER}/.well-known/jwks.json`,
        revokeUrl: `${TEST_ISSUER}/revoke`,
        allowsCaregivers: false,
        serverVersion: '1.0.0',
        webhookConfigured: false,
        roles: [],
    };
    auth.issuerUrl = TEST_ISSUER;
}
describe('loginWithCredentials', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });
    it('throws credentials_login_disabled when allowCredentialsLogin is false', async () => {
        const auth = makeAuth(false);
        setAppConfig(auth);
        await expect(auth.loginWithCredentials('test@example.com', 'pass', 'acme')).rejects.toThrow(TendioAuthError);
        try {
            await auth.loginWithCredentials('test@example.com', 'pass', 'acme');
        }
        catch (err) {
            expect(err.code).toBe('credentials_login_disabled');
        }
    });
    it('returns TendioUser on successful credentials login', async () => {
        const auth = makeAuth(true);
        setAppConfig(auth);
        const { jwt, jwks } = await makeSignedIdToken();
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
            const urlStr = typeof url === 'string' ? url : url.toString();
            if (urlStr.includes('/token')) {
                return new Response(JSON.stringify({
                    access_token: 'at_new',
                    refresh_token: 'rt_new',
                    id_token: jwt,
                    expires_in: 3600,
                }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }
            if (urlStr.includes('/jwks')) {
                return new Response(JSON.stringify(jwks), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                });
            }
            return new Response('Not Found', { status: 404 });
        });
        const initJWKS = await import('../core/jwks.js');
        await initJWKS.initJWKS(`${TEST_ISSUER}/.well-known/jwks.json`, auth.logger);
        const result = await auth.loginWithCredentials('test@example.com', 'password123', 'acme');
        expect(result.user).toBeDefined();
        expect(result.user.sub).toBe('user_123');
        expect(result.user.email).toBe('test@example.com');
        expect(result.user.name).toBe('Test User');
        expect(result.tokens).toBeDefined();
        expect(result.tokens.access_token).toBe('at_new');
        fetchSpy.mockRestore();
    });
    it('throws TendioAuthError on 400 invalid_grant', async () => {
        const auth = makeAuth(true);
        setAppConfig(auth);
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: 'invalid_grant' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        }));
        await expect(auth.loginWithCredentials('bad@example.com', 'wrong', 'acme')).rejects.toThrow(TendioAuthError);
        try {
            await auth.loginWithCredentials('bad@example.com', 'wrong', 'acme');
        }
        catch (err) {
            expect(err.code).toBe('token_exchange_failed');
            expect(err.statusCode).toBe(400);
        }
        fetchSpy.mockRestore();
    });
});
//# sourceMappingURL=ropc.test.js.map