import { useMemo } from "react";
import type { Event } from "../types/Event";
import { LogStream } from "../logs/LogStream";
import { eventToLogEntry } from "../logs/mapEvent";
import { useStore } from "../store/store";

export function RunLogs({ events, live }: { events: Event[]; live?: boolean }) {
  const selectSpan = useStore((s) => s.selectSpan);
  const entries = useMemo(() => events.map((e, i) => eventToLogEntry(e, i)), [events]);
  return (
    <LogStream
      entries={entries}
      live={live}
      onEntryClick={(e) => e.spanId && selectSpan(e.spanId)}
    />
  );
}
