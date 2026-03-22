import type { AppConfig, TendioLogger } from '../types.js';
export declare function fetchAppConfig(baseUrl: string, clientId: string, clientSecret: string, logger: TendioLogger, environment?: string): Promise<AppConfig>;
export declare function registerUris(baseUrl: string, clientId: string, clientSecret: string, environment: string, redirectUri?: string, webhookUrl?: string, logger?: TendioLogger): Promise<AppConfig>;
export declare function validateRedirectUri(redirectUri: string, registeredUris: string[]): void;
export declare function validateRoles(roleNames: string[], registeredRoles: Array<{
    name: string;
}>): void;
//# sourceMappingURL=config.d.ts.map