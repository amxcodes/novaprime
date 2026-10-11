export type WorkAreaId = "my-work" | "tasks" | "reviews" | "requests" | "reviewer-management" | "context";

export interface WorkArea {
  id: WorkAreaId;
  label: string;
  title: string;
  description: string;
  features: readonly string[];
  sections: readonly string[];
}

export function getAvailableWorkAreas(readPlan: Readonly<Record<string, unknown>>, canCreateTasks?: boolean): WorkArea[];
export function resolveWorkAreaId(requestedId: string | null | undefined, availableAreas: readonly WorkArea[]): WorkAreaId | null;
export function isWorkReadIncludedInArea(readKey: string, areaId: WorkAreaId | null, canCreateTasks?: boolean): boolean;
export function isWorkFeatureIncludedInArea(feature: string, areaId: WorkAreaId | null, readPlan: Readonly<Record<string, unknown>>, canCreateTasks?: boolean): boolean;
export function workAreaHref(currentHref: string, areaId: WorkAreaId): string;
