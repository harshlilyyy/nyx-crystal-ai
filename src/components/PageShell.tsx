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
        <header className="mb-6 flex items-end justify-between gap-3">
          <div>
            {title && <h1 className="font-display text-3xl font-semibold text-balance">{title}</h1>}
            {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
          </div>
          {right}
        </header>
      )}
      <div className={cn("space-y-4 animate-float-up", className)}>{children}</div>
      <footer
        className="mt-12 pt-8 text-center font-display italic text-sm"
        style={{ color: "#D4A5A5" }}
      >
        harshhhhh1dubeyyyyy · Nyx
      </footer>
    </div>
  );
}
