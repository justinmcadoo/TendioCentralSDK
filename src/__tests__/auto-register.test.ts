import { describe, it, expect, vi, afterEach } from 'vitest';
import { TendioAuth } from '../core/client.js';

const TEST_CLIENT_ID = 'test-client-id';
const TEST_ISSUER = 'https://sso.example.com';

const BASE_APP_CONFIG = {
  appId: 'app1',
  appName: 'Test',
  environment: 'development',
  homepageUrl: null,
  ssoLoginUrl: null,
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

const silentLogger = {
  info: () => {},
  error: () => {},
  warn: () => {},
};

describe('autoRegisterUris', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls POST /api/apps/register-uris when redirect URI is missing', async () => {
    const configWithoutUri = {
      ...BASE_APP_CONFIG,
      redirectUris: [],
    };
    const configWithUri = {
      ...BASE_APP_CONFIG,
      redirectUris: ['http://localhost:3000/callback'],
    };

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, opts) => {
      const urlStr = typeof url === 'string' ? url : url.toString();

      if (urlStr.includes('/api/apps/config')) {
        return new Response(JSON.stringify(configWithoutUri), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (urlStr.includes('/api/apps/register-uris')) {
        const body = JSON.parse((opts as any).body);
        expect(body.redirectUri).toBe('http://localhost:3000/callback');
        expect(body.environment).toBe('development');
        return new Response(JSON.stringify(configWithUri), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (urlStr.includes('/jwks')) {
        return new Response(JSON.stringify({ keys: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response('Not Found', { status: 404 });
    });

    const auth = await TendioAuth.fromConfig({
      clientId: TEST_CLIENT_ID,
      clientSecret: 'test-secret',
      redirectUri: 'http://localhost:3000/callback',
      tendiocentralUrl: 'https://central.example.com',
      environment: 'development',
      autoRegisterUris: true,
      logger: silentLogger,
    });

    const registerCalls = fetchSpy.mock.calls.filter(
      ([url]) => (typeof url === 'string' ? url : url.toString()).includes('/register-uris'),
    );
    expect(registerCalls.length).toBe(1);

    expect(auth.getAppConfig().redirectUris).toContain('http://localhost:3000/callback');
  });

  it('skips registration when redirect URI is already registered', async () => {
    const configWithUri = {
      ...BASE_APP_CONFIG,
      redirectUris: ['http://localhost:3000/callback'],
    };

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = typeof url === 'string' ? url : url.toString();

      if (urlStr.includes('/api/apps/config')) {
        return new Response(JSON.stringify(configWithUri), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (urlStr.includes('/jwks')) {
        return new Response(JSON.stringify({ keys: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response('Not Found', { status: 404 });
    });

    await TendioAuth.fromConfig({
      clientId: TEST_CLIENT_ID,
      clientSecret: 'test-secret',
      redirectUri: 'http://localhost:3000/callback',
      tendiocentralUrl: 'https://central.example.com',
      environment: 'development',
      autoRegisterUris: true,
      logger: silentLogger,
    });

    const registerCalls = fetchSpy.mock.calls.filter(
      ([url]) => (typeof url === 'string' ? url : url.toString()).includes('/register-uris'),
    );
    expect(registerCalls.length).toBe(0);
  });

  it('continues with warning when auto-registration fails', async () => {
    const configWithoutUri = {
      ...BASE_APP_CONFIG,
      redirectUris: [],
    };

    const warnSpy = vi.fn();
    const logger = { ...silentLogger, warn: warnSpy };

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = typeof url === 'string' ? url : url.toString();

      if (urlStr.includes('/api/apps/config')) {
        return new Response(JSON.stringify(configWithoutUri), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (urlStr.includes('/api/apps/register-uris')) {
        return new Response(JSON.stringify({ error: 'limit_exceeded' }), { status: 400 });
      }

      if (urlStr.includes('/jwks')) {
        return new Response(JSON.stringify({ keys: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response('Not Found', { status: 404 });
    });

    await expect(
      TendioAuth.fromConfig({
        clientId: TEST_CLIENT_ID,
        clientSecret: 'test-secret',
        redirectUri: 'http://localhost:3000/callback',
        tendiocentralUrl: 'https://central.example.com',
        environment: 'development',
        autoRegisterUris: true,
        logger,
      }),
    ).rejects.toThrow('not registered');

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Auto-registration failed'),
    );
  });

  it('does not attempt registration when autoRegisterUris is false', async () => {
    const configWithUri = {
      ...BASE_APP_CONFIG,
      redirectUris: ['http://localhost:3000/callback'],
    };

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = typeof url === 'string' ? url : url.toString();

      if (urlStr.includes('/api/apps/config')) {
        return new Response(JSON.stringify(configWithUri), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (urlStr.includes('/jwks')) {
        return new Response(JSON.stringify({ keys: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response('Not Found', { status: 404 });
    });

    await TendioAuth.fromConfig({
      clientId: TEST_CLIENT_ID,
      clientSecret: 'test-secret',
      redirectUri: 'http://localhost:3000/callback',
      tendiocentralUrl: 'https://central.example.com',
      environment: 'development',
      logger: silentLogger,
    });

    const registerCalls = fetchSpy.mock.calls.filter(
      ([url]) => (typeof url === 'string' ? url : url.toString()).includes('/register-uris'),
    );
    expect(registerCalls.length).toBe(0);
  });

  it('registers webhook URL when redirect URI exists but webhook is not configured', async () => {
    const configNoWebhook = {
      ...BASE_APP_CONFIG,
      redirectUris: ['http://localhost:3000/callback'],
      webhookConfigured: false,
    };
    const configWithWebhook = {
      ...BASE_APP_CONFIG,
      redirectUris: ['http://localhost:3000/callback'],
      webhookConfigured: true,
    };

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, opts) => {
      const urlStr = typeof url === 'string' ? url : url.toString();

      if (urlStr.includes('/api/apps/config')) {
        return new Response(JSON.stringify(configNoWebhook), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (urlStr.includes('/api/apps/register-uris')) {
        const body = JSON.parse((opts as any).body);
        expect(body.webhookUrl).toBe('https://myapp.com/webhooks/tendio');
        expect(body.redirectUri).toBeUndefined();
        return new Response(JSON.stringify(configWithWebhook), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (urlStr.includes('/jwks')) {
        return new Response(JSON.stringify({ keys: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response('Not Found', { status: 404 });
    });

    await TendioAuth.fromConfig({
      clientId: TEST_CLIENT_ID,
      clientSecret: 'test-secret',
      redirectUri: 'http://localhost:3000/callback',
      tendiocentralUrl: 'https://central.example.com',
      environment: 'development',
      autoRegisterUris: true,
      webhookUrl: 'https://myapp.com/webhooks/tendio',
      webhookSecret: 'wh-secret',
      logger: silentLogger,
    });

    const registerCalls = fetchSpy.mock.calls.filter(
      ([url]) => (typeof url === 'string' ? url : url.toString()).includes('/register-uris'),
    );
    expect(registerCalls.length).toBe(1);
  });
});
