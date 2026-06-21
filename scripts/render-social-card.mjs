import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = resolve(root, "assets/openmaple-social-card.png");
const mascotPath = resolve(root, "assets/openmaple-mascot.svg");
const screenshotPath = resolve(root, "assets/screenshots/openmaple-quickstart.png");

const toDataUrl = async (path, mimeType) => {
  const buffer = await readFile(path);
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
};

const mascotUrl = await toDataUrl(mascotPath, "image/svg+xml");
const screenshotUrl = await toDataUrl(screenshotPath, "image/png");

const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      :root {
        --paper: #f4efe6;
        --panel: #fffdf8;
        --ink: #191a16;
        --muted: #68695f;
        --line: #ddd5c8;
        --line-strong: #c7bdad;
        --leaf: #17684f;
        --maple: #c65a43;
        --blue: #256fbb;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        width: 1200px;
        height: 630px;
        overflow: hidden;
        color: var(--ink);
        background:
          linear-gradient(90deg, rgba(28,29,25,.055) 1px, transparent 1px),
          linear-gradient(180deg, rgba(28,29,25,.045) 1px, transparent 1px),
          var(--paper);
        background-size: 56px 56px, 56px 56px, auto;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        -webkit-font-smoothing: antialiased;
      }
      .card {
        position: relative;
        width: 1200px;
        height: 630px;
        padding: 70px 78px 58px;
      }
      .brand {
        display: flex;
        align-items: center;
        gap: 22px;
        height: 76px;
      }
      .brand-mark {
        width: 66px;
        height: 66px;
        border: 1px solid var(--line-strong);
        border-radius: 16px;
        background: var(--panel);
        display: grid;
        place-items: center;
        box-shadow: 0 10px 22px rgba(65, 50, 32, .10);
      }
      .brand-mark img {
        width: 52px;
        height: 52px;
        display: block;
      }
      h1 {
        margin: 0;
        font-size: 74px;
        line-height: .92;
        letter-spacing: 0;
        font-weight: 920;
      }
      .main {
        display: grid;
        grid-template-columns: 475px 1fr;
        gap: 54px;
        align-items: center;
        margin-top: 26px;
      }
      .headline {
        margin: 0;
        max-width: 440px;
        font-size: 38px;
        line-height: 1.08;
        font-weight: 900;
        letter-spacing: 0;
      }
      .copy {
        margin: 28px 0 0;
        max-width: 450px;
        color: var(--muted);
        font-size: 28px;
        line-height: 1.28;
        font-weight: 500;
      }
      .pills {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-top: 24px;
        max-width: 440px;
      }
      .pill {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        height: 40px;
        padding: 0 14px;
        border: 1px solid var(--line-strong);
        border-radius: 9px;
        background: var(--panel);
        color: var(--ink);
        font-size: 19px;
        line-height: 1;
        font-weight: 850;
        white-space: nowrap;
      }
      .dot {
        width: 8px;
        height: 8px;
        border-radius: 99px;
        background: var(--leaf);
      }
      .pill:nth-child(2) .dot { background: var(--blue); }
      .pill:nth-child(3) .dot { background: var(--maple); }
      .pill:nth-child(4) .dot { background: var(--ink); }
      .shot-wrap {
        position: relative;
        align-self: center;
        margin-top: 12px;
      }
      .shot {
        width: 594px;
        height: 302px;
        padding: 22px;
        border: 2px solid var(--line-strong);
        border-radius: 28px;
        background: var(--panel);
        box-shadow: 0 22px 46px rgba(65, 50, 32, .13);
      }
      .shot img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        object-position: center top;
        border-radius: 14px;
        border: 1px solid var(--line);
        display: block;
      }
      .shot-label {
        position: absolute;
        left: 34px;
        bottom: -29px;
        padding: 0 10px;
        color: var(--muted);
        background: var(--paper);
        font-size: 15px;
        line-height: 22px;
        font-weight: 900;
        letter-spacing: .08em;
      }
      .footer {
        position: absolute;
        left: 78px;
        right: 78px;
        bottom: 26px;
        display: flex;
        align-items: end;
        justify-content: space-between;
        gap: 40px;
      }
      .url {
        color: var(--blue);
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 25px;
        line-height: 1;
        letter-spacing: 0;
      }
      .tagline {
        margin-top: 10px;
        color: var(--muted);
        font-size: 20px;
        line-height: 1;
      }
      .badge {
        color: var(--leaf);
        font-size: 14px;
        line-height: 1;
        font-weight: 920;
        text-transform: uppercase;
        letter-spacing: .09em;
        white-space: nowrap;
      }
    </style>
  </head>
  <body>
    <main class="card">
      <div class="brand">
        <div class="brand-mark"><img src="${mascotUrl}" alt="" /></div>
        <h1>OpenMaple</h1>
      </div>
      <section class="main">
        <div>
          <p class="headline">Self-contained local Docker managed agents</p>
          <p class="copy">One setup script starts separate web, API, MySQL, local Docker runtime pools, and sandbox pools.</p>
          <div class="pills" aria-label="OpenMaple surfaces">
            <span class="pill"><span class="dot"></span>One-command setup</span>
            <span class="pill"><span class="dot"></span>Local Docker</span>
            <span class="pill"><span class="dot"></span>SDK</span>
            <span class="pill"><span class="dot"></span>CLI</span>
          </div>
        </div>
        <div class="shot-wrap">
          <div class="shot"><img src="${screenshotUrl}" alt="" /></div>
          <div class="shot-label">REAL CONSOLE SCREENSHOT</div>
        </div>
      </section>
      <footer class="footer">
        <div>
          <div class="url">github.com/dragonforce2010/openmaple</div>
          <div class="tagline">./scripts/setup-local-docker.sh</div>
        </div>
        <div class="badge">Public-safe capture from the running product</div>
      </footer>
    </main>
  </body>
</html>`;

await mkdir(dirname(outputPath), { recursive: true });
async function launchBrowser() {
  try {
    return await chromium.launch();
  } catch (error) {
    if (error instanceof Error && error.message.includes("Executable doesn't exist")) {
      return chromium.launch({ channel: "chrome" });
    }
    throw error;
  }
}

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: "load" });
await page.screenshot({ path: outputPath, type: "png" });
await browser.close();

console.log(JSON.stringify({ status: "ok", output: outputPath }, null, 2));
