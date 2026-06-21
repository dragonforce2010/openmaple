#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const videoDir = join(repoRoot, "assets/videos");
const frameDir = join(repoRoot, ".tmp-local-docker-tour-frames");
mkdirSync(videoDir, { recursive: true });
mkdirSync(frameDir, { recursive: true });

const slides = [
  [
    "assets/screenshots/openmaple-local-setup-terminal.png",
    "Run one setup command. Web API MySQL runtime and sandbox start together.",
    "The script prints local login and health URLs."
  ],
  [
    "assets/screenshots/openmaple-local-onboarding-tenant.png",
    "Local dev login opens tenant setup in the browser.",
    "The form is filled from the running local Docker stack."
  ],
  [
    "assets/screenshots/openmaple-local-onboarding-workspace.png",
    "Create the workspace and slug without cloud credentials.",
    "The console validates the local route before continuing."
  ],
  [
    "assets/screenshots/openmaple-local-onboarding-runtime.png",
    "Runtime provider defaults to Local Docker.",
    "Docker Compose mounts the local daemon and starts runtime containers."
  ],
  [
    "assets/screenshots/openmaple-local-onboarding-sandbox.png",
    "Sandbox provider defaults to Local Docker.",
    "Tool execution uses local container sandboxes with a small standby pool."
  ],
  [
    "assets/screenshots/openmaple-local-onboarding-models.png",
    "Model pool can start empty.",
    "Add model keys only when running real model backed loops."
  ],
  [
    "assets/screenshots/openmaple-local-runtime-pool-drawer.png",
    "Runtime pool members are visible in workspace settings.",
    "Prewarmed local Docker members show active session counts."
  ],
  [
    "assets/screenshots/openmaple-local-sandbox-pool-drawer.png",
    "Sandbox pool members are visible too.",
    "Standby local Docker sandboxes show image status and claim fields."
  ],
  [
    "assets/screenshots/openmaple-local-session-dashboard.png",
    "Sessions show transcript events and local Docker metadata.",
    "The same local stack exposes UI API SDK and CLI paths."
  ]
];

const browser = await launchBrowser();

try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  for (let index = 0; index < slides.length; index += 1) {
    const [image, title, subtitle] = slides[index];
    const imageUrl = `data:image/png;base64,${readFileSync(join(repoRoot, image)).toString("base64")}`;
    await page.setContent(`<!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <style>
            * { box-sizing: border-box; }
            body {
              width: 1920px;
              height: 1080px;
              margin: 0;
              overflow: hidden;
              background: #f4efe6;
              font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            }
            .stage {
              width: 1920px;
              height: 900px;
              display: grid;
              place-items: center;
              padding: 34px 62px 28px;
            }
            img {
              max-width: 100%;
              max-height: 100%;
              object-fit: contain;
              border: 1px solid #c7bdad;
              border-radius: 10px;
              box-shadow: 0 28px 80px rgba(28, 29, 25, .18);
              background: #fffaf1;
            }
            .caption {
              width: 1920px;
              height: 180px;
              display: grid;
              align-content: center;
              gap: 12px;
              padding: 0 84px;
              color: #fffaf1;
              background: #1c1d19;
            }
            h1 { margin: 0; font-size: 44px; line-height: 1.1; letter-spacing: 0; }
            p { margin: 0; color: #c9c2b7; font-size: 28px; line-height: 1.28; }
          </style>
        </head>
        <body>
          <div class="stage"><img src="${imageUrl}" alt="" /></div>
          <div class="caption"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(subtitle)}</p></div>
        </body>
      </html>`);
    await page.waitForFunction(() => {
      const image = document.querySelector("img");
      return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0;
    });
    await page.screenshot({ path: join(frameDir, `frame-${String(index).padStart(2, "0")}.png`), fullPage: false, animations: "disabled" });
  }
} finally {
  await browser.close();
}

const args = ["-y"];
for (let index = 0; index < slides.length; index += 1) {
  args.push("-loop", "1", "-t", "4", "-i", join(frameDir, `frame-${String(index).padStart(2, "0")}.png`));
}

const filters = slides.map((_, index) => `[${index}:v]scale=1920:1080,setsar=1[v${index}]`);
filters.push(`${slides.map((_, index) => `[v${index}]`).join("")}concat=n=${slides.length}:v=1:a=0,format=yuv420p[v]`);

args.push(
  "-filter_complex",
  filters.join(";"),
  "-map",
  "[v]",
  "-r",
  "30",
  "-movflags",
  "+faststart",
  join(videoDir, "openmaple-local-docker-tour.mp4")
);

const result = spawnSync("ffmpeg", args, { cwd: repoRoot, encoding: "utf8" });
if (result.status !== 0) {
  process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}

process.stdout.write("wrote assets/videos/openmaple-local-docker-tour.mp4\n");

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function launchBrowser() {
  const args = ["--no-sandbox", "--disable-gpu"];
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  if (executablePath) return chromium.launch({ executablePath, headless: true, args });
  try {
    return await chromium.launch({ headless: true, args });
  } catch {
    return chromium.launch({ channel: "chrome", headless: true, args });
  }
}
