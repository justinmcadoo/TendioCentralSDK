import { TendioAuthError } from '../types.js';
function basicAuthHeader(clientId, clientSecret) {
    return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
}
export async function fetchUser(baseUrl, clientId, clientSecret, userId, logger) {
    const url = `${baseUrl}/api/internal/users/${encodeURIComponent(userId)}`;
    const response = await managementFetch(url, clientId, clientSecret, 'GET', logger);
    if (response.status === 404) {
        throw new TendioAuthError('user_not_found', `User not found: ${userId}`, { statusCode: 404 });
    }
    if (!response.ok) {
        throw new TendioAuthError('network_error', `Failed to fetch user: HTTP ${response.status}`, { statusCode: response.status });
    }
    return await response.json();
}
export async function fetchAllUsers(baseUrl, clientId, clientSecret, logger) {
    const url = `${baseUrl}/api/internal/users/bulk`;
    const response = await managementFetch(url, clientId, clientSecret, 'GET', logger);
    if (!response.ok) {
        throw new TendioAuthError('network_error', `Failed to fetch all users: HTTP ${response.status}`, { statusCode: response.status });
    }
    const data = await response.json();
    return Array.isArray(data) ? data : data.users;
}
export async function triggerSync(baseUrl, clientId, clientSecret, logger) {
    const url = `${baseUrl}/api/internal/sync-staff-users`;
    const response = await managementFetch(url, clientId, clientSecret, 'POST', logger);
    if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new TendioAuthError('sync_failed', `Sync failed: HTTP ${response.status} — ${body}`, { statusCode: response.status });
    }
    const data = await response.json();
    return {
        success: data.success ?? true,
        total_from_tendio: data.totalFromTendio ?? 0,
        created: data.created ?? 0,
        updated: data.updated ?? 0,
        deactivated: data.deactivated ?? 0,
        locations_synced: data.locationsSynced ?? 0,
        roles_enriched: data.rolesEnriched ?? 0,
        roles_failed: data.rolesFailed ?? 0,
        duration_ms: data.durationMs ?? 0,
    };
}
async function managementFetch(url, clientId, clientSecret, method, logger) {
    let response;
    try {
        response = await fetch(url, {
            method,
            headers: {
                'Authorization': basicAuthHeader(clientId, clientSecret),
                'Accept': 'application/json',
            },
        });
    }
    catch (err) {
        throw new TendioAuthError('network_error', `Network error calling ${url}: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
    }
    if (response.status === 401) {
        throw new TendioAuthError('invalid_credentials', 'Invalid clientId or clientSecret for Internal API', { statusCode: 401 });
    }
    if (response.status === 403) {
        throw new TendioAuthError('application_disabled', 'Application is disabled or lacks permission for this endpoint', { statusCode: 403 });
    }
    if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get('Retry-After') || '60', 10);
        throw new TendioAuthError('rate_limited', `Rate limited by TendioCentral Internal API. Retry after ${retryAfter} seconds.`, { statusCode: 429, retryAfter });
    }
    return response;
}
//# sourceMappingURL=management.js.map