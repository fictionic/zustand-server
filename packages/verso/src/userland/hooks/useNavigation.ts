import {useEffect, useRef, useSyncExternalStore, type EffectCallback} from "react";
import {getClientController} from "../../core/client/controller";
import type {NavigationState} from "../../core/client/navigation";
import {getServerStash} from "../../core/server/stash";

/**
 * Runs an effect callback in sync with the lifecycle of a Verso page,
 * including through client navigations that reuse React roots.
 */
export function useNavigationEffect(effect: EffectCallback): void {
  const routeName = useRouteName();
  useEffect(effect, [routeName]);
}

/**
 * Returns the current routeName. Persists the outgoing routeName during navigation.
 */
export function useRouteName(): string {
  const state = useNavigation();
  const routeName = state.status === 'idle' ? state.routeName : null;
  const routeNameRef = useRef(routeName);
  routeNameRef.current = routeName ?? routeNameRef.current;
  return routeNameRef.current!; // by the time react is running, there will be a route
}

/**
 * Returns the state of the navigator.
 */
export function useNavigation(): NavigationState {
  const controller = getClientController();
  return useSyncExternalStore(
    // lambdas for autobinding
    (listener) => controller.subscribeToNavigation(listener),
    () => controller.getNavigationState(),
    globalThis.IS_SERVER ?
      () => getServerNavigationState() :
      () => controller.getNavigationState(),
  );
}

function getServerNavigationState(): NavigationState {
  return {
    status: 'idle',
    routeName: getServerStash().routeName,
    location: getServerStash().request.url,
  };
}
