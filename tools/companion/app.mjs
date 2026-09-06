import { createCompanion, parseActivation } from './runtime.mjs';
import { defaultDataDir, installationSecret } from './storage.mjs';

const dataDir = defaultDataDir();
const args = process.argv.slice(2);
const action = args[0];
if (args.length > (action === '--activate' ? 2 : 1) || (action && !['--activate', '--status', '--stop'].includes(action))) {
  process.stderr.write('Usage: app.mjs [--activate joblit://connect?... | --status | --stop]\n');
  process.exitCode = 2;
} else {
  try {
    const activation = action === '--activate' ? parseActivation(args[1]) : undefined;
    const secret = await installationSecret(dataDir);
    const local = async (path, body) => {
      for (let attempt = 0; ; attempt++) {
        const response = await fetch(`http://127.0.0.1:8791${path}`, { method: body === undefined ? 'GET' : 'POST', redirect: 'error', headers: { Authorization: `Bearer ${secret}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(3000) });
        if (response.status !== 503 || attempt === 4) return response;
        await response.body?.cancel();
        await new Promise(resolve => setTimeout(resolve, 150));
      }
    };
    if (action === '--status' || action === '--stop') {
      try {
        const response = await local(action === '--status' ? '/_status' : '/_stop', action === '--stop' ? {} : undefined);
        const value = await response.json();
        process.stdout.write(`${JSON.stringify(value)}\n`);
        if (!response.ok) process.exitCode = 2;
      } catch { process.stdout.write('{"running":false}\n'); if (action === '--status') process.exitCode = 1; }
    } else {
      let existing = false;
      try { existing = (await local(activation ? '/_activate' : '/_status', activation)).ok; } catch {}
      if (!existing) {
        const companion = await createCompanion({ dataDir });
        try {
          await companion.listen();
          if (activation) companion.activate(activation);
          const shutdown = () => companion.close().then(() => { process.exitCode = 0; });
          process.once('SIGTERM', shutdown);
          process.once('SIGINT', shutdown);
        } catch (error) {
          // Simultaneous launcher clicks can race to bind. Hand the second
          // challenge to the winner instead of replacing its live tasks.
          if (error.code !== 'EADDRINUSE') throw error;
          await companion.close();
          const response = await local(activation ? '/_activate' : '/_status', activation);
          if (!response.ok) throw new Error('Port 8791 is occupied by another application.');
        }
      }
    }
  } catch (error) {
    process.stderr.write(`${error.status === 400 ? error.message : 'Joblit Companion could not start. Check its installation and whether port 8791 is available.'}\n`);
    process.exitCode = 1;
  }
}
