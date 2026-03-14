import type { TendioTokenSet, TendioLogger } from '../types.js';
export declare function exchangeCodeForTokens(tokenUrl: string, code: string, redirectUri: string, clientId: string, clientSecret: string, codeVerifier: string, logger: TendioLogger): Promise<{
    tokenSet: TendioTokenSet;
    rawIdToken: string;
}>;
export declare function refreshAccessToken(tokenUrl: string, refreshToken: string, clientId: string, clientSecret: string, logger: TendioLogger): Promise<TendioTokenSet>;
export declare function revokeToken(revokeUrl: string, token: string, clientId: string, clientSecret: string, logger: TendioLogger): Promise<void>;
//# sourceMappingURL=tokens.d.ts.map