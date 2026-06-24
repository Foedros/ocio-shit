// The whole app is client-only: OPFS, the worker and File System Access exist only in the
// browser. Prerender the shell to a static index.html for GitHub Pages; no SSR.
export const ssr = false;
export const prerender = true;
export const trailingSlash = 'ignore';
