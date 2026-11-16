/**
 * The build-time switches this app reads.
 *
 * `VITE_LAYOUT` picks the shell: `kiosk` (the exhibit — one page, centred
 * mark, three-stop mode knob, no side menu) or `sidebar` (the operator console
 * this grew out of).  Anything else, or nothing, means the kiosk.
 */
interface ImportMetaEnv {
  readonly VITE_LAYOUT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
