import type {ServerSettings} from "../../build/config";
import type {RequestContext, RequestHandler} from "../../vendor/hattip/compose";

const LOCAL_HOSTS = ['localhost', '127.0.0.1'];

export function resolvePublicRequest(settings: ServerSettings, allowLoopbackHosts = false): RequestHandler {
  return (ctx: RequestContext) => {
    const rawReq = ctx.request;
    const rawUrl = ctx.url;

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

    const { allowedHosts } = settings;
    if (!hostIsAllowed(lowercaseHost, allowedHosts)) {
      // allow all local hosts in dev/preview mode, for convenience. allowedHosts is mostly a prod setting
      const isAllowedLoopback = allowLoopbackHosts && LOCAL_HOSTS.includes(lowercaseHost.split(':')[0]!);
      if (!isAllowedLoopback) {
        console.error(`[verso] Host not in allowedHosts: ${host}`);
        return misdirectedRequest();
      }
    }

    const publicUrl = new URL(rawUrl.pathname + rawUrl.search, `${protocol}//${host}`);
    ctx.url = publicUrl;
    ctx.request = new Request(publicUrl, rawReq); // passing Request as init copies method/headers/body/signal/duplex
  };
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

function misdirectedRequest(): Response {
  return new Response('Misdirected Request', { status: 421 });
}
