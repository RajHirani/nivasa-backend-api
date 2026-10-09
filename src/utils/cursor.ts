// Opaque keyset cursor: base64url of a small JSON value.
export const encodeCursor = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');

export const decodeCursor = <T>(cursor: string | undefined): T | null => {
  if (!cursor) return null;
  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString()) as T;
  } catch {
    return null;
  }
};
