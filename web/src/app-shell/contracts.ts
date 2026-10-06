import type { ReactNode } from "react";

/**
 * The host builds navigation from its effective capability plan. Only allowed
 * destinations belong in these groups; this shell never evaluates grants.
 */
export interface AppNavigationItem {
  id: string;
  label: string;
  href: string;
  icon: ReactNode;
  external?: boolean;
}

export interface AppNavigationGroup {
  id: string;
  label?: string;
  items: readonly AppNavigationItem[];
}

export interface AppShellProps {
  brand: ReactNode;
  navigation: readonly AppNavigationGroup[];
  activeItemId?: string;
  currentPageLabel: string;
  children: ReactNode;
  headerActions?: ReactNode;
  sidebarFooter?: ReactNode;
  /** Explicit list of up to four granted items for the compact bottom bar. */
  mobilePrimaryIds?: readonly string[];
  /** Host route adapter; omit to retain ordinary anchor navigation. */
  onNavigate?: (item: AppNavigationItem) => void;
}
