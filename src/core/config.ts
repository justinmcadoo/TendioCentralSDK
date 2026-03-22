import type { AppConfig, TendioLogger } from '../types.js';
import { TendioAuthError } from '../types.js';

export async function fetchAppConfig(
  baseUrl: string,
  clientId: string,
  clientSecret: string,
  logger: TendioLogger,
  environment: string = 'production',
): Promise<AppConfig> {
  const url = `${baseUrl}/api/apps/config?env=${environment}`;
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Accept': 'application/json',
      },
    });
  } catch (err) {
    throw new TendioAuthError(
      'config_fetch_failed',
      `Failed to connect to TendioCentral at ${baseUrl}: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }

  if (response.status === 401) {
    throw new TendioAuthError(
      'invalid_credentials',
      'Invalid clientId or clientSecret — TendioCentral returned 401',
      { statusCode: 401 },
    );
  }

  if (response.status === 429) {
    const retryAfter = parseInt(response.headers.get('Retry-After') || '60', 10);
    throw new TendioAuthError(
      'rate_limited',
      `Rate limited by TendioCentral. Retry after ${retryAfter} seconds.`,
      { statusCode: 429, retryAfter },
    );
  }

  if (!response.ok) {
    throw new TendioAuthError(
      'config_fetch_failed',
      `Failed to fetch app config: HTTP ${response.status}`,
      { statusCode: response.status },
    );
  }

  const config = await response.json() as AppConfig;

  if (!config.isActive) {
    throw new TendioAuthError(
      'application_disabled',
      `Application '${config.appName}' is disabled in TendioCentral.`,
    );
  }

  logger.info(`[TendioAuth] Loaded config for "${config.appName}" (${config.environment})`);

  return config;
}

export async function registerUris(
  baseUrl: string,
  clientId: string,
  clientSecret: string,
  environment: string,
  redirectUri?: string,
  webhookUrl?: string,
  logger?: TendioLogger,
): Promise<AppConfig> {
  const url = `${baseUrl}/api/apps/register-uris`;
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const body: Record<string, string> = { environment };
  if (redirectUri) body.redirectUri = redirectUri;
  if (webhookUrl) body.webhookUrl = webhookUrl;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new TendioAuthError(
      'uri_registration_failed',
      `Auto-registration failed: HTTP ${response.status}${text ? ` — ${text}` : ''}`,
      { statusCode: response.status },
    );
  }

  return await response.json() as AppConfig;
}

export function validateRedirectUri(redirectUri: string, registeredUris: string[]): void {
  if (!registeredUris.includes(redirectUri)) {
    throw new TendioAuthError(
      'invalid_redirect_uri',
      `Redirect URI "${redirectUri}" is not registered in TendioCentral. ` +
      `Registered URIs: ${registeredUris.join(', ')}`,
    );
  }
}

export function validateRoles(roleNames: string[], registeredRoles: Array<{ name: string }>): void {
  const validNames = new Set(registeredRoles.map(r => r.name.toLowerCase()));
  for (const name of roleNames) {
    if (!validNames.has(name.toLowerCase())) {
      throw new TendioAuthError(
        'invalid_role',
        `Role "${name}" is not configured for this application. ` +
        `Available roles: ${registeredRoles.map(r => r.name).join(', ')}`,
      );
    }
  }
}
