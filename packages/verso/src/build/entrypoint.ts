import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {fillClientSettings, fillServerSettings, type VersoConfig} from './config';
import {VERSO_ENTRY} from './paths';
import type {ServerFactory} from '@verso-js/contract';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BOOTSTRAPCLIENT_PATH = path.resolve(__dirname, VERSO_ENTRY.bootstrapClient);
const CREATESERVERFACTORY_PATH = path.resolve(__dirname, VERSO_ENTRY.createServerFactory);

export interface EntrypointGenerator {
  generateClientEntrypoint(): string;
  generateServerEntrypoint(): string;
}

export function createEntrypointGenerator(
  handlerBasePath: string,
  versoConfig: VersoConfig,
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

      return `
import { default as bootstrapClient } from ${quote(BOOTSTRAPCLIENT_PATH)};

const routes = ${JSON.stringify(routes)};

const clientSettings = ${JSON.stringify(clientSettings)};

const pageLoaders = {
  ${pageImporterEntries.join(',\n  ')}
};

${middlewareImportStatements.join('\n')}
const middleware = [${middlewareImportNames.join(', ')}];

bootstrapClient(routes, pageLoaders, middleware, clientSettings);
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
import { default as createServerFactory } from ${quote(CREATESERVERFACTORY_PATH)};

const routes = ${JSON.stringify(routes)};

${routeHandlerImportStatements.join('\n')}
const routeHandlers = {
  ${routeHandlerImportEntries.join(',\n  ')}
};

${middlewareImportStatements.join('\n')}
const middleware = [${middlewareImportNames.join(',\n')}];

const settings = ${JSON.stringify(serverSettings)};

export default createServerFactory({
  routes,
  routeHandlers,
  middleware,
  settings,
});
`.trim();
    }
  };
};

export type ServerEntry = {
  default: ServerFactory;
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

