# TendioCentral SDK Integration Guide

**Package:** `@justinmcadoo/tendiocentral-sdk`
**Current Version:** 1.0.8
**Requires:** Node.js, Express 4.x, express-session

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
| `TENDIOCENTRAL_REDIRECT_URI` | Yes | The OAuth callback URL registered in TendioCentral |
| `TENDIOCENTRAL_WEBHOOK_SECRET` | No | Secret for verifying webhook payloads |
| `ENVIRONMENT` | No | `development`, `staging`, or `production` (defaults to `production`) |
| `SESSION_SECRET` | Yes | Secret for express-session |

**Important:** `TENDIOCENTRAL_CLIENT_ID` and `TENDIOCENTRAL_URL` are automatically read from `process.env` by the SDK. You only need to pass `clientSecret`, `redirectUri`, and optionally `webhookSecret` and `environment` in the config object.

---

## 3. TendioCentral Portal Configuration

In the TendioCentral portal, register your application with:

| Field | Value |
|---|---|
| Homepage URL | `https://your-app.com` |
| SSO Login URL | The full URL that initiates the OAuth flow (e.g., `https://your-app.com/api/auth/sso/login`) |
| Redirect URIs | The OAuth callback URL (e.g., `https://your-app.com/auth/callback`) |

**Common mistake:** The SSO Login URL must match the exact route path where your login handler is mounted. If your SSO router is mounted at `/api/auth/sso`, the login URL is `/api/auth/sso/login`, not `/auth/sso/login`.

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

Then register `https://your-app.com/api/webhooks/tendiocentral` as the webhook URL in the TendioCentral portal.

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

## 14. Available SDK Methods

| Method | Description |
|---|---|
| `TendioAuth.fromConfig(config)` | Initialize the SDK (async) |
| `getAuth().initiateLogin()` | Middleware that redirects to TendioCentral login |
| `getAuth().handleCallback()` | Middleware that processes the OAuth callback |
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

## 15. TendioUser Object

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

## 16. Checklist

- [ ] Install the SDK: `npm install @justinmcadoo/tendiocentral-sdk`
- [ ] Set environment variables: `TENDIOCENTRAL_CLIENT_ID`, `TENDIOCENTRAL_CLIENT_SECRET`, `TENDIOCENTRAL_URL`, `TENDIOCENTRAL_REDIRECT_URI`, `SESSION_SECRET`
- [ ] Optionally set: `TENDIOCENTRAL_WEBHOOK_SECRET`, `ENVIRONMENT`
- [ ] Configure express-session with a persistent store (PostgreSQL recommended)
- [ ] Create auth.ts with `initializeAuth()`, `getAuth()`, lifecycle hooks
- [ ] Call `initializeAuth()` at app startup before route registration
- [ ] Create SSO router with `/login`, `/callback`, `/logout` routes
- [ ] Mount SSO router (e.g., `app.use('/api/auth/sso', tendioSsoRouter)`)
- [ ] Add redirect URI forwarding if needed (`/auth/callback` -> `/api/auth/sso/callback`)
- [ ] Mount `refreshTokens()` middleware on all protected routes
- [ ] Set up webhook router and mount it (optional but recommended)
- [ ] Register in TendioCentral portal: Homepage URL, SSO Login URL, Redirect URIs
- [ ] Register webhook URL in TendioCentral portal (if using webhooks)
- [ ] Add users table with `sso_id` column
- [ ] Add sessions table with `sid`, `sess`, `expire` columns
- [ ] Build login page that redirects to `/api/auth/sso/login`
- [ ] Build auth check endpoint that reads `session.userId`
- [ ] Test: login flow, callback, session persistence, logout, token refresh
