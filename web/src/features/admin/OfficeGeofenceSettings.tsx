import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Button, EmptyState, Field, Input, StateMessage } from "../../design-system";
import type { OfficeGeofenceOption, OfficeGeofenceSettingsProps } from "./office-geofence-contracts";
import { parseOfficeGeofenceDraft, type OfficeGeofenceDraft, type OfficeGeofenceFieldErrors } from "./office-geofence-model";
import styles from "./OfficeGeofenceSettings.module.css";

export function OfficeGeofenceSettings(props: OfficeGeofenceSettingsProps) {
  if (!props.canManage) return null;

  switch (props.read.status) {
    case "loading":
      return <StateMessage kind="loading" title="Loading attendance geofences">Reading the authorized office settings.</StateMessage>;
    case "unavailable":
      return <StateMessage kind="info" title="Office geofence settings unavailable">
        {props.read.message || "The authorized office settings are not available right now."}
      </StateMessage>;
    case "error":
      return <StateMessage kind="error" title="Office geofence settings could not load">{props.read.message}</StateMessage>;
    case "ready":
      if (!props.read.offices.length) {
        return <EmptyState title="No offices are available to configure" description="Create an office before setting its attendance geofence." />;
      }
      return (
        <div className={styles.officeList}>
          {props.read.offices.map((office) => (
            <OfficeGeofenceCard key={office.id} office={office} onSave={props.onSave} />
          ))}
        </div>
      );
  }
}

function OfficeGeofenceCard({
  office,
  onSave,
}: {
  office: OfficeGeofenceOption;
  onSave: OfficeGeofenceSettingsProps["onSave"];
}) {
  const id = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(false);
  const [draft, setDraft] = useState<OfficeGeofenceDraft>(() => ({
    latitude: office.latitude === null ? "" : String(office.latitude),
    longitude: office.longitude === null ? "" : String(office.longitude),
    radiusMeters: String(office.geofenceRadiusMeters || 150),
  }));
  const [savedLocation, setSavedLocation] = useState({
    latitude: office.latitude,
    longitude: office.longitude,
    radiusMeters: office.geofenceRadiusMeters,
  });
  const [fieldErrors, setFieldErrors] = useState<OfficeGeofenceFieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const statusLabel = savedLocation.latitude === null || savedLocation.longitude === null
    ? "Not configured"
    : `${savedLocation.radiusMeters} m radius`;

  function updateField(key: keyof OfficeGeofenceDraft, value: string) {
    setDraft((current) => ({ ...current, [key]: value }));
    if (fieldErrors[key]) setFieldErrors((current) => ({ ...current, [key]: undefined }));
    setError(null);
    setSaved(false);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;

    const result = parseOfficeGeofenceDraft(draft);
    setFieldErrors(result.errors);
    setError(null);
    setSaved(false);
    if (!result.input) {
      setError("Review the highlighted values. Coordinates and radius must be within the allowed ranges.");
      requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>("[aria-invalid='true']")?.focus());
      return;
    }

    setSaving(true);
    try {
      await onSave(office.id, result.input);
      if (!mountedRef.current) return;
      setSavedLocation({
        latitude: result.input.latitude,
        longitude: result.input.longitude,
        radiusMeters: result.input.geofenceRadiusMeters,
      });
      setDraft({
        latitude: String(result.input.latitude),
        longitude: String(result.input.longitude),
        radiusMeters: String(result.input.geofenceRadiusMeters),
      });
      setSaved(true);
    } catch (saveError) {
      if (!mountedRef.current) return;
      const message = saveError instanceof Error ? saveError.message.trim() : "";
      setError(message || "The office geofence could not be saved. Review the values and try again.");
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  }

  return (
    <article className={styles.officeCard} aria-labelledby={`${id}-title`}>
      <header className={styles.officeHeader}>
        <div className={styles.officeTitleGroup}>
          <h3 className={styles.officeTitle} id={`${id}-title`}>{office.name}</h3>
          <p className={styles.officeStatus}>{statusLabel}</p>
        </div>
      </header>

      <form className={styles.form} ref={formRef} noValidate onSubmit={(event) => void submit(event)}>
        <div className={styles.fields}>
          <Field
            id={`${id}-latitude`}
            label="Latitude"
            hint="−90 to 90; up to five decimal places."
            error={fieldErrors.latitude}
            required
          >
            {(control) => (
              <Input
                {...control}
                type="number"
                inputMode="decimal"
                min={-90}
                max={90}
                step="0.00001"
                value={draft.latitude}
                disabled={saving}
                onChange={(event) => updateField("latitude", event.currentTarget.value)}
              />
            )}
          </Field>
          <Field
            id={`${id}-longitude`}
            label="Longitude"
            hint="−180 to 180; up to five decimal places."
            error={fieldErrors.longitude}
            required
          >
            {(control) => (
              <Input
                {...control}
                type="number"
                inputMode="decimal"
                min={-180}
                max={180}
                step="0.00001"
                value={draft.longitude}
                disabled={saving}
                onChange={(event) => updateField("longitude", event.currentTarget.value)}
              />
            )}
          </Field>
          <Field
            id={`${id}-radius`}
            label="Radius (metres)"
            hint="Whole number from 10 to 100,000 metres."
            error={fieldErrors.radiusMeters}
            required
          >
            {(control) => (
              <Input
                {...control}
                type="number"
                inputMode="numeric"
                min={10}
                max={100000}
                step={1}
                value={draft.radiusMeters}
                disabled={saving}
                onChange={(event) => updateField("radiusMeters", event.currentTarget.value)}
              />
            )}
          </Field>
        </div>

        {error ? (
          <div className={styles.feedback} ref={errorRef} tabIndex={-1}>
            <StateMessage kind="error" title="Geofence not saved">{error}</StateMessage>
          </div>
        ) : null}
        {saved ? <StateMessage kind="success" title="Geofence saved">The office attendance boundary is updated.</StateMessage> : null}
        <div className={styles.actions}>
          <Button variant="secondary" type="submit" loading={saving} loadingLabel="Saving geofence" disabled={saving}>
            Save geofence
          </Button>
        </div>
      </form>
    </article>
  );
}
