export interface TendioAuthConfig<TRoles extends string = string> {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    tendiocentralUrl?: string;
    environment?: 'development' | 'staging' | 'production';
    webhookSecret?: string;
    scopes?: string[];
    sessionKey?: string;
    onUserAuthenticated?: (user: TendioUser<TRoles>) => Promise<void>;
    /**
     * Called during logout after tokens have been revoked but before the HTTP
     * response is sent. Use this hook to destroy the consuming app's local
     * session (e.g. call `req.session.destroy()`) so the cleanup completes
     * before the client receives the response.
     */
    onBeforeLogout?: (req: unknown, res: unknown) => Promise<void>;
    /**
     * Called during the OAuth callback when no existing local user is found
     * for the authenticated SSO identity. Return `{ localUserId, linkSsoId: true }`
     * to resolve an existing local account and link the SSO identity to it,
     * or return `null` to fall through to `onUserAuthenticated` which can
     * create a brand-new user.
     */
    onUserNotFound?: (user: TendioUser<TRoles>) => Promise<{
        localUserId: string;
        linkSsoId: boolean;
    } | null>;
    allowCredentialsLogin?: boolean;
    logger?: TendioLogger;
}
export interface TendioLogger {
    info: (msg: string, meta?: object) => void;
    error: (msg: string, meta?: object) => void;
    warn: (msg: string, meta?: object) => void;
}
export interface TendioUser<TRoles extends string = string> {
    sub: string;
    email: string;
    name: string;
    first_name: string | null;
    last_name: string | null;
    profile_image_url: string | null;
    user_type: 'staff' | 'caregiver';
    role: TRoles;
    role_id: string;
    tendio_role: string;
    tendio_role_id: string;
    tenant: string;
    tenant_id: string;
    location: string;
    location_id: number;
    primary_location_id: number;
    primary_location_name: string;
    locations: TendioLocation[];
    timezone: string;
    timezone_id: number;
    tendio_user_id: string;
    portal_url: string;
    resolvedLocalUserId?: string;
}
export interface TendioLocation {
    id: number;
    name: string;
    is_primary: boolean;
    type?: 'timezone';
}
export interface TendioStaffUser {
    id: string;
    email: string;
    first_name: string;
    last_name: string;
    profile_image_url: string | null;
    is_active: boolean;
    user_type: 'staff';
    tendio_role: string | null;
    location_name: string | null;
    company_id: string | null;
    synced_at: string | null;
}
export interface SyncResult {
    success: boolean;
    total_from_tendio: number;
    created: number;
    updated: number;
    deactivated: number;
    locations_synced: number;
    roles_enriched: number;
    roles_failed: number;
    duration_ms: number;
}
export interface TendioTokenSet {
    access_token: string;
    refresh_token: string;
    id_token: string;
    expires_at: number;
}
export interface AppConfig {
    appId: string;
    appName: string;
    environment: string;
    homepageUrl: string | null;
    ssoLoginUrl: string | null;
    redirectUris: string[];
    logoUrl: string | null;
    isActive: boolean;
    ssoBaseUrl: string;
    authorizeUrl: string;
    tokenUrl: string;
    userinfoUrl: string;
    discoveryUrl: string;
    jwksUri: string;
    revokeUrl: string;
    allowsCaregivers: boolean;
    serverVersion: string;
    webhookConfigured: boolean;
    roles: AppRole[];
}
export interface AppRole {
    id: string;
    name: string;
    isDefault: boolean;
}
export type WebhookEventType = 'user.created' | 'user.updated' | 'user.deactivated' | 'user.reactivated' | 'user.password_changed' | 'user.role_changed' | 'users.bulk_synced' | 'session.revoked_all' | 'webhook.test';
export interface TendioWebhookEvent<T = Record<string, unknown>> {
    event: WebhookEventType;
    event_id: string;
    version: string;
    timestamp: string;
    tenant_id: string | null;
    data: T;
}
export interface UserCreatedData {
    user_id: string;
    email: string;
    name: string;
    user_type: 'staff' | 'caregiver';
    created_at: string;
}
export interface UserUpdatedData {
    user_id: string;
    email: string;
    name: string;
    tendio_user_id?: string;
    user_type?: string;
    changes: Record<string, {
        old: string;
        new: string;
    }>;
}
export interface UserDeactivatedData {
    user_id: string;
    email: string;
    name: string;
    tendio_user_id?: string;
    user_type?: string;
    deactivated_by?: string;
    reason: 'admin_action' | 'user_deleted';
}
export interface UserReactivatedData {
    user_id: string;
    email: string;
    name: string;
    tendio_user_id?: string;
    user_type?: string;
    reactivated_by?: string;
    reason?: string;
}
export interface UserPasswordChangedData {
    user_id: string;
    email: string;
    name: string;
    tendio_user_id: string;
    user_type: string;
    reason: 'tendio_password_change';
    changed_at: string;
}
export interface UserRoleChangedData {
    user_id: string;
    email: string;
    app_id: string;
    app_name: string;
    old_role: string | null;
    new_role: string | null;
    access_type: 'direct' | 'override';
    changed_by: string;
}
export interface SessionRevokedAllData {
    user_id: string;
    email: string;
    reason: 'password_changed' | 'admin_action' | 'security_lockout';
}
export interface UsersBulkSyncedData {
    source: 'scheduled' | 'app' | 'admin';
    created: number;
    updated: number;
    deactivated: number;
    affected_user_ids: string[];
    all_users: TendioStaffUser[];
    all_user_ids: string[];
    total_users: number;
    synced_at: string;
}
export interface WebhookTestData {
    message: string;
    test_id: string;
    timestamp: string;
}
export type TendioAuthErrorCode = 'invalid_credentials' | 'application_disabled' | 'user_not_found' | 'sync_failed' | 'config_fetch_failed' | 'invalid_redirect_uri' | 'invalid_role' | 'token_exchange_failed' | 'token_refresh_failed' | 'token_revocation_failed' | 'jwks_fetch_failed' | 'token_verification_failed' | 'webhook_signature_invalid' | 'webhook_timestamp_invalid' | 'webhook_payload_malformed' | 'rate_limited' | 'network_error' | 'not_authenticated' | 'insufficient_role' | 'insufficient_user_type' | 'insufficient_location' | 'caregivers_not_allowed' | 'credentials_login_disabled';
export declare class TendioAuthError extends Error {
    readonly code: TendioAuthErrorCode;
    readonly statusCode?: number;
    readonly retryAfter?: number;
    constructor(code: TendioAuthErrorCode, message: string, options?: {
        statusCode?: number;
        retryAfter?: number;
        cause?: unknown;
    });
}
export interface InitiateLoginOptions {
    prompt?: 'login' | 'consent' | 'none';
    loginHint?: string;
}
export interface RequireAuthOptions {
    redirectTo?: string;
    onUnauthenticated?: (req: unknown, res: unknown) => void;
}
export interface LogoutOptions {
    redirectTo?: string;
    revokeTokens?: boolean;
}
//# sourceMappingURL=types.d.ts.map