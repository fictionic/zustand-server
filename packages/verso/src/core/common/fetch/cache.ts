export type DehydratedCache = Record<string, Array<DehydratedCacheEntry>>;

export type PendingEntry = {
  request: CacheableRequest;
  dataPromise: Promise<CacheEntryData>;
};

export type CacheableRequest = {
  url: string;
  method: string;
  body: string | null;
};

export type CacheEntryData = {
  response: CachedResponse | null;
  error: SerializedError | null;
  requesters: number;
};

export type CachedResponse = {
  text: string;
  isBinary?: boolean;
  status: number;
  // we don't include response headers in the cache because (1) they're big,
  // (2) it would be a security vulnerability, and (3) probably no one needs them.
};

type SerializedError = {
  message: string;
};

type DehydratedCacheEntry = {
  aux: CacheKeyAuxData;
  data: CacheEntryData;
};

type CacheKeyAuxData = {
  method: string;
  query: string;
  body: string | null;
};

type CacheEntry = {
  aux: CacheKeyAuxData;
  data: CacheEntryData;
  dfd: PromiseWithResolvers<CachedResponse>;
  evicted?: boolean;
};

const EVICTED: unique symbol = Symbol();

type ThrownEviction = {
  [EVICTED]: true,
  response: Response,
};

export class FetchCache {
  private buckets: Map<string, Array<CacheEntry>>;

  constructor() {
    this.buckets = new Map();
  }

  private createEntry(req: CacheableRequest): CacheEntry {
    const { urlKey, searchParams } = parseUrlString(req.url);
    const entry: CacheEntry = {
      data: {
        response: null,
        error: null,
        requesters: 1,
      },
      aux: {
        method: req.method,
        body: req.body,
        query: normalizeQueryParams(searchParams),
      },
      dfd: Promise.withResolvers(),
    };
    const key = urlKey;
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = [];
      this.buckets.set(key, bucket);
    }
    bucket.push(entry);
    return entry;
  }

  private findEntry(req: CacheableRequest): CacheEntry | null {
    const { urlKey, searchParams } = parseUrlString(req.url);
    const bucket = this.buckets.get(urlKey);
    if (!bucket) return null;
    const normalizedParams = normalizeQueryParams(searchParams);
    return bucket.find((entry) => {
      if (entry.evicted) return false;
      const { method, query, body } = entry.aux;
      if (method !== req.method) return false;
      if (normalizedParams !== query) return false;
      if (body !== req.body) return false;
      return true;
    }) ?? null;
  }

  server() {
    const cache = this;
    return {
      receiveRequest(req: CacheableRequest): {first: boolean, responsePromise: Promise<CachedResponse>} {
        let first!: boolean;
        let entry = cache.findEntry(req);
        if (!entry) {
          first = true;
          entry = cache.createEntry(req);
        } else {
          first = false;
          entry.data.requesters += 1;
        }
        return {
          first,
          responsePromise: entry.dfd.promise,
        };
      },

      async receiveResponse(req: CacheableRequest, response: Response) {
        const entry = ensureEntry(cache.findEntry(req));
        const text = await response.text();
        const cachedResponse: CachedResponse = {
          text,
          status: response.status,
        };
        entry.data.response = cachedResponse;
        entry.dfd.resolve(cachedResponse);
      },

      async receiveBinaryResponse(req: CacheableRequest, response: Response) {
        const entry = ensureEntry(cache.findEntry(req));
        const bytes = await response.bytes();
        const cachedResponse: CachedResponse = {
          text: bytes.toBase64(),
          isBinary: true,
          status: response.status,
        };
        entry.data.response = cachedResponse;
        entry.dfd.resolve(cachedResponse);
      },

      evictRequest(req: CacheableRequest, response: Response) {
        const entry = cache.findEntry(req);
        if (!entry) return;
        entry.evicted = true;
        entry.dfd.reject({
          [EVICTED]: true,
          response,
        });
      },

      receiveError(req: CacheableRequest, error: Error) {
        const entry = ensureEntry(cache.findEntry(req));
        entry.dfd.reject(error);
        entry.data.error = dehydrateError(error);
      },

      dehydrate(): DehydratedCache {
        const dehydrated: DehydratedCache = {};
        cache.buckets.forEach((entries, urlKey) => {
          const dehydratedEntries = entries
            .filter((entry) => !entry.evicted)
            .map((entry) => ({
              aux: entry.aux,
              data: entry.data,
            }));
          if (dehydratedEntries.length) dehydrated[urlKey] = dehydratedEntries;
        });
        return dehydrated;
      },

      getPending(): Array<PendingEntry> {
        const pending: Array<PendingEntry> = [];
        cache.buckets.forEach((entries, urlKey) => {
          entries.forEach((entry) => {
            if (entry.evicted) return;
            const { response, error } = entry.data;
            if (response || error) return;
            const { query: queryParams } = entry.aux;
            const queryString = queryParams ? `?${queryParams}` : '';
            pending.push({
              request: {
                url: urlKey + queryString,
                method: entry.aux.method,
                body: entry.aux.body,
              },
              dataPromise: entry.dfd.promise
                .then(
                  () => entry.data,
                  () => entry.data
                ),
            });
          });
        });
        return pending;
      }
    }
  }

  client() {
    const cache = this;
    return {
      rehydrate(dehydrated: DehydratedCache) {
        Object.entries(dehydrated).forEach(([urlKey, dehydratedEntries]) => {
          const rehydratedEntries: CacheEntry[] = dehydratedEntries.map((dehydratedEntry) => {
            const dfd = Promise.withResolvers<CachedResponse>();
            const { response, error } = dehydratedEntry.data;
            if (response) {
              dfd.resolve(response);
            } else if (error) {
              dfd.reject(rehydrateError(error));
            }
            return {
              aux: dehydratedEntry.aux,
              data: dehydratedEntry.data,
              dfd,
            };
          });
          cache.buckets.set(urlKey, rehydratedEntries);
        });
      },

      receiveRequest(req: CacheableRequest): Promise<CachedResponse> | null {
        return cache.findEntry(req)?.dfd.promise ?? null;
      },

      receiveLateArrivalData(req: CacheableRequest, data: CacheEntryData) {
        const entry = ensureEntry(cache.findEntry(req));
        entry.data = data;
        if (data.response) {
          entry.dfd.resolve(data.response);
        } else {
          entry.dfd.reject(rehydrateError(data.error!));
        }
      },

      consumeResponse(req: CacheableRequest) {
        const entry = cache.findEntry(req);
        if (!entry) return;
        entry.data.requesters -= 1;
        if (entry.data.requesters <= 0) {
          entry.evicted = true;
        }
      }
    }
  }
}

function ensureEntry(entry: CacheEntry | null): CacheEntry {
  if (!entry) throw new Error("cache entry not found!");
  return entry;
}

function dehydrateError(error: Error): SerializedError {
  // Error objects aren't serializable
  return {
    message: error.message,
  };
}

function rehydrateError(error: SerializedError): Error {
  return new Error(error.message);
}

type ParsedURL = {
  urlKey: string;
  searchParams: URLSearchParams;
};
function parseUrlString(url: string): ParsedURL {
  const [urlKey, queryString] = url.split('?', 2);
  const searchParams = new URLSearchParams(queryString);
  return {
    urlKey: urlKey!,
    searchParams,
  };
}

function normalizeQueryParams(params: URLSearchParams): string {
  const _params = new URLSearchParams(params);
  _params.sort();
  return _params.toString();
}

export function reifyCachedResponse(promise: Promise<CachedResponse>): Promise<Response> {
  return promise.then(readCachedResponse, extractEvictedResponse);
}

function readCachedResponse(cachedResponse: CachedResponse): Response {
  const body = cachedResponse.isBinary ? Uint8Array.fromBase64(cachedResponse.text) : cachedResponse.text;
  return new Response(body, {
    status: cachedResponse.status,
  });
}

function extractEvictedResponse(thrown: any): Response {
  if (EVICTED in thrown) {
    // response bodies can only be consumed once. have to clone
    // in case there are multiple requesters
    return (thrown as ThrownEviction).response.clone();
  }
  throw thrown;
}
