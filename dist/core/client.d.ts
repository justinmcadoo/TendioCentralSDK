import type { TendioAuthConfig, TendioUser, TendioStaffUser, SyncResult, TendioTokenSet, TendioWebhookEvent, TendioLogger, AppConfig, AppRole } from '../types.js';
export declare class TendioAuth<TRoles extends string = string> {
    readonly clientId: string;
    readonly clientSecret: string;
    readonly redirectUri: string;
    readonly baseUrl: string;
    readonly webhookSecret: string | undefined;
    readonly scopes: string[];
    readonly sessionKey: string;
    readonly environment: 'development' | 'staging' | 'production';
    readonly logger: TendioLogger;
    readonly onUserAuthenticated?: (user: TendioUser<TRoles>) => Promise<void>;
    readonly onBeforeLogout?: (req: unknown, res: unknown) => Promise<void>;
    readonly onUserNotFound?: (user: TendioUser<TRoles>) => Promise<{
        localUserId: string;
        linkSsoId: boolean;
    } | null>;
    private appConfig;
    private issuerUrl;
    private refreshMutex;
    constructor(config: TendioAuthConfig<TRoles>);
    static fromConfig<TRoles extends string = string>(config: Omit<TendioAuthConfig<TRoles>, 'clientId'> & {
        clientId?: string;
    }): Promise<TendioAuth<TRoles>>;
    init(): Promise<void>;
    getAppConfig(): AppConfig;
    getRoles(): AppRole[];
    validateRoleNames(...roleNames: TRoles[]): void;
    getAuthorizeUrl(state: string, codeChallenge: string, options?: {
        prompt?: 'login' | 'consent' | 'none';
        loginHint?: string;
        theme?: string;
    }): string;
    generatePKCE(): {
        verifier: string;
        challenge: string;
        state: string;
    };
    exchangeCode(code: string, codeVerifier: string): Promise<{
        user: TendioUser<TRoles>;
        tokens: TendioTokenSet;
    }>;
    refreshTokens(currentTokens: TendioTokenSet): Promise<TendioTokenSet>;
    shouldRefreshTokens(tokens: TendioTokenSet): boolean;
    revokeToken(token: string): Promise<void>;
    verifyWebhookPayload(rawBody: Buffer | string, headers: {
        signature: string;
        timestamp: string;
    }): TendioWebhookEvent;
    fetchUser(userId: string): Promise<TendioStaffUser>;
    fetchAllUsers(): Promise<TendioStaffUser[]>;
    triggerSync(): Promise<SyncResult>;
}
//# sourceMappingURL=client.d.ts.map