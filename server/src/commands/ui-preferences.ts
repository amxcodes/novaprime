import { authenticationConfiguration } from "../auth-configuration.js";
import { withDatabaseRequest, type DatabaseRequestContext } from "../db.js";
import { isNormalOperationalActor, requestActor } from "../request-actor.js";
import {
  DEFAULT_APPEARANCE,
  DEFAULT_WORKSPACE,
  UI_PREFERENCE_SCHEMA_VERSION,
  validateAppearance,
  validateWorkspace,
} from "../../../web/ui-preferences.js";

const json = (body: unknown, status = 200) => Response.json(body, {
  status,
  headers: { "cache-control": "no-store" },
});

async function normalActor(
  request: Request,
): Promise<{ context: DatabaseRequestContext } | { response: Response }> {
  try {
    authenticationConfiguration();
  } catch {
    return { response: json({ error: "AUTHENTICATION_CONFIGURATION_REQUIRED" }, 503) };
  }
  const actor = await requestActor(request);
  if (!actor) return { response: json({ error: "AUTHENTICATION_REQUIRED" }, 401) };
  if (!isNormalOperationalActor(actor)) return { response: json({ error: "ACCOUNT_NOT_OPERATIONAL" }, 403) };
  return { context: actor.context };
}

type PreferenceRow = {
  schema_version: number;
  revision: number;
  preferences: { appearance?: unknown; workspace?: unknown };
};

/**
 * Saved task views have their own owner-scoped API. Keep accepting an old
 * workspace document during rollout, but never return or persist its saved
 * search definitions through the generic appearance-preferences endpoint.
 */
export function sanitizePreferenceWorkspace(value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const workspaceInput = { ...(value as Record<string, unknown>) };
  delete workspaceInput.savedViews;
  const workspace = validateWorkspace(workspaceInput);
  if (!workspace) return undefined;
  const safeWorkspace = { ...workspace } as Record<string, unknown>;
  delete safeWorkspace.savedViews;
  return safeWorkspace;
}

function preferenceResult(row?: PreferenceRow) {
  const schemaVersion = row?.schema_version ?? UI_PREFERENCE_SCHEMA_VERSION;
  const appearance = schemaVersion === UI_PREFERENCE_SCHEMA_VERSION
    ? validateAppearance(row?.preferences?.appearance) || { ...DEFAULT_APPEARANCE }
    : { ...DEFAULT_APPEARANCE };
  const workspace = schemaVersion === UI_PREFERENCE_SCHEMA_VERSION
    ? sanitizePreferenceWorkspace(row?.preferences?.workspace) || {
      navigationOrder: [...DEFAULT_WORKSPACE.navigationOrder],
      pinnedDestinations: [],
      homeView: "auto",
      myDayModules: [...DEFAULT_WORKSPACE.myDayModules],
    }
    : {
      navigationOrder: [...DEFAULT_WORKSPACE.navigationOrder],
      pinnedDestinations: [],
      homeView: "auto",
      myDayModules: [...DEFAULT_WORKSPACE.myDayModules],
    };
  return {
    schemaVersion,
    revision: row?.revision ?? 0,
    appearance,
    workspace,
    writable: schemaVersion === UI_PREFERENCE_SCHEMA_VERSION,
  };
}

async function readCurrentPreference(
  context: DatabaseRequestContext,
): Promise<PreferenceRow | undefined> {
  return withDatabaseRequest(context, async (transaction) => {
    const result = await transaction.query<PreferenceRow>(
      `SELECT schema_version, revision, preferences
       FROM nova.personal_ui_preferences
       WHERE organisation_id = $1 AND person_id = $2`,
      [context.organisationId, context.userId],
    );
    return result.rows[0];
  });
}

export async function readPersonalUiPreferences(request: Request): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  try {
    return json({
      ...preferenceResult(await readCurrentPreference(actor.context)),
      personId: actor.context.userId,
    });
  } catch {
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
}

export async function updatePersonalUiPreferences(request: Request): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;

  const source = await request.text().catch(() => "");
  if (source.length > 8192) return json({ error: "UI_PREFERENCE_INPUT_INVALID" }, 400);
  let body: unknown;
  try {
    body = JSON.parse(source);
  } catch {
    return json({ error: "UI_PREFERENCE_INPUT_INVALID" }, 400);
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return json({ error: "UI_PREFERENCE_INPUT_INVALID" }, 400);
  }

  const candidate = body as Record<string, unknown>;
  const hasAppearance = Object.hasOwn(candidate, "appearance");
  const hasWorkspace = Object.hasOwn(candidate, "workspace");
  if (
    Object.keys(candidate).some((key) => !["schemaVersion", "expectedPersonId", "expectedRevision", "appearance", "workspace"].includes(key)) ||
    candidate.schemaVersion !== UI_PREFERENCE_SCHEMA_VERSION ||
    typeof candidate.expectedPersonId !== "string" ||
    !Number.isSafeInteger(candidate.expectedRevision) ||
    (candidate.expectedRevision as number) < 0 ||
    (!hasAppearance && !hasWorkspace) ||
    (hasAppearance && !validateAppearance(candidate.appearance)) ||
    (hasWorkspace && !sanitizePreferenceWorkspace(candidate.workspace))
  ) {
    return json({ error: "UI_PREFERENCE_INPUT_INVALID" }, 400);
  }
  if (candidate.expectedPersonId !== actor.context.userId) {
    return json({ error: "UI_PREFERENCE_IDENTITY_CHANGED" }, 409);
  }

  const expectedRevision = candidate.expectedRevision as number;
  const appearance = hasAppearance ? validateAppearance(candidate.appearance)! : undefined;
  const workspace = hasWorkspace ? sanitizePreferenceWorkspace(candidate.workspace)! : undefined;
  const preferencePatch = {
    ...(appearance ? { appearance } : {}),
    ...(workspace ? { workspace } : {}),
  };
  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) => {
      if (expectedRevision === 0) {
        const inserted = await transaction.query<PreferenceRow>(
          `INSERT INTO nova.personal_ui_preferences
             (organisation_id, person_id, schema_version, revision, preferences)
           VALUES ($1, $2, $3, 1, $4::jsonb)
           ON CONFLICT (organisation_id, person_id) DO NOTHING
           RETURNING schema_version, revision, preferences`,
          [actor.context.organisationId, actor.context.userId, UI_PREFERENCE_SCHEMA_VERSION, JSON.stringify(preferencePatch)],
        );
        if (inserted.rows[0]) return { kind: "saved" as const, row: inserted.rows[0] };
      }

      if (expectedRevision > 0) {
        const updated = await transaction.query<PreferenceRow>(
          `UPDATE nova.personal_ui_preferences
           SET preferences = preferences || $4::jsonb,
               revision = revision + 1,
               updated_at = clock_timestamp()
           WHERE organisation_id = $1 AND person_id = $2
             AND revision = $3 AND schema_version = $5
           RETURNING schema_version, revision, preferences`,
          [actor.context.organisationId, actor.context.userId, expectedRevision,
            JSON.stringify(preferencePatch), UI_PREFERENCE_SCHEMA_VERSION],
        );
        if (updated.rows[0]) return { kind: "saved" as const, row: updated.rows[0] };
      }

      const current = await transaction.query<PreferenceRow>(
        `SELECT schema_version, revision, preferences
         FROM nova.personal_ui_preferences
         WHERE organisation_id = $1 AND person_id = $2`,
        [actor.context.organisationId, actor.context.userId],
      );
      const row = current.rows[0];
      if (row && row.schema_version !== UI_PREFERENCE_SCHEMA_VERSION) {
        return { kind: "unsupported" as const, current: preferenceResult(row) };
      }
      return { kind: "conflict" as const, current: preferenceResult(row) };
    });

    if (result.kind === "unsupported") {
      return json({ error: "UI_PREFERENCE_SCHEMA_UNSUPPORTED", current: result.current }, 409);
    }
    if (result.kind === "conflict") {
      return json({ error: "UI_PREFERENCE_CONFLICT", current: result.current }, 409);
    }
    return json({
      ...preferenceResult(result.row),
      personId: actor.context.userId,
    });
  } catch {
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
}
