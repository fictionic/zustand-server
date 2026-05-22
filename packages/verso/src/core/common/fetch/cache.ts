import {marshallBody, unmarshallBody, type MarshalledBody} from "../util/body";

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
  error: MarshalledError | null;
  requesters: number;
};

export type CachedResponse = {
  body: MarshalledBody | null;
  status: number;
  // we don't include response headers in the cache because (1) they're big,
  // (2) it would be a security vulnerability, and (3) probably no one needs them.
};

type MarshalledError = {
  name: string;
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
        const cachedResponse: CachedResponse = {
          body: await marshallBody(response),
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
        entry.data.error = marshallError(error);
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
              dfd.reject(unmarshallError(error));
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
          entry.dfd.reject(unmarshallError(data.error!));
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

function marshallError(error: Error): MarshalledError {
  return {
    name: error.name,
    message: error.message,
  };
}

function unmarshallError(error: MarshalledError): ReconstructedFetchError {
  return new ReconstructedFetchError(error);
}

class ReconstructedFetchError extends Error {
  constructor(error: MarshalledError) {
    super(error.message);
    this.name = error.name;
  }
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

function normalizeQueryParams(_params: URLSearchParams): string {
  const params = new URLSearchParams(_params);
  params.sort();
  return params.toString();
}

export function reifyCachedResponse(promise: Promise<CachedResponse>): Promise<Response> {
  return promise.then(readCachedResponse, extractEvictedResponse);
}

function readCachedResponse(cachedResponse: CachedResponse): Response {
  const body = unmarshallBody(cachedResponse.body);
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
