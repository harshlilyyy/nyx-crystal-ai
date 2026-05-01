import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PageShell({
  title,
  subtitle,
  children,
  className,
  right,
}: {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
  right?: ReactNode;
}) {
  return (
    <div className="mx-auto min-h-screen max-w-md px-5 pb-32 pt-12">
      {(title || subtitle) && (
        <header className="mb-6 flex items-end justify-between gap-3 border-b border-border pb-4">
          <div>
            {title && (
              <h1 className="font-display text-4xl font-semibold tracking-tight text-balance">
                {title}
              </h1>
            )}
            {subtitle && (
              <p
                className="mt-1.5 text-[11px] uppercase tracking-[0.18em] text-muted-foreground"
                style={{ fontFamily: "Inter, sans-serif" }}
              >
                {subtitle}
              </p>
            )}
          </div>
          {right}
        </header>
      )}
      <div className={cn("space-y-4 animate-float-up", className)}>{children}</div>
      <footer
        className="mt-16 border-t border-border pt-6 text-center font-display italic text-sm"
        style={{ color: "#C8A97E" }}
      >
        harshhhhh1dubeyyyyy · Nyx
      </footer>
    </div>
  );
}
