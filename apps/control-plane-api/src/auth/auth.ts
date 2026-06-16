import type { NextFunction, Request, Response } from "express";
import { createHash, randomBytes } from "node:crypto";
import { createAuthSession, deleteAuthSession, getAuthSessionByHash, getTenantApiKeyByHash, getUser, getWorkspaceApiKeyByHash, touchTenantApiKey, touchWorkspaceApiKey, upsertUser } from "../store";
import type { JsonRecord } from "../types";
import { decodeStatePart, encodeStatePart, safeWebReturnPath } from "./returnPath";

export type AuthUser = { id: string; email: string; name: string; auth_provider: string; role: string; metadata: JsonRecord; created_at: string; updated_at: string };

export type AuthenticatedRequest = Request & { user?: AuthUser };

export const authCookieName = "maple_session";
export const oauthStateCookieName = "maple_oauth_state";
const sessionDays = Number(process.env.MAPLE_AUTH_SESSION_DAYS || 7);

export function listAuthProviders() {
  return [
    { id: "local", name: "Local dev login", configured: true }, { id: "oauth", name: "OAuth 2.0", configured: Boolean(getProviderConfig("oauth")) },
    { id: "oidc", name: "OIDC", configured: Boolean(getProviderConfig("oidc")) }, { id: "lark_sso", name: "Lark SSO", configured: Boolean(getProviderConfig("lark_sso")) },
    { id: "bytesso", name: "ByteSSO", configured: Boolean(getProviderConfig("bytesso")) }
  ];
}

export function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function readRequestToken(request: Request) {
  const authHeader = request.header("authorization") || "";
  if (authHeader.toLowerCase().startsWith("bearer ")) return authHeader.slice(7).trim();
  return readCookie(request.header("cookie") || "", authCookieName);
}

export function issueLogin(input: { provider: string; email: string; name?: string; metadata?: JsonRecord }) {
  const provider = normalizeProvider(input.provider);
  const email = input.email.trim().toLowerCase();
  const user = upsertUser({
    email,
    name: input.name?.trim() || email.split("@")[0] || "Local User",
    auth_provider: provider,
    metadata: { ...(input.metadata ?? {}), login_method: provider }
  }) as AuthUser;
  const token = `maple_sess_${randomBytes(32).toString("base64url")}`;
  const expiresAt = new Date(Date.now() + sessionDays * 86_400_000).toISOString();
  createAuthSession({ token_hash: tokenHash(token), user_id: user.id, expires_at: expiresAt });
  return { user, token, expires_at: expiresAt };
}

export function requireAuth(request: AuthenticatedRequest, response: Response, next: NextFunction) {
  const token = readRequestToken(request);
  const apiKey = request.header("x-maple-api-key") || request.header("x-api-key") || "";
  if (!token && !apiKey) return response.status(401).json({ error: "login_required" });
  const auth = token ? getAuthSessionByHash(tokenHash(token)) : null;
  if (auth?.user) {
    request.user = auth.user as AuthUser;
    return next();
  }
  const apiUser = resolveApiKeyUser(apiKey || token || "");
  if (!apiUser) return response.status(401).json({ error: "invalid_or_expired_session" });
  request.user = apiUser;
  next();
}

function resolveApiKeyUser(rawKey: string) {
  if (!rawKey) return null;
  const devKey = process.env.MAPLE_DEV_API_KEY || "maple_dev_key";
  if (rawKey === devKey) {
    return upsertUser({
      email: process.env.MAPLE_DEV_USER_EMAIL || "local-managed-agent@example.com",
      name: process.env.MAPLE_DEV_USER_NAME || "Maple Developer",
      auth_provider: "local",
      metadata: { source: "platform_dev_key" }
    }) as AuthUser;
  }
  const workspaceKey = getWorkspaceApiKeyByHash(tokenHash(rawKey)) as JsonRecord | null;
  if (workspaceKey?.enabled && workspaceKey.workspace_status === "active") {
    touchWorkspaceApiKey(String(workspaceKey.id));
    const user = getUser(String(workspaceKey.created_by_user_id));
    if (!user) return null;
    return {
      ...(user as AuthUser),
      metadata: {
        ...((user as AuthUser).metadata ?? {}),
        source: "workspace_api_key",
        workspace_api_key_id: workspaceKey.id,
        workspace_id: workspaceKey.workspace_id,
        scopes: workspaceKey.scopes
      }
    } as AuthUser;
  }
  const tenantKey = getTenantApiKeyByHash(tokenHash(rawKey)) as JsonRecord | null;
  if (tenantKey?.enabled && tenantKey.tenant_status === "active") {
    touchTenantApiKey(String(tenantKey.id));
    const user = getUser(String(tenantKey.created_by_user_id));
    if (!user) return null;
    return {
      ...(user as AuthUser),
      metadata: {
        ...((user as AuthUser).metadata ?? {}),
        source: "tenant_api_key",
        tenant_api_key_id: tenantKey.id,
        tenant_id: tenantKey.tenant_id,
        scopes: tenantKey.scopes
      }
    } as AuthUser;
  }
  return null;
}

export function optionalAuth(request: AuthenticatedRequest, _response: Response, next: NextFunction) {
  const token = readRequestToken(request);
  if (token) {
    const auth = getAuthSessionByHash(tokenHash(token));
    if (auth?.user) request.user = auth.user as AuthUser;
  }
  if (!request.user) {
    const apiUser = resolveApiKeyUser(request.header("x-maple-api-key") || request.header("x-api-key") || token || "");
    if (apiUser) request.user = apiUser;
  }
  next();
}

export function currentUser(request: AuthenticatedRequest) {
  if (!request.user) throw new Error("request user missing; requireAuth must run first");
  return request.user;
}

export function setAuthCookie(response: Response, token: string, expiresAt: string) {
  response.cookie(authCookieName, token, { httpOnly: true, sameSite: "lax", secure: process.env.MAPLE_COOKIE_SECURE === "true", expires: new Date(expiresAt), path: "/" });
}

export function buildAuthorizationStart(provider: string, redirectUri?: string) {
  const normalized = normalizeProvider(provider);
  const config = getProviderConfig(normalized);
  if (!config) return null;
  const effectiveRedirectUri = config.callbackUrl || redirectUri;
  if (!effectiveRedirectUri) return null;
  const state = randomBytes(18).toString("base64url");
  const url = new URL(config.authorizeUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", effectiveRedirectUri);
  url.searchParams.set("scope", config.scope);
  url.searchParams.set("state", state);
  return { state, redirect_url: url.toString(), provider: normalized, redirect_uri: effectiveRedirectUri };
}

export function providerCallbackUrl(provider: string, fallback: string) {
  return getProviderConfig(provider)?.callbackUrl || fallback;
}

export async function completeAuthorizationCode(input: { provider: string; code: string; redirectUri: string }) {
  const provider = normalizeProvider(input.provider);
  const config = getProviderConfig(provider);
  if (!config) throw new Error(`Auth provider is not configured: ${provider}`);
  if (config.kind === "lark_openapi") return completeLarkAuthorizationCode(config, input.code);

  const tokenResponse = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.redirectUri,
      client_id: config.clientId,
      client_secret: config.clientSecret
    })
  });
  const tokenText = await tokenResponse.text();
  if (!tokenResponse.ok) throw new Error(`Token exchange failed ${tokenResponse.status}: ${tokenText}`);
  const tokenBody = JSON.parse(tokenText) as JsonRecord;
  const accessToken = String(tokenBody.access_token || "");
  if (!accessToken) throw new Error("Token exchange response did not include access_token.");
  const profile = await fetchUserProfile(config, accessToken, tokenBody);
  return issueLogin({
    provider,
    email: profile.email,
    name: profile.name,
    metadata: { external_sub: profile.sub, source: "oauth_callback" }
  });
}

export function setOAuthStateCookie(response: Response, provider: string, state: string, context?: { tenantSlug?: string; workspaceSlug?: string; returnTo?: string }) {
  const tenantSlug = normalizeRouteSlug(context?.tenantSlug ?? "");
  const workspaceSlug = normalizeRouteSlug(context?.workspaceSlug ?? "");
  const returnTo = safeWebReturnPath(context?.returnTo);
  const returnPart = returnTo ? `:${encodeStatePart(returnTo)}` : "";
  const value = tenantSlug || returnTo ? `${normalizeProvider(provider)}:${state}:${tenantSlug}:${workspaceSlug}${returnPart}` : `${normalizeProvider(provider)}:${state}`;
  response.cookie(oauthStateCookieName, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.MAPLE_COOKIE_SECURE === "true",
    maxAge: 10 * 60 * 1000,
    path: "/"
  });
}

export function verifyOAuthState(request: Request, provider: string, state: string) {
  const parsed = parseOAuthStateCookie(request);
  return Boolean(parsed && parsed.provider === normalizeProvider(provider) && parsed.state === state);
}

export function oauthStateWorkspaceRoute(request: Request, provider: string, state: string) {
  const parsed = parseOAuthStateCookie(request);
  if (!parsed || parsed.provider !== normalizeProvider(provider) || parsed.state !== state) return "";
  if (parsed.returnTo) return parsed.returnTo;
  return parsed.tenantSlug ? `/t/${encodeURIComponent(parsed.tenantSlug)}${parsed.workspaceSlug ? `/w/${encodeURIComponent(parsed.workspaceSlug)}` : ""}` : "";
}

export function clearOAuthStateCookie(response: Response) {
  response.clearCookie(oauthStateCookieName, { path: "/" });
}

export function clearAuth(request: Request, response: Response) {
  const token = readRequestToken(request);
  if (token) deleteAuthSession(tokenHash(token));
  response.clearCookie(authCookieName, { path: "/" });
}

function normalizeProvider(provider: string) {
  const normalized = provider.trim().toLowerCase();
  if (["local", "oauth", "oidc", "lark_sso", "bytesso"].includes(normalized)) return normalized;
  return "local";
}

function normalizeRouteSlug(value: string) {
  const slug = value.trim().toLowerCase();
  return /^[a-z0-9]([a-z0-9-]{1,58}[a-z0-9])?$/.test(slug) ? slug : "";
}

function parseOAuthStateCookie(request: Request) {
  const raw = readCookie(request.header("cookie") || "", oauthStateCookieName);
  const [provider, state, tenantSlug = "", workspaceSlug = "", returnToPart = ""] = raw.split(":");
  if (!provider || !state) return null;
  return { provider, state, tenantSlug: normalizeRouteSlug(tenantSlug), workspaceSlug: normalizeRouteSlug(workspaceSlug), returnTo: safeWebReturnPath(decodeStatePart(returnToPart)) };
}

function getProviderConfig(provider: string) {
  const normalized = normalizeProvider(provider);
  if (normalized === "local") return null;
  if (normalized === "lark_sso") {
    const oidcTokenUrl = process.env.MAPLE_LARK_TOKEN_URL || "";
    if (oidcTokenUrl) {
      const authorizeUrl = process.env.MAPLE_LARK_AUTHORIZE_URL || "";
      const userinfoUrl = process.env.MAPLE_LARK_USERINFO_URL || "";
      const clientId = process.env.MAPLE_LARK_CLIENT_ID || "";
      const clientSecret = process.env.MAPLE_LARK_CLIENT_SECRET || "";
      if (!authorizeUrl || !userinfoUrl || !clientId || !clientSecret) return null;
      return {
        kind: "generic_oauth" as const,
        authorizeUrl,
        tokenUrl: oidcTokenUrl,
        userinfoUrl,
        clientId,
        clientSecret,
        scope: process.env.MAPLE_LARK_SCOPE || "openid email profile",
        callbackUrl: process.env.MAPLE_LARK_CALLBACK_URL || ""
      };
    }
    const appId = process.env.MAPLE_LARK_APP_ID || process.env.MAPLE_LARK_CLIENT_ID || "";
    const appSecret = process.env.MAPLE_LARK_APP_SECRET || process.env.MAPLE_LARK_CLIENT_SECRET || "";
    const apiBase = (process.env.MAPLE_LARK_OPENAPI_BASE_URL || "https://open.feishu.cn/open-apis").replace(/\/$/, "");
    if (appId && appSecret) {
      return {
        kind: "lark_openapi" as const,
        authorizeUrl: process.env.MAPLE_LARK_AUTHORIZE_URL || "https://accounts.feishu.cn/open-apis/authen/v1/authorize",
        tokenUrl: process.env.MAPLE_LARK_USER_ACCESS_TOKEN_URL || `${apiBase}/authen/v1/access_token`,
        tokenUrlFallback: `${apiBase}/authen/v1/oidc/access_token`,
        userinfoUrl: process.env.MAPLE_LARK_USERINFO_URL || `${apiBase}/authen/v1/user_info`,
        appTokenUrl: process.env.MAPLE_LARK_APP_ACCESS_TOKEN_URL || `${apiBase}/auth/v3/app_access_token/internal`,
        clientId: appId,
        clientSecret: appSecret,
        scope: process.env.MAPLE_LARK_SCOPE || "auth:user.id:read",
        callbackUrl: process.env.MAPLE_LARK_CALLBACK_URL || ""
      };
    }
  }
  const prefix =
    normalized === "oauth"
      ? "MAPLE_OAUTH"
      : normalized === "oidc"
        ? "MAPLE_OIDC"
        : normalized === "lark_sso"
          ? "MAPLE_LARK"
          : "MAPLE_BYTESSO";
  const authorizeUrl = process.env[`${prefix}_AUTHORIZE_URL`] || "";
  const tokenUrl = process.env[`${prefix}_TOKEN_URL`] || "";
  const userinfoUrl = process.env[`${prefix}_USERINFO_URL`] || "";
  const clientId = process.env[`${prefix}_CLIENT_ID`] || "";
  const clientSecret = process.env[`${prefix}_CLIENT_SECRET`] || "";
  if (!authorizeUrl || !tokenUrl || !userinfoUrl || !clientId || !clientSecret) return null;
  return {
    kind: "generic_oauth" as const,
    authorizeUrl,
    tokenUrl,
    userinfoUrl,
    clientId,
    clientSecret,
    scope: process.env[`${prefix}_SCOPE`] || (normalized === "oidc" || normalized === "lark_sso" ? "openid email profile" : "email profile"),
    callbackUrl: process.env[`${prefix}_CALLBACK_URL`] || ""
  };
}

async function fetchUserProfile(
  config: NonNullable<ReturnType<typeof getProviderConfig>>,
  accessToken: string,
  tokenBody: JsonRecord
) {
  const userinfoResponse = await fetch(config.userinfoUrl, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const userinfoText = await userinfoResponse.text();
  if (!userinfoResponse.ok) throw new Error(`Userinfo fetch failed ${userinfoResponse.status}: ${userinfoText}`);
  const body = JSON.parse(userinfoText) as JsonRecord;
  const profile = (typeof body.data === "object" && body.data !== null ? body.data : body) as JsonRecord;
  const email = String(profile.email || profile.enterprise_email || profile.mail || profile.user_email || "");
  if (!email) throw new Error("Userinfo response did not include an email.");
  return {
    email,
    name: String(profile.name || profile.en_name || profile.display_name || profile.user_name || email.split("@")[0]),
    sub: String(profile.sub || profile.open_id || profile.union_id || profile.user_id || tokenBody.id_token || "")
  };
}

async function completeLarkAuthorizationCode(config: Extract<NonNullable<ReturnType<typeof getProviderConfig>>, { kind: "lark_openapi" }>, code: string) {
  const appAccessToken = await getLarkAppAccessToken(config);
  const tokenBody = await exchangeLarkUserAccessToken(config, appAccessToken, code);
  const accessToken = String(tokenBody.access_token || tokenBody.user_access_token || "");
  if (!accessToken) throw new Error("Lark user_access_token response did not include access_token.");
  const profile = await fetchUserProfile(config, accessToken, tokenBody);
  return issueLogin({
    provider: "lark_sso",
    email: profile.email,
    name: profile.name,
    metadata: {
      external_sub: profile.sub,
      source: "lark_openapi_callback",
      lark_scope: tokenBody.scope ?? ""
    }
  });
}

async function getLarkAppAccessToken(config: Extract<NonNullable<ReturnType<typeof getProviderConfig>>, { kind: "lark_openapi" }>) {
  const response = await fetch(config.appTokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      app_id: config.clientId,
      app_secret: config.clientSecret
    })
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Lark app_access_token fetch failed ${response.status}: ${text}`);
  const body = JSON.parse(text) as JsonRecord;
  if (Number(body.code ?? 0) !== 0) throw new Error(`Lark app_access_token failed ${body.code}: ${body.msg}`);
  const token = String(body.app_access_token || "");
  if (!token) throw new Error("Lark app_access_token response did not include app_access_token.");
  return token;
}

async function exchangeLarkUserAccessToken(
  config: Extract<NonNullable<ReturnType<typeof getProviderConfig>>, { kind: "lark_openapi" }>,
  appAccessToken: string,
  code: string
) {
  const body = {
    grant_type: "authorization_code",
    code
  };
  const primary = await postLarkUserToken(config.tokenUrl, appAccessToken, body);
  if (primary.ok) return primary.data;
  const fallback = await postLarkUserToken(config.tokenUrlFallback, appAccessToken, body);
  if (fallback.ok) return fallback.data;
  throw new Error(`Lark user_access_token failed: ${primary.error}; fallback: ${fallback.error}`);
}

async function postLarkUserToken(url: string, appAccessToken: string, body: JsonRecord) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${appAccessToken}`,
      "Content-Type": "application/json; charset=utf-8"
    },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  if (!response.ok) return { ok: false as const, error: `${response.status}: ${text}` };
  const parsed = JSON.parse(text) as JsonRecord;
  if (Number(parsed.code ?? 0) !== 0) return { ok: false as const, error: `${parsed.code}: ${parsed.msg}` };
  const data = (typeof parsed.data === "object" && parsed.data !== null ? parsed.data : parsed) as JsonRecord;
  return { ok: true as const, data };
}

function readCookie(header: string, name: string) {
  const cookies = header.split(";").map((part) => part.trim());
  const prefix = `${name}=`;
  const match = cookies.find((cookie) => cookie.startsWith(prefix));
  return match ? decodeURIComponent(match.slice(prefix.length)) : "";
}
