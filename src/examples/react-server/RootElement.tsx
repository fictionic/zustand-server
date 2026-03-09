import type {ReactNode} from "react";

// dummy implementation of RootElement from react-server
interface Props {
  when?: Promise<void>;
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
