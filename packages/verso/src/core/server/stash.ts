import {getRLS} from "../common/RequestLocalStorage";

const RLS = getRLS<{
  stash: {
    request: Request;
  };
}>();

export function getStash() {
  return RLS().stash;
}
