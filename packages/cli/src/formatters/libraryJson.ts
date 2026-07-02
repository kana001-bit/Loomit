import type { LibraryPartEntry } from "@loomit/core";

export function formatLibraryJson(entries: readonly LibraryPartEntry[]): string {
  return `${JSON.stringify(entries, null, 2)}\n`;
}
