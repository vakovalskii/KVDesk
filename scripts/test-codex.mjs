#!/usr/bin/env node
/**
 * Integration test: Codex API via OAuth
 * 1. Tries existing credentials from ~/.codex/auth.json
 * 2. If expired — runs OAuth browser flow to get new tokens
 * 3. Makes a test request to chatgpt.com/backend-api/codex using Responses API
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import http from 'http';
import { execSync } from 'child_process';

const CODEX_AUTH_PATH = path.join(os.homedir(), '.codex', 'auth.json');
const CODEX_BASE_URL = 'https://chatgpt.com/backend-api/codex';
const OAUTH_ISSUER = 'https://auth.openai.com';
const OAUTH_TOKEN_URL = `${OAUTH_ISSUER}/oauth/token`;
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const CALLBACK_PORT = 1455;

// ── Helpers ──

function parseJWT(token) {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    let payload = parts[1];
    switch (payload.length % 4) {
      case 2: payload += '=='; break;
      case 3: payload += '='; break;
    }
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
  } catch { return null; }
}

function isExpired(token) {
  const claims = parseJWT(token);
  if (!claims?.exp) return false;
  return Date.now() > claims.exp * 1000;
}

function generatePKCE() {
  const verifier = crypto.randomBytes(64).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

async function refreshAccessToken(refreshToken) {
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    scope: 'openid profile email',
  });

  const resp = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    throw new Error(`Refresh failed (${resp.status}): ${data.error?.message || 'unknown'}`);
  }

  return await resp.json();
}

function runOAuthBrowserFlow() {
  return new Promise((resolve, reject) => {
    const { verifier, challenge } = generatePKCE();
    const state = crypto.randomBytes(32).toString('hex');
    const redirectUri = `http://localhost:${CALLBACK_PORT}/auth/callback`;

    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, `http://localhost:${CALLBACK_PORT}`);
      if (url.pathname !== '/auth/callback') {
        res.writeHead(404);
        res.end();
        return;
      }

      const returnedState = url.searchParams.get('state');
      const code = url.searchParams.get('code');

      if (returnedState !== state || !code) {
        res.writeHead(400);
        res.end('Invalid callback');
        server.close();
        reject(new Error('OAuth callback: state mismatch or missing code'));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<html><body style="font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh"><h2 style="color:#22c55e">OK! Return to terminal.</h2></body></html>');

      try {
        const body = new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
          client_id: CLIENT_ID,
          code_verifier: verifier,
        });

        const resp = await fetch(OAUTH_TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
        });

        if (!resp.ok) {
          const text = await resp.text();
          server.close();
          reject(new Error(`Token exchange failed (${resp.status}): ${text}`));
          return;
        }

        const tokens = await resp.json();
        server.close();
        resolve(tokens);
      } catch (err) {
        server.close();
        reject(err);
      }
    });

    server.listen(CALLBACK_PORT, '127.0.0.1', () => {
      const params = new URLSearchParams({
        response_type: 'code',
        client_id: CLIENT_ID,
        redirect_uri: redirectUri,
        scope: 'openid profile email offline_access',
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
        id_token_add_organizations: 'true',
        originator: 'codex_cli_rs',
      });
      const authorizeUrl = `${OAUTH_ISSUER}/oauth/authorize?${params}`;

      console.log('      Opening browser for OpenAI login...');
      execSync(`open "${authorizeUrl}"`);
    });

    // Timeout after 3 minutes
    setTimeout(() => {
      server.close();
      reject(new Error('OAuth timeout (3 min)'));
    }, 3 * 60 * 1000);
  });
}

// ── Main ──

console.log('=== Codex API Integration Test ===\n');

// Step 1: Load existing credentials
let accessToken = null;
let accountId = null;

if (fs.existsSync(CODEX_AUTH_PATH)) {
  const authData = JSON.parse(fs.readFileSync(CODEX_AUTH_PATH, 'utf-8'));
  accessToken = authData.tokens?.access_token;
  const refreshToken = authData.tokens?.refresh_token;
  accountId = authData.tokens?.account_id;

  if (accessToken && !isExpired(accessToken)) {
    const claims = parseJWT(accessToken);
    console.log(`[1/4] Token valid: ${claims?.['https://api.openai.com/profile']?.email}`);
  } else if (refreshToken) {
    console.log('[1/4] Token expired, trying refresh...');
    try {
      const tokens = await refreshAccessToken(refreshToken);
      accessToken = tokens.access_token;

      // Extract accountId from new token
      const claims = parseJWT(accessToken);
      const auth = claims?.['https://api.openai.com/auth'];
      if (auth?.chatgpt_account_id) accountId = auth.chatgpt_account_id;

      // Save back
      authData.tokens.access_token = tokens.access_token;
      if (tokens.id_token) authData.tokens.id_token = tokens.id_token;
      if (tokens.refresh_token) authData.tokens.refresh_token = tokens.refresh_token;
      authData.last_refresh = new Date().toISOString();
      fs.writeFileSync(CODEX_AUTH_PATH, JSON.stringify(authData, null, 2));
      console.log('      Token refreshed successfully');
    } catch (err) {
      console.log(`      Refresh failed: ${err.message}`);
      accessToken = null;
    }
  } else {
    console.log('[1/4] No valid credentials found');
    accessToken = null;
  }
} else {
  console.log('[1/4] No ~/.codex/auth.json found');
}

// Step 2: OAuth browser flow if needed
if (!accessToken || isExpired(accessToken)) {
  console.log('\n[2/4] Starting OAuth browser flow...');
  try {
    const tokens = await runOAuthBrowserFlow();
    accessToken = tokens.access_token;

    const claims = parseJWT(accessToken);
    const auth = claims?.['https://api.openai.com/auth'];
    accountId = auth?.chatgpt_account_id || accountId;
    const email = claims?.['https://api.openai.com/profile']?.email || 'unknown';

    // Save to ~/.codex/auth.json
    const saveData = {
      auth_mode: 'chatgpt',
      OPENAI_API_KEY: null,
      tokens: {
        id_token: tokens.id_token || null,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token || null,
        account_id: accountId,
      },
      last_refresh: new Date().toISOString(),
    };
    fs.mkdirSync(path.dirname(CODEX_AUTH_PATH), { recursive: true });
    fs.writeFileSync(CODEX_AUTH_PATH, JSON.stringify(saveData, null, 2));

    console.log(`      Logged in as: ${email}`);
    console.log(`      Account ID: ${accountId}`);
    console.log(`      Saved to ${CODEX_AUTH_PATH}`);
  } catch (err) {
    console.error(`\nERROR: OAuth failed: ${err.message}`);
    process.exit(1);
  }
} else {
  console.log('\n[2/4] Using existing valid token');
}

// Step 3: Test Codex Responses API
console.log('\n[3/4] Sending test request to Codex Responses API...');
console.log(`      URL: ${CODEX_BASE_URL}/responses`);
console.log(`      Model: gpt-5.3-codex`);

const apiResp = await fetch(`${CODEX_BASE_URL}/responses`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${accessToken}`,
    'Chatgpt-Account-Id': accountId,
    'originator': 'codex_cli_rs',
    'OpenAI-Beta': 'responses=experimental',
  },
  body: JSON.stringify({
    model: 'gpt-5.3-codex',
    instructions: 'You are Codex, a coding assistant.',
    input: [{ role: 'user', content: 'Say "Hello from ValeDesk!" and nothing else.' }],
    store: false,
    stream: true,
  }),
});

console.log(`      Status: ${apiResp.status} ${apiResp.statusText}`);

if (!apiResp.ok) {
  const text = await apiResp.text();
  if (text.includes('cf_chl_opt') || text.includes('challenge-platform')) {
    console.error('\nERROR: Cloudflare challenge! Token may be invalid or IP blocked.');
  } else {
    console.error(`\nERROR: ${text.substring(0, 500)}`);
  }
  process.exit(1);
}

// Parse SSE stream
const body = await apiResp.text();
const lines = body.split('\n');
let responseText = '';
let responseId = '';
let responseModel = '';
let usage = null;

for (const line of lines) {
  if (!line.startsWith('data: ')) continue;
  const data = line.slice(6);
  if (data === '[DONE]') break;
  try {
    const event = JSON.parse(data);
    if (event.type === 'response.output_text.delta') {
      responseText += event.delta || '';
    }
    if (event.type === 'response.completed' && event.response) {
      responseId = event.response.id;
      responseModel = event.response.model;
      usage = event.response.usage;
      // Also extract text from completed response
      if (!responseText && event.response.output) {
        for (const item of event.response.output) {
          if (item.type === 'message' && item.content) {
            for (const part of item.content) {
              if (part.type === 'output_text') responseText += part.text;
            }
          }
        }
      }
    }
  } catch {}
}

// Step 4: Show result
console.log('\n[4/4] Response received!');
console.log(`      Model says: "${responseText}"`);
console.log(`      Response ID: ${responseId}`);
console.log(`      Model: ${responseModel}`);
if (usage) {
  console.log(`      Tokens: ${usage.input_tokens} in / ${usage.output_tokens} out`);
}

console.log('\n=== TEST PASSED ===');
