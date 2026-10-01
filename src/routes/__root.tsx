import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";

import appCss from "../styles.css?url";
import { AppProvider } from "@/lib/app-context";
import { reportAppError } from "../lib/error-reporting";

const NAV = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/audit", label: "New audit" },
  { to: "/history", label: "History" },
  { to: "/ml-lab", label: "ML Lab" },
  { to: "/datasets", label: "Datasets" },
  { to: "/reports", label: "Reports" },
  { to: "/methodology", label: "Methodology" },
  { to: "/tests", label: "Tests" },
  { to: "/settings", label: "Settings" },
] as const;

function NotFoundComponent() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-24">
      <p className="label-caps">Error 404</p>
      <h1 className="mt-2 text-4xl">That page does not exist</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        The address you followed is not part of AccessLens. Everything starts from the dashboard or a
        new audit.
      </p>
      <div className="mt-6 flex gap-3">
        <Link
          to="/"
          className="inline-flex items-center rounded-sm bg-primary px-4 py-2 text-sm text-primary-foreground"
        >
          Go home
        </Link>
        <Link to="/audit" className="inline-flex items-center rounded-sm border border-border px-4 py-2 text-sm">
          Start an audit
        </Link>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportAppError(error, { boundary: "root_error_component" });
  }, [error]);

  return (
    <div className="mx-auto max-w-2xl px-4 py-24">
      <p className="label-caps">Unexpected failure</p>
      <h1 className="mt-2 text-3xl">This page did not load</h1>
      <p className="mt-3 text-sm text-muted-foreground">{error.message}</p>
      <div className="mt-6 flex gap-3">
        <button
          onClick={() => {
            router.invalidate();
            reset();
          }}
          className="rounded-sm bg-primary px-4 py-2 text-sm text-primary-foreground"
        >
          Try again
        </button>
        <a href="/" className="rounded-sm border border-border px-4 py-2 text-sm">
          Go home
        </a>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "AccessLens — ML accessibility auditor" },
      {
        name: "description",
        content:
          "AccessLens audits a web page against WCAG 2.1 rules, ranks findings with browser-trained models and generates concrete fixes.",
      },
      { property: "og:title", content: "AccessLens — ML accessibility auditor" },
      {
        property: "og:description",
        content: "Rule-based WCAG checks, in-browser machine learning and automatic remediation.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap",
      },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="paper">
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

function SiteHeader() {
  return (
    <header className="no-print border-b border-border bg-card">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <Link to="/" className="flex items-baseline gap-2">
          <span className="font-[family-name:var(--font-display)] text-xl">AccessLens</span>
          <span className="label-caps hidden sm:inline">WCAG 2.1 auditor</span>
        </Link>
        <nav aria-label="Main" className="hidden flex-wrap items-center gap-1 lg:flex">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="rounded-sm px-2 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
              activeProps={{ className: "rounded-sm px-2 py-1 text-sm text-foreground bg-muted font-medium" }}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <details className="lg:hidden">
          <summary className="cursor-pointer rounded-sm border border-border px-3 py-1.5 text-sm">Menu</summary>
          <nav aria-label="Main" className="panel absolute right-4 z-50 mt-2 flex w-56 flex-col p-2 shadow-[var(--shadow-modal)]">
            {NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="rounded-sm px-2 py-2 text-sm hover:bg-muted"
                activeProps={{ className: "rounded-sm px-2 py-2 text-sm bg-muted font-medium" }}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </details>
      </div>
    </header>
  );
}

function SiteFooter() {
  return (
    <footer className="no-print mt-16 border-t border-border bg-card">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-6 text-sm text-muted-foreground">
        <p>
          AccessLens — rule-based WCAG 2.1 checks with browser-trained models. Final-year project
          build.
        </p>
        <nav aria-label="Footer" className="flex flex-wrap gap-3">
          <Link to="/methodology" className="underline underline-offset-2 hover:text-foreground">
            Methodology
          </Link>
          <Link to="/tests" className="underline underline-offset-2 hover:text-foreground">
            Tests
          </Link>
          <Link to="/datasets" className="underline underline-offset-2 hover:text-foreground">
            Datasets
          </Link>
          <Link to="/settings" className="underline underline-offset-2 hover:text-foreground">
            Settings
          </Link>
        </nav>
      </div>
    </footer>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <AppProvider>
        <a
          href="#main"
          className="no-print sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-sm focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
        >
          Skip to main content
        </a>
        <div className="flex min-h-screen flex-col">
          <SiteHeader />
          <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
            {/* Required: nested routes render here. */}
            <Outlet />
          </main>
          <SiteFooter />
        </div>
        <Toaster position="bottom-right" />
      </AppProvider>
    </QueryClientProvider>
  );
}
