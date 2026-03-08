import type {ReactNode} from "react";

interface Props {
  when?: () => Promise<void>;
  listen?: (listener: () => void) => void;
  children: ReactNode;
}
export default function RootElement({
  when,
  listen,
  children,
}: Props) {
  return children;
}
