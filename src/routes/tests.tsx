import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { Breadcrumbs, PageHeader, Panel, Stat } from "@/components/primitives";
import { runAllSuites, type SuiteResult } from "@/lib/selftest";

export const Route = createFileRoute("/tests")({
  head: () => ({
    meta: [
      { title: "Tests — AccessLens" },
      { name: "description", content: "Run the built-in test suites for colour maths, rule detection, scoring, remediation and feature extraction." },
      { property: "og:title", content: "Tests — AccessLens" },
      { property: "og:description", content: "Real assertions executed against the real engine, with expected and actual values shown." },
    ],
  }),
  component: Tests,
});

function Tests() {
  const [suites, setSuites] = useState<SuiteResult[] | null>(null);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  const runTests = () => {
    setRunning(true);
    // Let the button's disabled state paint before the synchronous run.
    setTimeout(() => {
      const started = performance.now();
      const result = runAllSuites();
      setElapsed(Number((performance.now() - started).toFixed(1)));
      setSuites(result);
      setRunning(false);
    }, 20);
  };

  const all = suites?.flatMap((suite) => suite.results) ?? [];
  const passed = all.filter((test) => test.passed).length;

  return (
    <div className="space-y-8">
      <Breadcrumbs trail={[{ label: "Home", to: "/" }, { label: "Tests" }]} />
      <PageHeader
        eyebrow="Section 10"
        title="Built-in tests"
        description="These suites run the production engine, not a copy of it. Every expected value comes from the WCAG specification or from a property that must hold."
        actions={
          <button
            type="button"
            onClick={runTests}
            disabled={running}
            className="rounded-sm bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
          >
            {running ? "Running…" : "Run all tests"}
          </button>
        }
      />

      {suites ? (
        <div className="grid gap-5 sm:grid-cols-4">
          <div className="panel p-5">
            <Stat label="Assertions" value={all.length} />
          </div>
          <div className="panel p-5">
            <Stat label="Passed" value={passed} />
          </div>
          <div className="panel p-5">
            <Stat label="Failed" value={all.length - passed} />
          </div>
          <div className="panel p-5">
            <Stat label="Total time" value={`${elapsed} ms`} />
          </div>
        </div>
      ) : (
        <Panel>
          <p className="text-sm text-muted-foreground">
            Press "Run all tests". Nothing is pre-computed — the results below appear only after the
            suites actually execute in this browser.
          </p>
        </Panel>
      )}

      {suites?.map((suite) => {
        const suitePassed = suite.results.filter((test) => test.passed).length;
        return (
          <Panel
            key={suite.suite}
            label={`${suitePassed}/${suite.results.length} passed`}
            title={suite.suite}
          >
            <p className="text-sm text-muted-foreground">{suite.description}</p>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="rule-line border-b text-left">
                    <th scope="col" className="py-2 pr-3">result</th>
                    <th scope="col" className="py-2 pr-3">assertion</th>
                    <th scope="col" className="py-2 pr-3">expected</th>
                    <th scope="col" className="py-2 pr-3">actual</th>
                    <th scope="col" className="py-2">ms</th>
                  </tr>
                </thead>
                <tbody>
                  {suite.results.map((test) => (
                    <tr key={test.name} className="border-b border-border align-top">
                      <td className="py-2 pr-3">
                        <span
                          className="metric rounded-sm px-2 py-0.5 text-[0.6875rem] uppercase tracking-wider"
                          style={{
                            background: test.passed ? "var(--pass)" : "var(--critical)",
                            color: test.passed ? "var(--pass-foreground)" : "var(--critical-foreground)",
                          }}
                        >
                          {test.passed ? "pass" : "fail"}
                        </span>
                      </td>
                      <td className="py-2 pr-3">{test.name}</td>
                      <td className="metric max-w-[16rem] break-words py-2 pr-3 text-xs text-muted-foreground">
                        {test.expected}
                      </td>
                      <td className="metric max-w-[16rem] break-words py-2 pr-3 text-xs">{test.actual}</td>
                      <td className="metric py-2 text-xs text-muted-foreground">{test.durationMs}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        );
      })}
    </div>
  );
}
