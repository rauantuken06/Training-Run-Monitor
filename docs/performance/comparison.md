| Metric | Baseline median (min–max) | Optimized median (min–max) | Difference | Change | Method |
| --- | --- | --- | --- | --- | --- |
| Runs list: first contentful paint | 960 ms (868–1,392; n=5) | 780 ms (728–828; n=5) | -180 ms | -18.8% | Paint Timing (FCP), from navigation start |
| Runs list: table painted | 978 ms (896–1,421; n=5) | 763 ms (710–859; n=5) | -215 ms | -21.9% | 20 rows in DOM, then next painted frame |
| Runs list: total blocking time | 604 ms (533–829; n=5) | 433 ms (397–509; n=5) | -171 ms | -28.3% | Σ(long task − 50 ms) until table painted |
| Runs list: JS downloaded | 950 kB (950–950; n=5) | 371 kB (371–371; n=5) | -580 kB | -61.0% | Resource Timing decodedBodySize of .js |
| Runs list: JS heap after GC | 3.5 MB (3.5–3.5; n=5) | 2.3 MB (2.3–2.4; n=5) | -1.2 MB | -34.3% | CDP Performance.getMetrics JSHeapUsedSize after 2× forced GC |
| run-20: loading message painted | 798 ms (753–923; n=5) | 605 ms (603–641; n=5) | -193 ms | -24.1% | deep link; status "Loading…" in DOM, then next frame |
| run-20: data ready (summaries) | 3,208 ms (3,054–3,762; n=5) | 1,330 ms (1,315–1,416; n=5) | -1,879 ms | -58.6% | "Data quality" heading in DOM |
| run-20: charts painted (first render) | 4,348 ms (4,072–5,022; n=5) | 2,530 ms (2,445–2,836; n=5) | -1,817 ms | -41.8% | all 3 chart lines in DOM, then next frame |
| run-20: total blocking time | 3,638 ms (3,343–4,292; n=5) | 1,023 ms (989–1,127; n=5) | -2,615 ms | -71.9% | Σ(long task − 50 ms) until charts painted |
| run-20: longest main-thread task | 1,824 ms (1,619–2,035; n=5) | 332 ms (319–379; n=5) | -1,492 ms | -81.8% | Long Tasks API |
| run-20: JS heap after GC (1M points) | 77.6 MB (77.6–77.6; n=5) | 74.2 MB (74.2–74.2; n=5) | -3.4 MB | -4.4% | CDP JSHeapUsedSize after 2× forced GC (main thread only) |
| Zoom in, first click (new viewport) | 504 ms (488–520; n=5) | 440 ms (400–632; n=5) | -64 ms | -12.7% | Event Timing duration of the click (input → next paint) |
| Zoom in, repeated clicks (viewport seen before) | 360 ms (312–424; n=20) | 144 ms (112–248; n=20) | -216 ms | -60.0% | Event Timing, clicks 2–5 |
| Reset zoom, first click (full range) | 648 ms (640–680; n=5) | 176 ms (176–192; n=5) | -472 ms | -72.8% | Event Timing duration of the click |
| Reset zoom, repeated clicks | 528 ms (496–640; n=20) | 128 ms (112–224; n=20) | -400 ms | -75.8% | Event Timing, clicks 2–5 |
| Hover: processing per move (median) | 12 ms (11–13; n=5) | 12 ms (10–13; n=5) | +1 ms | +4.3% | pointermove input timestamp → end of dispatch |
| Hover: input → next frame (median) | 32 ms (30–32; n=5) | 31 ms (28–33; n=5) | -1 ms | -2.2% | input timestamp → after next frame |
| Hover: input → next frame (max) | 122 ms (114–140; n=5) | 122 ms (113–141; n=5) | +1 ms | +0.6% | worst of 30 moves |

| Build output (JS) | Baseline | Optimized |
| --- | --- | --- |
| index.js | 950.1 kB (gzip 317.4 kB) | 370.5 kB (gzip 117.6 kB) |
| run.worker.js | — | 17.0 kB (gzip 6.2 kB) |
| RunCharts.js | — | 582.5 kB (gzip 200.9 kB) |
