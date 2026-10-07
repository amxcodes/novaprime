export function requestFailureStatus(error: unknown): 500 | 503 {
  if (!error || typeof error !== "object" || !("code" in error) || typeof error.code !== "string") {
    return 500;
  }

  // SQLSTATE class 08 is a connection exception and class 28 means the
  // configured runtime identity could not authenticate. Both make the API
  // unavailable even when the failing query came from Better Auth.
  return error.code.startsWith("08")
    || error.code.startsWith("28")
    || ["53300", "57P01", "57P02", "57P03"].includes(error.code)
    ? 503
    : 500;
}
