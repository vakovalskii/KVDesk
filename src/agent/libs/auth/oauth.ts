import http from 'http';
import { generatePKCE, generateState } from './pkce.js';
import { getCredential, setCredential, needsRefresh, isExpired, readCodexCliCredentials } from './store.js';
import type {
  AuthCredential,
  OAuthProviderConfig,
  DeviceCodeInfo,
  TokenResponse,
  OAuthFlowState,
} from './types.js';

// ── OpenAI OAuth config (same as Codex CLI / picoclaw) ──

export function openAIOAuthConfig(): OAuthProviderConfig {
  return {
    issuer: 'https://auth.openai.com',
    clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
    scopes: 'openid profile email offline_access',
    originator: 'codex_cli_rs',
    port: 1455,
  };
}

// ── URL builders ──

export function buildAuthorizeUrl(
  cfg: OAuthProviderConfig,
  codeChallenge: string,
  state: string,
  redirectUri: string,
): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: cfg.clientId,
    redirect_uri: redirectUri,
    scope: cfg.scopes,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
    id_token_add_organizations: 'true',
    codex_cli_simplified_flow: 'true',
    originator: cfg.originator || 'picoclaw',
  });
  return `${cfg.issuer}/oauth/authorize?${params.toString()}`;
}

// ── Token exchange ──

export async function exchangeCodeForTokens(
  cfg: OAuthProviderConfig,
  code: string,
  codeVerifier: string,
  redirectUri: string,
): Promise<AuthCredential> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: cfg.clientId,
    code_verifier: codeVerifier,
  });

  const tokenUrl = cfg.tokenUrl || `${cfg.issuer}/oauth/token`;
  const resp = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Token exchange failed (${resp.status}): ${text}`);
  }

  const tokenResp: TokenResponse = await resp.json();
  return parseTokenResponse(tokenResp, 'openai');
}

// ── Token refresh ──

export async function refreshAccessToken(
  cred: AuthCredential,
  cfg: OAuthProviderConfig,
): Promise<AuthCredential> {
  if (!cred.refreshToken) {
    throw new Error('No refresh token available');
  }

  const body = new URLSearchParams({
    client_id: cfg.clientId,
    grant_type: 'refresh_token',
    refresh_token: cred.refreshToken,
    scope: 'openid profile email',
  });

  const tokenUrl = cfg.tokenUrl || `${cfg.issuer}/oauth/token`;
  const resp = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Token refresh failed (${resp.status}): ${text}`);
  }

  const tokenResp: TokenResponse = await resp.json();
  const refreshed = parseTokenResponse(tokenResp, cred.provider);

  // Preserve fields from original credential
  if (!refreshed.refreshToken) refreshed.refreshToken = cred.refreshToken;
  if (!refreshed.accountId) refreshed.accountId = cred.accountId;
  if (cred.email && !refreshed.email) refreshed.email = cred.email;

  return refreshed;
}

// ── Browser OAuth flow ──

let activeFlow: OAuthFlowState | null = null;
let activeServer: http.Server | null = null;

export function startBrowserOAuthFlow(cfg: OAuthProviderConfig): {
  authorizeUrl: string;
  flowId: string;
} {
  // Cleanup any previous flow
  stopOAuthFlow();

  const pkce = generatePKCE();
  const state = generateState();
  const redirectUri = `http://localhost:${cfg.port}/auth/callback`;
  const flowId = state;

  activeFlow = {
    id: flowId,
    status: 'pending',
    pkce,
    state,
    redirectUri,
    config: cfg,
  };

  // Start callback server
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://localhost:${cfg.port}`);

    if (url.pathname === '/auth/callback') {
      handleOAuthCallback(url, res);
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  server.listen(cfg.port, '127.0.0.1', () => {
    console.log(`[OAuth] Callback server listening on port ${cfg.port}`);
  });

  server.on('error', (err) => {
    console.error(`[OAuth] Callback server error:`, err);
    if (activeFlow) activeFlow.status = 'error';
  });

  activeServer = server;

  const authorizeUrl = buildAuthorizeUrl(cfg, pkce.codeChallenge, state, redirectUri);

  return { authorizeUrl, flowId };
}

async function handleOAuthCallback(url: URL, res: http.ServerResponse): Promise<void> {
  if (!activeFlow) {
    res.writeHead(400);
    res.end('No active OAuth flow');
    return;
  }

  const returnedState = url.searchParams.get('state');
  if (returnedState !== activeFlow.state) {
    res.writeHead(400);
    res.end('State mismatch');
    return;
  }

  const code = url.searchParams.get('code');
  if (!code) {
    const errMsg = url.searchParams.get('error') || 'unknown';
    res.writeHead(400);
    res.end(`No authorization code: ${errMsg}`);
    activeFlow.status = 'error';
    return;
  }

  // Send success page
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`
    <html><body style="font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0">
      <div style="text-align:center">
        <h2 style="color:#22c55e">Authentication successful!</h2>
        <p>You can close this window and return to ValeDesk.</p>
      </div>
    </body></html>
  `);

  try {
    const cred = await exchangeCodeForTokens(
      activeFlow.config,
      code,
      activeFlow.pkce.codeVerifier,
      activeFlow.redirectUri,
    );
    setCredential('openai', cred);
    activeFlow.status = 'completed';
    console.log(`[OAuth] Login successful. Account: ${cred.accountId || 'unknown'}`);
  } catch (err) {
    console.error(`[OAuth] Token exchange error:`, err);
    activeFlow.status = 'error';
  }

  // Cleanup server after short delay
  setTimeout(() => stopOAuthFlow(), 2000);
}

export function stopOAuthFlow(): void {
  if (activeServer) {
    activeServer.close();
    activeServer = null;
  }
  activeFlow = null;
}

export function getOAuthFlowStatus(): { status: string; credential?: AuthCredential } | null {
  if (!activeFlow) return null;
  const result: { status: string; credential?: AuthCredential } = { status: activeFlow.status };
  if (activeFlow.status === 'completed') {
    result.credential = getCredential('openai') || undefined;
  }
  return result;
}

// ── Device Code flow ──

export async function requestDeviceCode(cfg: OAuthProviderConfig): Promise<DeviceCodeInfo> {
  const resp = await fetch(`${cfg.issuer}/api/accounts/deviceauth/usercode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: cfg.clientId }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Device code request failed: ${text}`);
  }

  const data = await resp.json();
  return {
    deviceAuthId: data.device_auth_id,
    userCode: data.user_code,
    verifyUrl: `${cfg.issuer}/codex/device`,
    interval: Math.max(parseInt(data.interval) || 5, 1),
  };
}

export async function pollDeviceCode(
  cfg: OAuthProviderConfig,
  deviceAuthId: string,
  userCode: string,
): Promise<AuthCredential | null> {
  const resp = await fetch(`${cfg.issuer}/api/accounts/deviceauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_auth_id: deviceAuthId, user_code: userCode }),
  });

  if (resp.status !== 200) {
    return null; // Still pending
  }

  const data = await resp.json();
  const redirectUri = `${cfg.issuer}/deviceauth/callback`;
  return exchangeCodeForTokens(cfg, data.authorization_code, data.code_verifier, redirectUri);
}

// ── Token source for Codex provider ──

/**
 * Returns a function that provides fresh (accessToken, accountId).
 * Automatically refreshes tokens when needed.
 */
export function createCodexTokenSource(): () => Promise<{ accessToken: string; accountId: string }> {
  const cfg = openAIOAuthConfig();

  return async () => {
    let cred = getCredential('openai');

    // Fallback: try Codex CLI credentials (~/.codex/auth.json)
    if (!cred) {
      const codexCred = readCodexCliCredentials();
      if (codexCred) {
        console.log('[OAuth] Using Codex CLI credentials from ~/.codex/auth.json');
        setCredential('openai', codexCred);
        cred = codexCred;
      }
    }

    if (!cred) {
      throw new Error('No OpenAI credentials. Please login via Settings > LLM Models > Codex provider, or run "codex" CLI to login.');
    }

    // Refresh if expired or about to expire
    if ((needsRefresh(cred) || isExpired(cred)) && cred.refreshToken) {
      try {
        const refreshed = await refreshAccessToken(cred, cfg);
        setCredential('openai', refreshed);
        cred = refreshed;
      } catch (err) {
        console.error('[OAuth] Token refresh failed:', err);
        // Continue with current token, it might still work
      }
    }

    return {
      accessToken: cred.accessToken,
      accountId: cred.accountId || '',
    };
  };
}

// ── JWT helpers ──

function parseTokenResponse(tokenResp: TokenResponse, provider: string): AuthCredential {
  if (!tokenResp.access_token) {
    throw new Error('No access token in response');
  }

  let expiresAt: string | undefined;
  if (tokenResp.expires_in) {
    expiresAt = new Date(Date.now() + tokenResp.expires_in * 1000).toISOString();
  }

  const cred: AuthCredential = {
    accessToken: tokenResp.access_token,
    refreshToken: tokenResp.refresh_token,
    expiresAt,
    provider,
    authMethod: 'oauth',
  };

  // Extract account ID from JWT claims
  const accountId =
    extractAccountId(tokenResp.id_token) ||
    extractAccountId(tokenResp.access_token);
  if (accountId) cred.accountId = accountId;

  // Extract email
  const email = extractEmail(tokenResp.id_token) || extractEmail(tokenResp.access_token);
  if (email) cred.email = email;

  return cred;
}

function extractAccountId(token?: string): string | null {
  if (!token) return null;
  const claims = parseJWTClaims(token);
  if (!claims) return null;

  if (typeof claims.chatgpt_account_id === 'string') return claims.chatgpt_account_id;
  if (typeof claims['https://api.openai.com/auth.chatgpt_account_id'] === 'string')
    return claims['https://api.openai.com/auth.chatgpt_account_id'];

  const authClaim = claims['https://api.openai.com/auth'];
  if (authClaim && typeof authClaim === 'object' && typeof (authClaim as Record<string, unknown>).chatgpt_account_id === 'string')
    return (authClaim as Record<string, unknown>).chatgpt_account_id as string;

  if (Array.isArray(claims.organizations)) {
    for (const org of claims.organizations) {
      if (org && typeof org === 'object' && typeof (org as Record<string, unknown>).id === 'string')
        return (org as Record<string, unknown>).id as string;
    }
  }

  return null;
}

function extractEmail(token?: string): string | null {
  if (!token) return null;
  const claims = parseJWTClaims(token);
  if (!claims) return null;
  if (typeof claims.email === 'string') return claims.email;
  return null;
}

function parseJWTClaims(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;

    let payload = parts[1]!;
    // Fix base64url padding
    switch (payload.length % 4) {
      case 2: payload += '=='; break;
      case 3: payload += '='; break;
    }

    const decoded = Buffer.from(payload, 'base64url').toString('utf-8');
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}
