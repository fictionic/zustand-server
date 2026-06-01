import {parseArgs} from 'node:util';
import {DEFAULT_OUTDIR} from './constants';
import {getAdapter as getNodeAdapter} from './start/adapter-node';

const DEFAULT_PORT = 3000;
const DEFAULT_HOSTNAME = 'localhost';

const command = process.argv[2];

switch (command) {
  case 'start': {
    const { runStart } = await import('./start/verso-start');

    const {values, positionals} = parseArgs({
      args: process.argv.slice(3),
      allowPositionals: true,
      options: {
        port: {type: 'string', short: 'p'},
        hostname: {type: 'string', short: 'h'},
      },
    });
    const outDir = positionals[0] ?? DEFAULT_OUTDIR;

    const port = values.port ? Number(values.port) : DEFAULT_PORT;
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      console.error(`invalid port: ${values.port}`);
      process.exit(1);
    }

    const hostname = values.hostname ?? DEFAULT_HOSTNAME;

    const controller = new AbortController();
    const shutdown = () => controller.abort();
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);

    await runStart(getNodeAdapter(), outDir, {
      port,
      hostname,
      signal: controller.signal,
    });

    break;
  }
  default:
    console.error('usage: verso start [--hostname HOSTNAME] [--port PORT] [DIR]');
    process.exit(1);
}
