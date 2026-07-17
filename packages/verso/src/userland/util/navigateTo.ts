import type {NavigateOptions} from '../../core/client/controller';

type GetClientController = typeof import('../../core/client/controller').getClientController;

let getController: GetClientController | null = null;

if (!globalThis.IS_SERVER) {
  await import('../../core/client/controller').then(({ getClientController }) => {
    getController = getClientController;
  });
}

export async function navigateTo(url: string, options?: Partial<NavigateOptions>) {
  if (!getController) {
    throw new Error('cannot navigate on the server!');
  }
  const controller = getController();
  await controller.navigate(url, 'PUSH', options);
}
