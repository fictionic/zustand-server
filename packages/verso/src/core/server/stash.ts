import type {ClientManifest} from "../../build/manifest";
import {getRLS} from "../common/RequestLocalStorage";

const RLS = getRLS<{
  request: Request;
  routeName: string;
  manifest: ClientManifest | null;
}>();

export function getServerStash() {
  return RLS();
}
