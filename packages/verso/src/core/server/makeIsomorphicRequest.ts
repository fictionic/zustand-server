import type {ServerSettings} from "../../build/config";

const LOCAL_HOSTS = ['localhost', '127.0.0.1'];

export function makeIsomorphicRequest(rawReq: Request, settings: ServerSettings): Request {
  const rawUrl = new URL(rawReq.url);

  // X-Forwarded-* can be a comma-separated chain ("client, proxy1, proxy2");
  // the value from the originating client's is the first entry.
  const forwardedProtocols = rawReq.headers.get('x-forwarded-proto');
  const forwardedHosts = rawReq.headers.get('x-forwarded-host');

  const host = settings.trustProxy && forwardedHosts
    ? forwardedHosts.split(',')[0]!.trim()
    : rawUrl.host; // intentionally using `host` instead of `hostname` (we need the port)

  const protocol = settings.trustProxy && forwardedProtocols
    ? forwardedProtocols.split(',')[0]!.trim() + ':'
    : rawUrl.protocol;

  const lowercaseHost = host.toLowerCase(); // just to be safe...

  if (!hostIsAllowed(lowercaseHost, settings.allowedHosts)) {
    // allow all local hosts in dev mode, for convenience. allowedHosts is mostly a prod setting
    const isLocalhostDev = globalThis.IS_DEV && LOCAL_HOSTS.includes(lowercaseHost.split(':')[0]!);
    if (!isLocalhostDev) {
      throw new UntrustedHostError(lowercaseHost);
    }
  }

  const publicUrl = new URL(rawUrl.pathname + rawUrl.search, `${protocol}//${host}`);
  return new Request(publicUrl, rawReq);
}

function hostIsAllowed(host: string, allowedHosts: string[]): boolean {
  return allowedHosts.some((allowed) => {
    if (allowed.startsWith('*')) {
      // support globs for subdomains
      return host.endsWith(allowed.slice(1));
    }
    return host === allowed;
  });
}

export class UntrustedHostError extends Error {
  constructor(host: string) {
    super(`host not in allowedHosts: ${host}`);
    this.name = 'UntrustedHostError';
  }
}
