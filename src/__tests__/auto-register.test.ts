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
  autoRegisterUris: true,
  roles: [],
};

const FULLY_REGISTERED_CONFIG = {
  ...BASE_APP_CONFIG,
  redirectUris: ['http://localhost:3000/callback'],
  homepageUrl: 'http://localhost:3000',
  ssoLoginUrl: 'http://localhost:3000/auth/login',
  webhookConfigured: true,
};

const silentLogger = {
  info: () => {},
  error: () => {},
  warn: () => {},
};

function mockFetch(configResponse: object, registerResponse?: object) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, opts) => {
    const urlStr = typeof url === 'string' ? url : url.toString();

    if (urlStr.includes('/api/apps/config')) {
      return new Response(JSON.stringify(configResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (urlStr.includes('/api/apps/register-uris')) {
      if (registerResponse) {
        return new Response(JSON.stringify(registerResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ error: 'unexpected' }), { status: 400 });
    }

    if (urlStr.includes('/jwks')) {
      return new Response(JSON.stringify({ keys: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not Found', { status: 404 });
  });
}

function getRegisterCalls(fetchSpy: any) {
  return fetchSpy.mock.calls.filter(
    ([url]: any[]) => (typeof url === 'string' ? url : url.toString()).includes('/register-uris'),
  );
}

function getRegisterBody(fetchSpy: any, index = 0) {
  const calls = getRegisterCalls(fetchSpy);
  return JSON.parse((calls[index][1] as any).body);
}

describe('autoRegisterUris', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls POST /api/apps/register-uris when redirect URI is missing', async () => {
    const configWithoutUri = { ...BASE_APP_CONFIG, redirectUris: [] };
    const configWithUri = { ...BASE_APP_CONFIG, redirectUris: ['http://localhost:3000/callback'], homepageUrl: 'http://localhost:3000' };

    const fetchSpy = mockFetch(configWithoutUri, configWithUri);

    const auth = await TendioAuth.fromConfig({
      clientId: TEST_CLIENT_ID,
      clientSecret: 'test-secret',
      redirectUri: 'http://localhost:3000/callback',
      tendiocentralUrl: 'https://central.example.com',
      environment: 'development',
      autoRegisterUris: true,
      logger: silentLogger,
    });

    expect(getRegisterCalls(fetchSpy).length).toBe(1);
    const body = getRegisterBody(fetchSpy);
    expect(body.redirectUri).toBe('http://localhost:3000/callback');
    expect(body.environment).toBe('development');
    expect(auth.getAppConfig().redirectUris).toContain('http://localhost:3000/callback');
  });

  it('skips registration when everything is already registered', async () => {
    const fetchSpy = mockFetch(FULLY_REGISTERED_CONFIG);

    await TendioAuth.fromConfig({
      clientId: TEST_CLIENT_ID,
      clientSecret: 'test-secret',
      redirectUri: 'http://localhost:3000/callback',
      tendiocentralUrl: 'https://central.example.com',
      environment: 'development',
      autoRegisterUris: true,
      logger: silentLogger,
    });

    expect(getRegisterCalls(fetchSpy).length).toBe(0);
  });

  it('continues with warning when auto-registration fails', async () => {
    const configWithoutUri = { ...BASE_APP_CONFIG, redirectUris: [] };

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
    const fetchSpy = mockFetch(FULLY_REGISTERED_CONFIG);

    await TendioAuth.fromConfig({
      clientId: TEST_CLIENT_ID,
      clientSecret: 'test-secret',
      redirectUri: 'http://localhost:3000/callback',
      tendiocentralUrl: 'https://central.example.com',
      environment: 'development',
      logger: silentLogger,
    });

    expect(getRegisterCalls(fetchSpy).length).toBe(0);
  });

  it('registers webhook URL when redirect URI exists but webhook is not configured', async () => {
    const configNoWebhook = {
      ...FULLY_REGISTERED_CONFIG,
      webhookConfigured: false,
    };
    const configWithWebhook = {
      ...FULLY_REGISTERED_CONFIG,
      webhookConfigured: true,
    };

    const fetchSpy = mockFetch(configNoWebhook, configWithWebhook);

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

    expect(getRegisterCalls(fetchSpy).length).toBe(1);
    const body = getRegisterBody(fetchSpy);
    expect(body.webhookUrl).toBe('https://myapp.com/webhooks/tendio');
    expect(body.redirectUri).toBeUndefined();
  });

  it('derives homepageUrl from redirectUri origin', async () => {
    const configNoHomepage = { ...BASE_APP_CONFIG, redirectUris: [], homepageUrl: null };
    const configComplete = { ...BASE_APP_CONFIG, redirectUris: ['https://myapp.com/auth/callback'], homepageUrl: 'https://myapp.com' };

    const fetchSpy = mockFetch(configNoHomepage, configComplete);

    await TendioAuth.fromConfig({
      clientId: TEST_CLIENT_ID,
      clientSecret: 'test-secret',
      redirectUri: 'https://myapp.com/auth/callback',
      tendiocentralUrl: 'https://central.example.com',
      environment: 'development',
      autoRegisterUris: true,
      logger: silentLogger,
    });

    const body = getRegisterBody(fetchSpy);
    expect(body.homepageUrl).toBe('https://myapp.com');
  });

  it('sends ssoLoginUrl when provided and not yet registered', async () => {
    const configNoSso = { ...BASE_APP_CONFIG, redirectUris: [], ssoLoginUrl: null };
    const configComplete = {
      ...BASE_APP_CONFIG,
      redirectUris: ['https://myapp.com/auth/callback'],
      ssoLoginUrl: 'https://myapp.com/api/auth/sso/login',
      homepageUrl: 'https://myapp.com',
    };

    const fetchSpy = mockFetch(configNoSso, configComplete);

    await TendioAuth.fromConfig({
      clientId: TEST_CLIENT_ID,
      clientSecret: 'test-secret',
      redirectUri: 'https://myapp.com/auth/callback',
      tendiocentralUrl: 'https://central.example.com',
      environment: 'development',
      autoRegisterUris: true,
      ssoLoginUrl: 'https://myapp.com/api/auth/sso/login',
      logger: silentLogger,
    });

    const body = getRegisterBody(fetchSpy);
    expect(body.ssoLoginUrl).toBe('https://myapp.com/api/auth/sso/login');
    expect(body.redirectUri).toBe('https://myapp.com/auth/callback');
    expect(body.homepageUrl).toBe('https://myapp.com');
  });

  it('sends all fields in a single registration call', async () => {
    const emptyConfig = { ...BASE_APP_CONFIG, redirectUris: [], homepageUrl: null, ssoLoginUrl: null, webhookConfigured: false };
    const fullConfig = {
      ...BASE_APP_CONFIG,
      redirectUris: ['https://myapp.com/auth/callback'],
      homepageUrl: 'https://myapp.com',
      ssoLoginUrl: 'https://myapp.com/api/auth/sso/login',
      webhookConfigured: true,
    };

    const fetchSpy = mockFetch(emptyConfig, fullConfig);

    await TendioAuth.fromConfig({
      clientId: TEST_CLIENT_ID,
      clientSecret: 'test-secret',
      redirectUri: 'https://myapp.com/auth/callback',
      tendiocentralUrl: 'https://central.example.com',
      environment: 'development',
      autoRegisterUris: true,
      ssoLoginUrl: 'https://myapp.com/api/auth/sso/login',
      webhookUrl: 'https://myapp.com/webhooks/tendio',
      webhookSecret: 'wh-secret',
      logger: silentLogger,
    });

    expect(getRegisterCalls(fetchSpy).length).toBe(1);
    const body = getRegisterBody(fetchSpy);
    expect(body.redirectUri).toBe('https://myapp.com/auth/callback');
    expect(body.webhookUrl).toBe('https://myapp.com/webhooks/tendio');
    expect(body.homepageUrl).toBe('https://myapp.com');
    expect(body.ssoLoginUrl).toBe('https://myapp.com/api/auth/sso/login');
    expect(body.environment).toBe('development');
  });

  it('skips registration when server has autoRegisterUris set to false', async () => {
    const serverDisabled = {
      ...BASE_APP_CONFIG,
      redirectUris: [],
      autoRegisterUris: false,
    };

    const infoSpy = vi.fn();
    const logger = { ...silentLogger, info: infoSpy };

    const fetchSpy = mockFetch(serverDisabled);

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

    expect(getRegisterCalls(fetchSpy).length).toBe(0);
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining('disabled for this application'),
    );
  });

  it('handles 403 auto_registration_disabled gracefully', async () => {
    const configWithoutUri = { ...BASE_APP_CONFIG, redirectUris: [] };

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
        return new Response(
          JSON.stringify({ error: 'auto_registration_disabled', error_description: 'Disabled by admin' }),
          { status: 403, headers: { 'Content-Type': 'application/json' } },
        );
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
      expect.stringContaining('disabled for this application by an admin'),
    );
  });
});
