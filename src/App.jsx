import { useState, useEffect, useRef } from "react";
import {
  LAST_UPDATED,
  SCHEDULES,
  MBTA_HOLIDAYS,
} from "./scheduleData";

const AVAILABLE_DATES = Object.keys(SCHEDULES).sort();

const parseLocalDate = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};

const formatDateLabel = (dateStr, todayStr) => {
  const date = parseLocalDate(dateStr);
  const today = parseLocalDate(todayStr);
  const diffDays = Math.round((date - today) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  return date.toLocaleDateString(undefined, { weekday: "short" });
};

const formatDateSub = (dateStr) => {
  const date = parseLocalDate(dateStr);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

const OUTBOUND_CROSSING_OFFSET = 2; // minutes before Porter
const INBOUND_CROSSING_OFFSET = 5; // minutes after Porter (inc. stop time + slower approach)

const addMinutes = (timeStr, mins) => {
  if (!timeStr) return null;
  const isPM_label = timeStr.includes("PM");
  const isAM_label = timeStr.includes("AM");
  let t = timeStr.replace(/ AM| PM/, "").trim();
  let [h, m] = t.split(":").map(Number);
  if (isPM_label && h !== 12) h += 12;
  if (isAM_label && h === 12) h = 0;
  let totalMin = h * 60 + m + mins;
  if (totalMin < 0) totalMin += 24 * 60;
  totalMin = totalMin % (24 * 60);
  const newH = Math.floor(totalMin / 60);
  const newM = totalMin % 60;
  const display12 = newH % 12 === 0 ? 12 : newH % 12;
  const ampm = newH < 12 ? "AM" : "PM";
  return `${display12}:${String(newM).padStart(2, "0")} ${ampm}`;
};

const getLocalDateStr = () => {
  const now = new Date();
  // Times before 4 AM belong to the previous service day, matching the
  // 4 AM cutoff used by nowMin and timeToMin. This keeps the displayed day
  // from rolling over at midnight while the schedule still shows the prior
  // day's late-night trains.
  now.setHours(now.getHours() - 4);
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const getHolidayNote = (dateStr) => MBTA_HOLIDAYS[dateStr] ?? null;

const isoToAmPm = (isoStr) => {
  const m = isoStr.match(/T(\d{2}):(\d{2})/);
  if (!m) return null;
  const h = Number(m[1]);
  const mm = m[2];
  const display12 = h % 12 === 0 ? 12 : h % 12;
  const ampm = h < 12 ? "AM" : "PM";
  return `${display12}:${mm} ${ampm}`;
};

const fetchPredictions = async (signal) => {
  const url = "https://api-v3.mbta.com/predictions?filter[route]=CR-Fitchburg&filter[stop]=place-portr&include=trip";
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`MBTA predictions: ${res.status}`);
  const body = await res.json();
  const tripNames = new Map();
  for (const inc of body.included || []) {
    if (inc.type === "trip") tripNames.set(inc.id, inc.attributes?.name);
  }
  const map = new Map();
  for (const p of body.data || []) {
    const tripId = p.relationships?.trip?.data?.id;
    const train = tripNames.get(tripId);
    if (!train) continue;
    const cancelled = p.attributes?.schedule_relationship === "CANCELLED";
    const iso = p.attributes?.arrival_time || p.attributes?.departure_time;
    const porter = iso ? isoToAmPm(iso) : null;
    if (!porter && !cancelled) continue;
    map.set(train, { porter, cancelled });
  }
  return map;
};

const timeToMin = (t) => {
  if (!t) return null;
  const [time, ampm] = t.split(" ");
  let [h, m] = time.split(":").map(Number);
  if (ampm === "PM" && h !== 12) h += 12;
  if (ampm === "AM" && h === 12) h = 0;
  const total = h * 60 + m;
  return total < 240 ? total + 24 * 60 : total;
};

export default function App() {
  const [todayStr, setTodayStr] = useState(getLocalDateStr);
  const initialDate = AVAILABLE_DATES.includes(todayStr) ? todayStr : AVAILABLE_DATES[0];
  const [selectedDate, setSelectedDate] = useState(initialDate);

  // Keep todayStr fresh in case the page sits open past the 4 AM rollover.
  useEffect(() => {
    const interval = setInterval(() => {
      const newToday = getLocalDateStr();
      setTodayStr((prev) => (prev === newToday ? prev : newToday));
    }, 60000);
    return () => clearInterval(interval);
  }, []);
  const [nowMin, setNowMin] = useState(() => {
    const n = new Date();
    const total = n.getHours() * 60 + n.getMinutes();
    return total < 240 ? total + 24 * 60 : total;
  });

  const [isDarkMode, setIsDarkMode] = useState(() => {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (e) => setIsDarkMode(e.matches);
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      const n = new Date();
      const total = n.getHours() * 60 + n.getMinutes();
      setNowMin(total < 240 ? total + 24 * 60 : total);
    }, 30000); // update every 30 seconds
    return () => clearInterval(interval);
  }, []);

  const isToday = selectedDate === todayStr;
  const [predictions, setPredictions] = useState(() => new Map());

  useEffect(() => {
    if (!isToday) {
      setPredictions(new Map());
      return;
    }
    const controller = new AbortController();
    const load = async () => {
      try {
        const map = await fetchPredictions(controller.signal);
        setPredictions(map);
      } catch (err) {
        if (err.name !== "AbortError") setPredictions(new Map());
      }
    };
    load();
    const interval = setInterval(load, 30000);
    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [isToday]);

  const [isScrolled, setIsScrolled] = useState(false);
  const nextTrainRef = useRef(null);
  const headerRef = useRef(null);
  const scrollContainerRef = useRef(null);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const onScroll = () => setIsScrolled(container.scrollTop > 0);
    container.addEventListener("scroll", onScroll);
    return () => container.removeEventListener("scroll", onScroll);
  }, []);

  const dayData = SCHEDULES[selectedDate];
  const outboundData = dayData?.outbound ?? [];
  const inboundData = dayData?.inbound ?? [];

  const decorate = (rows, offset, direction) => rows.map(r => {
    const live = predictions.get(r.train);
    const porter = live?.porter ?? r.porter;
    return {
      ...r,
      porter,
      isLive: !!live?.porter,
      cancelled: !!live?.cancelled,
      crossing: addMinutes(porter, offset),
      direction,
    };
  });
  const outboundRows = decorate(outboundData, -OUTBOUND_CROSSING_OFFSET, "→ Wachusett");
  const inboundRows = decorate(inboundData, INBOUND_CROSSING_OFFSET, "→ North Station");

  const allRows = [
    ...outboundRows.map(r => ({ ...r, dir: "out" })),
    ...inboundRows.map(r => ({ ...r, dir: "in" })),
  ].sort((a, b) => (timeToMin(a.crossing) ?? 9999) - (timeToMin(b.crossing) ?? 9999));

  // Identify the "next" non-passed row so the auto-scroll effect can re-fire
  // when predictions push the previously-passed train back into the future.
  let nextTrainKey = null;
  for (let i = 0; i < allRows.length; i++) {
    const r = allRows[i];
    const passed = isToday && (timeToMin(r.crossing) ?? 9999) < nowMin - 5;
    if (!passed) { nextTrainKey = `${r.dir}-${r.train}-${i}`; break; }
  }

  useEffect(() => {
    if (nextTrainRef.current && scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      const rowRect = nextTrainRef.current.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const top = container.scrollTop + rowRect.top - containerRect.top - 24;
      container.scrollTo({ top, behavior: "smooth" });
    }
  }, [selectedDate, nextTrainKey]);

  // Color scheme based on dark/light mode
  const colors = isDarkMode ? {
    bg: "#0f1117",
    bgSecondary: "#16191f",
    text: "#e8e4d9",
    textMuted: "#888",
    textDim: "#555",
    border: "#2a2f3a",
    borderSubtle: "#1e2330",
    accent: "#e8c96d",
    accentBg: "rgba(232,201,109,0.15)",
    accentBorder: "rgba(232,201,109,0.4)",
    outbound: "#5b9cf6",
    inbound: "#e87c5b",
    rowHoverBg: "rgba(255,255,255,0.04)",
  } : {
    bg: "#ffffff",
    bgSecondary: "#f5f5f5",
    text: "#1a1a1a",
    textMuted: "#666",
    textDim: "#999",
    border: "#d0d0d0",
    borderSubtle: "#e0e0e0",
    accent: "#d4a947",
    accentBg: "rgba(212,169,71,0.1)",
    accentBorder: "rgba(212,169,71,0.3)",
    outbound: "#0066cc",
    inbound: "#cc5522",
    rowHoverBg: "rgba(0,0,0,0.04)",
  };

  return (
    <div style={{
      height: "100vh",
      display: "flex",
      flexDirection: "column",
      background: colors.bg,
      fontFamily: "'DM Mono', 'Courier New', monospace",
      color: colors.text,
      overflow: "hidden",
      margin: 0,
      padding: 0,
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Bebas+Neue&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { margin: 0; padding: 0; }
        html { margin: 0; padding: 0; }
        .tab-btn {
          padding: 8px 16px;
          border: 1.5px solid ${colors.border};
          background: transparent;
          color: ${colors.textMuted};
          font-family: 'DM Mono', monospace;
          font-size: 11px;
          letter-spacing: 0.08em;
          cursor: pointer;
          transition: all 0.15s;
          text-transform: uppercase;
        }
        .tab-btn.active {
          background: ${colors.accent};
          color: ${colors.bg};
          border-color: ${colors.accent};
          font-weight: 500;
        }
        .tab-btn:hover:not(.active) {
          border-color: ${colors.textMuted};
          color: ${colors.text};
        }
        .date-btn {
          flex: 0 0 auto;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 2px;
          padding: 6px 10px;
          border: 1.5px solid ${colors.border};
          background: transparent;
          color: ${colors.textMuted};
          font-family: 'DM Mono', monospace;
          cursor: pointer;
          transition: all 0.15s;
          border-radius: 4px;
          min-width: 64px;
        }
        .date-btn .date-btn-label {
          font-size: 11px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        .date-btn .date-btn-sub {
          font-size: 9px;
          letter-spacing: 0.05em;
          color: ${colors.textDim};
        }
        .date-btn.active {
          background: ${colors.accent};
          color: ${colors.bg};
          border-color: ${colors.accent};
          font-weight: 500;
        }
        .date-btn.active .date-btn-sub { color: ${colors.bg}; opacity: 0.75; }
        .date-btn:hover:not(.active) {
          border-color: ${colors.textMuted};
          color: ${colors.text};
        }
        .date-strip {
          scrollbar-width: none;
          -ms-overflow-style: none;
        }
        .date-strip::-webkit-scrollbar {
          display: none;
        }
        .row-out { border-left: 3px solid ${colors.outbound}; }
        .row-in  { border-left: 3px solid ${colors.inbound}; }
        .row-out:hover, .row-in:hover { background: ${colors.rowHoverBg}; }
        @keyframes fadeIn { from { transform: translateY(6px); } to { transform: none; } }
        .fade-row { animation: fadeIn 0.2s ease both; }
      `}</style>

      {/* Header */}
      <div ref={headerRef} style={{
        flexShrink: 0,
        background: colors.bg,
        padding: "24px 16px 0",
        zIndex: 10,
        boxShadow: isScrolled ? `0 8px 24px 8px ${colors.bg}` : "none",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div style={{
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: "38px",
            letterSpacing: "0.04em",
            lineHeight: 1,
            color: colors.text,
          }}>
            FITCHBURG LINE
          </div>
          <button
            onClick={() => setIsDarkMode(!isDarkMode)}
            title={isDarkMode ? "Switch to light mode" : "Switch to dark mode"}
            style={{
              background: colors.bgSecondary,
              border: `1px solid ${colors.border}`,
              borderRadius: "999px",
              padding: "4px 10px",
              fontSize: "14px",
              lineHeight: 1,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              fontFamily: "'DM Mono', monospace",
              color: colors.textDim,
            }}
          >
            <span style={{ opacity: isDarkMode ? 1 : 0.35 }}>🌙</span>
            <span style={{ color: colors.textDim }}>/</span>
            <span style={{ opacity: isDarkMode ? 0.35 : 1 }}>☀️</span>
          </button>
        </div>
        <div style={{ fontSize: "12px", color: colors.accent, letterSpacing: "0.15em", marginTop: "4px", textTransform: "uppercase" }}>
          Park St. Crossing · Somerville
        </div>
        <div style={{ fontSize: "10px", color: colors.textDim, marginTop: "6px", letterSpacing: "0.05em" }}>
          Between Porter Square & North Station
        </div>
        {getHolidayNote(selectedDate) && (
          <div style={{
            display: "inline-block",
            marginTop: "8px",
            padding: "3px 8px",
            background: colors.accentBg,
            border: `1px solid ${colors.accentBorder}`,
            borderRadius: "4px",
            fontSize: "10px",
            color: colors.accent,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}>
            🎉 {getHolidayNote(selectedDate)} — Weekend Schedule
          </div>
        )}
        <div style={{ marginBottom: "16px" }} />

        {/* Date strip */}
        <div className="date-strip" style={{
          display: "flex",
          gap: "6px",
          marginBottom: "12px",
          overflowX: "auto",
          paddingBottom: "2px",
          WebkitOverflowScrolling: "touch",
        }}>
          {AVAILABLE_DATES.map((d) => {
            const active = d === selectedDate;
            const isHoliday = !!MBTA_HOLIDAYS[d];
            return (
              <button
                key={d}
                className={`date-btn ${active ? "active" : ""}`}
                onClick={() => setSelectedDate(d)}
                title={isHoliday ? MBTA_HOLIDAYS[d] : undefined}
              >
                <span className="date-btn-label">{formatDateLabel(d, todayStr)}</span>
                <span className="date-btn-sub">
                  {formatDateSub(d)}
                  {isHoliday && <span style={{ marginLeft: 4 }}>🎉</span>}
                </span>
              </button>
            );
          })}
        </div>

        {/* Legend */}
        <div style={{ display: "flex", gap: "16px", marginBottom: "12px", fontSize: "10px", letterSpacing: "0.1em" }}>
          <span style={{ display: "flex", alignItems: "center", gap: "6px", color: colors.text }}>
            <span style={{ width: 10, height: 10, background: colors.outbound, borderRadius: 2, display: "inline-block" }} />
            Outbound → Wachusett
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: "6px", color: colors.text }}>
            <span style={{ width: 10, height: 10, background: colors.inbound, borderRadius: 2, display: "inline-block" }} />
            Inbound → N Station
          </span>
        </div>

        {/* Table header */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "108px 1fr 80px",
          padding: "8px 12px",
          fontSize: "9px",
          letterSpacing: "0.15em",
          color: colors.textDim,
          textTransform: "uppercase",
          borderBottom: `1px solid ${colors.borderSubtle}`,
        }}>
          <span>ETA</span>
          <span>Direction</span>
          <span style={{ textAlign: "right" }}>Train #</span>
        </div>
      </div>

      {/* Scrollable rows + footer */}
      <div ref={scrollContainerRef} style={{ flex: 1, overflowY: "auto", padding: "4px 16px 24px", background: colors.bg }}>
      {/* Rows */}
      <div>
        {(() => {
          let attachedRef = false;
          return allRows.map((row, i) => {
            const passed = isToday && (timeToMin(row.crossing) ?? 9999) < nowMin - 5;
            const isNext = !passed && !attachedRef;
            if (isNext) attachedRef = true;
            return (
                <div key={`${row.train}-${i}`}
                  ref={isNext ? nextTrainRef : null}
                  className={`fade-row ${row.dir === "out" ? "row-out" : "row-in"}`}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "108px 1fr 80px",
                    padding: "11px 12px",
                    marginBottom: "3px",
                    borderRadius: "0 4px 4px 0",
                    transition: "background 0.12s, opacity 0.4s",
                    animationDelay: `${i * 18}ms`,
                    opacity: passed ? 0.25 : 1,
                  }}>
                  <span style={{
                    fontSize: "16px",
                    fontWeight: "500",
                    color: row.dir === "out" ? colors.outbound : colors.inbound,
                    letterSpacing: "0.02em",
                    whiteSpace: "nowrap",
                    textDecoration: row.cancelled ? "line-through" : "none",
                    opacity: row.cancelled ? 0.55 : 1,
                  }}>
                    <span title={row.isLive && !row.cancelled ? "Live prediction" : undefined} style={{
                      display: "inline-block",
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: row.isLive && !row.cancelled ? "#5dd86b" : "transparent",
                      marginRight: 6,
                      verticalAlign: "middle",
                    }} />
                    {row.crossing}
                  </span>
                  <span style={{ fontSize: "10px", color: row.cancelled ? "#e0524b" : colors.textMuted, letterSpacing: "0.08em", alignSelf: "center", fontWeight: row.cancelled ? 600 : "normal" }}>
                    {row.cancelled ? "CANCELLED" : row.direction}
                  </span>
                  <span style={{ fontSize: "10px", color: colors.textDim, textAlign: "right", alignSelf: "center", letterSpacing: "0.05em" }}>
                    #{row.train}
                  </span>
                </div>
              );
            });
          })()}
        </div>
      </div>

      {/* Footer note */}
      <div style={{
        flexShrink: 0,
        padding: "12px 16px",
        background: colors.bgSecondary,
        borderTop: `1px solid ${colors.borderSubtle}`,
        fontSize: "10px",
        color: colors.textDim,
        lineHeight: 1.7,
        letterSpacing: "0.04em",
      }}>
        <div>
          ⚠ Crossing times are <em>estimated</em> — ~{OUTBOUND_CROSSING_OFFSET} min before Porter (outbound) or ~{INBOUND_CROSSING_OFFSET} min after Porter (inbound). Schedule auto-updated daily from the MBTA API (last: {LAST_UPDATED}); rows with a <span style={{ display: "inline-block", width: 5, height: 5, borderRadius: "50%", background: "#5dd86b", verticalAlign: "middle" }} /> show live predictions. Always check <a href="https://www.mbta.com/schedules/CR-Fitchburg" target="_blank" rel="noopener noreferrer" style={{ color: colors.accent, textDecoration: "none" }}>mbta.com</a> for alerts & delays.
        </div>
        <div style={{ marginTop: "6px" }}>
          <a href="https://github.com/orn688/train-timetable" target="_blank" rel="noopener noreferrer" style={{ color: colors.accent, textDecoration: "none" }}>source on GitHub ↗</a>
        </div>
      </div>
    </div>
  );
}
