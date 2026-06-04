// Real-World Data Injection — client-side helpers
// Extracts text from PDFs/.txt and calls the AI Gateway "enrich" task.
// Session-only: nothing is persisted server-side; results live on the Simulation object.

import { supabase } from "@/integrations/supabase/client";
import type { RealWorldContext, RealWorldEntity } from "./nyx-types";

export class EnrichAuthError extends Error {
  constructor() {
    super("Sign in to use real-world enrichment.");
    this.name = "EnrichAuthError";
  }
}

async function extractPdfText(file: File): Promise<string> {
  // Dynamic import keeps pdfjs out of the initial bundle.
  const pdfjs = await import("pdfjs-dist");
  // Use a CDN-hosted worker matching the installed version.
  const version = (pdfjs as unknown as { version?: string }).version ?? "6.0.227";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (pdfjs as any).GlobalWorkerOptions.workerSrc =
    `https://cdn.jsdelivr.net/npm/pdfjs-dist@${version}/build/pdf.worker.min.mjs`;

  const buf = await file.arrayBuffer();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const doc = await (pdfjs as any).getDocument({ data: buf }).promise;
  const maxPages = Math.min(doc.numPages, 25);
  let out = "";
  for (let i = 1; i <= maxPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((it: any) => (typeof it.str === "string" ? it.str : ""))
      .join(" ");
    out += text + "\n";
    if (out.length > 40000) break;
  }
  return out;
}

export async function extractFileText(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf") || file.type === "application/pdf") {
    return extractPdfText(file);
  }
  // Treat everything else as plain text.
  return file.text();
}

export async function enrichWithRealWorld(input: {
  files: File[];
  pastedText: string;
  sourceLabels?: string[];
}): Promise<RealWorldContext> {
  const sources: string[] = [];
  const chunks: string[] = [];

  for (const f of input.files) {
    try {
      const text = await extractFileText(f);
      if (text.trim()) {
        chunks.push(`# ${f.name}\n${text}`);
        sources.push(f.name);
      }
    } catch (e) {
      // Skip files we couldn't parse but keep going.
      console.warn("Failed to extract", f.name, e);
    }
  }

  const pasted = (input.pastedText ?? "").trim();
  if (pasted) {
    chunks.push(`# Pasted text\n${pasted}`);
    sources.push("Pasted text");
  }

  const merged = chunks.join("\n\n---\n\n").slice(0, 16000);
  if (!merged.trim()) {
    throw new Error("No text could be extracted. Upload a PDF/TXT file or paste some text.");
  }

  const { data, error } = await supabase.functions.invoke("nyx-ai", {
    body: { task: "enrich", text: merged },
  });

  if (error) {
    const msg = String(error.message ?? "");
    if (/401|unauthor/i.test(msg)) throw new EnrichAuthError();
    throw new Error(msg || "Enrichment failed");
  }

  const entities: RealWorldEntity[] = Array.isArray(data?.entities)
    ? (data.entities as RealWorldEntity[]).slice(0, 12)
    : [];

  return {
    entities,
    claim: typeof data?.claim === "string" ? data.claim : "",
    risk_factor: typeof data?.risk_factor === "string" ? data.risk_factor : "",
    summary: typeof data?.summary === "string" ? data.summary : "",
    sources,
    createdAt: Date.now(),
  };
}
