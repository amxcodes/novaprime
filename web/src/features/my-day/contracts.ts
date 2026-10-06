/** A page module whose content and visibility were selected by the route host. */
export type MyDayModuleId = "attendance" | "assignments" | "timeline" | "leave" | "wfh";

export interface MyDayCardModule {
  id: "attendance" | "assignments" | "timeline";
  presentation: "card";
  title: string;
  description: string;
  wide?: boolean;
}

export interface MyDayIslandModule {
  id: "leave" | "wfh";
  presentation: "island";
}

export type MyDayModule = MyDayCardModule | MyDayIslandModule;

export interface MyDayPageProps {
  /** Ordered, authorized modules. The component does not infer grants or preferences. */
  modules: readonly MyDayModule[];
  onCustomize: () => void;
}
