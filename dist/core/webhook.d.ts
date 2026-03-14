import type { TendioWebhookEvent } from '../types.js';
export declare function verifyWebhookPayload(rawBody: Buffer | string, headers: {
    signature: string;
    timestamp: string;
}, secret: string): TendioWebhookEvent;
//# sourceMappingURL=webhook.d.ts.map