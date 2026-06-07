import path from "node:path";
import type {BunFile} from "bun";

export type LoadedFile = {
  file: BunFile;
  etag: string;
}

export interface FileLoader {
  loadFile: (pathname: string) => LoadedFile | null;
}

export async function createFileLoader(rootDir: string): Promise<FileLoader> {
  const filesMap: Map<string, BunFile> = new Map();
  const glob = new Bun.Glob('**/*');
  const paths = glob.scanSync({ cwd: rootDir });
  for (const p of paths) {
    filesMap.set(p, Bun.file(path.join(rootDir, p)));
  }
  return {
    loadFile: (pathname: string) => {
      // we only return files that we found in the initial walk,
      // so there's no risk of a leak from a ../ path segment
      const file = filesMap.get(pathname);
      if (!file) return null;
      return {
        file,
        etag: `W/"${file.size}-${file.lastModified}"`,
      }
    },
  };
}
