# TendioCentral SDK Integration Guide

**Package:** `@justinmcadoo/tendiocentral-sdk`
**Current Version:** 1.1.0
**Requires:** Node.js 18+, Express 4.x or 5.x, express-session

---

## 1. Installation

```bash
npm install @justinmcadoo/tendiocentral-sdk
```

---

## 2. Environment Variables

Set the following environment variables in your application:

| Variable | Required | Description |
|---|---|---|
| `TENDIOCENTRAL_CLIENT_ID` | Yes | Your app's client ID (auto-read by the SDK) |
| `TENDIOCENTRAL_CLIENT_SECRET` | Yes | Your app's client secret |
| `TENDIOCENTRAL_URL` | Yes | TendioCentral server URL (auto-read by the SDK if not passed in config) |
| `TENDIOCENTRAL_WEBHOOK_SECRET` | No | Secret for verifying webhook payloads |
| `ENVIRONMENT` | No | `development`, `staging`, or `production` (defaults to `production`) |
| `SESSION_SECRET` | Yes | Secret for express-session |

**Important:** `TENDIOCENTRAL_CLIENT_ID` and `TENDIOCENTRAL_URL` are automatically read from `process.env` by the SDK. You only need to pass `clientSecret`, `redirectUri`, and optionally `webhookSecret` and `environment` in the config object.

---

## 3. TendioCentral Portal Configuration

In the TendioCentral portal, create your application to obtain `CLIENT_ID` and `CLIENT_SECRET`.

**With auto-registration enabled (recommended):** The SDK automatically registers your app's URLs (redirect URI, homepage URL, SSO login URL, webhook URL) with TendioCentral on first startup. No manual URL entry in the dashboard is required. See [Section 5a: Auto-Registration](#5a-auto-registration) for details.

**Without auto-registration:** Manually configure the following in the portal:

| Field | Value |
|---|---|
| Homepage URL | `https://your-app.com` |
| SSO Login URL | The full URL that initiates the OAuth flow (e.g., `https://your-app.com/api/auth/sso/login`) |
| Redirect URIs | The OAuth callback URL (e.g., `https://your-app.com/auth/callback`) |
| Webhook URL | The URL that receives webhook events (e.g., `https://your-app.com/api/webhooks/tendiocentral`) |

**Note:** The SDK does not register any routes itself. It provides middleware functions (`initiateLogin()`, `handleCallback()`, `logout()`, `verifyWebhook()`) that you mount on whatever routes you choose. The URLs you configure must match where you mount the middleware.

---

## 4. Session Setup

The SDK requires `express-session` middleware. Configure it before mounting any SDK routes:

```typescript
import session from "express-session";
import connectPgSimple from "connect-pg-simple"; // or your session store

const PgSession = connectPgSimple(session);

app.use(session({
  store: new PgSession({
    conString: process.env.DATABASE_URL,
    tableName: 'sessions',
    createTableIfMissing: true,
  }),
  secret: process.env.SESSION_SECRET!,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));
```

Your sessions table needs columns: `sid` (VARCHAR primary key), `sess` (JSONB), `expire` (TIMESTAMP).

---

## 5. SDK Initialization

Create an `auth.ts` file:

```typescript
import { TendioAuth } from '@justinmcadoo/tendiocentral-sdk/express';
import type { TendioUser, TendioWebhookEvent } from '@justinmcadoo/tendiocentral-sdk';
import { Router, Request, Response, NextFunction } from 'express';
import express from 'express';

let authInstance: Awaited<ReturnType<typeof TendioAuth.fromConfig>>;

export async function initializeAuth() {
  authInstance = await TendioAuth.fromConfig({
    // clientId is auto-read from TENDIOCENTRAL_CLIENT_ID env var
    // tendiocentralUrl is auto-read from TENDIOCENTRAL_URL env var
    clientSecret: process.env.TENDIOCENTRAL_CLIENT_SECRET!,
    redirectUri: process.env.TENDIOCENTRAL_REDIRECT_URI!,
    webhookSecret: process.env.TENDIOCENTRAL_WEBHOOK_SECRET,
    environment: (process.env.ENVIRONMENT as any) || 'development',

    // Auto-registration (see Section 5a)
    autoRegisterUris: true,
    ssoLoginUrl: 'https://your-app.com/api/auth/sso/login',
    webhookUrl: 'https://your-app.com/api/webhooks/tendiocentral',

    // See Section 6 for hook implementations
    onUserNotFound: async (user: TendioUser) => { /* ... */ },
    onUserAuthenticated: async (user: TendioUser) => { /* ... */ },
    onBeforeLogout: async (req: unknown) => { /* ... */ },
  });

  return authInstance;
}

export function getAuth() {
  if (!authInstance) {
    throw new Error('Auth not initialized. Call initializeAuth() first.');
  }
  return authInstance;
}
```

Call `initializeAuth()` during app startup, **before** registering routes:

```typescript
// server/index.ts
import { initializeAuth } from './auth';

async function main() {
  await initializeAuth();
  console.log('[Auth] TendioCentral SDK initialized');

  // ... register routes, start server
}

main();
```

---

## 5a. Auto-Registration

The SDK can automatically register your app's URLs with TendioCentral during initialization, eliminating the need for manual URL entry in the admin dashboard.

### How it works

When `autoRegisterUris: true` is set in the config, the SDK checks the app config returned by TendioCentral during `init()`. If any URLs are missing, it sends a single `POST /api/apps/register-uris` request to register them:

| URL | Source | When registered |
|---|---|---|
| Redirect URI | `redirectUri` config option | When not in the registered URIs list |
| Webhook URL | `webhookUrl` config option | When `webhookConfigured` is `false` |
| Homepage URL | Auto-derived from `redirectUri` origin | When `homepageUrl` is not set |
| SSO Login URL | `ssoLoginUrl` config option | When `ssoLoginUrl` is not set or differs |

**Homepage URL derivation:** The SDK extracts the origin from your `redirectUri` automatically:
- `https://myapp.com/auth/callback` → `https://myapp.com`
- `http://localhost:3000/auth/callback` → `http://localhost:3000`

### Per-environment registration

All URLs are registered per-environment. When your app starts in development, it registers development URLs. When it starts in production, it registers production URLs. Each environment maintains its own set of URLs independently.

### Server-controlled toggle

TendioCentral provides an `autoRegisterUris` setting per application (defaults to `true`). The server value takes priority:

- Server `false` → registration is skipped, even if the local config has `autoRegisterUris: true`
- Server `true` + local config `true` → registration proceeds
- Server `true` + local config `false` (or not set) → registration is skipped

An admin can disable auto-registration at any time from the TendioCentral dashboard.

### Error handling

- If auto-registration fails, the SDK logs a warning and continues. The `validateRedirectUri` check still runs — if the redirect URI is missing, initialization will fail with a clear error.
- If the server returns `403 auto_registration_disabled`, the SDK logs a warning and continues normally.
- Registration is idempotent — calling it with already-registered URLs is a no-op.

### Example config

```typescript
await TendioAuth.fromConfig({
  clientSecret: process.env.TENDIOCENTRAL_CLIENT_SECRET!,
  redirectUri: 'https://myapp.com/auth/callback',
  ssoLoginUrl: 'https://myapp.com/api/auth/sso/login',
  webhookUrl: 'https://myapp.com/api/webhooks/tendiocentral',
  webhookSecret: process.env.TENDIOCENTRAL_WEBHOOK_SECRET,
  autoRegisterUris: true,
  environment: 'production',
});
```

### Setup flow with auto-registration

| Step | Who | What |
|---|---|---|
| 1 | Admin | Creates app in TendioCentral dashboard → gets `CLIENT_ID` + `CLIENT_SECRET` |
| 2 | Developer | Sets env vars (`CLIENT_ID`, `CLIENT_SECRET`, `TENDIOCENTRAL_URL`) |
| 3 | Developer | Configures SDK with `redirectUri`, `ssoLoginUrl`, `webhookUrl`, `autoRegisterUris: true` |
| 4 | SDK (auto) | On first startup: registers all URLs with TendioCentral |
| 5 | Done | App is fully configured — admin can verify or modify in dashboard |

---

## 6. Lifecycle Hooks

### `onUserNotFound`

Called during OAuth callback when no local user exists for the SSO identity. Use this to match by email and link accounts:

```typescript
onUserNotFound: async (user: TendioUser) => {
  // Try to find an existing local user by email
  const existing = await db
    .select()
    .from(users)
    .where(eq(users.email, user.email))
    .limit(1);

  if (existing.length > 0) {
    // Return the local user ID to link this SSO identity to them
    return { localUserId: existing[0].id, linkSsoId: true };
  }

  // Return null to fall through to onUserAuthenticated
  return null;
},
```

### `onUserAuthenticated`

Called after every successful login. Use this to upsert the local user record:

```typescript
onUserAuthenticated: async (user: TendioUser) => {
  const updateFields = {
    email: user.email,
    firstName: user.first_name,
    lastName: user.last_name,
    lastLoginAt: new Date(),
    authMethod: 'sso',
    ssoId: user.sub,
    role: user.role || 'employee',
  };

  if (user.resolvedLocalUserId) {
    // User was matched by onUserNotFound — update the linked record
    await db
      .update(users)
      .set(updateFields)
      .where(eq(users.id, user.resolvedLocalUserId));
  } else {
    // Check if user already exists by ssoId
    const existing = await db
      .select()
      .from(users)
      .where(eq(users.ssoId, user.sub))
      .limit(1);

    if (existing.length > 0) {
      await db.update(users).set(updateFields).where(eq(users.ssoId, user.sub));
    } else {
      // Create new user
      await db.insert(users).values({
        ...updateFields,
        isActive: '1',
      });
    }
  }
},
```

### `onBeforeLogout`

Called during logout after tokens are revoked but before the HTTP response. Destroy the local session here:

```typescript
onBeforeLogout: async (req: unknown) => {
  const expressReq = req as Request;
  await new Promise<void>((resolve) => {
    expressReq.session.destroy((err) => {
      if (err) console.error('Session destroy error:', err);
      resolve();
    });
  });
},
```

---

## 7. SSO Routes

### Login Route

The login route generates PKCE parameters, saves them to the session, and redirects to TendioCentral. **You must explicitly call `session.save()` before redirecting** to ensure the session is persisted:

```typescript
export const tendioSsoRouter = Router();

tendioSsoRouter.get('/login', (req: Request, res: Response, next: NextFunction) => {
  const auth = getAuth();
  const core = auth.getCore();

  const { verifier, challenge, state } = core.generatePKCE();
  const oauthKey = `${core.sessionKey}__oauth`;

  (req.session as any)[oauthKey] = {
    codeVerifier: verifier,
    state,
    returnTo: (req.query.returnTo as string) || '/',
  };

  const url = core.getAuthorizeUrl(state, challenge, {
    loginHint: req.query.login_hint as string | undefined,
    theme: req.query.theme as string | undefined,
  });

  // CRITICAL: Save session before redirect
  req.session.save((err) => {
    if (err) {
      console.error('Failed to save session before redirect:', err);
      return res.status(500).json({ error: 'Session initialization failed' });
    }
    res.redirect(url);
  });
});
```

### Callback Route

Handles the OAuth callback, looks up the local user, regenerates the session, and sets the user ID:

```typescript
tendioSsoRouter.get('/callback', (req: Request, res: Response, next: NextFunction) => {
  const auth = getAuth();
  auth.handleCallback()(req, res, async (err?: any) => {
    if (err) {
      console.error('Callback error:', err.message || err);
      return res.redirect('/?sso_error=auth_failed');
    }

    try {
      const tendioUser = req.tendioUser;
      if (!tendioUser) {
        return res.redirect('/?sso_error=no_user');
      }

      // Find the local user by ssoId
      const localUser = await db
        .select()
        .from(users)
        .where(eq(users.ssoId, tendioUser.sub))
        .limit(1);

      if (localUser.length === 0) {
        return res.redirect('/?sso_error=user_not_found');
      }

      const userId = localUser[0].id;

      // Regenerate session to prevent fixation attacks
      req.session.regenerate((regenErr) => {
        if (regenErr) {
          return res.redirect('/?sso_error=session_error');
        }

        (req.session as any).userId = userId;

        req.session.save((saveErr) => {
          if (saveErr) {
            return res.redirect('/?sso_error=session_error');
          }
          res.redirect('/');
        });
      });
    } catch (error) {
      console.error('Post-callback error:', error);
      res.redirect('/?sso_error=internal_error');
    }
  });
});
```

### Logout Route

Clears the session cookie and delegates to the SDK's logout (which revokes tokens and calls `onBeforeLogout`):

```typescript
tendioSsoRouter.post('/logout', (req: Request, res: Response, next: NextFunction) => {
  const auth = getAuth();
  res.clearCookie('connect.sid');
  auth.logout()(req, res, next);
});
```

The SDK's `logout()` returns `{ success: true, redirectTo: <portal_url> }` as JSON.

### Portal URL (Optional)

Expose the TendioCentral portal URL for "Back to TendioCentral" links:

```typescript
tendioSsoRouter.get('/portal-url', (_req: Request, res: Response) => {
  const auth = getAuth();
  const config = auth.getAppConfig();
  res.json({ portalUrl: config.ssoBaseUrl || process.env.TENDIOCENTRAL_URL || null });
});
```

---

## 8. Redirect URI Forwarding

If your registered redirect URI in TendioCentral (e.g., `/auth/callback`) differs from where your callback handler is mounted (e.g., `/api/auth/sso/callback`), add a redirect:

```typescript
app.get('/auth/callback', (req, res) => {
  const qs = new URLSearchParams(req.query as Record<string, string>).toString();
  res.redirect(`/api/auth/sso/callback${qs ? `?${qs}` : ''}`);
});
```

---

## 9. Token Refresh Middleware

The SDK provides `refreshTokens()` middleware that silently refreshes access tokens when they're within 5 minutes of expiry. Mount it on all protected routes:

```typescript
import { getAuth } from './auth';

const refreshTokens = (req: Request, res: Response, next: NextFunction) =>
  getAuth().refreshTokens()(req, res, next);

// Apply to all protected route groups
app.use('/api/protected', refreshTokens, protectedRouter);
```

How it works:
- If no tokens exist in the session, it's a no-op (calls `next()`)
- If the access token has more than 5 minutes left, it attaches tokens to `req.tendioTokens` and continues
- If the access token is expiring soon, it refreshes using the refresh token, stores new tokens in the session, and continues
- Concurrent refresh requests for the same token are deduplicated

---

## 10. Webhook Handler

Handle real-time events from TendioCentral (user updates, deactivations, role changes, session revocations, bulk sync):

```typescript
import express from 'express';

export const tendioWebhookRouter = Router();

tendioWebhookRouter.post(
  '/',
  express.raw({ type: 'application/json' }),  // MUST use raw body for signature verification
  (req: Request, res: Response, next: NextFunction) => {
    const auth = getAuth();
    auth.verifyWebhook()(req, res, next);
  },
  async (req: Request, res: Response) => {
    const event = req.webhookEvent as TendioWebhookEvent;
    if (!event) {
      return res.status(400).json({ error: 'No webhook event parsed' });
    }

    const data = event.data as Record<string, unknown>;

    switch (event.event) {
      case 'user.deactivated':
        // Set user inactive in your DB
        break;

      case 'user.reactivated':
        // Set user active in your DB
        break;

      case 'user.updated':
        // Update user email/name in your DB
        break;

      case 'user.role_changed':
        // Update user role; if newRole is empty, deactivate
        break;

      case 'session.revoked_all':
        // Delete all sessions for this user from your session store
        // Use: DELETE FROM sessions WHERE sess->>'userId' = '<localUserId>'
        break;

      case 'users.bulk_synced':
        // Respond immediately, then process in background
        res.status(200).json({ received: true });
        // Use setImmediate() to process the user list asynchronously
        return;

      default:
        console.log(`Unhandled event: ${event.event}`);
    }

    res.status(200).json({ received: true });
  }
);
```

Mount the webhook router:

```typescript
app.use('/api/webhooks/tendiocentral', tendioWebhookRouter);
```

If using auto-registration, the webhook URL is registered automatically. Otherwise, register `https://your-app.com/api/webhooks/tendiocentral` manually in the TendioCentral portal.

---

## 11. Route Registration Summary

```typescript
// Session middleware (must be first)
app.use(session({ /* ... */ }));

// SSO routes (login, callback, logout) — no auth required
app.use('/api/auth/sso', tendioSsoRouter);

// Webhook route — uses raw body parser, no session auth
app.use('/api/webhooks/tendiocentral', tendioWebhookRouter);

// OAuth callback redirect (if redirect URI differs from callback route)
app.get('/auth/callback', (req, res) => {
  const qs = new URLSearchParams(req.query as Record<string, string>).toString();
  res.redirect(`/api/auth/sso/callback${qs ? `?${qs}` : ''}`);
});

// Token refresh middleware for protected routes
const refreshTokens = (req, res, next) => getAuth().refreshTokens()(req, res, next);

// Protected routes — add refreshTokens before each
app.use('/api/users', refreshTokens, usersRouter);
app.use('/api/data', refreshTokens, dataRouter);
```

---

## 12. Frontend Integration

### Login Page

Redirect users to your SSO login route:

```typescript
const handleLogin = () => {
  window.location.href = '/api/auth/sso/login';
};
```

### Logout

Call your logout endpoint and redirect to the portal:

```typescript
const handleLogout = async () => {
  const res = await fetch('/api/auth/sso/logout', { method: 'POST', credentials: 'include' });
  const data = await res.json();
  if (data.redirectTo) {
    window.location.href = data.redirectTo;
  }
};
```

### Check Authentication

Create an endpoint that reads `session.userId` and returns the local user:

```typescript
// Backend
app.get('/api/auth/user', async (req, res) => {
  const userId = (req.session as any)?.userId;
  if (!userId) return res.status(401).json({ message: 'Not authenticated' });

  const user = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user.length) return res.status(401).json({ message: 'User not found' });

  res.json(user[0]);
});
```

---

## 13. Database Requirements

Your users table needs at minimum:

| Column | Type | Description |
|---|---|---|
| `id` | serial/uuid | Your local user ID |
| `email` | varchar | User's email |
| `first_name` | varchar | First name from TendioCentral |
| `last_name` | varchar | Last name from TendioCentral |
| `sso_id` | varchar | TendioCentral `sub` claim (unique identifier) |
| `role` | varchar | User's role from TendioCentral |
| `is_active` | varchar/boolean | Whether the user is active |
| `auth_method` | varchar | Set to `'sso'` |
| `last_login_at` | timestamp | Last login timestamp |

Your sessions table needs:

| Column | Type | Description |
|---|---|---|
| `sid` | varchar | Session ID (primary key) |
| `sess` | jsonb | Session data |
| `expire` | timestamp | Session expiration |

---

## 14. Configuration Reference

### `TendioAuth.fromConfig(config)` Options

| Option | Type | Required | Description |
|---|---|---|---|
| `clientId` | string | No | App client ID (auto-read from `TENDIOCENTRAL_CLIENT_ID` env var) |
| `clientSecret` | string | Yes | App client secret |
| `redirectUri` | string | Yes | Full absolute OAuth callback URL |
| `tendiocentralUrl` | string | No | TendioCentral server URL (auto-read from `TENDIOCENTRAL_URL` env var) |
| `environment` | string | No | `'development'`, `'staging'`, or `'production'` (defaults to `'production'`) |
| `webhookSecret` | string | No | Secret for verifying webhook payloads (auto-read from `TENDIOCENTRAL_WEBHOOK_SECRET` env var) |
| `webhookUrl` | string | No | Webhook endpoint URL (used for auto-registration) |
| `ssoLoginUrl` | string | No | SSO login initiation URL (used for auto-registration) |
| `autoRegisterUris` | boolean | No | Enable auto-registration of URLs during init (default `false`) |
| `allowCredentialsLogin` | boolean | No | Enable ROPC login via `loginWithCredentials()` (default `false`) |
| `scopes` | string[] | No | OAuth scopes (default: `['openid', 'profile', 'email', 'roles']`) |
| `sessionKey` | string | No | Session storage key prefix (default: `'tendioUser'`) |
| `onUserNotFound` | function | No | Called when no local user exists for the SSO identity |
| `onUserAuthenticated` | function | No | Called after every successful login |
| `onBeforeLogout` | function | No | Called during logout after token revocation |
| `logger` | object | No | Custom logger with `info`, `warn`, `error` methods |

---

## 15. Available SDK Methods

| Method | Description |
|---|---|
| `TendioAuth.fromConfig(config)` | Initialize the SDK (async) |
| `getAuth().initiateLogin()` | Middleware that redirects to TendioCentral login |
| `getAuth().handleCallback()` | Middleware that processes the OAuth callback |
| `getAuth().handleCredentialsLogin()` | Middleware for ROPC login (requires `allowCredentialsLogin: true`) |
| `getAuth().logout(options?)` | Middleware that revokes tokens and logs out |
| `getAuth().requireAuth(options?)` | Middleware that blocks unauthenticated requests |
| `getAuth().requireRole(...roles)` | Middleware that requires specific roles |
| `getAuth().requireStaff()` | Middleware that requires staff user type |
| `getAuth().requireCaregiver()` | Middleware that requires caregiver user type |
| `getAuth().requireLocation(locationId)` | Middleware that requires a specific location |
| `getAuth().refreshTokens()` | Middleware that silently refreshes expiring tokens |
| `getAuth().verifyWebhook()` | Middleware that verifies webhook signatures |
| `getAuth().getAppConfig()` | Returns the app configuration from TendioCentral |
| `getAuth().fetchUser(userId)` | Fetch a single user from TendioCentral |
| `getAuth().fetchAllUsers()` | Fetch all users from TendioCentral |
| `getAuth().triggerSync()` | Trigger a user sync from TendioCentral |
| `getAuth().getCore()` | Access the core TendioAuth instance (for PKCE, etc.) |

---

## 16. TendioUser Object

After authentication, `req.tendioUser` contains:

```typescript
{
  sub: string;              // Unique SSO identifier
  email: string;
  name: string;
  first_name: string | null;
  last_name: string | null;
  profile_image_url: string | null;
  user_type: 'staff' | 'caregiver';
  role: string;             // Role name from your app's role config
  role_id: string;
  tenant: string;           // Company/tenant name
  tenant_id: string;
  location: string;
  location_id: number;
  primary_location_id: number;
  primary_location_name: string;
  locations: Array<{ id: number; name: string; is_primary: boolean }>;
  timezone: string;
  portal_url: string;       // URL to the TendioCentral portal
  resolvedLocalUserId?: string;  // Set by onUserNotFound when linking
}
```

---

## 17. Checklist

### With Auto-Registration (recommended)

- [ ] Install the SDK: `npm install @justinmcadoo/tendiocentral-sdk`
- [ ] Create app in TendioCentral dashboard (get `CLIENT_ID` and `CLIENT_SECRET`)
- [ ] Set environment variables: `TENDIOCENTRAL_CLIENT_ID`, `TENDIOCENTRAL_CLIENT_SECRET`, `TENDIOCENTRAL_URL`, `SESSION_SECRET`
- [ ] Optionally set: `TENDIOCENTRAL_WEBHOOK_SECRET`, `ENVIRONMENT`
- [ ] Configure express-session with a persistent store (PostgreSQL recommended)
- [ ] Create auth.ts with `initializeAuth()`, `getAuth()`, lifecycle hooks
- [ ] Set `autoRegisterUris: true`, `redirectUri`, `ssoLoginUrl`, and optionally `webhookUrl` in config
- [ ] Call `initializeAuth()` at app startup before route registration
- [ ] Create SSO router with `/login`, `/callback`, `/logout` routes
- [ ] Mount SSO router (e.g., `app.use('/api/auth/sso', tendioSsoRouter)`)
- [ ] Add redirect URI forwarding if needed (`/auth/callback` -> `/api/auth/sso/callback`)
- [ ] Mount `refreshTokens()` middleware on all protected routes
- [ ] Set up webhook router and mount it (optional but recommended)
- [ ] Add users table with `sso_id` column
- [ ] Add sessions table with `sid`, `sess`, `expire` columns
- [ ] Build login page that redirects to `/api/auth/sso/login`
- [ ] Build auth check endpoint that reads `session.userId`
- [ ] Test: login flow, callback, session persistence, logout, token refresh

### Without Auto-Registration

- [ ] All steps above, but skip `autoRegisterUris`, `ssoLoginUrl`, `webhookUrl` in config
- [ ] Manually register in TendioCentral portal: Homepage URL, SSO Login URL, Redirect URIs, Webhook URL
