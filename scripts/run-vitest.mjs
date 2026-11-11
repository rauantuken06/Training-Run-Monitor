// Launches Vitest from the project root with an upper-case Windows drive letter.
//
// Why: Vitest 4 loads the `vitest` module twice when the process starts in a
// lower-case drive path (e.g. `c:\project`, as VS Code's integrated terminal
// often does). Tests then fail with "Invalid Chai property" or
// "Cannot read properties of undefined (reading 'config')". Starting Vitest in
// `C:\project` avoids it. On macOS/Linux the path is used unchanged.
//
// Usage: node scripts/run-vitest.mjs [vitest args...]
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Both the cwd and the Vitest entry path must use the normalized drive letter.
const projectRoot = fileURLToPath(new URL('..', import.meta.url)).replace(/^[a-z]:/, (drive) =>
  drive.toUpperCase(),
);
const vitestBin = join(projectRoot, 'node_modules', 'vitest', 'vitest.mjs');

const result = spawnSync(process.execPath, [vitestBin, ...process.argv.slice(2)], {
  cwd: projectRoot,
  stdio: 'inherit',
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}
process.exit(result.status ?? 1);
