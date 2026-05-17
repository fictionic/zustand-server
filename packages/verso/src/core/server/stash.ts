import {getRLS} from "../common/RequestLocalStorage";

const RLS = getRLS<{
  request: Request;
}>();

export function getStash() {
  return RLS();
}
