import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { formatMapOutput } from './result-format.js';
import { createReportVisualArtifacts } from './visual-artifacts.js';

const execFileAsync = promisify(execFile);

export interface PdfArtifactResult {
  pdfPath?: string;
  htmlPath: string;
  renderer?: string;
  warning?: string;
}

export async function writeHtmlArtifact(
  result: unknown,
  options: { compact?: boolean; outputDir?: string } = {},
): Promise<{ htmlPath: string }> {
  const outputDir = path.resolve(options.outputDir ?? inferOutputDir(result));
  await fs.mkdir(outputDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const htmlPath = path.join(outputDir, `map-result-${stamp}.html`);
  const artifactManifest = await createReportVisualArtifacts(result, { outputDir });
  const resultWithArtifacts = attachArtifacts(result, artifactManifest);
  const html = makePrintFriendlyHtml(formatMapOutput(resultWithArtifacts, 'pdf', { compact: options.compact }));
  await fs.writeFile(htmlPath, html, 'utf8');
  return { htmlPath };
}

export async function writePdfArtifact(
  result: unknown,
  options: { compact?: boolean; outputDir?: string; renderPdf?: boolean } = {},
): Promise<PdfArtifactResult> {
  const { htmlPath } = await writeHtmlArtifact(result, options);
  const pdfPath = htmlPath.replace(/\.html$/i, '.pdf');

  if (options.renderPdf === false) {
    return {
      htmlPath,
      warning: 'PDF rendering was disabled; wrote print-ready HTML instead.',
    };
  }

  const browser = await findHeadlessBrowser();
  if (!browser) {
    return {
      htmlPath,
      warning: 'No Chrome/Chromium-compatible browser was found; wrote print-ready HTML instead.',
    };
  }

  try {
    await execFileAsync(browser, [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--print-to-pdf-no-header',
      `--print-to-pdf=${pdfPath}`,
      fileUrl(htmlPath),
    ], { timeout: 60_000, maxBuffer: 1024 * 1024 });
    return { pdfPath, htmlPath, renderer: browser };
  } catch (err: unknown) {
    return {
      htmlPath,
      warning: `PDF rendering failed (${err instanceof Error ? err.message : String(err)}); wrote print-ready HTML instead.`,
    };
  }
}

export async function openOutputArtifact(filePath: string): Promise<void> {
  if (process.platform === 'darwin') {
    await execFileAsync('open', [filePath]);
    return;
  }

  if (process.platform === 'win32') {
    await execFileAsync('cmd', ['/c', 'start', '', filePath]);
    return;
  }

  await execFileAsync('xdg-open', [filePath]);
}

function attachArtifacts(result: unknown, manifest: Awaited<ReturnType<typeof createReportVisualArtifacts>>): unknown {
  if (typeof result === 'object' && result !== null && !Array.isArray(result)) {
    return {
      ...result,
      artifacts: manifest.artifacts,
      artifactManifestPath: manifest.manifestPath,
    };
  }
  return { result, artifacts: manifest.artifacts, artifactManifestPath: manifest.manifestPath };
}

function inferOutputDir(result: unknown): string {
  if (typeof result === 'object' && result !== null && !Array.isArray(result)) {
    const maybeOutputDir = (result as Record<string, unknown>)['outputDir'];
    if (typeof maybeOutputDir === 'string' && maybeOutputDir.trim()) {
      return maybeOutputDir;
    }
  }
  return path.join(process.cwd(), 'map-output');
}

function makePrintFriendlyHtml(html: string): string {
  const printCss = `
<style>
@page { size: Letter; margin: 0.55in; }
:root { color-scheme: light; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #172033; background: #fff; }
h1 { font-size: 24px; border-bottom: 2px solid #26364f; padding-bottom: 8px; }
h2 { font-size: 17px; margin-top: 24px; color: #26364f; }
h3 { font-size: 14px; color: #344766; }
table { width: 100%; border-collapse: collapse; margin: 10px 0 18px; page-break-inside: avoid; }
th { background: #edf2f7; }
th, td { border: 1px solid #cbd5e1; padding: 6px 8px; vertical-align: top; font-size: 11px; }
.agent-network, .rendered-markdown { page-break-inside: avoid; }
.agent-flow { gap: 0.35rem; }
.agent-flow-step { gap: 0.35rem; }
.agent-node { min-height: 70px; min-width: 145px; max-width: 180px; }
.flow-arrow-line { width: 20px; }
pre { white-space: pre-wrap; word-break: break-word; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px; font-size: 11px; }
code { background: #f1f5f9; padding: 1px 3px; border-radius: 3px; }
ul { padding-left: 20px; }
li { margin: 3px 0; }
</style>`;

  if (html.includes('</head>')) {
    return html.replace('</head>', `${printCss}\n</head>`);
  }
  return `<!doctype html><html><head><meta charset="utf-8">${printCss}</head><body>${html}</body></html>`;
}

function fileUrl(filePath: string): string {
  return `file://${filePath.split(path.sep).map(encodeURIComponent).join('/')}`;
}

async function findHeadlessBrowser(): Promise<string | null> {
  const candidates = [
    process.env['MAP_PDF_BROWSER'],
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ...(process.platform === 'win32'
      ? [
          path.join(process.env['PROGRAMFILES'] ?? 'C:\\Program Files', 'Google/Chrome/Application/chrome.exe'),
          path.join(process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)', 'Google/Chrome/Application/chrome.exe'),
        ]
      : []),
    'google-chrome',
    'google-chrome-stable',
    'chromium',
    'chromium-browser',
    'microsoft-edge',
  ].filter((candidate): candidate is string => Boolean(candidate && candidate.trim()));

  for (const candidate of candidates) {
    if (candidate.includes(path.sep)) {
      try {
        await fs.access(candidate);
        return candidate;
      } catch {
        continue;
      }
    }
    try {
      const command = process.platform === 'win32' ? 'where' : 'which';
      const { stdout } = await execFileAsync(command, [candidate], { timeout: 3_000 });
      const resolved = stdout.trim().split(/\r?\n/)[0];
      if (resolved) return resolved;
    } catch {
      continue;
    }
  }

  // On macOS, `open` cannot print to PDF headlessly; keep this explicit.
  void os.platform();
  return null;
}
