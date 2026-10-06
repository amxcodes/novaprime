import type { EmailPreference, PreferenceReadState } from "../contracts";

interface ApiPreference {
  channel: string;
  eventKey: string;
  label: string;
  enabled: unknown;
}

interface ApiPreferenceResponse {
  preferences?: unknown;
}

interface NotificationPreferencesControllerDependencies {
  isCurrent: () => boolean;
  readPreferences: () => Promise<ApiPreferenceResponse>;
  savePreference: (eventKey: string, enabled: boolean) => Promise<void>;
  runActionButton: (source: HTMLButtonElement, action: (context: unknown) => Promise<void>) => Promise<void>;
  isCurrentCommand: (context: unknown) => boolean;
  errorMessage: (error: unknown) => string;
  onStateChange: (state: PreferenceReadState, pendingEventKeys: ReadonlyArray<string>) => void;
  onSaveConfirmed: () => void;
}

export function createNotificationPreferencesController(dependencies: NotificationPreferencesControllerDependencies) {
  let state: PreferenceReadState = { status: "loading" };
  let readGeneration = 0;
  const pendingEventKeys = new Set<string>();
  const publish = () => {
    if (dependencies.isCurrent()) dependencies.onStateChange(state, [...pendingEventKeys]);
  };

  async function refresh(): Promise<boolean> {
    if (!dependencies.isCurrent()) return false;
    const generation = ++readGeneration;
    try {
      const result = await dependencies.readPreferences();
      if (!dependencies.isCurrent() || generation !== readGeneration) return false;
      if (!Array.isArray(result.preferences)) throw new Error("Invalid notification preferences response");
      const preferences = result.preferences
        .filter((value): value is ApiPreference => Boolean(value && typeof value === "object" && (value as ApiPreference).channel === "email"))
        .map((preference): EmailPreference => ({
          eventKey: preference.eventKey,
          label: preference.label,
          enabled: preference.enabled === true,
        }));
      state = { status: "ready", preferences };
      publish();
      return true;
    } catch (error) {
      if (!dependencies.isCurrent() || generation !== readGeneration) return false;
      state = { status: "failed", message: dependencies.errorMessage(error) };
      publish();
      return false;
    }
  }

  async function setEmailPreference(eventKey: string, enabled: boolean, source: HTMLButtonElement): Promise<void> {
    if (!dependencies.isCurrent() || pendingEventKeys.has(eventKey)) return;
    pendingEventKeys.add(eventKey);
    publish();
    try {
      await dependencies.runActionButton(source, async (context) => {
        if (!dependencies.isCurrent() || !dependencies.isCurrentCommand(context)) return;
        try {
          await dependencies.savePreference(eventKey, enabled);
        } catch (error) {
          // A lost response or server failure may follow a committed upsert; read back
          // the actor-owned value before reporting the failure so the switch reconciles.
          const status = (error as { httpStatus?: unknown } | null)?.httpStatus;
          if ((status === undefined || (typeof status === "number" && status >= 500)) && dependencies.isCurrentCommand(context)) {
            await refresh();
          }
          throw error;
        }
        if (!dependencies.isCurrent() || !dependencies.isCurrentCommand(context)) return;
        if (!await refresh() || !dependencies.isCurrent() || !dependencies.isCurrentCommand(context)) return;
        dependencies.onSaveConfirmed();
      });
    } finally {
      pendingEventKeys.delete(eventKey);
      publish();
    }
  }

  return {
    start() {
      publish();
      void refresh();
    },
    retry() {
      state = { status: "loading" };
      publish();
      void refresh();
    },
    setEmailPreference,
  };
}
