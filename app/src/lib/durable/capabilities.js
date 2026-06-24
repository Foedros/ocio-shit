// Feature detection that decides the durability mode and powers the honest UI warning.
//
// Browser-scope decision (roadmap Sprint 1, task 7): MVP targets Chromium for FULL
// automatic durability (File System Access API directory handles). Where the API is
// missing/partial (Safari, Firefox), we degrade to MANUAL export and SAY SO in the
// indicator — never pretend the archive is safe when it isn't.

export function detectCapabilities() {
  const hasWindow = typeof window !== 'undefined';

  const supportsOpfs =
    typeof navigator !== 'undefined' &&
    !!navigator.storage &&
    typeof navigator.storage.getDirectory === 'function';

  const supportsFileSystemAccess =
    hasWindow && typeof window.showDirectoryPicker === 'function';

  // Atomic temp+rename needs FileSystemFileHandle.move(); fall back to commit-on-close
  // (createWritable already swaps atomically on close) when move() is absent.
  const supportsMove =
    typeof FileSystemFileHandle !== 'undefined' &&
    typeof FileSystemFileHandle.prototype.move === 'function';

  const supportsPersistentStorage =
    typeof navigator !== 'undefined' &&
    !!navigator.storage &&
    typeof navigator.storage.persist === 'function';

  const supportsIndexedDb = hasWindow && 'indexedDB' in window;

  // Chromium family (Chrome, Edge, Brave, Opera, Arc...) — the supported MVP target.
  let isChromium = false;
  if (typeof navigator !== 'undefined') {
    const brands = navigator.userAgentData?.brands;
    if (Array.isArray(brands)) {
      isChromium = brands.some((b) => /Chromium|Google Chrome|Microsoft Edge/i.test(b.brand));
    } else {
      const ua = navigator.userAgent || '';
      isChromium = /Chrome|Chromium|Edg\//.test(ua) && !/(^|\s)Version\/.*Safari/.test(ua);
    }
  }

  const mode = supportsFileSystemAccess ? 'auto' : 'manual';

  return {
    supportsOpfs,
    supportsFileSystemAccess,
    supportsMove,
    supportsPersistentStorage,
    supportsIndexedDb,
    isChromium,
    mode, // 'auto' (durable, automatic) | 'manual' (degraded, user must export)
    summary: supportsFileSystemAccess
      ? 'Durabilidad automática (File System Access API).'
      : 'Navegador sin File System Access API: durabilidad MANUAL — debes exportar tú.'
  };
}
