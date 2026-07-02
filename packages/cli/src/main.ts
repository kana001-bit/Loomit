#!/usr/bin/env node

import { pathToFileURL } from "node:url";

import { runCli } from "./runCli.js";

export function getCliPackageMarker(): string {
  return "loomit-cli";
}

export { runCli } from "./runCli.js";

if (isEntrypoint(import.meta.url, process.argv[1])) {
  runCli(process.argv).then(
    (exitCode) => {
      process.exitCode = exitCode;
    },
    (error: unknown) => {
      process.stderr.write(formatUnexpectedError(error));
      process.exitCode = 3;
    }
  );
}

function isEntrypoint(moduleUrl: string, argvPath: string | undefined): boolean {
  return argvPath !== undefined && moduleUrl === pathToFileURL(argvPath).href;
}

function formatUnexpectedError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `Unexpected internal error: ${message}\n`;
}
