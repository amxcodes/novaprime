import { useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Button, EmptyState, Field, Input, SearchableSelect, SectionHeading, StateMessage } from "../../design-system";
import styles from "./AdminAvailabilityConfiguration.module.css";
import type {
  AdminAvailabilityConfigurationProps,
  AvailabilityCalendar,
  AvailabilityHoliday,
  AvailabilityOfficeOption,
  AvailabilityReadState,
  AvailabilityResource,
  AvailabilityShift,
} from "./admin-configuration-contracts";
import {
  AVAILABILITY_WEEKDAYS,
  acquireAvailabilityMutation,
  buildCalendarRequest,
  buildHolidayRequest,
  buildShiftRequest,
  defaultCalendarRules,
  releaseAvailabilityMutation,
  type CalendarDraft,
  type HolidayDraft,
  type ShiftDraft,
} from "./admin-configuration-model";

const defaultShift: ShiftDraft = {
  name: "",
  startLocalTime: "09:30",
  endLocalTime: "18:30",
  breakStartLocalTime: "13:00",
  breakEndLocalTime: "14:00",
  graceMinutes: "0",
  overtimeEnabled: false,
};

function ResourceReadState<T>({
  read,
  label,
  children,
}: {
  read: AvailabilityReadState<T>;
  label: string;
  children: (data: readonly T[]) => ReactNode;
}) {
  if (read.status !== "ready") {
    return (
      <StateMessage kind={read.status === "denied" ? "warning" : "error"} title={`${label} unavailable`}>
        {read.message}
      </StateMessage>
    );
  }
  return <>{children(read.data)}</>;
}

function ResourceError({ read, label }: { read: AvailabilityReadState<unknown>; label: string }) {
  return read.status === "ready" ? null : (
    <StateMessage kind={read.status === "denied" ? "warning" : "error"} title={`${label} unavailable`}>
      {read.message}
    </StateMessage>
  );
}

function SubmitFeedback({ message, error }: { message: string; error: boolean }) {
  if (!message) return null;
  return <StateMessage kind={error ? "error" : "success"}>{message}</StateMessage>;
}

function ShiftConfiguration({
  resource,
  onCreate,
}: {
  resource: AvailabilityResource<AvailabilityShift>;
  onCreate: AdminAvailabilityConfigurationProps["onCreateShift"];
}) {
  const id = useId();
  const [draft, setDraft] = useState(defaultShift);
  const [pending, setPending] = useState(false);
  const mutationLock = useRef(false);
  const [attempted, setAttempted] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; error: boolean }>({ message: "", error: false });
  if (!resource.visible) return null;

  const set = <K extends keyof ShiftDraft>(key: K, value: ShiftDraft[K]) => {
    setDraft((previous) => ({ ...previous, [key]: value }));
    setAttempted(false);
    setFeedback({ message: "", error: false });
  };
  const setShiftTime = (key: "startLocalTime" | "endLocalTime", value: string) => {
    setDraft((previous) => {
      const next = { ...previous, [key]: value };
      return next.endLocalTime < next.startLocalTime
        ? { ...next, breakStartLocalTime: "", breakEndLocalTime: "" }
        : next;
    });
    setAttempted(false);
    setFeedback({ message: "", error: false });
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAttempted(true);
    const request = buildShiftRequest(draft);
    if (!request) {
      setFeedback({
        message: "Check the shift times, paired break times, and grace period. Breaks cannot be used on an overnight shift.",
        error: true,
      });
      return;
    }
    if (!acquireAvailabilityMutation(mutationLock)) return;
    setPending(true);
    setFeedback({ message: "", error: false });
    try {
      await onCreate(request);
      setDraft(defaultShift);
      setFeedback({ message: "Shift created.", error: false });
    } catch (error) {
      setFeedback({ message: error instanceof Error ? error.message : "Could not create the shift.", error: true });
    } finally {
      releaseAvailabilityMutation(mutationLock);
      setPending(false);
    }
  };

  const overnight = draft.endLocalTime < draft.startLocalTime;
  const invalidShiftRange = attempted && Boolean(draft.startLocalTime) && draft.startLocalTime === draft.endLocalTime;
  const hasBreakStart = Boolean(draft.breakStartLocalTime);
  const hasBreakEnd = Boolean(draft.breakEndLocalTime);
  const invalidBreak = attempted && (hasBreakStart !== hasBreakEnd || (hasBreakStart && (
    overnight ||
    draft.breakStartLocalTime < draft.startLocalTime ||
    draft.breakEndLocalTime <= draft.breakStartLocalTime ||
    draft.breakEndLocalTime > draft.endLocalTime
  )));
  return (
    <section className={[styles.panel, styles.shiftPanel].join(" ")} aria-labelledby={`${id}-heading`}>
      <SectionHeading level={3} title={<span id={`${id}-heading`}>Shifts</span>} description="Reusable local-time schedules for working calendar days." />
      {resource.canManage ? (
        <form className={styles.form} onSubmit={submit}>
          <div className={styles.shiftFields}>
            <InputField label="Shift name" name="shift-name" value={draft.name} onChange={(value) => set("name", value)} required />
            <InputField label="Start (local time)" name="shift-start" type="time" value={draft.startLocalTime} onChange={(value) => setShiftTime("startLocalTime", value)} required error={invalidShiftRange ? "Start and end times must differ." : undefined} />
            <InputField label="End (local time)" name="shift-end" type="time" value={draft.endLocalTime} onChange={(value) => setShiftTime("endLocalTime", value)} required error={invalidShiftRange ? "Start and end times must differ." : undefined} />
            <InputField label="Break start" name="shift-break-start" type="time" value={draft.breakStartLocalTime} onChange={(value) => set("breakStartLocalTime", value)} disabled={overnight} error={invalidBreak ? "Enter both break times within the shift, or leave both blank." : undefined} />
            <InputField label="Break end" name="shift-break-end" type="time" value={draft.breakEndLocalTime} onChange={(value) => set("breakEndLocalTime", value)} disabled={overnight} />
            <InputField label="Grace minutes" name="shift-grace" type="number" min={0} max={720} step={1} value={draft.graceMinutes} onChange={(value) => set("graceMinutes", value)} required />
          </div>
          {overnight ? <p className={styles.formHint}>This end time makes the shift run overnight. Break times are unavailable for overnight shifts.</p> : null}
          <label className={styles.checkboxRow}>
            <input type="checkbox" checked={draft.overtimeEnabled} onChange={(event) => set("overtimeEnabled", event.currentTarget.checked)} />
            <span>Overtime may be recorded</span>
          </label>
          <SubmitFeedback {...feedback} />
          <div className={styles.actions}>
            <Button type="submit" loading={pending} loadingLabel="Creating shift">Create shift</Button>
          </div>
        </form>
      ) : null}

      {resource.read.status !== "ready" ? <ResourceError read={resource.read} label="Shift list" /> : (
        <ResourceReadState read={resource.read} label="Shift list">
          {(shifts) => shifts.length ? (
            <ul className={styles.itemList} aria-label="Configured shifts">
              {shifts.map((shift) => (
                <li className={styles.item} key={shift.id}>
                  <strong>{shift.name}</strong>
                  <span>{shift.startLocalTime}–{shift.endLocalTime}{shift.spansMidnight ? " · overnight" : ""}</span>
                  <span>Grace {shift.graceMinutes} min{shift.overtimeEnabled ? " · overtime enabled" : ""}</span>
                </li>
              ))}
            </ul>
          ) : <EmptyState title="No shifts configured" description="Add a shift before assigning working days to a calendar." />}
        </ResourceReadState>
      )}
    </section>
  );
}

function CalendarConfiguration({
  resource,
  offices,
  shiftTargets,
  onCreate,
  searchOffices,
  searchShifts,
}: {
  resource: AvailabilityResource<AvailabilityCalendar>;
  offices: AvailabilityReadState<AvailabilityOfficeOption>;
  shiftTargets: AdminAvailabilityConfigurationProps["shiftTargets"];
  onCreate: AdminAvailabilityConfigurationProps["onCreateCalendar"];
  searchOffices: AdminAvailabilityConfigurationProps["searchOffices"];
  searchShifts: AdminAvailabilityConfigurationProps["searchShifts"];
}) {
  const id = useId();
  const [draft, setDraft] = useState<CalendarDraft>(() => ({
    name: "",
    officeId: "",
    effectiveOn: "",
    rules: defaultCalendarRules(),
  }));
  const [pending, setPending] = useState(false);
  const mutationLock = useRef(false);
  const [feedback, setFeedback] = useState<{ message: string; error: boolean }>({ message: "", error: false });
  if (!resource.visible) return null;

  const officesReady = offices.status === "ready";
  const shiftsReady = shiftTargets.visible && shiftTargets.read.status === "ready";
  const targetsReady = officesReady && shiftsReady;
  const update = <K extends keyof CalendarDraft>(key: K, value: CalendarDraft[K]) => {
    setDraft((previous) => ({ ...previous, [key]: value }));
    setFeedback({ message: "", error: false });
  };
  const updateRule = (weekday: number, changes: Partial<CalendarDraft["rules"][number]>) => {
    update("rules", draft.rules.map((rule) => rule.weekday === weekday
      ? { ...rule, ...changes, ...(changes.isWorking === false ? { shiftId: "" } : {}) }
      : rule));
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const request = buildCalendarRequest(draft);
    if (!request) {
      setFeedback({ message: "Choose an office and a shift for every working day, then check the effective date.", error: true });
      return;
    }
    if (!acquireAvailabilityMutation(mutationLock)) return;
    setPending(true);
    setFeedback({ message: "", error: false });
    try {
      await onCreate(request);
      setDraft((previous) => ({ ...previous, name: "", rules: defaultCalendarRules() }));
      setFeedback({ message: "Working calendar created and assigned to the office.", error: false });
    } catch (error) {
      setFeedback({ message: error instanceof Error ? error.message : "Could not create the working calendar.", error: true });
    } finally {
      releaseAvailabilityMutation(mutationLock);
      setPending(false);
    }
  };

  return (
    <section className={[styles.panel, styles.calendarPanel].join(" ")} aria-labelledby={`${id}-heading`}>
      <SectionHeading level={3} title={<span id={`${id}-heading`}>Working calendars</span>} description="Assign a calendar to an office from an effective date. A new assignment replaces the office’s current calendar from that date." />
      {resource.canManage ? (
        <div className={styles.calendarContent}>
          <div className={styles.targetStates}>
            {offices.status !== "ready" ? <ResourceError read={offices} label="Office choices" /> : null}
            {!shiftTargets.visible ? (
              <StateMessage kind="warning" title="Shift choices unavailable">The host did not provide shift targets for calendar setup.</StateMessage>
            ) : shiftTargets.read.status !== "ready" ? <ResourceError read={shiftTargets.read} label="Shift choices" /> : null}
          </div>
          {targetsReady ? (
            <form className={styles.form} onSubmit={submit}>
              <div className={styles.calendarFields}>
                <InputField label="Calendar name" name="calendar-name" value={draft.name} onChange={(value) => update("name", value)} required />
                <SearchableSelect
                  label="Office"
                  name="officeId"
                  value={draft.officeId}
                  options={[]}
                  searchMode="remote"
                  onSearch={(query) => searchOffices("calendar", query)}
                  searchErrorMessage="Office choices could not be loaded. Edit the search to try again."
                  placeholder="Choose office"
                  emptyMessage="No available offices match this search."
                  hint="Search offices available for calendar management."
                  clearLabel="Clear office selection"
                  required
                  onChange={(value) => update("officeId", value)}
                />
                <InputField label="Effective from" name="calendar-effective-on" type="date" value={draft.effectiveOn} onChange={(value) => update("effectiveOn", value)} required />
              </div>
              <fieldset className={styles.weekFieldset}>
                <legend>Weekly rules</legend>
                <p className={styles.formHint}>Choose a shift for each working day. Days marked off will not require attendance.</p>
                <div className={styles.weekGrid}>
                  {draft.rules.map((rule) => {
                    const day = AVAILABILITY_WEEKDAYS[rule.weekday] || `Day ${rule.weekday}`;
                    return (
                      <div className={styles.weekRow} key={rule.weekday}>
                        <strong className={styles.weekday}>{day}</strong>
                        <label className={styles.checkboxRow}>
                          <input type="checkbox" aria-label={`${day} is a working day`} checked={rule.isWorking} onChange={(event) => updateRule(rule.weekday, { isWorking: event.currentTarget.checked })} />
                          <span>Working</span>
                        </label>
                        <SearchableSelect
                          id={`${id}-shift-${rule.weekday}`}
                          label={`Shift for ${day}`}
                          value={rule.shiftId}
                          options={[]}
                          searchMode="remote"
                          onSearch={searchShifts}
                          searchErrorMessage="Shift choices could not be loaded. Edit the search to try again."
                          placeholder="Choose shift"
                          emptyMessage="No available shifts match this search."
                          hint="Search active shifts available to this calendar."
                          clearLabel={`Clear shift for ${day}`}
                          disabled={!rule.isWorking}
                          required={rule.isWorking}
                          onChange={(value) => updateRule(rule.weekday, { shiftId: value })}
                        />
                      </div>
                    );
                  })}
                </div>
              </fieldset>
              <SubmitFeedback {...feedback} />
              <div className={styles.actions}>
                <Button type="submit" loading={pending} loadingLabel="Creating calendar">Create calendar</Button>
              </div>
            </form>
          ) : null}
        </div>
      ) : null}

      {resource.read.status !== "ready" ? <ResourceError read={resource.read} label="Calendar list" /> : (
        <ResourceReadState read={resource.read} label="Calendar list">
          {(calendars) => calendars.length ? (
            <ul className={styles.itemList} aria-label="Assigned working calendars">
              {calendars.map((calendar) => (
                <li className={styles.item} key={calendar.id}>
                  <strong>{calendar.name}</strong>
                  <span>{calendar.office.name} · effective {calendar.effectiveOn}</span>
                  <span>{calendar.rules.filter((rule) => rule.isWorking).length} working days per week</span>
                </li>
              ))}
            </ul>
          ) : <EmptyState title="No working calendars assigned" description="Assigned office calendars will appear here." />}
        </ResourceReadState>
      )}
    </section>
  );
}

function HolidayConfiguration({
  resource,
  offices,
  onCreate,
  searchOffices,
}: {
  resource: AvailabilityResource<AvailabilityHoliday>;
  offices: AvailabilityReadState<AvailabilityOfficeOption>;
  onCreate: AdminAvailabilityConfigurationProps["onCreateHoliday"];
  searchOffices: AdminAvailabilityConfigurationProps["searchOffices"];
}) {
  const id = useId();
  const [draft, setDraft] = useState<HolidayDraft>({ name: "", date: "", officeId: "" });
  const [pending, setPending] = useState(false);
  const mutationLock = useRef(false);
  const [feedback, setFeedback] = useState<{ message: string; error: boolean }>({ message: "", error: false });
  if (!resource.visible) return null;
  const officesReady = offices.status === "ready";
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const request = buildHolidayRequest(draft);
    if (!request) {
      setFeedback({ message: "Choose an office and enter a valid holiday name and date.", error: true });
      return;
    }
    if (!acquireAvailabilityMutation(mutationLock)) return;
    setPending(true);
    setFeedback({ message: "", error: false });
    try {
      await onCreate(request);
      setDraft({ name: "", date: "", officeId: "" });
      setFeedback({ message: "Holiday added.", error: false });
    } catch (error) {
      setFeedback({ message: error instanceof Error ? error.message : "Could not add the holiday.", error: true });
    } finally {
      releaseAvailabilityMutation(mutationLock);
      setPending(false);
    }
  };

  return (
    <section className={[styles.panel, styles.holidayPanel].join(" ")} aria-labelledby={`${id}-heading`}>
      <SectionHeading level={3} title={<span id={`${id}-heading`}>Office holidays</span>} description="Mark an office date as closed. The server reconciles attendance for the selected date." />
      {resource.canManage ? (
        officesReady ? (
          <form className={styles.form} onSubmit={submit}>
            <div className={styles.holidayFields}>
              <InputField label="Holiday name" name="holiday-name" value={draft.name} onChange={(value) => { setDraft((current) => ({ ...current, name: value })); setFeedback({ message: "", error: false }); }} required />
              <InputField label="Date" name="holiday-date" type="date" value={draft.date} onChange={(value) => { setDraft((current) => ({ ...current, date: value })); setFeedback({ message: "", error: false }); }} required />
              <SearchableSelect
                label="Office"
                name="holiday-office"
                value={draft.officeId}
                options={[]}
                searchMode="remote"
                onSearch={(query) => searchOffices("holiday", query)}
                searchErrorMessage="Office choices could not be loaded. Edit the search to try again."
                placeholder="Choose office"
                emptyMessage="No available offices match this search."
                hint="Search offices available for holiday management."
                clearLabel="Clear office selection"
                required
                onChange={(value) => { setDraft((current) => ({ ...current, officeId: value })); setFeedback({ message: "", error: false }); }}
              />
            </div>
            <SubmitFeedback {...feedback} />
            <div className={styles.actions}>
              <Button type="submit" loading={pending} loadingLabel="Adding holiday">Add holiday</Button>
            </div>
          </form>
        ) : <ResourceError read={offices} label="Office choices" />
      ) : null}

      {resource.read.status !== "ready" ? <ResourceError read={resource.read} label="Holiday list" /> : (
        <ResourceReadState read={resource.read} label="Holiday list">
          {(holidays) => holidays.length ? (
            <ul className={styles.itemList} aria-label="Office holidays">
              {holidays.map((holiday) => (
                <li className={styles.item} key={holiday.id}>
                  <strong>{holiday.date} · {holiday.name}</strong>
                  <span>{holiday.office.name}</span>
                </li>
              ))}
            </ul>
          ) : <EmptyState title="No holidays configured" description="Office holidays will appear here after they are added." />}
        </ResourceReadState>
      )}
    </section>
  );
}

function InputField({
  label,
  name,
  value,
  onChange,
  type = "text",
  required,
  disabled,
  min,
  max,
  step,
  error,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "time" | "date" | "number";
  required?: boolean;
  disabled?: boolean;
  min?: number;
  max?: number;
  step?: number;
  error?: string;
}) {
  return (
    <Field label={label} required={required} error={error}>
      {(control) => (
        <Input
          {...control}
          name={name}
          type={type}
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
          disabled={disabled}
          min={min}
          max={max}
          step={step}
        />
      )}
    </Field>
  );
}

export function AdminAvailabilityConfiguration(props: AdminAvailabilityConfigurationProps) {
  const visibleCount = Number(props.shifts.visible) + Number(props.calendars.visible) + Number(props.holidays.visible);
  if (visibleCount === 0) return null;
  return (
    <div className={styles.configuration}>
      <SectionHeading
        title="Availability configuration"
        description="Set reusable shifts, office working calendars, and holiday closures. Each section follows the access granted by your administrator."
      />
      <div className={styles.resourceGrid}>
        <ShiftConfiguration resource={props.shifts} onCreate={props.onCreateShift} />
        <HolidayConfiguration
          resource={props.holidays}
          offices={props.offices}
          onCreate={props.onCreateHoliday}
          searchOffices={props.searchOffices}
        />
        <CalendarConfiguration
          resource={props.calendars}
          offices={props.offices}
          shiftTargets={props.shiftTargets}
          onCreate={props.onCreateCalendar}
          searchOffices={props.searchOffices}
          searchShifts={props.searchShifts}
        />
      </div>
    </div>
  );
}
