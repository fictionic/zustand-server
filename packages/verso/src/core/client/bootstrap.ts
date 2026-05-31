import type {ClientSettings, RoutesMap} from '../../build/config';
import type {PageDefinition} from '../common/handler/Page';
import type {MiddlewareDefinition} from '../common/handler/Middleware';
import {ClientController} from './controller';
import {createResolver, type GetRouteHandler} from '../common/resolver';
import {CLIENT_MANIFEST_KEY, VersoPipe} from '../common/VersoPipe';

export type PageLoaders = Record<string, () => Promise<PageDefinition>>;

export async function bootstrap(
  routes: RoutesMap,
  pageLoaders: PageLoaders,
  middleware: MiddlewareDefinition[],
  clientSettings: ClientSettings,
): Promise<void> {
  const getRouteHandler: GetRouteHandler = async (routeName: string) => {
    const loader = pageLoaders[routeName];
    return loader?.() ?? null;
  }

  const resolver = createResolver(routes, getRouteHandler, middleware);
  const manifest = VersoPipe.reader().readValue(CLIENT_MANIFEST_KEY);
  const controller = new ClientController(resolver, manifest ?? null, clientSettings);
  await controller.hydrate();
}
