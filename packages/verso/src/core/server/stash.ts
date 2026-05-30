import {getRLS} from "../common/RequestLocalStorage";

const RLS = getRLS<{
  request: Request;
  routeName: string;
}>();

export function getServerStash() {
  return RLS();
}
