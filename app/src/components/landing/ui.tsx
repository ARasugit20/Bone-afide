"use client";

import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";

export function cn(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

const BASE =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium cursor-pointer transition-colors";

const VARIANT = {
  brand: "bg-forest text-on-dark font-bold shadow-glow duration-200 ease-ui hover:bg-forest-dark active:translate-y-px",
  outlineDark: "border border-on-dark/20 text-on-dark font-bold duration-200 ease-ui hover:border-on-dark/60 hover:bg-on-dark/10",
  outlineInk: "border border-line bg-surface text-ink font-bold duration-200 ease-ui hover:border-forest hover:text-forest",
} as const;

const SIZE = {
  pill: "h-12 rounded-full px-6 text-body",
  pillSm: "h-10 rounded-full px-5 text-body",
} as const;

type ButtonProps = {
  children: ReactNode;
  className?: string;
  variant?: keyof typeof VARIANT;
  size?: keyof typeof SIZE;
  /** Render the single child element instead of a <button>, merging classes onto it. */
  asChild?: boolean;
};

export function Button({ children, className, variant = "brand", size = "pill", asChild }: ButtonProps) {
  const classes = cn(BASE, VARIANT[variant], SIZE[size], className);
  if (asChild) {
    const child = Children.only(children);
    if (isValidElement<{ className?: string }>(child)) {
      return cloneElement(child as ReactElement<{ className?: string }>, {
        className: cn(classes, child.props.className),
      });
    }
  }
  return <button className={classes}>{children}</button>;
}
