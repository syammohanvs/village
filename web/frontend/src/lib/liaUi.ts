// A tiny event bus so any page or the sidebar can open Lia.
//
// The guide owns its own open state (it is mounted above the routes), so a
// request from elsewhere is a window event rather than a new React context.
const OPEN_EVENT = 'village:open-lia';

export type LiaEntry = 'model' | 'voice' | 'events' | 'help';

export function openLia(entry: LiaEntry = 'help'): void {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { entry } }));
}

export function subscribeOpenLia(handler: (entry: LiaEntry) => void): () => void {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<{ entry?: LiaEntry }>).detail;
    handler(detail?.entry ?? 'help');
  };
  window.addEventListener(OPEN_EVENT, listener);
  return () => window.removeEventListener(OPEN_EVENT, listener);
}
