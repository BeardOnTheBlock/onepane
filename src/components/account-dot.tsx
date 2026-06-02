import { cn } from "@/lib/utils";

const SIZE_CLASSES = {
  sm: "h-2 w-2",
  md: "h-2.5 w-2.5",
  lg: "h-3 w-3",
} as const;

export interface AccountDotProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Hex (or any CSS) colour for the account. */
  color: string;
  size?: keyof typeof SIZE_CLASSES;
}

/**
 * A small round colour swatch identifying an account. Decorative by default
 * (aria-hidden); pass aria-label to make it meaningful on its own.
 */
export function AccountDot({
  color,
  size = "md",
  className,
  style,
  ...props
}: AccountDotProps) {
  return (
    <span
      aria-hidden={props["aria-label"] ? undefined : true}
      className={cn(
        "inline-block shrink-0 rounded-full ring-1 ring-black/5",
        SIZE_CLASSES[size],
        className,
      )}
      style={{ backgroundColor: color, ...style }}
      {...props}
    />
  );
}
