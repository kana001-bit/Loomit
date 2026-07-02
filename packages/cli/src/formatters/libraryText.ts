import type { LibraryPartEntry } from "@loomit/core";

export function formatLibraryText(entries: readonly LibraryPartEntry[]): string {
  const lines = [`Loomit library: ${entries.length} part${entries.length === 1 ? "" : "s"}`];

  for (const entry of entries) {
    lines.push(
      `  ${entry.meta.type}/${entry.meta.name} published_at=${entry.meta.published_at}`
    );
    lines.push(`    path: ${entry.partDirectory}`);
  }

  return `${lines.join("\n")}\n`;
}
