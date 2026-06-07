import type {ClientManifest} from "@verso-js/contract";
import {getRLS} from "../common/RequestLocalStorage";

const RLS = getRLS<{
  request: Request;
  routeName: string;
  manifest: ClientManifest | null;
  headersLocked: boolean;
}>();

export function getServerStash() {
  return RLS();
}
