import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {fillClientSettings, fillServerSettings, type ServerSettings, type VersoConfig} from './config';
import type {CreateVersoServer} from './createVersoServer';
import type {BundleResult} from './bundle';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BOOTSTRAP_PATH = path.resolve(__dirname, 'bootstrap.js');
const BUILD_PATH = path.resolve(__dirname, 'build.js');

export interface EntrypointGenerator {
  generateClientEntrypoint(): string;
  generateServerEntrypoint(): string;
}

export function getEntrypointGenerator(
  handlerBasePath: string,
  versoConfig: VersoConfig,
  writeManifest: boolean,
): EntrypointGenerator {

  const { routes, middleware, server: _serverSettings, client: _clientSettings } = versoConfig;
  const serverSettings = fillServerSettings(_serverSettings);
  const clientSettings = fillClientSettings(_clientSettings);
  const middlewarePaths = (middleware ?? [])
    .map((modulePath) => path.resolve(handlerBasePath, modulePath));

  return {
    generateClientEntrypoint(): string {
      const pageImporterEntries = Object.entries(routes)
        .map(([routeName, routeConfig]) => {
          // clientside, we generate lazy-loaders so each page is only imported when routed to
          // TODO: ensure that the requested routes's loader is module-preloaded
          const handlerPath = routeConfig.handler;
          const absolutePagePath = path.resolve(handlerBasePath, handlerPath);
          return `${quote(routeName)}: async () => (await import(${quote(absolutePagePath)})).default`;
        });

      const {
        importStatements: middlewareImportStatements,
        importNames: middlewareImportNames,
      } = generateStaticImports(middlewarePaths, 'middleware');

      const manifest = writeManifest ?
        "await import(/* @vite-ignore */ '/bundles/manifest.js?v=' + __BUILD_ID__).then(m => m.default)" : // we've preloaded this so it should be instant
        "null"; // not needed in dev mode -- vite handles css on client transitions

      return `
import { bootstrap } from ${quote(BOOTSTRAP_PATH)};

const routes = ${JSON.stringify(routes)};

const clientSettings = ${JSON.stringify(clientSettings)};

const pageLoaders = {
  ${pageImporterEntries.join(',\n  ')}
};

${middlewareImportStatements.join('\n')}
const middleware = [${middlewareImportNames.join(', ')}];

const manifest = ${manifest};

bootstrap(routes, pageLoaders, middleware, manifest, clientSettings);
`.trim();
    },

    generateServerEntrypoint(): string {
      const routeHandlerArray = Object.entries(routes)
        .map(([routeName, routeConfig]) => {
          const handlerPath = routeConfig.handler;
          return {
            routeName,
            modulePath: path.resolve(handlerBasePath, handlerPath),
          };
        });
      const routeHandlerModulePaths = routeHandlerArray.map(({ modulePath }) => modulePath);
      const {
        importStatements: routeHandlerImportStatements,
        importNames: routeHandlerImportNames,
      } = generateStaticImports(routeHandlerModulePaths, 'handler');
      const routeHandlerImportEntries = routeHandlerArray
        .map(({ routeName }, i) => `${quote(routeName)}: ${routeHandlerImportNames[i]}`);

      const {
        importStatements: middlewareImportStatements,
        importNames: middlewareImportNames,
      }  = generateStaticImports(middlewarePaths, 'middleware');

      return `
import { createVersoServer } from ${quote(BUILD_PATH)};

const routes = ${JSON.stringify(routes)};

${routeHandlerImportStatements.join('\n')}
const routeHandlers = {
  ${routeHandlerImportEntries.join(',\n  ')}
};

${middlewareImportStatements.join('\n')}
const middleware = [${middlewareImportNames.join(',\n')}];

const serverSettings = ${JSON.stringify(serverSettings)};

export function getServer(bundleResult) {
  return createVersoServer(
    routes,
    routeHandlers,
    middleware,
    bundleResult,
    serverSettings,
  );
}

export function getSettings() {
  return serverSettings;
}
`.trim();
    }
  };
};

export type ServerEntry = {
  getServer(b: BundleResult): ReturnType<CreateVersoServer>;
  getSettings(): ServerSettings;
};

function quote(s: string) {
  return JSON.stringify(s);
}

type StaticImports = {
  importStatements: string[];
  importNames: string[];
};
function generateStaticImports(modulePaths: string[], key: string): StaticImports {
  const importStatements: string[] = [];
  const importNames: string[] = [];
  modulePaths.forEach((modulePath, i) => {
    const importName = `${key}_${i}`;
    importNames.push(importName);
    importStatements.push(`import ${importName} from ${quote(modulePath)};`);
  });
  return {
    importStatements,
    importNames,
  };
}

