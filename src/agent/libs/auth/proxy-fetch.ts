import { HttpsProxyAgent } from 'https-proxy-agent';

/**
 * Create a fetch function that routes through a proxy.
 * Supports http://, https://, socks5:// proxy URLs.
 * Falls back to HTTP_PROXY/HTTPS_PROXY env vars if no explicit proxy provided.
 */
export function createProxyFetch(proxyUrl?: string): typeof fetch {
  const proxy = proxyUrl || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy;

  if (!proxy) {
    return globalThis.fetch;
  }

  const agent = new HttpsProxyAgent(proxy);

  return (input: any, init?: any) => {
    const opts: any = { ...init, agent };
    return globalThis.fetch(input, opts);
  };
}
