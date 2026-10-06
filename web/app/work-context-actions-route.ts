import type { WorkContextDepartmentFeatureData } from "../src/features/work-context/client-department-projection.ts";

type Permission = (latest: WorkContextDepartmentFeatureData | null | undefined) => boolean;
type PermissionTarget = { clientId: string };
type RequestOptions = (method: string, payload?: unknown) => RequestInit;
type Api = (path: string, options: RequestInit) => Promise<unknown>;
type RunWorkSetupCommand = (
  source: Element,
  lifetime: unknown,
  work: () => Promise<unknown>,
  resource: string,
) => Promise<unknown>;

interface WorkContextDepartmentCommandServices {
  target: Element;
  lifetime: unknown;
  getPermissionData: () => WorkContextDepartmentFeatureData;
  runWorkSetupCommand: RunWorkSetupCommand;
  api: Api;
  requestOptions: RequestOptions;
  permissionDeniedError: () => Error;
  setMessage: (message: string) => void;
}

/** Bind the Work Context department command to the route's live grants and shared command guard. */
export function createWorkContextDepartmentCommandAction(services: WorkContextDepartmentCommandServices) {
  const {
    target,
    lifetime,
    getPermissionData,
    runWorkSetupCommand,
    api,
    requestOptions,
    permissionDeniedError,
    setMessage,
  } = services;

  return (
    permission: Permission,
    _permissionTarget: PermissionTarget,
    method: string,
    path: string,
    payload: unknown,
    successMessage: string,
  ): Promise<unknown> => runWorkSetupCommand(
    target,
    lifetime,
    () => {
      if (!permission(getPermissionData())) throw permissionDeniedError();
      return api(path, requestOptions(method, payload));
    },
    "Work",
  ).then((result) => {
    setMessage(successMessage);
    return result;
  });
}
