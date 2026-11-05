// Copy for the questions (SPEC section 9 "Copy"): the Clipboard API first, then
// a hidden textarea and execCommand for browsers or contexts without it.

export interface ClipboardEnv {
  clipboard?: Pick<Clipboard, "writeText"> | undefined;
  document: Pick<Document, "createElement" | "execCommand" | "activeElement"> & {
    body: Pick<HTMLElement, "appendChild" | "removeChild">;
  };
}

function browserEnv(): ClipboardEnv {
  return { clipboard: navigator.clipboard, document };
}

/** Resolves true when the text reached the clipboard by either route. */
export async function copyText(text: string, env: ClipboardEnv = browserEnv()): Promise<boolean> {
  if (env.clipboard !== undefined) {
    try {
      await env.clipboard.writeText(text);
      return true;
    } catch {
      // Permission refused or no secure context: fall through to the textarea.
    }
  }
  return copyWithTextarea(text, env.document);
}

function copyWithTextarea(text: string, doc: ClipboardEnv["document"]): boolean {
  const previous = doc.activeElement as HTMLElement | null;
  const area = doc.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  // Off screen but selectable; readonly keeps phone keyboards from opening.
  area.style.position = "fixed";
  area.style.top = "-1000px";
  doc.body.appendChild(area);
  area.select();
  let ok = false;
  try {
    // SPEC section 9 asks for this fallback; execCommand is deprecated but still the only route without the Clipboard API.
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    ok = doc.execCommand("copy");
  } catch {
    ok = false;
  }
  doc.body.removeChild(area);
  previous?.focus();
  return ok;
}

/** "1. First question\n2. Second question" for Copy all. */
export function numberedList(items: readonly string[]): string {
  return items.map((item, i) => `${String(i + 1)}. ${item}`).join("\n");
}
