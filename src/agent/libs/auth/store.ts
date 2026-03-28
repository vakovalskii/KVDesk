import fs from 'fs';
import path from 'path';
import os from 'os';
import type { AuthCredential, AuthStore } from './types.js';

function getAuthFilePath(): string {
  const home = os.homedir();
  // Store in ValeDesk data directory
  const platform = process.platform;
  let dataDir: string;
  if (platform === 'darwin') {
    dataDir = path.join(home, 'Library', 'Application Support', 'ValeDesk');
  } else if (platform === 'win32') {
    dataDir = path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'ValeDesk');
  } else {
    dataDir = path.join(home, '.config', 'ValeDesk');
  }
  return path.join(dataDir, 'auth.json');
}

export function loadAuthStore(): AuthStore {
  const filePath = getAuthFilePath();
  try {
    const data = fs.readFileSync(filePath, 'utf-8');
    const store: AuthStore = JSON.parse(data);
    if (!store.credentials) {
      store.credentials = {};
    }
    return store;
  } catch {
    return { credentials: {} };
  }
}

export function saveAuthStore(store: AuthStore): void {
  const filePath = getAuthFilePath();
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(store, null, 2), { mode: 0o600 });
}

export function getCredential(provider: string): AuthCredential | null {
  const store = loadAuthStore();
  return store.credentials[provider] || null;
}

export function setCredential(provider: string, cred: AuthCredential): void {
  const store = loadAuthStore();
  store.credentials[provider] = cred;
  saveAuthStore(store);
}

export function deleteCredential(provider: string): void {
  const store = loadAuthStore();
  delete store.credentials[provider];
  saveAuthStore(store);
}

export function isExpired(cred: AuthCredential): boolean {
  if (!cred.expiresAt) return false;
  return new Date() > new Date(cred.expiresAt);
}

export function needsRefresh(cred: AuthCredential): boolean {
  if (!cred.expiresAt) return false;
  const fiveMinutes = 5 * 60 * 1000;
  return new Date(Date.now() + fiveMinutes) > new Date(cred.expiresAt);
}

/**
 * Try to read credentials from Codex CLI's ~/.codex/auth.json
 * Format: { auth_mode, tokens: { access_token, refresh_token, id_token, account_id }, last_refresh }
 */
export function readCodexCliCredentials(): AuthCredential | null {
  try {
    const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
    const authPath = path.join(codexHome, 'auth.json');
    const data = fs.readFileSync(authPath, 'utf-8');
    const auth = JSON.parse(data);

    const accessToken = auth?.tokens?.access_token;
    if (!accessToken) return null;

    const accountId = auth?.tokens?.account_id || '';
    const refreshToken = auth?.tokens?.refresh_token || undefined;

    // Parse JWT to get expiry and email
    let expiresAt: string | undefined;
    let email: string | undefined;
    try {
      const parts = accessToken.split('.');
      if (parts.length >= 2) {
        let payload = parts[1];
        switch (payload.length % 4) {
          case 2: payload += '=='; break;
          case 3: payload += '='; break;
        }
        const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
        if (claims.exp) {
          expiresAt = new Date(claims.exp * 1000).toISOString();
        }
        const profile = claims['https://api.openai.com/profile'];
        if (profile?.email) {
          email = profile.email;
        }
      }
    } catch { /* ignore JWT parse errors */ }

    return {
      accessToken,
      refreshToken,
      accountId,
      expiresAt,
      provider: 'openai',
      authMethod: 'oauth',
      email,
    };
  } catch {
    return null;
  }
}
