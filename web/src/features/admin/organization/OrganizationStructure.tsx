import { useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Button, Field, Input, StateMessage } from "../../../design-system";
import type {
  CreateOrganizationDepartmentInput,
  CreateOrganizationOfficeInput,
  OrganizationDepartmentSummary,
  OrganizationOfficeSummary,
  OrganizationReadState,
  OrganizationStructureProps,
} from "./contracts";
import styles from "./OrganizationStructure.module.css";

export function OrganizationStructure(props: OrganizationStructureProps) {
  const id = useId();
  if (!props.canView) return null;

  const officeCreateAllowed = props.canManageOrganization && props.canManageOfficeGeofence;
  const titleId = `${id}-title`;
  const officesTitleId = `${id}-offices-title`;
  const departmentsTitleId = `${id}-departments-title`;

  return (
    <section className={styles.structure} aria-labelledby={titleId}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Organisation</p>
          <h2 className={styles.title} id={titleId}>Offices and departments</h2>
          <p className={styles.description}>Review the offices and departments configured for this organisation.</p>
        </div>
        <div className={styles.counts} role="group" aria-label="Organisation structure totals">
          <span>{countLabel(props.offices, "office", "offices")}</span>
          <span>{countLabel(props.departments, "department", "departments")}</span>
        </div>
      </header>

      <div className={styles.layout}>
        <div className={styles.catalog}>
          <section className={styles.group} aria-labelledby={officesTitleId}>
            <div className={styles.groupHeader}>
              <h3 className={styles.groupTitle} id={officesTitleId}>Offices</h3>
              {props.offices.status === "ready" ? <span className={styles.count}>{props.offices.items.length}</span> : null}
            </div>
            <ReadContent
              read={props.offices}
              resource="office"
              unavailableTitle="Office list unavailable"
              errorTitle="Offices could not load"
              emptyTitle="No offices yet"
              emptyDescription="Create an office to give attendance and onboarding a location and timezone."
            >
              {(items) => <OfficeList offices={items} />}
            </ReadContent>
          </section>

          <section className={styles.group} aria-labelledby={departmentsTitleId}>
            <div className={styles.groupHeader}>
              <h3 className={styles.groupTitle} id={departmentsTitleId}>Departments</h3>
              {props.departments.status === "ready" ? <span className={styles.count}>{props.departments.items.length}</span> : null}
            </div>
            <ReadContent
              read={props.departments}
              resource="department"
              unavailableTitle="Department list unavailable"
              errorTitle="Departments could not load"
              emptyTitle="No departments yet"
              emptyDescription="Add departments to keep onboarding and people records consistent."
            >
              {(items) => <DepartmentList departments={items} />}
            </ReadContent>
          </section>
        </div>

        {props.canManageOrganization ? (
          <aside className={styles.actions} aria-label="Organisation structure actions">
            <h3 className={styles.actionsTitle}>Add to your organisation</h3>
            {officeCreateAllowed ? (
              <OfficeForm onCreate={props.onCreateOffice} />
            ) : (
              <StateMessage kind="warning" title="Office creation needs another grant">
                Creating an office also saves its attendance geofence. An organisation administrator needs both organisation settings and office geofence management access.
              </StateMessage>
            )}
            <DepartmentForm onCreate={props.onCreateDepartment} />
          </aside>
        ) : null}
      </div>
    </section>
  );
}

function countLabel<T>(read: OrganizationReadState<T>, singular: string, plural: string): ReactNode {
  if (read.status !== "ready") return <><strong>—</strong> {plural}</>;
  const count = read.items.length;
  return <><strong>{count}</strong> {count === 1 ? singular : plural}</>;
}

function ReadContent<T>({
  read,
  resource,
  unavailableTitle,
  errorTitle,
  emptyTitle,
  emptyDescription,
  children,
}: {
  read: OrganizationReadState<T>;
  resource: string;
  unavailableTitle: string;
  errorTitle: string;
  emptyTitle: string;
  emptyDescription: string;
  children: (items: ReadonlyArray<T>) => ReactNode;
}) {
  switch (read.status) {
    case "loading":
      return <StateMessage kind="loading" title={`Loading ${resource}s`}>Reading organisation records.</StateMessage>;
    case "unavailable":
      return <StateMessage kind="info" title={unavailableTitle}>{read.message || `The ${resource} list is not available.`}</StateMessage>;
    case "error":
      return <StateMessage kind="error" title={errorTitle}>{read.message || `The ${resource} list could not be loaded.`}</StateMessage>;
    case "ready":
      return read.items.length
        ? children(read.items)
        : <div className={styles.empty}><strong>{emptyTitle}</strong><p>{emptyDescription}</p></div>;
  }
}

function OfficeList({ offices }: { offices: ReadonlyArray<OrganizationOfficeSummary> }) {
  return (
    <ul className={styles.officeList} aria-label="Offices">
      {offices.map((office) => {
        const hasGeofence = office.latitude !== null && office.longitude !== null;
        return (
          <li className={styles.officeRow} key={office.id}>
            <div className={styles.recordMain}>
              <strong className={styles.recordName}>{office.name}</strong>
              <span className={styles.recordDetail}>{office.location || "No location label"}</span>
            </div>
            <div className={styles.recordMeta}>
              <span>{office.timezone}</span>
              <span>{hasGeofence ? `Geofence · ${office.geofenceRadiusMeters} m` : "Geofence not configured"}</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function DepartmentList({ departments }: { departments: ReadonlyArray<OrganizationDepartmentSummary> }) {
  return (
    <ul className={styles.departmentList} aria-label="Departments">
      {departments.map((department) => (
        <li className={styles.departmentRow} key={department.id}>{department.name}</li>
      ))}
    </ul>
  );
}

function OfficeForm({ onCreate }: { onCreate: OrganizationStructureProps["onCreateOffice"] }) {
  const id = useId();
  const pending = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const input: CreateOrganizationOfficeInput = {
      name: String(values.get("name") || "").trim(),
      location: String(values.get("location") || "").trim(),
      timezone: String(values.get("timezone") || "").trim(),
      latitude: Number(values.get("latitude")),
      longitude: Number(values.get("longitude")),
      geofenceRadiusMeters: Number(values.get("geofenceRadiusMeters")),
    };
    pending.current = true;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await onCreate(input);
      form.reset();
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The office could not be created. Review the fields and try again.");
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={submit} aria-labelledby={`${id}-title`}>
      <div className={styles.formHeader}>
        <h4 className={styles.formTitle} id={`${id}-title`}>Create office</h4>
        <p className={styles.formDescription}>Location and attendance boundary are set together.</p>
      </div>
      <div className={styles.fields}>
        <Field label="Office name" required>
          {(control) => <Input {...control} name="name" autoComplete="organization-title" maxLength={180} required />}
        </Field>
        <Field label="Location" required hint="For example, Bengaluru, India.">
          {(control) => <Input {...control} name="location" autoComplete="address-level2" maxLength={320} required />}
        </Field>
        <Field label="IANA timezone" required hint="For example, Asia/Kolkata.">
          {(control) => <Input {...control} name="timezone" autoComplete="off" maxLength={120} required />}
        </Field>
        <Field label="Latitude" required hint="−90 to 90">
          {(control) => <Input {...control} name="latitude" type="number" inputMode="decimal" min={-90} max={90} step="any" required />}
        </Field>
        <Field label="Longitude" required hint="−180 to 180">
          {(control) => <Input {...control} name="longitude" type="number" inputMode="decimal" min={-180} max={180} step="any" required />}
        </Field>
        <Field label="Attendance radius (metres)" required hint="10–100,000 metres">
          {(control) => <Input {...control} name="geofenceRadiusMeters" type="number" inputMode="numeric" min={10} max={100000} step={1} defaultValue={150} required />}
        </Field>
      </div>
      <div className={styles.formFooter}>
        <Button type="submit" loading={saving} loadingLabel="Creating office…">Create office</Button>
      </div>
      {error ? <StateMessage kind="error" title="Office was not created">{error}</StateMessage> : null}
      {saved ? <StateMessage kind="success" title="Office created">The office record and geofence were saved.</StateMessage> : null}
    </form>
  );
}

function DepartmentForm({ onCreate }: { onCreate: OrganizationStructureProps["onCreateDepartment"] }) {
  const id = useId();
  const pending = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const input: CreateOrganizationDepartmentInput = { name: String(values.get("name") || "").trim() };
    pending.current = true;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await onCreate(input);
      form.reset();
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The department could not be created. Review the name and try again.");
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  return (
    <form className={styles.departmentForm} onSubmit={submit} aria-labelledby={`${id}-title`}>
      <div className={styles.formHeader}>
        <h4 className={styles.formTitle} id={`${id}-title`}>Create department</h4>
      </div>
      <Field label="Department name" required>
        {(control) => <Input {...control} name="name" autoComplete="organization-title" maxLength={180} required />}
      </Field>
      <div className={styles.formFooter}>
        <Button type="submit" variant="secondary" loading={saving} loadingLabel="Creating department…">Create department</Button>
      </div>
      {error ? <StateMessage kind="error" title="Department was not created">{error}</StateMessage> : null}
      {saved ? <StateMessage kind="success" title="Department created">The department is ready to use.</StateMessage> : null}
    </form>
  );
}
