export interface AuthCredential {
  accessToken: string;
  refreshToken?: string;
  accountId?: string;
  expiresAt?: string; // ISO date string
  provider: string;
  authMethod: 'oauth' | 'device_code' | 'token';
  email?: string;
}

export interface AuthStore {
  credentials: Record<string, AuthCredential>;
}

export interface OAuthProviderConfig {
  issuer: string;
  clientId: string;
  clientSecret?: string;
  tokenUrl?: string;
  scopes: string;
  originator: string;
  port: number;
}

export interface PKCECodes {
  codeVerifier: string;
  codeChallenge: string;
}

export interface DeviceCodeInfo {
  deviceAuthId: string;
  userCode: string;
  verifyUrl: string;
  interval: number;
}

export interface OAuthFlowState {
  id: string;
  status: 'pending' | 'completed' | 'error';
  pkce: PKCECodes;
  state: string;
  redirectUri: string;
  config: OAuthProviderConfig;
}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  id_token?: string;
}
