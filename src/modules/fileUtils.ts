export async function ensureDir(path: string): Promise<void> {
  const io = (globalThis as unknown as {
    IOUtils?: {
      makeDirectory?: (
        path: string,
        options?: { createAncestors?: boolean; ignoreExisting?: boolean },
      ) => Promise<void>;
    };
  }).IOUtils;

  if (io?.makeDirectory) {
    await io.makeDirectory(path, {
      createAncestors: true,
      ignoreExisting: true,
    });
    return;
  }

  const osFile = (globalThis as unknown as {
    OS?: {
      File?: {
        makeDir?: (
          path: string,
          options?: { from?: string; ignoreExisting?: boolean },
        ) => Promise<void>;
      };
    };
  }).OS?.File;

  if (osFile?.makeDir) {
    const parent = path.replace(/[\\/][^\\/]+$/, "");
    await osFile.makeDir(path, {
      from: parent,
      ignoreExisting: true,
    });
    return;
  }

  throw new Error("No directory creation API available");
}

export async function writeTextFile(
  path: string,
  content: string,
): Promise<void> {
  const bytes = new TextEncoder().encode(content);

  const io = (globalThis as unknown as {
    IOUtils?: {
      write?: (path: string, data: Uint8Array) => Promise<unknown>;
    };
  }).IOUtils;

  if (io?.write) {
    await io.write(path, bytes);
    return;
  }

  const osFile = (globalThis as unknown as {
    OS?: {
      File?: {
        writeAtomic?: (path: string, data: Uint8Array) => Promise<void>;
      };
    };
  }).OS?.File;

  if (osFile?.writeAtomic) {
    await osFile.writeAtomic(path, bytes);
    return;
  }

  throw new Error("No file write API available");
}