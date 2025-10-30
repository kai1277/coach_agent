import * as React from "react";

type ClassValue = string | number | false | null | undefined;

export function cn(...values: ClassValue[]): string {
  return values
    .flatMap((value) => {
      if (!value && value !== 0) return [];
      if (typeof value === "string" || typeof value === "number") {
        return [String(value)];
      }
      return [];
    })
    .join(" ")
    .trim();
}

type CardProps = React.ComponentPropsWithoutRef<"div">;

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "rounded-3xl border border-slate-800/60 bg-slate-900/60 p-6 shadow-[0_20px_50px_-20px_rgba(15,23,42,0.7)] backdrop-blur-xl",
          className
        )}
        {...props}
      />
    );
  }
);
Card.displayName = "Card";

type CardHeaderProps = React.ComponentPropsWithoutRef<"div">;
export const CardHeader = React.forwardRef<HTMLDivElement, CardHeaderProps>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("mb-6 flex flex-col gap-1 text-left", className)}
      {...props}
    />
  )
);
CardHeader.displayName = "CardHeader";

type CardTitleProps = React.ComponentPropsWithoutRef<"h2">;
export const CardTitle = React.forwardRef<HTMLHeadingElement, CardTitleProps>(
  ({ className, ...props }, ref) => (
    <h2
      ref={ref}
      className={cn("text-lg font-semibold tracking-tight text-white", className)}
      {...props}
    />
  )
);
CardTitle.displayName = "CardTitle";

type CardDescriptionProps = React.ComponentPropsWithoutRef<"p">;
export const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  CardDescriptionProps
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn("text-sm text-slate-300", className)}
    {...props}
  />
));
CardDescription.displayName = "CardDescription";

type CardContentProps = React.ComponentPropsWithoutRef<"div">;
export const CardContent = React.forwardRef<HTMLDivElement, CardContentProps>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("space-y-6", className)} {...props} />
  )
);
CardContent.displayName = "CardContent";

type CardFooterProps = React.ComponentPropsWithoutRef<"div">;
export const CardFooter = React.forwardRef<HTMLDivElement, CardFooterProps>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("mt-6 flex flex-wrap gap-3", className)} {...props} />
  )
);
CardFooter.displayName = "CardFooter";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "outline" | "ghost" | "destructive";
  size?: "default" | "sm" | "lg" | "icon";
};

const BUTTON_BASE =
  "inline-flex items-center justify-center rounded-full text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 disabled:cursor-not-allowed disabled:opacity-50";

const BUTTON_VARIANTS: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary:
    "bg-emerald-500/90 text-slate-950 shadow-[0_10px_30px_-12px_rgba(16,185,129,0.65)] hover:bg-emerald-400",
  secondary: "bg-slate-800/80 text-slate-100 hover:bg-slate-700/80",
  outline:
    "border border-slate-700/60 bg-transparent text-slate-100 hover:border-emerald-400/50 hover:text-white",
  ghost: "text-slate-300 hover:text-white hover:bg-slate-800/60",
  destructive: "bg-rose-500 text-white hover:bg-rose-500/90",
};

const BUTTON_SIZES: Record<NonNullable<ButtonProps["size"]>, string> = {
  default: "h-11 px-5",
  sm: "h-9 px-4 text-xs",
  lg: "h-12 px-6 text-base",
  icon: "h-10 w-10",
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "default", ...props }, ref) => (
    <button
      ref={ref}
      className={cn(BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size], className)}
      {...props}
    />
  )
);
Button.displayName = "Button";

type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;
export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "w-full rounded-2xl border border-slate-700/60 bg-slate-950/40 px-4 py-3 text-sm text-slate-100 shadow-inner placeholder:text-slate-500 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 disabled:cursor-not-allowed disabled:opacity-60",
        className
      )}
      {...props}
    />
  )
);
Textarea.displayName = "Textarea";

type InputProps = React.InputHTMLAttributes<HTMLInputElement>;
export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "w-full rounded-2xl border border-slate-700/60 bg-slate-950/40 px-4 py-2.5 text-sm text-slate-100 shadow-inner placeholder:text-slate-500 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 disabled:cursor-not-allowed disabled:opacity-60",
        className
      )}
      {...props}
    />
  )
);
Input.displayName = "Input";

type ScrollAreaProps = React.ComponentPropsWithoutRef<"div">;
export const ScrollArea = React.forwardRef<HTMLDivElement, ScrollAreaProps>(
  ({ className, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("relative overflow-hidden", className)}
      {...props}
    >
      <div className="h-full w-full overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-slate-700/70 scrollbar-track-transparent">
        {children}
      </div>
    </div>
  )
);
ScrollArea.displayName = "ScrollArea";

export const SectionLabel: React.FC<{
  children: React.ReactNode;
  subtle?: boolean;
}> = ({
  children,
  subtle = false,
}) => (
  <div
    className={cn(
      "inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium uppercase tracking-widest",
      subtle
        ? "bg-slate-800/60 text-slate-300"
        : "bg-emerald-500/15 text-emerald-300"
    )}
  >
    {children}
  </div>
);

export const Muted = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn("text-sm leading-relaxed text-slate-300/90", className)}
    {...props}
  />
));
Muted.displayName = "Muted";
