import {useId as useReactId} from "react";
import {useRootIndex} from "../../core/common/components/Root";

/**
 * Returns an ID that is unique to the callsite within the given Verso page
 * request.
 *
 * This should always be used in favor of React.useId.
 */
export function useId(): string {
  const rootIndex = useRootIndex();
  const reactId = useReactId();
  return `${rootIndex}:${reactId}`;
}
