// Small "⚠ Ungrounded" badge with a tooltip showing the measured delta.
import { AlertTriangle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { EvidenceFlag } from "@/lib/nyx-evidence";

export function EvidenceBadge({ flag }: { flag: EvidenceFlag }) {
  if (flag.grounded) return null;
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center gap-1 rounded-full bg-[oklch(0.93_0.06_25)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-primary">
            <AlertTriangle className="h-2.5 w-2.5" /> Ungrounded
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-[240px] text-[10px] leading-snug">
          {flag.reason}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
