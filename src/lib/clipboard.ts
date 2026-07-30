/** Clipboard write that never throws: falls back to a hidden textarea when
 *  the async Clipboard API is unavailable or denied (e.g. wallet webviews). */
export function copyText(text: string) {
  try {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => copyLegacy(text));
      return;
    }
  } catch {
    // fall through to legacy path
  }
  copyLegacy(text);
}

function copyLegacy(text: string) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand("copy");
  } catch {
    // nothing else we can do; the short address is still visible on screen
  }
  document.body.removeChild(ta);
}
