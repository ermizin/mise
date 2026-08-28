export type IconName =
  | "calendar" | "pot" | "basket" | "person" | "plus" | "minus" | "close" | "chevron"
  | "check" | "clock" | "sun" | "moon" | "apple" | "cup" | "leaf" | "wallet"
  | "target" | "container" | "snowflake" | "info" | "search" | "bell" | "sparkles";

const iconPaths: Record<IconName, string[]> = {
  calendar: ["M4 7.5A2.5 2.5 0 0 1 6.5 5h11A2.5 2.5 0 0 1 20 7.5v10A2.5 2.5 0 0 1 17.5 20h-11A2.5 2.5 0 0 1 4 17.5z", "M4 10h16", "M8.5 3v4", "M15.5 3v4"],
  pot: ["M5 10h14v5.5A3.5 3.5 0 0 1 15.5 19h-7A3.5 3.5 0 0 1 5 15.5z", "M3 12h2", "M19 12h2", "M9.5 3.5c0 1.6 1 1.6 1 3", "M14 3.5c0 1.6 1 1.6 1 3"],
  basket: ["M4 9h16l-1.4 9.1A2 2 0 0 1 16.6 20H7.4a2 2 0 0 1-2-1.9z", "M8.5 9 12 3.5 15.5 9", "M10 13v3", "M14 13v3"],
  person: ["M12 12.5a4.2 4.2 0 1 0 0-8.5 4.2 4.2 0 0 0 0 8.5z", "M4.8 20.5c0-3.5 3.2-5.8 7.2-5.8s7.2 2.3 7.2 5.8"],
  plus: ["M12 5.5v13", "M5.5 12h13"],
  minus: ["M5.5 12h13"],
  close: ["M6 6l12 12", "M18 6 6 18"],
  chevron: ["m9.5 5.5 6.5 6.5-6.5 6.5"],
  check: ["m5 12.5 4.6 4.6L19 7.5"],
  clock: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M12 7.2v5.1l3.4 2"],
  sun: ["M12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9z", "M12 2v2", "M12 20v2", "M4.9 4.9l1.4 1.4", "M17.7 17.7l1.4 1.4", "M2 12h2", "M20 12h2", "M4.9 19.1l1.4-1.4", "M17.7 6.3l1.4-1.4"],
  moon: ["M20 15.2A8.5 8.5 0 0 1 8.8 4 8.5 8.5 0 1 0 20 15.2z"],
  apple: ["M12 7c-2.7-2.2-7-1-7 3.7 0 4.7 3.2 9.3 6 9.3s6-4.6 6-9.3C17 6 14.7 4.8 12 7z", "M12 7c0-2 1.1-3.4 3.2-4", "M11.7 4.7C10.3 3.2 8.8 3 7.5 3.4"],
  cup: ["M5 7h12v7a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5z", "M17 9h1.5a2.5 2.5 0 0 1 0 5H17", "M8 3.5v1.2", "M12 3.5v1.2"],
  leaf: ["M19.5 4.5C12 4.5 6 7 6 13.3c0 3.7 2.4 6.2 6 6.2 6.3 0 7.5-8.2 7.5-15z", "M6 20c2.3-4.7 5.6-7.8 10-10"],
  wallet: ["M4 7.5h15a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h12", "M16 12h5", "M17.5 15h.1"],
  target: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z", "M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z"],
  container: ["M5 8h14l-1 12H6z", "M4 5h16", "M9 5V3h6v2"],
  snowflake: ["M12 3v18", "m7 6 10 12", "m17 6-10 12", "m9.5 4.5 2.5 2 2.5-2", "m9.5 19.5 2.5-2 2.5 2", "m4.7 8.5 3.2.4.5-3", "m19.3 15.5-3.2-.4-.5 3"],
  info: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M12 10.5v6", "M12 7.5h.01"],
  search: ["M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15z", "m16 16 5 5"],
  bell: ["M6 17h12l-1.5-2v-4a4.5 4.5 0 0 0-9 0v4z", "M10 20h4"],
  sparkles: ["m12 3 1.3 4.1L17 8.5l-3.7 1.4L12 14l-1.3-4.1L7 8.5l3.7-1.4z", "m18.5 14 .7 2.2 2.3.8-2.3.8-.7 2.2-.7-2.2-2.3-.8 2.3-.8z"],
};

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return <svg className={className ? `icon ${className}` : "icon"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false">{iconPaths[name].map((d) => <path key={d} d={d} />)}</svg>;
}
