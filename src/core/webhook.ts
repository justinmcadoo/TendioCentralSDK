import { createHmac, timingSafeEqual } from 'node:crypto';
import type { TendioWebhookEvent, WebhookEventType } from '../types.js';
import { TendioAuthError } from '../types.js';

const MAX_TIMESTAMP_AGE_SECONDS = 5 * 60;

export function verifyWebhookPayload(
  rawBody: Buffer | string,
  headers: {
    signature: string;
    timestamp: string;
  },
  secret: string,
): TendioWebhookEvent {
  if (!headers.signature || !headers.timestamp) {
    throw new TendioAuthError(
      'webhook_payload_malformed',
      'Missing required webhook headers: X-TendioCentral-Signature and/or X-TendioCentral-Timestamp',
      { statusCode: 400 },
    );
  }

  const timestampSeconds = parseInt(headers.timestamp, 10);
  if (isNaN(timestampSeconds)) {
    throw new TendioAuthError(
      'webhook_timestamp_invalid',
      'Invalid webhook timestamp header: not a valid number',
      { statusCode: 400 },
    );
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const age = Math.abs(nowSeconds - timestampSeconds);
  if (age > MAX_TIMESTAMP_AGE_SECONDS) {
    throw new TendioAuthError(
      'webhook_timestamp_invalid',
      `Webhook timestamp is too old: ${age}s (max ${MAX_TIMESTAMP_AGE_SECONDS}s)`,
      { statusCode: 400 },
    );
  }

  const bodyStr = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf-8');
  const signaturePayload = `${headers.timestamp}.${bodyStr}`;
  const computedHex = createHmac('sha256', secret)
    .update(signaturePayload)
    .digest('hex');
  const expectedSignature = `sha256=${computedHex}`;

  const sigBuffer = Buffer.from(headers.signature, 'utf-8');
  const expectedBuffer = Buffer.from(expectedSignature, 'utf-8');

  if (sigBuffer.length !== expectedBuffer.length || !timingSafeEqual(sigBuffer, expectedBuffer)) {
    throw new TendioAuthError(
      'webhook_signature_invalid',
      'Webhook signature verification failed',
      { statusCode: 401 },
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyStr);
  } catch {
    throw new TendioAuthError(
      'webhook_payload_malformed',
      'Webhook body is not valid JSON',
      { statusCode: 400 },
    );
  }

  const payload = parsed as Record<string, unknown>;
  if (!payload.event || !payload.event_id) {
    throw new TendioAuthError(
      'webhook_payload_malformed',
      'Webhook payload missing required fields: event, event_id',
      { statusCode: 400 },
    );
  }

  return {
    event: payload.event as WebhookEventType,
    event_id: payload.event_id as string,
    version: (payload.version as string) || '1.0',
    timestamp: (payload.timestamp as string) || '',
    tenant_id: (payload.tenant_id as string | null) ?? null,
    data: (payload.data as Record<string, unknown>) || {},
  };
}
