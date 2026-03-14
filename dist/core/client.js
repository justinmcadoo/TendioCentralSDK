import { TendioAuthError } from '../types.js';
import { fetchAppConfig, validateRedirectUri, validateRoles } from './config.js';
import { initJWKS, verifyIdToken } from './jwks.js';
import { exchangeCodeForTokens, refreshAccessToken, revokeToken } from './tokens.js';
import { generateCodeVerifier, generateCodeChallenge, generateState } from './pkce.js';
import { verifyWebhookPayload } from './webhook.js';
import { fetchUser as apiFetchUser, fetchAllUsers as apiFetchAllUsers, triggerSync as apiTriggerSync, } from './management.js';
const DEFAULT_SCOPES = ['openid', 'profile', 'email', 'roles'];
const DEFAULT_SESSION_KEY = 'tendioUser';
const DEFAULT_TOKENS_KEY = 'tendioTokens';
const DEFAULT_OAUTH_KEY = 'tendioOAuth';
const TOKEN_REFRESH_BUFFER_SECONDS = 300;
const defaultLogger = {
    info: (msg, meta) => console.log(msg, meta ?? ''),
    error: (msg, meta) => console.error(msg, meta ?? ''),
    warn: (msg, meta) => console.warn(msg, meta ?? ''),
};
export class TendioAuth {
    clientId;
    clientSecret;
    redirectUri;
    baseUrl;
    webhookSecret;
    scopes;
    sessionKey;
    environment;
    logger;
    onUserAuthenticated;
    onBeforeLogout;
    onUserNotFound;
    appConfig = null;
    issuerUrl = '';
    refreshMutex = new Map();
    constructor(config) {
        this.clientId = config.clientId || process.env.TENDIOCENTRAL_CLIENT_ID || '';
        this.clientSecret = config.clientSecret;
        this.redirectUri = config.redirectUri;
        this.baseUrl = config.tendiocentralUrl || process.env.TENDIOCENTRAL_URL || '';
        this.webhookSecret = config.webhookSecret || process.env.TENDIOCENTRAL_WEBHOOK_SECRET;
        this.scopes = config.scopes || DEFAULT_SCOPES;
        this.sessionKey = config.sessionKey || DEFAULT_SESSION_KEY;
        this.environment = config.environment || 'production';
        this.logger = config.logger || defaultLogger;
        this.onUserAuthenticated = config.onUserAuthenticated;
        this.onBeforeLogout = config.onBeforeLogout;
        this.onUserNotFound = config.onUserNotFound;
        if (!this.clientId)
            throw new Error('clientId is required');
        if (!this.clientSecret)
            throw new Error('clientSecret is required');
        if (!this.redirectUri)
            throw new Error('redirectUri is required');
        if (!this.baseUrl)
            throw new Error('tendiocentralUrl is required (or set TENDIOCENTRAL_URL env var)');
    }
    static async fromConfig(config) {
        const clientId = config.clientId || process.env.TENDIOCENTRAL_CLIENT_ID || '';
        const fullConfig = { ...config, clientId };
        const instance = new TendioAuth(fullConfig);
        await instance.init();
        return instance;
    }
    async init() {
        this.appConfig = await fetchAppConfig(this.baseUrl, this.clientId, this.clientSecret, this.logger, this.environment);
        validateRedirectUri(this.redirectUri, this.appConfig.redirectUris);
        this.issuerUrl = this.appConfig.ssoBaseUrl.replace(/\/$/, '');
        const issuerHttps = this.issuerUrl.replace(/^http:/, 'https:');
        this.issuerUrl = issuerHttps;
        await initJWKS(this.appConfig.jwksUri, this.logger);
        if (this.webhookSecret && !this.appConfig.webhookConfigured) {
            this.logger.warn('[TendioAuth] webhookSecret is configured but no webhook URL is set in TendioCentral. ' +
                'Webhooks will not be delivered until a URL is configured.');
        }
        this.logger.info(`[TendioAuth] Initialized for "${this.appConfig.appName}" — ${this.appConfig.roles.length} roles, caregivers: ${this.appConfig.allowsCaregivers}`);
    }
    getAppConfig() {
        if (!this.appConfig) {
            throw new TendioAuthError('config_fetch_failed', 'App config not loaded — call init() or use fromConfig() first');
        }
        return this.appConfig;
    }
    getRoles() {
        return this.getAppConfig().roles;
    }
    validateRoleNames(...roleNames) {
        validateRoles(roleNames, this.getAppConfig().roles);
    }
    getAuthorizeUrl(state, codeChallenge, options) {
        const config = this.getAppConfig();
        const params = new URLSearchParams({
            response_type: 'code',
            client_id: this.clientId,
            redirect_uri: this.redirectUri,
            scope: this.scopes.join(' '),
            state,
            code_challenge: codeChallenge,
            code_challenge_method: 'S256',
        });
        if (options?.prompt)
            params.set('prompt', options.prompt);
        if (options?.loginHint)
            params.set('login_hint', options.loginHint);
        if (options?.theme)
            params.set('theme', options.theme);
        return `${config.authorizeUrl}?${params.toString()}`;
    }
    generatePKCE() {
        const verifier = generateCodeVerifier();
        const challenge = generateCodeChallenge(verifier);
        const state = generateState();
        return { verifier, challenge, state };
    }
    async exchangeCode(code, codeVerifier) {
        const config = this.getAppConfig();
        const { tokenSet, rawIdToken } = await exchangeCodeForTokens(config.tokenUrl, code, this.redirectUri, this.clientId, this.clientSecret, codeVerifier, this.logger);
        const user = await verifyIdToken(rawIdToken, this.clientId, this.issuerUrl);
        if (this.onUserAuthenticated) {
            await this.onUserAuthenticated(user);
        }
        return { user, tokens: tokenSet };
    }
    async refreshTokens(currentTokens) {
        const config = this.getAppConfig();
        const key = currentTokens.refresh_token;
        const existing = this.refreshMutex.get(key);
        if (existing)
            return existing;
        const promise = refreshAccessToken(config.tokenUrl, currentTokens.refresh_token, this.clientId, this.clientSecret, this.logger).finally(() => {
            this.refreshMutex.delete(key);
        });
        this.refreshMutex.set(key, promise);
        return promise;
    }
    shouldRefreshTokens(tokens) {
        const now = Math.floor(Date.now() / 1000);
        return tokens.expires_at - now < TOKEN_REFRESH_BUFFER_SECONDS;
    }
    async revokeToken(token) {
        const config = this.getAppConfig();
        await revokeToken(config.revokeUrl, token, this.clientId, this.clientSecret, this.logger);
    }
    verifyWebhookPayload(rawBody, headers) {
        if (!this.webhookSecret) {
            throw new TendioAuthError('webhook_signature_invalid', 'No webhookSecret configured — cannot verify webhook signatures');
        }
        return verifyWebhookPayload(rawBody, headers, this.webhookSecret);
    }
    async fetchUser(userId) {
        return apiFetchUser(this.baseUrl, this.clientId, this.clientSecret, userId, this.logger);
    }
    async fetchAllUsers() {
        return apiFetchAllUsers(this.baseUrl, this.clientId, this.clientSecret, this.logger);
    }
    async triggerSync() {
        return apiTriggerSync(this.baseUrl, this.clientId, this.clientSecret, this.logger);
    }
}
//# sourceMappingURL=client.js.map