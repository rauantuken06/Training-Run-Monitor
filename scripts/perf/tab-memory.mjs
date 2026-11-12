/**
 * Tab memory for the million-point run (Task 09), measured at the OS level.
 *
 *   npm run build && node scripts/perf/tab-memory.mjs [reps=3]   (Windows only)
 *
 * Chrome's Task Manager cannot be automated, so this reads Windows process counters
 * (Win32_Process) for the tab's renderer process, identified through the Chrome
 * DevTools Protocol (SystemInfo.getProcessInfo: the renderer that appears when the page
 * opens). The renderer hosts the page *and* its Web Worker. Reported per stage:
 * private bytes (commit charge), working set, and the process-lifetime peaks of both
 * (the peak captures the transient moment when the worker and the main thread both hold data).
 * Also the main-thread JS heap (CDP), for comparison. Not identical to Task Manager's
 * "Memory footprint" column, which is not exposed to automation.
 */
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import { chromium } from '@playwright/test';

const reps = Number(process.argv[2] ?? 3);
const PORT = 4321;
const BASE = `http://localhost:${PORT}`;
const MB = (bytes) => Math.round((bytes / 1048576) * 10) / 10;

function processMemory(pid) {
  const ps = `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${pid}"; "$($p.PrivatePageCount),$($p.PeakPageFileUsage),$($p.WorkingSetSize),$($p.PeakWorkingSetSize)"`;
  const [priv, peakPrivKB, ws, peakWsKB] = execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { encoding: 'utf8' }).trim().split(',').map(Number);
  return { privateMB: MB(priv), peakPrivateMB: MB(peakPrivKB * 1024), workingSetMB: MB(ws), peakWorkingSetMB: MB(peakWsKB * 1024) };
}

async function renderers(browserCdp) {
  const { processInfo } = await browserCdp.send('SystemInfo.getProcessInfo');
  return new Map(processInfo.filter((p) => p.type === 'renderer').map((p) => [p.id, p.cpuTime]));
}

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
try {
  for (let i = 0; i < 100; i++) { try { await fetch(BASE); break; } catch { await new Promise((r) => setTimeout(r, 200)); } }
  const runs = [];
  let chrome = null;
  for (let r = 0; r < reps; r++) {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    chrome = browser.version();
    const browserCdp = await browser.newBrowserCDPSession();
    const before = await renderers(browserCdp);
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Performance.enable');
    await page.goto(`${BASE}/`);
    await page.getByRole('table').waitFor();
    // Chrome may start several renderers (spare/utility). The tab's renderer is the new one
    // whose CPU time grows most while run-20 is opened (decode + downsampling run there).
    const fresh = [...(await renderers(browserCdp)).keys()].filter((p) => !before.has(p));
    if (fresh.length === 0) throw new Error('no new renderer process');
    const gcAndHeap = async () => {
      await cdp.send('HeapProfiler.collectGarbage');
      await cdp.send('HeapProfiler.collectGarbage');
      const { metrics } = await cdp.send('Performance.getMetrics');
      return MB(metrics.find((m) => m.name === 'JSHeapUsedSize').value);
    };
    await page.waitForTimeout(1500);
    const listHeap = await gcAndHeap();
    const listAll = Object.fromEntries(fresh.map((p) => [p, processMemory(p)]));
    const cpuBefore = await renderers(browserCdp);

    await page.getByRole('link', { name: 'large-1m-steps-loss-spike' }).click();
    await page.getByTestId('metric-chart-loss').locator('svg').waitFor({ timeout: 60_000 });
    const cpuAfter = await renderers(browserCdp);
    const cpuGrowth = fresh.map((p) => [p, (cpuAfter.get(p) ?? 0) - (cpuBefore.get(p) ?? 0)]).sort((a, b) => b[1] - a[1]);
    const pid = cpuGrowth[0][0];
    const list = { ...listAll[pid], jsHeapMB: listHeap };
    const workersAfterLoad = page.workers().length;
    await page.waitForTimeout(3000);
    const run20Heap = await gcAndHeap();
    const run20 = { ...processMemory(pid), jsHeapMB: run20Heap, liveWorkersAfterLoad: workersAfterLoad };
    const otherNewRenderers = Object.fromEntries(fresh.filter((p) => p !== pid).map((p) => [p, { cpuSecondsDuringRun20Load: cpuGrowth.find((c) => c[0] === p)[1], ...processMemory(p) }]));
    runs.push({ rendererPid: pid, cpuSecondsDuringRun20Load: cpuGrowth[0][1], list, run20, otherNewRenderers });
    console.log(`rep ${r + 1}: list private ${list.privateMB} MB; run-20 private ${run20.privateMB} MB (peak ${run20.peakPrivateMB}), working set ${run20.workingSetMB} MB (peak ${run20.peakWorkingSetMB}), JS heap ${run20.jsHeapMB} MB`);
    await browser.close();
  }
  const out = { chrome, method: 'Windows Win32_Process counters of the tab renderer process (page + worker), identified via CDP SystemInfo.getProcessInfo; after 2× forced GC', date: new Date().toISOString(), runs };
  fs.writeFileSync('docs/qa/tab-memory.json', JSON.stringify(out, null, 2));
  console.log('wrote docs/qa/tab-memory.json');
} finally {
  server.kill();
}
