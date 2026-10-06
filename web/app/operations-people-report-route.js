import { peopleDirectoryPageUrl } from "./people-directory-route.js";
import { createOperationsPeopleReportController } from "../src/features/operations/people-report-controller.ts";

/** Bind the feature-owned search/page lifecycle to its bounded directory read. */
export function createOperationsPeopleReportRoute({
  read,
  isCurrent = () => true,
  onChange = () => {},
  failureMessage,
  deniedMessage,
} = {}) {
  if (typeof read !== "function") throw new TypeError("read must be a function");
  return createOperationsPeopleReportController({
    readPage: async (query, cursor) => {
      try {
        return await read(peopleDirectoryPageUrl(query, cursor));
      } catch (error) {
        return {
          readError: error?.code || "REQUEST_FAILED",
          readStatus: error?.httpStatus,
        };
      }
    },
    isCurrent,
    onChange,
    isDenied: (result) => result.readError === "PERMISSION_DENIED" || result.readStatus === 403,
    failureMessage,
    deniedMessage,
  });
}
