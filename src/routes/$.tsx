import { createFileRoute, Link } from "@tanstack/react-router";

import { PageHeader, Panel } from "@/components/primitives";

export const Route = createFileRoute("/$")({
  head: () => ({
    meta: [
      { title: "Page not found — AccessLens" },
      { name: "description", content: "That address does not exist in AccessLens." },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Page not found — AccessLens" },
      { property: "og:description", content: "That address does not exist in AccessLens." },
    ],
  }),
  component: NotFound,
});

const LINKS: { to: string; label: string; description: string }[] = [
  { to: "/dashboard", label: "Dashboard", description: "Totals, average score and the score trend" },
  { to: "/audit", label: "New audit", description: "Paste HTML, upload a file or load a sample page" },
  { to: "/history", label: "History", description: "Every stored audit" },
  { to: "/ml-lab", label: "ML Lab", description: "Train the models and inspect their metrics" },
  { to: "/datasets", label: "Datasets", description: "Browse the labelled training data" },
  { to: "/reports", label: "Reports", description: "Printable findings reports" },
  { to: "/methodology", label: "Methodology", description: "Rules, formula, architectures and limits" },
  { to: "/tests", label: "Tests", description: "Run the built-in test suites" },
];

function NotFound() {
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="404"
        title="That page does not exist"
        description="The address you opened is not part of this application. Everything it can do is listed below."
      />
      <Panel label="Go to">
        <ul className="grid gap-4 sm:grid-cols-2">
          {LINKS.map((link) => (
            <li key={link.to}>
              <Link to={link.to} className="block rounded-sm border border-border p-4 hover:bg-muted">
                <span className="block text-base">{link.label}</span>
                <span className="mt-1 block text-sm text-muted-foreground">{link.description}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
