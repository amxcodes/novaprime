const paths: Record<string, string> = {
  today: "M12 7v5l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z",
  work: "M4 7.5h16v12H4zM8 7.5V5h8v2.5M4 12h16M10 12v2h4v-2",
  availability: "M5 4v3m14-3v3M4 8h16v12H4zM8 12h3v3H8z",
  people: "M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20m6-8a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm6-6.7a3.5 3.5 0 0 1 0 6.8m1.5 3.7A3.5 3.5 0 0 1 20 19v1",
  notifications: "M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 12h4",
  operations: "M4 19V9m5 10V5m6 14v-7m5 7H2",
  admin: "M12 3 20 6v5c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6l8-3Zm-3 9 2 2 4-4",
  invite: "M12 5v14m-7-7h14",
  "work-setup": "M4 6h16M4 12h16M4 18h16M8 4v4m8 2v4m-5 2v4",
  settings: "M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm0-6v2m0 15v2m9-9h-2M5 12H3m15.36-6.36-1.42 1.42M7.06 16.94l-1.42 1.42m12.72 0-1.42-1.42M7.06 7.06 5.64 5.64",
};

export function NavigationIcon({ destination }: { destination: string }) {
  const d = paths[destination] ?? "M5 12h14M12 5v14";
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={d} />
    </svg>
  );
}
