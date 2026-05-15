import { createPipe, type PipeSchema } from "./util/ServerClientPipe";
import type { CacheableRequest, CacheEntryData, DehydratedCache } from "./fetch/cache";

export const VERSO_PIPE_NAME = '__versoPipe';

export const REQUEST_METHOD_KEY = 'requestMethod' as const;
export const FETCH_CACHE_KEY = 'fetchCache' as const;

export const FN_HYDRATE_ROOTS_UP_TO = 'hydrateRootsUpTo' as const;
export const FN_SIGNAL_ROOTS_COMPLETE = 'signalRootsComplete' as const;
export const FN_RECEIVE_LATE_DATA_ARRIVAL = 'receiveLateDataArrival' as const;
export const FN_ABORT_HYDRATION = 'abortHydration' as const;

export interface VersoPipeSchema extends PipeSchema {
  data: {
    [REQUEST_METHOD_KEY]: string;
    [FETCH_CACHE_KEY]: DehydratedCache;
  };
  fns: {
    [FN_HYDRATE_ROOTS_UP_TO]: [number];
    [FN_SIGNAL_ROOTS_COMPLETE]: [];
    [FN_RECEIVE_LATE_DATA_ARRIVAL]: [CacheableRequest, CacheEntryData];
    [FN_ABORT_HYDRATION]: [];
  };
}

export const VersoPipe = createPipe<VersoPipeSchema>(VERSO_PIPE_NAME);
