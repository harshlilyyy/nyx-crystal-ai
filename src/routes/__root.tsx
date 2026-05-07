import { Outlet, Link, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";

import appCss from "../styles.css?url";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Nyx — Strategic Simulation, Beautifully Simple" },
      { name: "description", content: "Run multi-agent strategic simulations with elegance. Ontology, graph, personas, forecast." },
      { name: "author", content: "Nyx" },
      { property: "og:title", content: "Nyx — Strategic Simulation, Beautifully Simple" },
      { property: "og:description", content: "Run multi-agent strategic simulations with elegance. Ontology, graph, personas, forecast." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:site", content: "@Lovable" },
      { name: "twitter:title", content: "Nyx — Strategic Simulation, Beautifully Simple" },
      { name: "twitter:description", content: "Run multi-agent strategic simulations with elegance. Ontology, graph, personas, forecast." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/39e431a2-671b-49bf-b5ab-d3170d43a42c/id-preview-7923d413--e439c28a-6eb0-44ae-95c6-480346c41af6.lovable.app-1777529935830.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/39e431a2-671b-49bf-b5ab-d3170d43a42c/id-preview-7923d413--e439c28a-6eb0-44ae-95c6-480346c41af6.lovable.app-1777529935830.png" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
    scripts: [
      {
        src: "https://cdn.jsdelivr.net/pyodide/v0.25.0/full/pyodide.js",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

import { TabBar } from "@/components/TabBar";
import { Toaster } from "@/components/ui/sonner";
import { CosmicArena } from "@/components/CosmicArena";

function RootComponent() {
  return (
    <>
      <CosmicArena />
      <div className="relative z-10">
        <Outlet />
      </div>
      <TabBar />
      <Toaster position="top-center" />
    </>
  );
}
