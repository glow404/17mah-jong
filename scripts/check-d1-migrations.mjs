import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const persistDirectory = await mkdtemp(join(tmpdir(), '17mah-jong-d1-'));
const wrangler = join(process.cwd(), 'node_modules', 'wrangler', 'bin', 'wrangler.js');

try {
  const result = await execFileAsync(process.execPath, [
    wrangler,
    'd1',
    'migrations',
    'apply',
    'mahjong-db',
    '--local',
    '--persist-to',
    persistDirectory,
  ]);
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  console.log(`D1 migrations applied successfully to an empty database: ${persistDirectory}`);
} finally {
  await rm(persistDirectory, { recursive: true, force: true });
}
