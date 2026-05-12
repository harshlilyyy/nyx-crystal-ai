import { Link, useLocation } from "@tanstack/react-router";
import { Home, Sparkles, Users, Activity, FileText, GitBranch } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { getCurrent } from "@/lib/nyx-store";

const baseTabs = [
  { to: "/", label: "Home", icon: Home },
  { to: "/setup", label: "Setup", icon: Sparkles },
  { to: "/agents", label: "Agents", icon: Users },
  { to: "/simulation", label: "Run", icon: Activity },
  { to: "/report", label: "Report", icon: FileText },
] as const;

const outcomesTab = { to: "/outcomes", label: "Outcomes", icon: GitBranch } as const;

export function TabBar() {
  const { pathname } = useLocation();
  const [showOutcomes, setShowOutcomes] = useState(false);

  useEffect(() => {
    const check = () => {
      const s = getCurrent();
      setShowOutcomes(!!(s && s.advanced && s.status === "done"));
    };
    check();
    const onStorage = () => check();
    window.addEventListener("storage", onStorage);
    const id = window.setInterval(check, 1500);
    return () => { window.removeEventListener("storage", onStorage); window.clearInterval(id); };
  }, [pathname]);

  const tabs = showOutcomes ? [...baseTabs, outcomesTab] : baseTabs;

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50"
      style={{ background: "#1E1E1E", boxShadow: "var(--shadow-floating)" }}
    >
      <div
        className="mx-auto flex max-w-md items-center justify-between px-3 pt-2"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.5rem)" }}
      >
        {tabs.map((t) => {
          const active = pathname === t.to;
          const Icon = t.icon;
          return (
            <Link
              key={t.to}
              to={t.to}
              className={cn(
                "flex flex-1 flex-col items-center gap-1 px-2 py-2 transition-opacity",
                active ? "opacity-100" : "opacity-60 hover:opacity-90"
              )}
              style={{ color: "#FDFBF7" }}
            >
              <Icon className="h-[18px] w-[18px]" strokeWidth={1.6} />
              <span
                className="text-[10px] tracking-[0.14em] uppercase"
                style={{ fontFamily: "Inter, sans-serif", fontWeight: active ? 600 : 400 }}
              >
                {t.label}
              </span>
              {active && (
                <span
                  className="mt-0.5 h-px w-4"
                  style={{ background: "#C8A97E" }}
                />
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
