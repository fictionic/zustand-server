import type {BundleManifest} from '../../build/bundle';
import type {ClientSettings, RoutesMap} from '../../build/config';
import type {PageDefinition} from '../common/handler/Page';
import type {MiddlewareDefinition} from '../common/handler/Middleware';
import {ClientController} from './controller';
import {createResolver, type GetRouteHandler} from '../common/resolver';

export type PageLoaders = Record<string, () => Promise<PageDefinition>>;

export async function bootstrap(
  routes: RoutesMap,
  pageLoaders: PageLoaders,
  middleware: MiddlewareDefinition[],
  // The bundle manifest is only available in build mode. In dev, the controller
  // fetches route stylesheets from a dev-only endpoint during client transitions.
  manifest: BundleManifest | null,
  clientSettings: ClientSettings,
): Promise<void> {
  const getRouteHandler: GetRouteHandler = async (routeName: string) => {
    const loader = pageLoaders[routeName];
    return loader?.() ?? null;
  }

  const resolver = createResolver(routes, getRouteHandler, middleware);
  const controller = new ClientController(resolver, manifest, clientSettings);
  await controller.hydrate();
}
