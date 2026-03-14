import * as jose from 'jose';
import type { TendioUser, TendioLocation, TendioLogger } from '../types.js';
import { TendioAuthError } from '../types.js';

let cachedJWKS: jose.JSONWebKeySet | null = null;
let jwksUri: string = '';

export async function initJWKS(uri: string, logger: TendioLogger): Promise<void> {
  jwksUri = uri;
  try {
    const response = await fetch(uri);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    cachedJWKS = await response.json() as jose.JSONWebKeySet;
    logger.info(`[TendioAuth] JWKS cached from ${uri} (${cachedJWKS.keys.length} keys)`);
  } catch (err) {
    throw new TendioAuthError(
      'jwks_fetch_failed',
      `Failed to fetch JWKS from ${uri}: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
}

export async function refreshJWKS(): Promise<void> {
  if (!jwksUri) return;
  try {
    const response = await fetch(jwksUri);
    if (response.ok) {
      cachedJWKS = await response.json() as jose.JSONWebKeySet;
    }
  } catch {
    // Silently fail on refresh — use cached keys
  }
}

export async function verifyIdToken<TRoles extends string = string>(
  idToken: string,
  clientId: string,
  issuer: string,
): Promise<TendioUser<TRoles>> {
  if (!cachedJWKS) {
    throw new TendioAuthError(
      'jwks_fetch_failed',
      'JWKS not initialized — call TendioAuth.fromConfig() or init() first',
    );
  }

  let payload: jose.JWTPayload;
  try {
    const keySet = jose.createLocalJWKSet(cachedJWKS);
    const result = await jose.jwtVerify(idToken, keySet, {
      issuer,
      audience: clientId,
    });
    payload = result.payload;
  } catch (err) {
    if (err instanceof jose.errors.JWKSNoMatchingKey) {
      await refreshJWKS();
      if (!cachedJWKS) {
        throw new TendioAuthError(
          'token_verification_failed',
          'ID token verification failed: no matching key in JWKS',
          { cause: err },
        );
      }
      try {
        const keySet = jose.createLocalJWKSet(cachedJWKS);
        const result = await jose.jwtVerify(idToken, keySet, {
          issuer,
          audience: clientId,
        });
        payload = result.payload;
      } catch (retryErr) {
        throw new TendioAuthError(
          'token_verification_failed',
          `ID token verification failed after JWKS refresh: ${retryErr instanceof Error ? retryErr.message : String(retryErr)}`,
          { cause: retryErr },
        );
      }
    } else {
      throw new TendioAuthError(
        'token_verification_failed',
        `ID token verification failed: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }
  }

  const locations: TendioLocation[] = Array.isArray(payload.locations)
    ? (payload.locations as TendioLocation[])
    : [];

  return {
    sub: payload.sub || '',
    email: (payload.email as string) || '',
    name: (payload.name as string) || '',
    first_name: (payload.first_name as string | null) ?? null,
    last_name: (payload.last_name as string | null) ?? null,
    profile_image_url: (payload.profile_image_url as string | null) ?? null,
    user_type: (payload.user_type as 'staff' | 'caregiver') || 'staff',

    role: (payload.role as TRoles) || ('' as TRoles),
    role_id: (payload.role_id as string) || '',
    tendio_role: (payload.tendio_role as string) || '',
    tendio_role_id: (payload.tendio_role_id as string) || '',

    tenant: (payload.tenant as string) || '',
    tenant_id: (payload.tenant_id as string) || '',

    location: (payload.location as string) || '',
    location_id: (payload.location_id as number) || 0,
    primary_location_id: (payload.primary_location_id as number) || 0,
    primary_location_name: (payload.primary_location_name as string) || '',
    locations,

    timezone: (payload.timezone as string) || '',
    timezone_id: (payload.timezone_id as number) || 0,

    tendio_user_id: (payload.tendio_user_id as string) || '',
    portal_url: (payload.portal_url as string) || '',
  };
}
