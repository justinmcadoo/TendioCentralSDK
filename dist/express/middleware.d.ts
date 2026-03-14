import type { RequestHandler } from 'express';
import type { TendioUser, TendioTokenSet, TendioWebhookEvent, InitiateLoginOptions, RequireAuthOptions, LogoutOptions, AppConfig } from '../types.js';
import { TendioAuth } from '../core/client.js';
declare global {
    namespace Express {
        interface Request {
            tendioUser?: TendioUser;
            tendioTokens?: TendioTokenSet;
            webhookEvent?: TendioWebhookEvent;
        }
    }
}
export declare class TendioExpressAuth<TRoles extends string = string> {
    private readonly auth;
    constructor(auth: TendioAuth<TRoles>);
    static fromConfig<TRoles extends string = string>(config: Parameters<typeof TendioAuth.fromConfig<TRoles>>[0]): Promise<TendioExpressAuth<TRoles>>;
    initiateLogin(options?: InitiateLoginOptions): RequestHandler;
    handleCallback(): RequestHandler;
    requireAuth(options?: RequireAuthOptions): RequestHandler;
    requireRole(...roles: TRoles[]): RequestHandler;
    requireStaff(): RequestHandler;
    requireCaregiver(): RequestHandler;
    requireLocation(locationId: number): RequestHandler;
    logout(options?: LogoutOptions): RequestHandler;
    refreshTokens(): RequestHandler;
    verifyWebhook(): RequestHandler;
    handleCredentialsLogin(): RequestHandler;
    getAppConfig(): AppConfig;
    fetchUser(userId: string): Promise<import("./index.js").TendioStaffUser>;
    fetchAllUsers(): Promise<import("./index.js").TendioStaffUser[]>;
    triggerSync(): Promise<import("./index.js").SyncResult>;
    getCore(): TendioAuth<TRoles>;
}
//# sourceMappingURL=middleware.d.ts.map