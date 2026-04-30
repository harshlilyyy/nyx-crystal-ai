import { Link, useLocation } from "@tanstack/react-router";
import { Home, Sparkles, Users, Activity, FileText } from "lucide-react";
import { cn } from "@/lib/utils";

const tabs = [
  { to: "/", label: "Home", icon: Home },
  { to: "/setup", label: "Setup", icon: Sparkles },
  { to: "/agents", label: "Agents", icon: Users },
  { to: "/simulation", label: "Run", icon: Activity },
  { to: "/report", label: "Report", icon: FileText },
] as const;

export function TabBar() {
  const { pathname } = useLocation();
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 px-3 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-2">
      <div className="glass-strong mx-auto flex max-w-md items-center justify-between rounded-[28px] px-2 py-2">
        {tabs.map((t) => {
          const active = pathname === t.to;
          const Icon = t.icon;
          return (
            <Link
              key={t.to}
              to={t.to}
              className={cn(
                "flex flex-1 flex-col items-center gap-0.5 rounded-2xl px-2 py-1.5 transition-all",
                active ? "text-primary" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <span className={cn(
                "flex h-9 w-9 items-center justify-center rounded-2xl transition-all",
                active && "gradient-rose text-primary-foreground shadow-[var(--shadow-soft)]"
              )}>
                <Icon className="h-[18px] w-[18px]" strokeWidth={2.2} />
              </span>
              <span className="text-[10px] font-medium tracking-wide">{t.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
