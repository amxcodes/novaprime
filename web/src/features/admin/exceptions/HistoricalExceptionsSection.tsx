import { lazy, Suspense, type ReactElement } from "react";
import { StateMessage } from "../../../design-system/primitives/StateMessage";
import type { HistoricalExceptionsProps } from "./contracts";

const HistoricalExceptionsLoadFailure = (_props: HistoricalExceptionsProps): ReactElement => (
  <StateMessage kind="error" title="Historical exceptions could not load">
    Historical exception controls could not be downloaded. Reload Admin to try again.
  </StateMessage>
);

const DeferredHistoricalExceptions = lazy(() =>
  import("./HistoricalExceptions").then(({ HistoricalExceptions }) => ({
    default: HistoricalExceptions,
  })).catch(() => ({ default: HistoricalExceptionsLoadFailure })),
);

/** Typed Admin slot that keeps the feature's own heading and UI in a lazy chunk. */
export function HistoricalExceptionsSection(props: HistoricalExceptionsProps) {
  return (
    <Suspense fallback={<StateMessage kind="loading" title="Loading historical exceptions" />}>
      <DeferredHistoricalExceptions {...props} />
    </Suspense>
  );
}
