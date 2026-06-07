import {createFileLoader} from "./file";

export type StaticCacheOptions = {
  maxAge?: number;
  immutable?: boolean;
  etag?: boolean;
};

export type StaticFileServer = {
  tryServeStatic: (req: Request) => Promise<Response | null>;
};

export async function createStaticFileServer(rootDir: string, opts: StaticCacheOptions): Promise<StaticFileServer> {
  const staticFileLoader = await createFileLoader(rootDir);
  return {
    tryServeStatic: async (req: Request) => {
      if (req.method === 'GET' || req.method === 'HEAD') {
        const { pathname: rawPathname } = new URL(req.url);
        const pathname = decodeURIComponent(rawPathname);
        // strip leading path separator, since the file loader doesn't put those in the key
        const normalizedPathname = pathname.replace(/^\/+/, '');
        const loaded = staticFileLoader.loadFile(normalizedPathname);
        if (loaded) {
          if (opts.etag && req.headers.get('If-None-Match') === loaded.etag) {
            return new Response(null, { status: 304 });
          }
          return new Response(loaded.file, {
            headers: makeHeaders(loaded.etag, opts),
          });
        }
      }
      return null;
    },
  };
}

function makeHeaders(fileEtag: string, opts: StaticCacheOptions): Headers {
  const headers = new Headers();
  const { maxAge, immutable, etag } = opts;
  if (typeof maxAge === 'number') {
    let cacheControl: string;
    if (maxAge > 0) {
      cacheControl = `public, max-age=${maxAge}`;
      if (immutable) {
        cacheControl += ', immutable';
      }
    } else {
      // match sirv's implementation
      cacheControl = 'public, max-age=0, must-revalidate';
    }
    headers.append('Cache-Control', cacheControl);
  }
  if (etag) {
    headers.append('ETag', fileEtag);
  }
  return headers;
}

