import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type {
  TendioUser,
  TendioTokenSet,
  TendioWebhookEvent,
  InitiateLoginOptions,
  RequireAuthOptions,
  LogoutOptions,
  AppConfig,
} from '../types.js';
import { TendioAuthError } from '../types.js';
import { TendioAuth } from '../core/client.js';

declare global {
  namespace Express {
    interface Request {
      tendioUser?: TendioUser;
      tendioTokens?: TendioTokenSet;
      webhookEvent?: TendioWebhookEvent;
    }
  }
}

interface SessionData {
  [key: string]: unknown;
}

function getSession(req: Request): SessionData {
  const session = (req as unknown as { session?: SessionData }).session;
  if (!session) {
    throw new TendioAuthError(
      'not_authenticated',
      'No session available on the request. Ensure session middleware (e.g., express-session) is configured before TendioAuth middleware.',
    );
  }
  return session;
}

export class TendioExpressAuth<TRoles extends string = string> {
  private readonly auth: TendioAuth<TRoles>;

  constructor(auth: TendioAuth<TRoles>) {
    this.auth = auth;
  }

  static async fromConfig<TRoles extends string = string>(
    config: Parameters<typeof TendioAuth.fromConfig<TRoles>>[0],
  ): Promise<TendioExpressAuth<TRoles>> {
    const auth = await TendioAuth.fromConfig<TRoles>(config);
    return new TendioExpressAuth<TRoles>(auth);
  }

  initiateLogin(options?: InitiateLoginOptions): RequestHandler {
    return (req: Request, res: Response, _next: NextFunction): void => {
      const session = getSession(req);
      const { verifier, challenge, state } = this.auth.generatePKCE();

      const oauthKey = `${this.auth.sessionKey}__oauth`;
      session[oauthKey] = {
        codeVerifier: verifier,
        state,
        returnTo: (req.query as Record<string, string>).returnTo || '/',
      };

      const theme = (req.query as Record<string, string>).theme;
      const url = this.auth.getAuthorizeUrl(state, challenge, {
        prompt: options?.prompt,
        loginHint: options?.loginHint,
        theme,
      });

      res.redirect(url);
    };
  }

  handleCallback(): RequestHandler {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const session = getSession(req);
        const oauthKey = `${this.auth.sessionKey}__oauth`;
        const oauthData = session[oauthKey] as {
          codeVerifier: string;
          state: string;
          returnTo?: string;
        } | undefined;

        if (!oauthData) {
          throw new TendioAuthError(
            'not_authenticated',
            'No OAuth state found in session — the login flow may have expired or was not initiated',
          );
        }

        const query = req.query as Record<string, string>;
        const { code, state, error, error_description } = query;

        if (error) {
          throw new TendioAuthError(
            'token_exchange_failed',
            `OAuth error: ${error} — ${error_description || 'No description'}`,
          );
        }

        if (!code || !state) {
          throw new TendioAuthError(
            'token_exchange_failed',
            'Missing code or state parameter in callback',
          );
        }

        if (state !== oauthData.state) {
          throw new TendioAuthError(
            'token_exchange_failed',
            'OAuth state mismatch — possible CSRF attack',
          );
        }

        const { user, tokens } = await this.auth.exchangeCode(code, oauthData.codeVerifier);

        session[this.auth.sessionKey] = user;
        session[`${this.auth.sessionKey}__tokens`] = tokens;
        delete session[oauthKey];

        req.tendioUser = user as TendioUser;
        req.tendioTokens = tokens;

        next();
      } catch (err) {
        next(err);
      }
    };
  }

  requireAuth(options?: RequireAuthOptions): RequestHandler {
    return (req: Request, res: Response, next: NextFunction): void => {
      const session = (req as unknown as { session?: SessionData }).session;
      const user = session?.[this.auth.sessionKey] as TendioUser | undefined;

      if (!user) {
        if (options?.onUnauthenticated) {
          options.onUnauthenticated(req, res);
          return;
        }
        if (options?.redirectTo) {
          res.redirect(options.redirectTo);
          return;
        }
        res.status(401).json({ error: 'Not authenticated' });
        return;
      }

      req.tendioUser = user;
      const tokens = session?.[`${this.auth.sessionKey}__tokens`] as TendioTokenSet | undefined;
      if (tokens) {
        req.tendioTokens = tokens;
      }

      next();
    };
  }

  requireRole(...roles: TRoles[]): RequestHandler {
    if (this.auth.getAppConfig()) {
      try {
        this.auth.validateRoleNames(...roles);
      } catch (err) {
        if (err instanceof TendioAuthError) {
          throw err;
        }
      }
    }

    return (req: Request, res: Response, next: NextFunction): void => {
      const user = req.tendioUser;
      if (!user) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
      }

      const userRole = (user.role as string).toLowerCase();
      const allowed = roles.some(r => (r as string).toLowerCase() === userRole);

      if (!allowed) {
        res.status(403).json({
          error: 'Insufficient role',
          required: roles,
          current: user.role,
        });
        return;
      }

      next();
    };
  }

  requireStaff(): RequestHandler {
    return (req: Request, res: Response, next: NextFunction): void => {
      const user = req.tendioUser;
      if (!user) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
      }

      if (user.user_type !== 'staff') {
        res.status(403).json({
          error: 'Staff access required',
          current_type: user.user_type,
        });
        return;
      }

      next();
    };
  }

  requireCaregiver(): RequestHandler {
    const config = this.auth.getAppConfig();
    if (config && !config.allowsCaregivers) {
      throw new TendioAuthError(
        'caregivers_not_allowed',
        `Application "${config.appName}" does not support caregiver logins. requireCaregiver() cannot be used.`,
      );
    }

    return (req: Request, res: Response, next: NextFunction): void => {
      const user = req.tendioUser;
      if (!user) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
      }

      if (user.user_type !== 'caregiver') {
        res.status(403).json({
          error: 'Caregiver access required',
          current_type: user.user_type,
        });
        return;
      }

      next();
    };
  }

  requireLocation(locationId: number): RequestHandler {
    return (req: Request, res: Response, next: NextFunction): void => {
      const user = req.tendioUser;
      if (!user) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
      }

      const hasLocation = user.locations.some(loc => loc.id === locationId);
      if (!hasLocation) {
        res.status(403).json({
          error: 'Location access required',
          required_location: locationId,
        });
        return;
      }

      next();
    };
  }

  logout(options?: LogoutOptions): RequestHandler {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const session = (req as unknown as { session?: SessionData }).session;
        const tokens = session?.[`${this.auth.sessionKey}__tokens`] as TendioTokenSet | undefined;
        const user = session?.[this.auth.sessionKey] as TendioUser | undefined;

        if (tokens && (options?.revokeTokens !== false)) {
          try {
            if (tokens.access_token) {
              await this.auth.revokeToken(tokens.access_token);
            }
            if (tokens.refresh_token) {
              await this.auth.revokeToken(tokens.refresh_token);
            }
          } catch (err) {
            this.auth.logger.warn(`[TendioAuth] Token revocation failed during logout: ${err instanceof Error ? err.message : String(err)}`);
          }
        }

        if (session) {
          delete session[this.auth.sessionKey];
          delete session[`${this.auth.sessionKey}__tokens`];
          delete session[`${this.auth.sessionKey}__oauth`];
        }

        req.tendioUser = undefined;
        req.tendioTokens = undefined;

        const portalUrl = user?.portal_url;
        const redirectTo = options?.redirectTo || portalUrl || '/';

        res.json({ success: true, redirectTo });
      } catch (err) {
        next(err);
      }
    };
  }

  refreshTokens(): RequestHandler {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const session = (req as unknown as { session?: SessionData }).session;
        const tokens = session?.[`${this.auth.sessionKey}__tokens`] as TendioTokenSet | undefined;

        if (!tokens) {
          next();
          return;
        }

        if (!this.auth.shouldRefreshTokens(tokens)) {
          req.tendioTokens = tokens;
          next();
          return;
        }

        const newTokens = await this.auth.refreshTokens(tokens);

        session![`${this.auth.sessionKey}__tokens`] = newTokens;
        req.tendioTokens = newTokens;

        next();
      } catch (err) {
        next(err);
      }
    };
  }

  verifyWebhook(): RequestHandler {
    return (req: Request, res: Response, next: NextFunction): void => {
      try {
        const rawBody = req.body;
        if (!Buffer.isBuffer(rawBody)) {
          res.status(400).json({
            error: 'Request body must be a raw Buffer. ' +
              'Use express.raw({ type: "application/json" }) before verifyWebhook().',
          });
          return;
        }

        const signature = req.headers['x-tendiocentral-signature'] as string;
        const timestamp = req.headers['x-tendiocentral-timestamp'] as string;

        const event = this.auth.verifyWebhookPayload(rawBody, { signature, timestamp });

        req.webhookEvent = event;
        next();
      } catch (err) {
        if (err instanceof TendioAuthError) {
          const status = err.statusCode || 400;
          res.status(status).json({ error: err.message, code: err.code });
          return;
        }
        next(err);
      }
    };
  }

  getAppConfig(): AppConfig {
    return this.auth.getAppConfig();
  }

  async fetchUser(userId: string) {
    return this.auth.fetchUser(userId);
  }

  async fetchAllUsers() {
    return this.auth.fetchAllUsers();
  }

  async triggerSync() {
    return this.auth.triggerSync();
  }

  getCore(): TendioAuth<TRoles> {
    return this.auth;
  }
}
