import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifyWebhookPayload } from '../core/webhook.js';
import { TendioAuthError } from '../types.js';
const TEST_SECRET = 'whsec_test_secret_key_12345';
function makePayload(event = 'webhook.test', eventId = 'evt_123') {
    return JSON.stringify({
        event,
        event_id: eventId,
        version: '1.0',
        timestamp: new Date().toISOString(),
        tenant_id: 'tenant_abc',
        data: { message: 'hello', test_id: 'test_1', timestamp: new Date().toISOString() },
    });
}
function sign(body, timestamp, secret) {
    const signaturePayload = `${timestamp}.${body}`;
    const hex = createHmac('sha256', secret).update(signaturePayload).digest('hex');
    return `sha256=${hex}`;
}
describe('verifyWebhookPayload', () => {
    it('accepts a valid signature with correct timestamp', () => {
        const body = makePayload();
        const timestamp = String(Math.floor(Date.now() / 1000));
        const signature = sign(body, timestamp, TEST_SECRET);
        const result = verifyWebhookPayload(body, { signature, timestamp }, TEST_SECRET);
        expect(result.event).toBe('webhook.test');
        expect(result.event_id).toBe('evt_123');
        expect(result.tenant_id).toBe('tenant_abc');
    });
    it('rejects an invalid signature', () => {
        const body = makePayload();
        const timestamp = String(Math.floor(Date.now() / 1000));
        expect(() => verifyWebhookPayload(body, { signature: 'sha256=bad', timestamp }, TEST_SECRET)).toThrow(TendioAuthError);
        try {
            verifyWebhookPayload(body, { signature: 'sha256=bad', timestamp }, TEST_SECRET);
        }
        catch (err) {
            expect(err.code).toBe('webhook_signature_invalid');
        }
    });
    it('rejects a timestamp older than 5 minutes', () => {
        const body = makePayload();
        const oldTimestamp = String(Math.floor(Date.now() / 1000) - 400);
        const signature = sign(body, oldTimestamp, TEST_SECRET);
        expect(() => verifyWebhookPayload(body, { signature, timestamp: oldTimestamp }, TEST_SECRET)).toThrow(TendioAuthError);
        try {
            verifyWebhookPayload(body, { signature, timestamp: oldTimestamp }, TEST_SECRET);
        }
        catch (err) {
            expect(err.code).toBe('webhook_timestamp_invalid');
        }
    });
    it('rejects missing signature header', () => {
        const body = makePayload();
        const timestamp = String(Math.floor(Date.now() / 1000));
        expect(() => verifyWebhookPayload(body, { signature: '', timestamp }, TEST_SECRET)).toThrow(TendioAuthError);
        try {
            verifyWebhookPayload(body, { signature: '', timestamp }, TEST_SECRET);
        }
        catch (err) {
            expect(err.code).toBe('webhook_payload_malformed');
        }
    });
    it('rejects missing timestamp header', () => {
        const body = makePayload();
        expect(() => verifyWebhookPayload(body, { signature: 'sha256=abc', timestamp: '' }, TEST_SECRET)).toThrow(TendioAuthError);
        try {
            verifyWebhookPayload(body, { signature: 'sha256=abc', timestamp: '' }, TEST_SECRET);
        }
        catch (err) {
            expect(err.code).toBe('webhook_payload_malformed');
        }
    });
});
//# sourceMappingURL=webhook.test.js.map