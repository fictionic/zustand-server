import {type ComponentPropsWithRef, type MouseEventHandler} from "react";
import type {NavigateOptions} from "../../core/client/controller";
import {navigateTo} from "../util/navigateTo";

export type LinkProps = ComponentPropsWithRef<'a'> & {
  href: string; // required
} & Partial<NavigateOptions>;

export function Link({
  href,
  target,
  onClick,
  reuseDom,
  children,
  ...rest
}: LinkProps) {
  const handleClick: MouseEventHandler<HTMLAnchorElement> = (e) => {
    if (e.defaultPrevented) return;
    if (e.button !== 0) return; // not a left click
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (target && target !== '_self') return;
    e.preventDefault();
    navigateTo(href, { reuseDom })
      .catch((err) => {
        console.error("[verso] navigation failed", err);
      });
    onClick?.(e);
  };
  return (
    <a
      href={href}
      onClick={handleClick}
      {...rest}
    >
      {children}
    </a>
  );
}
