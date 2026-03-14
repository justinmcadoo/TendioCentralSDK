import type { TendioUser, TendioLogger } from '../types.js';
export declare function initJWKS(uri: string, logger: TendioLogger): Promise<void>;
export declare function refreshJWKS(): Promise<void>;
export declare function verifyIdToken<TRoles extends string = string>(idToken: string, clientId: string, issuer: string): Promise<TendioUser<TRoles>>;
//# sourceMappingURL=jwks.d.ts.map