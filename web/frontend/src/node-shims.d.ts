// This project's tsconfig lists its own `types`, so `@types/node` is not in
// scope.  Only one test reads a file from disk (the chip-tone guard, which has
// to see styles.css because a missing CSS class is invisible to TypeScript and
// to jsdom), so only that function is declared rather than adding a whole
// ambient package for one call.
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
}
