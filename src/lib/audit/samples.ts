/**
 * Bundled sample pages. Each one is a small but realistic page written to
 * contain a different mix of accessibility defects, so a demo can show the
 * auditor reacting to different problem types.
 */

export interface SamplePage {
  id: string;
  name: string;
  summary: string;
  problems: string[];
  html: string;
}

export const SAMPLE_PAGES: SamplePage[] = [
  {
    id: "campus-news",
    name: "Campus news article",
    summary: "A news page with unlabelled images, vague links and a skipped heading level.",
    problems: ["Missing and generic alt text", "Vague link text", "Heading level skipped", "No main landmark"],
    html: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Campus News</title>
  <style>
    body { font-family: Georgia, serif; margin: 0; color: #222; background: #fff; }
    header { background: #0c5c5c; color: #cfe; padding: 16px; }
    .meta { color: #9a9a9a; background: #ffffff; font-size: 14px; }
    .wrap { padding: 24px; max-width: 700px; }
  </style>
</head>
<body>
  <header><nav><a href="/">Home</a> <a href="/news">News</a> <a href="/about">About</a></nav></header>
  <div class="wrap">
    <h1>Engineering block reopens after retrofit</h1>
    <p class="meta">Posted 14 March by the news desk</p>
    <img src="/uploads/IMG_4821.jpg">
    <p>The retrofit added ramps, tactile paving and two accessible lifts.</p>
    <img src="/uploads/lift-interior-photo.jpg" alt="photo">
    <h4>What changed</h4>
    <ul>
      <li>Step-free entry from the north car park</li>
      <li>Hearing loops in both lecture theatres</li>
    </ul>
    <p>Full specification is available. <a href="/docs/retrofit-spec-2024.pdf">click here</a></p>
    <p>For the accessibility office, <a href="/contact">read more</a>.</p>
  </div>
  <footer><p>Campus News</p></footer>
</body>
</html>`,
  },
  {
    id: "signup-form",
    name: "Sign-up form",
    summary: "A form where placeholders stand in for labels and the submit button is icon-only.",
    problems: ["Unlabelled form controls", "Placeholder used as label", "Button with no name", "Positive tabindex"],
    html: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Create your account</title>
  <meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">
  <style>
    body { font-family: system-ui, sans-serif; background: #f6f6f4; color: #333; padding: 32px; }
    input { display: block; margin: 8px 0; padding: 8px; width: 260px; }
    .hint { color: #bbbbbb; background: #f6f6f4; }
    button { background: #0c5c5c; color: #fff; border: 0; padding: 10px 14px; }
  </style>
</head>
<body>
  <h1>Create your account</h1>
  <form>
    <input type="text" placeholder="Full name" tabindex="3">
    <input type="email" name="email_address">
    <input type="password" placeholder="Password" tabindex="1">
    <select name="country"><option>India</option><option>Kenya</option></select>
    <p class="hint">We never share your details.</p>
    <button type="submit"><span aria-hidden="true">&#10148;</span></button>
  </form>
  <div onclick="showTerms()">Read the terms of service</div>
</body>
</html>`,
  },
  {
    id: "pricing-table",
    name: "Pricing table",
    summary: "A data table without headers or caption, plus low-contrast fine print.",
    problems: ["Table without header cells", "Table without caption", "Low colour contrast", "Duplicate ids"],
    html: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Plans and pricing</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #ffffff; color: #1a1a1a; padding: 24px; }
    table { border-collapse: collapse; }
    td { border: 1px solid #ddd; padding: 8px 12px; }
    .fine { color: #c9c9c9; background: #ffffff; font-size: 13px; }
    .muted { color: #a8a8a8; background: #ffffff; }
  </style>
</head>
<body>
  <main>
    <h1>Plans and pricing</h1>
    <table>
      <tr><td>Plan</td><td>Monthly</td><td>Seats</td></tr>
      <tr><td>Starter</td><td>&#8377;499</td><td>3</td></tr>
      <tr><td>Department</td><td>&#8377;1,999</td><td>25</td></tr>
      <tr><td>Campus</td><td>&#8377;7,499</td><td>Unlimited</td></tr>
    </table>
    <p class="fine">Prices exclude tax. Annual billing saves twelve percent.</p>
    <p class="muted">Contact sales for public-sector pricing.</p>
    <div id="cta">Start a trial</div>
    <div id="cta">Talk to sales</div>
  </main>
</body>
</html>`,
  },
  {
    id: "media-dashboard",
    name: "Media dashboard",
    summary: "A dashboard with an uncaptioned video, invalid ARIA and hidden focusable controls.",
    problems: ["Video without captions", "Invalid ARIA role", "aria-hidden on focusable control", "Missing lang", "Duplicate navigation"],
    html: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: system-ui, sans-serif; background: #191917; color: #f3efe6; padding: 20px; }
    .panel { border: 1px solid #444; padding: 16px; margin-bottom: 16px; }
    .dim { color: #5b5a53; background: #191917; }
  </style>
</head>
<body>
  <nav><a href="/">Overview</a> <a href="/streams">Streams</a></nav>
  <nav><a href="/settings">Settings</a> <a href="/logout">Sign out</a></nav>
  <h2>Live streams</h2>
  <div class="panel">
    <video src="/media/lecture-12.mp4" controls></video>
    <p class="dim">Lecture 12 — recorded last Tuesday</p>
  </div>
  <div class="panel">
    <div role="clickable" onclick="restart()">Restart encoder</div>
    <span aria-hidden="true"><button>Export logs</button></span>
    <div role="checkbox">Mute alerts</div>
  </div>
  <table>
    <tr><td>Stream</td><td>Viewers</td></tr>
    <tr><td>Lecture 12</td><td>184</td></tr>
  </table>
</body>
</html>`,
  },
];

export function findSample(id: string): SamplePage | undefined {
  return SAMPLE_PAGES.find((page) => page.id === id);
}
