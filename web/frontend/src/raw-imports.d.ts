// Vite turns a `?raw` import into the file's text.  The project does not pull in
// `vite/client` (the tsconfig lists its own `types`), so the shape is declared
// here for the one guard that reads the stylesheet.
declare module '*?raw' {
  const content: string;
  export default content;
}
