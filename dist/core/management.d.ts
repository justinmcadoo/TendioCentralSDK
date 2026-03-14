import type { TendioStaffUser, SyncResult, TendioLogger } from '../types.js';
export declare function fetchUser(baseUrl: string, clientId: string, clientSecret: string, userId: string, logger: TendioLogger): Promise<TendioStaffUser>;
export declare function fetchAllUsers(baseUrl: string, clientId: string, clientSecret: string, logger: TendioLogger): Promise<TendioStaffUser[]>;
export declare function triggerSync(baseUrl: string, clientId: string, clientSecret: string, logger: TendioLogger): Promise<SyncResult>;
//# sourceMappingURL=management.d.ts.map