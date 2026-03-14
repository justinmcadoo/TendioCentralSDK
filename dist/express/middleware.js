import { TendioAuthError } from '../types.js';
import { TendioAuth } from '../core/client.js';
function getSession(req) {
    const session = req.session;
    if (!session) {
        throw new TendioAuthError('not_authenticated', 'No session available on the request. Ensure session middleware (e.g., express-session) is configured before TendioAuth middleware.');
    }
    return session;
}
export class TendioExpressAuth {
    auth;
    constructor(auth) {
        this.auth = auth;
    }
    static async fromConfig(config) {
        const auth = await TendioAuth.fromConfig(config);
        return new TendioExpressAuth(auth);
    }
    initiateLogin(options) {
        return (req, res, _next) => {
            const session = getSession(req);
            const { verifier, challenge, state } = this.auth.generatePKCE();
            const oauthKey = `${this.auth.sessionKey}__oauth`;
            session[oauthKey] = {
                codeVerifier: verifier,
                state,
                returnTo: req.query.returnTo || '/',
            };
            const theme = req.query.theme;
            const url = this.auth.getAuthorizeUrl(state, challenge, {
                prompt: options?.prompt,
                loginHint: options?.loginHint,
                theme,
            });
            res.redirect(url);
        };
    }
    handleCallback() {
        return async (req, res, next) => {
            try {
                const session = getSession(req);
                const oauthKey = `${this.auth.sessionKey}__oauth`;
                const oauthData = session[oauthKey];
                if (!oauthData) {
                    throw new TendioAuthError('not_authenticated', 'No OAuth state found in session — the login flow may have expired or was not initiated');
                }
                const query = req.query;
                const { code, state, error, error_description } = query;
                if (error) {
                    throw new TendioAuthError('token_exchange_failed', `OAuth error: ${error} — ${error_description || 'No description'}`);
                }
                if (!code || !state) {
                    throw new TendioAuthError('token_exchange_failed', 'Missing code or state parameter in callback');
                }
                if (state !== oauthData.state) {
                    throw new TendioAuthError('token_exchange_failed', 'OAuth state mismatch — possible CSRF attack');
                }
                const { user, tokens } = await this.auth.exchangeCode(code, oauthData.codeVerifier);
                const existingUser = session[this.auth.sessionKey];
                if ((!existingUser || existingUser.sub !== user.sub) && this.auth.onUserNotFound) {
                    const result = await this.auth.onUserNotFound(user);
                    if (result) {
                        user.resolvedLocalUserId = result.localUserId;
                        if (result.linkSsoId) {
                            this.auth.logger.info(`[TendioAuth] onUserNotFound resolved to localUserId="${result.localUserId}" — linking SSO sub="${user.sub}"`);
                        }
                    }
                }
                if (this.auth.onUserAuthenticated) {
                    await this.auth.onUserAuthenticated(user);
                }
                session[this.auth.sessionKey] = user;
                session[`${this.auth.sessionKey}__tokens`] = tokens;
                delete session[oauthKey];
                req.tendioUser = user;
                req.tendioTokens = tokens;
                next();
            }
            catch (err) {
                next(err);
            }
        };
    }
    requireAuth(options) {
        return (req, res, next) => {
            const session = req.session;
            const user = session?.[this.auth.sessionKey];
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
            const tokens = session?.[`${this.auth.sessionKey}__tokens`];
            if (tokens) {
                req.tendioTokens = tokens;
            }
            next();
        };
    }
    requireRole(...roles) {
        if (this.auth.getAppConfig()) {
            try {
                this.auth.validateRoleNames(...roles);
            }
            catch (err) {
                if (err instanceof TendioAuthError) {
                    throw err;
                }
            }
        }
        return (req, res, next) => {
            const user = req.tendioUser;
            if (!user) {
                res.status(401).json({ error: 'Not authenticated' });
                return;
            }
            const userRole = user.role.toLowerCase();
            const allowed = roles.some(r => r.toLowerCase() === userRole);
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
    requireStaff() {
        return (req, res, next) => {
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
    requireCaregiver() {
        const config = this.auth.getAppConfig();
        if (config && !config.allowsCaregivers) {
            throw new TendioAuthError('caregivers_not_allowed', `Application "${config.appName}" does not support caregiver logins. requireCaregiver() cannot be used.`);
        }
        return (req, res, next) => {
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
    requireLocation(locationId) {
        return (req, res, next) => {
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
    logout(options) {
        return async (req, res, next) => {
            try {
                const session = req.session;
                const tokens = session?.[`${this.auth.sessionKey}__tokens`];
                const user = session?.[this.auth.sessionKey];
                if (tokens && (options?.revokeTokens !== false)) {
                    try {
                        if (tokens.access_token) {
                            await this.auth.revokeToken(tokens.access_token);
                        }
                        if (tokens.refresh_token) {
                            await this.auth.revokeToken(tokens.refresh_token);
                        }
                    }
                    catch (err) {
                        this.auth.logger.warn(`[TendioAuth] Token revocation failed during logout: ${err instanceof Error ? err.message : String(err)}`);
                    }
                }
                if (this.auth.onBeforeLogout) {
                    await this.auth.onBeforeLogout(req, res);
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
            }
            catch (err) {
                next(err);
            }
        };
    }
    refreshTokens() {
        return async (req, res, next) => {
            try {
                const session = req.session;
                const tokens = session?.[`${this.auth.sessionKey}__tokens`];
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
                session[`${this.auth.sessionKey}__tokens`] = newTokens;
                req.tendioTokens = newTokens;
                next();
            }
            catch (err) {
                next(err);
            }
        };
    }
    verifyWebhook() {
        return (req, res, next) => {
            try {
                const rawBody = req.body;
                if (!Buffer.isBuffer(rawBody)) {
                    res.status(400).json({
                        error: 'Request body must be a raw Buffer. ' +
                            'Use express.raw({ type: "application/json" }) before verifyWebhook().',
                    });
                    return;
                }
                const signature = req.headers['x-tendiocentral-signature'];
                const timestamp = req.headers['x-tendiocentral-timestamp'];
                const event = this.auth.verifyWebhookPayload(rawBody, { signature, timestamp });
                req.webhookEvent = event;
                next();
            }
            catch (err) {
                if (err instanceof TendioAuthError) {
                    const status = err.statusCode || 400;
                    res.status(status).json({ error: err.message, code: err.code });
                    return;
                }
                next(err);
            }
        };
    }
    handleCredentialsLogin() {
        return async (req, res, next) => {
            try {
                const { email, password, acronym } = req.body;
                if (!email || !password || !acronym) {
                    res.status(400).json({
                        error: 'Missing required fields',
                        required: ['email', 'password', 'acronym'],
                        provided: {
                            email: !!email,
                            password: !!password,
                            acronym: !!acronym,
                        },
                    });
                    return;
                }
                const { user, tokens } = await this.auth.loginWithCredentials(email, password, acronym);
                const session = getSession(req);
                session[this.auth.sessionKey] = user;
                session[`${this.auth.sessionKey}__tokens`] = tokens;
                req.tendioUser = user;
                req.tendioTokens = tokens;
                next();
            }
            catch (err) {
                if (err instanceof TendioAuthError) {
                    const status = err.statusCode || 401;
                    res.status(status).json({ error: err.message, code: err.code });
                    return;
                }
                next(err);
            }
        };
    }
    getAppConfig() {
        return this.auth.getAppConfig();
    }
    async fetchUser(userId) {
        return this.auth.fetchUser(userId);
    }
    async fetchAllUsers() {
        return this.auth.fetchAllUsers();
    }
    async triggerSync() {
        return this.auth.triggerSync();
    }
    getCore() {
        return this.auth;
    }
}
//# sourceMappingURL=middleware.js.map