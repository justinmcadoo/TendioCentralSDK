import type { TendioTokenSet, TendioLogger } from '../types.js';
import { TendioAuthError } from '../types.js';

export async function exchangeCodeForTokens(
  tokenUrl: string,
  code: string,
  redirectUri: string,
  clientId: string,
  clientSecret: string,
  codeVerifier: string,
  logger: TendioLogger,
): Promise<{ tokenSet: TendioTokenSet; rawIdToken: string }> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
    code_verifier: codeVerifier,
  });

  const response = await fetchWithRateLimitHandling(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  }, 'token_exchange_failed', logger);

  const data = await response.json() as Record<string, unknown>;

  const accessToken = data.access_token as string;
  const refreshToken = data.refresh_token as string;
  const idToken = data.id_token as string;
  const expiresIn = (data.expires_in as number) || 3600;

  return {
    tokenSet: {
      access_token: accessToken,
      refresh_token: refreshToken,
      id_token: idToken,
      expires_at: Math.floor(Date.now() / 1000) + expiresIn,
    },
    rawIdToken: idToken,
  };
}

export async function refreshAccessToken(
  tokenUrl: string,
  refreshToken: string,
  clientId: string,
  clientSecret: string,
  logger: TendioLogger,
): Promise<TendioTokenSet> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const response = await fetchWithRateLimitHandling(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  }, 'token_refresh_failed', logger);

  const data = await response.json() as Record<string, unknown>;

  return {
    access_token: data.access_token as string,
    refresh_token: (data.refresh_token as string) || refreshToken,
    id_token: (data.id_token as string) || '',
    expires_at: Math.floor(Date.now() / 1000) + ((data.expires_in as number) || 3600),
  };
}

export async function revokeToken(
  revokeUrl: string,
  token: string,
  clientId: string,
  clientSecret: string,
  logger: TendioLogger,
): Promise<void> {
  const body = new URLSearchParams({
    token,
    client_id: clientId,
    client_secret: clientSecret,
  });

  try {
    const response = await fetch(revokeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (response.status === 429) {
      const retryAfter = parseInt(response.headers.get('Retry-After') || '60', 10);
      throw new TendioAuthError(
        'rate_limited',
        `Rate limited during token revocation. Retry after ${retryAfter} seconds.`,
        { statusCode: 429, retryAfter },
      );
    }

    if (!response.ok && response.status !== 400) {
      logger.warn(`[TendioAuth] Token revocation returned HTTP ${response.status}`);
    }
  } catch (err) {
    if (err instanceof TendioAuthError) throw err;
    throw new TendioAuthError(
      'token_revocation_failed',
      `Token revocation failed: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
}

async function fetchWithRateLimitHandling(
  url: string,
  init: RequestInit,
  errorCode: 'token_exchange_failed' | 'token_refresh_failed',
  logger: TendioLogger,
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (err) {
    throw new TendioAuthError(
      'network_error',
      `Network error calling ${url}: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
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
    let errorBody = '';
    try { errorBody = await response.text(); } catch { /* ignore */ }
    throw new TendioAuthError(
      errorCode,
      `${errorCode}: HTTP ${response.status} — ${errorBody}`,
      { statusCode: response.status },
    );
  }

  return response;
}
