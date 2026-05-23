export function invariant(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`invariant violated: ${message}`);
  }
}
