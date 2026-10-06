export type SavedTaskViewCollection = "mine" | "visible";
export type SavedTaskViewsReadStatus = "loading" | "error" | "ready";

export interface SavedTaskView {
  id: string;
  name: string;
  collection: SavedTaskViewCollection;
  status: string;
  due: string;
  search: string;
  revision: number;
  sortOrder?: number;
}

export interface SavedTaskViewFilters {
  status: string;
  due: string;
  search: string;
}

export type SavedTaskViewsPendingAction = "retry" | "open" | "update" | "create" | null;

export interface SavedTaskViewsActionErrorProps {
  formatError?: (error: unknown) => string;
  /** The host may consume protected-command failures and refresh auth state. */
  onFailure?: (error: unknown, source: HTMLButtonElement) => boolean;
}

export interface WorkSavedTaskViewsProps extends SavedTaskViewsActionErrorProps {
  views: readonly SavedTaskView[];
  collection: SavedTaskViewCollection;
  filters: SavedTaskViewFilters;
  readStatus: SavedTaskViewsReadStatus;
  availableCollections: readonly SavedTaskViewCollection[];
  atLimit: boolean;
  pendingAction?: SavedTaskViewsPendingAction;
  onOpen: (view: SavedTaskView) => void | Promise<void>;
  onCreate: (name: string) => void | Promise<void>;
  onUpdate: (view: SavedTaskView) => void | Promise<void>;
  onRetry: () => void | Promise<void>;
}

export interface SettingsSavedTaskViewsProps extends SavedTaskViewsActionErrorProps {
  views: readonly SavedTaskView[];
  availableCollections: readonly SavedTaskViewCollection[];
  readStatus: SavedTaskViewsReadStatus;
  pendingAction?: "retry" | "delete" | "rename" | null;
  pendingDeleteId?: string | null;
  pendingRenameId?: string | null;
  onDelete: (view: SavedTaskView) => void | Promise<void>;
  /** Return false when the host refreshed a stale view instead of saving it. */
  onRename: (view: SavedTaskView) => boolean | void | Promise<boolean | void>;
  onRetry: () => void | Promise<void>;
}
