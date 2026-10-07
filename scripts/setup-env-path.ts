import { lstatSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

function isInside(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot !== "" && pathFromRoot !== ".." &&
    !pathFromRoot.startsWith(`..${sep}`) && !isAbsolute(pathFromRoot);
}

/** Resolve an operator-selected env file without allowing a path or symlink to escape the checkout. */
export function resolveSetupEnvironmentPath(root: string, configuredPath?: string): string {
  if (configuredPath !== undefined && (!configuredPath.trim() || configuredPath.includes("\0"))) {
    throw new Error("SETUP_ENV_FILE_INVALID");
  }

  const realRoot = realpathSync(root);
  const envPath = resolve(realRoot, configuredPath?.trim() || ".env");
  if (!isInside(realRoot, envPath)) throw new Error("SETUP_ENV_FILE_OUTSIDE_REPOSITORY");

  const realParent = realpathSync(dirname(envPath));
  if (realParent !== realRoot && !isInside(realRoot, realParent)) {
    throw new Error("SETUP_ENV_FILE_OUTSIDE_REPOSITORY");
  }

  const envStat = lstatSync(envPath, { throwIfNoEntry: false });
  if (envStat?.isSymbolicLink()) throw new Error("SETUP_ENV_FILE_SYMLINK_UNSUPPORTED");
  if (envStat) {
    const realEnvPath = realpathSync(envPath);
    if (!isInside(realRoot, realEnvPath)) throw new Error("SETUP_ENV_FILE_OUTSIDE_REPOSITORY");
  }

  return envPath;
}
