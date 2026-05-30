export interface PipeSchema {
  data: Record<string, unknown>;
  fns: Record<string, unknown[]>;
}

export interface PipeReaderImpl<Schema extends PipeSchema> {
  data: Schema['data'];
  fns: {
    pending: { [K in keyof Schema['fns']]?: Array<Schema['fns'][K]> };
    handlers: { [K in keyof Schema['fns']]?: (...args: Schema['fns'][K]) => void; };
    call: (name: string, args: unknown[]) => void; // only called by inline script; can't be type safe
  };
}

const PIPE_READER_INIT = `{
  data: {},
  fns: {
    pending: {},
    handlers: {},
    call(name, args) {
      if (this.handlers[name]) this.handlers[name](...args);
      else (this.pending[name] = this.pending[name] || []).push(args);
    }
  }
}`;

export const createPipe = <Schema extends PipeSchema>(pipeName: string) => ({
  writer(write: (html: string) => void) {
    return {
      init: () => {
        write(`<script>window.${pipeName} = ${PIPE_READER_INIT};</script>`);
      },
      writeValue: <K extends keyof Schema['data']>(key: K, value: Schema['data'][K]) => {
        write(`<script>window.${pipeName}.data['${key as string}'] = ${serialize(value)}</script>`);
      },
      callFn: <K extends keyof Schema['fns']>(fnName: K, args: Schema['fns'][K]) => {
        write(`<script>window.${pipeName}.fns.call('${fnName as string}', ${serialize(args)})</script>`);
      },
    };
  },

  reader() {
    if (typeof window === 'undefined') {
      throw new Error('[verso] cannot read from ServerClientPipe on the server');
    }
    const pipe = (window as any)[pipeName] as PipeReaderImpl<Schema>;
    return {
      readValue: <K extends keyof Schema['data']>(key: K): Schema['data'][K] => {
        return pipe.data[key as string] as Schema['data'][K];
      },
      replaceValue: <K extends keyof Schema['data']>(key: K, value: Schema['data'][K]) => {
        (pipe.data as PipeSchema['data'])[key as string] = value;
      },
      onCallFn: <K extends keyof Schema['fns']>(fnName: K, callback: (...args: Schema['fns'][K]) => void) => {
        if (pipe.fns.pending[fnName]) {
          pipe.fns.pending[fnName].forEach((args) => {
            callback(...(args as Schema['fns'][K]));
          });
          delete pipe.fns.pending[fnName];
        }
        pipe.fns.handlers[fnName] = callback;
      },
      destroy: () => {
        delete (window as any)[pipeName];
      },
      _impl: pipe, // for unit tests
    };
  },
});

// apparently this is the standard way to do this
function serialize(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

