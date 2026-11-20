import { createServer } from 'node:http';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { topEntries, validEntry } from '../src/leaderboard.mjs';

const dataFile = process.env.LANTERN_LEADERBOARD_FILE ??
  join(process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), 'dao-den-long', 'leaderboard.json');

async function readEntries() {
  try {
    const parsed = JSON.parse(await readFile(dataFile, 'utf8'));
    return topEntries(parsed.entries);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

const contentTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
export async function serveGame({ port = 0, leaderboard = false } = {}) {
  const root = fileURLToPath(new URL('../dist/', import.meta.url)).replace(/\/$/, '');
  await readFile(join(root, 'index.html'));
  let pending = Promise.resolve();
  const server = createServer(async (request, response) => {
    const json = (code, value) => response.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(value));
    try {
      const url = new URL(request.url, 'http://localhost');
      if (leaderboard && url.pathname === '/api/leaderboard') {
        if (request.method === 'GET') return json(200, { entries: await readEntries() });
        if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });
        if (request.headers.origin && request.headers.origin !== 'http://' + request.headers.host) return json(403, { error: 'Invalid origin' });
        if (request.headers['content-type'] !== 'application/json') return json(415, { error: 'Expected JSON' });
        let raw = '';
        for await (const chunk of request) {
          raw += chunk;
          if (raw.length > 2000) return json(413, { error: 'Entry too large' });
        }
        let entry;
        try { entry = JSON.parse(raw); } catch { return json(400, { error: 'Invalid JSON' }); }
        if (!validEntry(entry)) return json(400, { error: 'Invalid entry' });
        const save = pending.then(async () => {
          const entries = topEntries([...(await readEntries()), entry]);
          await mkdir(dirname(dataFile), { recursive: true });
          await writeFile(dataFile + '.tmp', JSON.stringify({ entries }, null, 2) + '\n', { mode: 0o600 });
          await rename(dataFile + '.tmp', dataFile);
          return entries;
        });
        pending = save.catch(() => {});
        return json(200, { entries: await save });
      }
      if (request.method !== 'GET') return json(405, { error: 'Method not allowed' });
      const file = resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
      if (!file.startsWith(root + sep)) return json(404, { error: 'Not found' });
      const bytes = await readFile(file);
      response.writeHead(200, { 'Content-Type': contentTypes[extname(file)] ?? 'application/octet-stream' }).end(bytes);
    } catch (error) {
      json(error.code === 'ENOENT' || error.code === 'EISDIR' ? 404 : 500, { error: 'Unable to read or write requested data' });
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return { server, url: 'http://127.0.0.1:' + server.address().port };
}

async function main() {
  const { values } = parseArgs({ options: {
    'export-leaderboard': { type: 'string' }, 'no-open': { type: 'boolean' }
  } });
  if (values['export-leaderboard']) {
    await writeFile(values['export-leaderboard'], JSON.stringify({ entries: await readEntries() }, null, 2) + '\n');
    return;
  }
  const port = Number(process.env.LANTERN_PORT ?? 4174);
  const { url } = await serveGame({ port, leaderboard: true });
  console.log('Đảo Đèn Lồng — ' + url);
  if (!values['no-open']) {
    const command = process.platform === 'darwin' ? 'open' : 'xdg-open';
    const child = spawn(command, [url], { stdio: 'ignore', detached: true });
    child.on('error', () => console.log('Open the URL in your browser.'));
    child.unref();
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
