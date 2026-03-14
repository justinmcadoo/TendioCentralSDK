import type { AppConfig, TendioLogger } from '../types.js';
export declare function fetchAppConfig(baseUrl: string, clientId: string, clientSecret: string, logger: TendioLogger): Promise<AppConfig>;
export declare function validateRedirectUri(redirectUri: string, registeredUris: string[]): void;
export declare function validateRoles(roleNames: string[], registeredRoles: Array<{
    name: string;
}>): void;
//# sourceMappingURL=config.d.ts.map