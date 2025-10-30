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
          "rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_25px_70px_-35px_rgba(15,23,42,0.35)]",
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
      className={cn("text-lg font-semibold tracking-tight text-slate-900", className)}
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
    className={cn("text-sm text-slate-500", className)}
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
  "inline-flex items-center justify-center rounded-full text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-50";

const BUTTON_VARIANTS: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary:
    "bg-sky-600 text-white shadow-[0_15px_35px_-20px_rgba(2,132,199,0.8)] hover:bg-sky-500",
  secondary:
    "bg-slate-100 text-slate-700 shadow-[0_10px_30px_-22px_rgba(15,23,42,0.4)] hover:bg-slate-200",
  outline:
    "border border-slate-300 bg-white text-slate-700 hover:border-sky-300 hover:text-sky-600",
  ghost: "text-slate-500 hover:text-slate-900 hover:bg-slate-100/70",
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
        "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-[inset_0_1px_2px_rgba(15,23,42,0.05)] placeholder:text-slate-400 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-200 disabled:cursor-not-allowed disabled:opacity-60",
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
        "w-full rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700 shadow-[inset_0_1px_2px_rgba(15,23,42,0.05)] placeholder:text-slate-400 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-200 disabled:cursor-not-allowed disabled:opacity-60",
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
      <div className="h-full w-full overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-slate-300 scrollbar-track-transparent">
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
        ? "bg-slate-100 text-slate-500"
        : "bg-sky-100 text-sky-600"
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
    className={cn("text-sm leading-relaxed text-slate-500", className)}
    {...props}
  />
));
Muted.displayName = "Muted";
