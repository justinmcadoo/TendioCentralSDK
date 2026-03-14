import * as jose from 'jose';
import { TendioAuthError } from '../types.js';
let cachedJWKS = null;
let jwksUri = '';
export async function initJWKS(uri, logger) {
    jwksUri = uri;
    try {
        const response = await fetch(uri);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        cachedJWKS = await response.json();
        logger.info(`[TendioAuth] JWKS cached from ${uri} (${cachedJWKS.keys.length} keys)`);
    }
    catch (err) {
        throw new TendioAuthError('jwks_fetch_failed', `Failed to fetch JWKS from ${uri}: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
    }
}
export async function refreshJWKS() {
    if (!jwksUri)
        return;
    try {
        const response = await fetch(jwksUri);
        if (response.ok) {
            cachedJWKS = await response.json();
        }
    }
    catch {
        // Silently fail on refresh — use cached keys
    }
}
export async function verifyIdToken(idToken, clientId, issuer) {
    if (!cachedJWKS) {
        throw new TendioAuthError('jwks_fetch_failed', 'JWKS not initialized — call TendioAuth.fromConfig() or init() first');
    }
    let payload;
    try {
        const keySet = jose.createLocalJWKSet(cachedJWKS);
        const result = await jose.jwtVerify(idToken, keySet, {
            issuer,
            audience: clientId,
        });
        payload = result.payload;
    }
    catch (err) {
        if (err instanceof jose.errors.JWKSNoMatchingKey) {
            await refreshJWKS();
            if (!cachedJWKS) {
                throw new TendioAuthError('token_verification_failed', 'ID token verification failed: no matching key in JWKS', { cause: err });
            }
            try {
                const keySet = jose.createLocalJWKSet(cachedJWKS);
                const result = await jose.jwtVerify(idToken, keySet, {
                    issuer,
                    audience: clientId,
                });
                payload = result.payload;
            }
            catch (retryErr) {
                throw new TendioAuthError('token_verification_failed', `ID token verification failed after JWKS refresh: ${retryErr instanceof Error ? retryErr.message : String(retryErr)}`, { cause: retryErr });
            }
        }
        else {
            throw new TendioAuthError('token_verification_failed', `ID token verification failed: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
        }
    }
    const locations = Array.isArray(payload.locations)
        ? payload.locations
        : [];
    return {
        sub: payload.sub || '',
        email: payload.email || '',
        name: payload.name || '',
        first_name: payload.first_name ?? null,
        last_name: payload.last_name ?? null,
        profile_image_url: payload.profile_image_url ?? null,
        user_type: payload.user_type || 'staff',
        role: payload.role || '',
        role_id: payload.role_id || '',
        tendio_role: payload.tendio_role || '',
        tendio_role_id: payload.tendio_role_id || '',
        tenant: payload.tenant || '',
        tenant_id: payload.tenant_id || '',
        location: payload.location || '',
        location_id: payload.location_id || 0,
        primary_location_id: payload.primary_location_id || 0,
        primary_location_name: payload.primary_location_name || '',
        locations,
        timezone: payload.timezone || '',
        timezone_id: payload.timezone_id || 0,
        tendio_user_id: payload.tendio_user_id || '',
        portal_url: payload.portal_url || '',
    };
}
//# sourceMappingURL=jwks.js.map