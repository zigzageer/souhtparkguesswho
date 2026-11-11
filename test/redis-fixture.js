import { createServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
const exec = promisify(execFile);

export async function redisFixture() {
  const local = '/workspace/.cache/redis/usr/bin/';
  const serverBin = process.env.REDIS_SERVER_BIN || (existsSync(local + 'redis-server') ? local + 'redis-server' : 'redis-server');
  const clientBin = process.env.REDIS_CLI_BIN || (existsSync(local + 'redis-cli') ? local + 'redis-cli' : 'redis-cli');
  const env = { ...process.env, LD_LIBRARY_PATH: ['/workspace/.cache/redis/usr/lib/x86_64-linux-gnu', process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') };
  const reserve = createTcpServer(); reserve.listen(0, '127.0.0.1'); await once(reserve, 'listening');
  const port = reserve.address().port; await new Promise(r => reserve.close(r));
  const processRedis = spawn(serverBin, ['--bind', '127.0.0.1', '--port', String(port), '--save', '', '--appendonly', 'no'], { env, stdio: 'ignore' });
  let exited = false; processRedis.on('exit', () => exited = true); processRedis.on('error', () => exited = true);
  const command = async args => JSON.parse((await exec(clientBin, ['--json', '-p', String(port), ...args.map(String)], { env })).stdout);
  for (let i = 0; i < 100; i++) {
    if (exited) throw new Error('Redis test dependency is missing. Install redis-server and redis-cli or run scripts/redis-test-deps.sh.');
    try { if (await command(['PING']) === 'PONG') break; } catch { if (i === 99) throw new Error('Redis did not start.'); }
    await new Promise(r => setTimeout(r, 25));
  }
  const http = createServer(async (req, res) => {
    try {
      if (req.headers.authorization !== 'Bearer fixture-token') { res.writeHead(401); return res.end(); }
      let body = ''; for await (const c of req) body += c;
      const results = [];
      for (const c of JSON.parse(body)) results.push({ result: await command(c) });
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(results));
    } catch { res.writeHead(500); res.end('{}'); }
  });
  http.listen(0, '127.0.0.1'); await once(http, 'listening');
  return { url: `http://127.0.0.1:${http.address().port}`, token: 'fixture-token', allowLoopback: true,
    async close() { http.closeAllConnections(); await new Promise(r => http.close(r)); processRedis.kill(); if (!exited) await once(processRedis, 'exit'); } };
}
