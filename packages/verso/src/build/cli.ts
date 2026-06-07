// import {parseArgs} from 'node:util';

const command = process.argv[2];

switch (command) {
  // TODO: commands
  // - check (check config, ensure all handler paths point to actual handlers, config value read/write order maybe, etc)
  // - typegen (create ts types out of the routes table. sveltekit has this -- `svelte-kit sync`)
  // - add-route?
  //
  // const { values, positionals } = parseArgs({
  //   args: process.argv.slice(3),
  //   allowPositionals: true,
  //   options: {
  //     port: { type: 'string', short: 'p' },
  //     hostname: { type: 'string', short: 'h' },
  //   },
  // });
  default:
    console.error('usage: verso');
    process.exit(1);
}
