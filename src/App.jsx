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
  return date.toLocaleDateString("en-US", { weekday: "short" });
};

const formatDateSub = (dateStr) => {
  const date = parseLocalDate(dateStr);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

const OUTBOUND_CROSSING_OFFSET = 2; // minutes before Porter
const INBOUND_CROSSING_OFFSET = 5; // minutes after Porter (inc. stop time + slower approach)

// After midnight, keep showing the previous service day until this many
// minutes past its last train, then advance to the new calendar day.
const LATE_ADVANCE_GRACE = 10;

// Header scroll-shadow geometry. The shadow's visible reach below the header
// is HEADER_SHADOW_Y + HEADER_SHADOW_BLUR; the fade-in distance is tied to
// that same value so changing either dimension keeps them in sync.
const HEADER_SHADOW_Y = 8;
const HEADER_SHADOW_BLUR = 24;
const HEADER_SHADOW_SPREAD = 8;
const HEADER_SHADOW_FADE_DISTANCE = HEADER_SHADOW_Y + HEADER_SHADOW_BLUR;

// Time-axis layout. PX_PER_MIN sets the vertical scale: 5 min apart trains
// sit 5*PX_PER_MIN px apart. ROW_HEIGHT is the rendered row height; rows that
// would overlap at the time-true position get pushed into side-by-side lanes.
const PX_PER_MIN = 2.4;
const ROW_HEIGHT = 34;
const LANE_GAP = 4;
const AXIS_WIDTH = 56;

const formatHourLabel = (totalMin) => {
  const h = Math.floor(totalMin / 60) % 24;
  const display12 = h % 12 === 0 ? 12 : h % 12;
  const ampm = h < 12 ? "am" : "pm";
  return `${display12}${ampm}`;
};

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

// The schedule and MBTA predictions are all in Somerville's local (Eastern)
// wall-clock time, so "now" must be read in that zone too — otherwise a viewer
// in another timezone sees the now-line at their own clock time, not the
// train's. Intl handles the EST/EDT switch for us.
const getEasternNow = () => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const p = {};
  for (const part of parts) p[part.type] = part.value;
  let hour = Number(p.hour);
  if (hour === 24) hour = 0; // some engines emit "24" for midnight
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour,
    minute: Number(p.minute),
  };
};

// Format a Date's UTC calendar parts as YYYY-MM-DD. We build dates from
// Eastern Y/M/D in UTC purely for calendar arithmetic, so the browser's own
// timezone can never shift the day.
const utcDateStr = (d) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;

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

// Latest crossing time (in axis minutes) across both directions of a service
// day's schedule, or null if that day has no schedule. Used to decide when a
// finished service day should hand off to the next calendar day.
const lastCrossingMin = (dateStr) => {
  const day = SCHEDULES[dateStr];
  if (!day) return null;
  let max = null;
  const consider = (rows, offset) => {
    for (const r of rows ?? []) {
      const t = timeToMin(addMinutes(r.porter, offset));
      if (t != null && (max == null || t > max)) max = t;
    }
  };
  consider(day.outbound, -OUTBOUND_CROSSING_OFFSET);
  consider(day.inbound, INBOUND_CROSSING_OFFSET);
  return max;
};

// Resolve, in Somerville (Eastern) time, three things at once:
//  - calendarStr: the real calendar date (drives the Today/Tomorrow labels)
//  - activeStr:   the service day to show by default and pin "now" to
//  - nowMin:      "now" on that service day's axis
// During the day these coincide. After midnight the previous service day's
// late-night trains may still be running, so we keep it active until
// LATE_ADVANCE_GRACE minutes past its last train, then advance to the new
// calendar day. nowMin is wrapped past 24h only while that tail is active, so
// once we advance "now" sits before the new day's first train rather than
// after its (next-night) last one.
const getNowState = () => {
  const { year, month, day, hour, minute } = getEasternNow();
  const raw = hour * 60 + minute;
  const calD = new Date(Date.UTC(year, month - 1, day));
  const calendarStr = utcDateStr(calD);
  let activeStr = calendarStr;
  let tail = false;
  if (raw < 240) {
    const prevD = new Date(calD);
    prevD.setUTCDate(prevD.getUTCDate() - 1);
    const prevStr = utcDateStr(prevD);
    const prevLast = lastCrossingMin(prevStr);
    const nowWrapped = raw + 24 * 60;
    if (prevLast != null && nowWrapped <= prevLast + LATE_ADVANCE_GRACE) {
      activeStr = prevStr;
      tail = true;
    }
  }
  const nowMin = tail ? raw + 24 * 60 : raw;
  return { calendarStr, activeStr, nowMin };
};

export default function App() {
  const [todayStr, setTodayStr] = useState(() => getNowState().activeStr);
  const [calendarTodayStr, setCalendarTodayStr] = useState(() => getNowState().calendarStr);
  const initialDate = AVAILABLE_DATES.includes(todayStr) ? todayStr : AVAILABLE_DATES[0];
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [nowMin, setNowMin] = useState(() => getNowState().nowMin);

  // Refresh the active service day, calendar day, and "now" together so an
  // open page tracks midnight and the smart-advance handoff.
  useEffect(() => {
    const interval = setInterval(() => {
      const { calendarStr, activeStr, nowMin } = getNowState();
      setTodayStr((prev) => (prev === activeStr ? prev : activeStr));
      setCalendarTodayStr((prev) => (prev === calendarStr ? prev : calendarStr));
      setNowMin(nowMin);
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const [isDarkMode, setIsDarkMode] = useState(() => {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (e) => setIsDarkMode(e.matches);
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
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

  const [scrollProgress, setScrollProgress] = useState(0);
  const nextTrainRef = useRef(null);
  const headerRef = useRef(null);
  const scrollContainerRef = useRef(null);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const onScroll = () => {
      const p = Math.min(1, Math.max(0, container.scrollTop / HEADER_SHADOW_FADE_DISTANCE));
      setScrollProgress(p);
    };
    container.addEventListener("scroll", onScroll);
    return () => container.removeEventListener("scroll", onScroll);
  }, []);

  const arrowStyle = { fontWeight: 600, fontSize: "22px", lineHeight: 1, transform: "translateY(-4px)" };

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
  const outboundRows = decorate(outboundData, -OUTBOUND_CROSSING_OFFSET, "Wachusett");
  const inboundRows = decorate(inboundData, INBOUND_CROSSING_OFFSET, "North Station");

  const allRows = [
    ...outboundRows.map(r => ({ ...r, dir: "out" })),
    ...inboundRows.map(r => ({ ...r, dir: "in" })),
  ].sort((a, b) => (timeToMin(a.crossing) ?? 9999) - (timeToMin(b.crossing) ?? 9999));

  // Compute vertical positions on the time axis. Rows that would overlap at
  // their true-time position get assigned to side-by-side lanes; the layout
  // grows numLanes wide whenever a conflict appears.
  const rowsWithTime = allRows
    .map((r, idx) => ({ row: r, idx, t: timeToMin(r.crossing) }))
    .filter(x => x.t != null);
  const firstTime = rowsWithTime.length ? rowsWithTime[0].t : 0;
  const lastTime = rowsWithTime.length ? rowsWithTime[rowsWithTime.length - 1].t : 0;
  const startMin = Math.floor(firstTime / 60) * 60;
  const endMin = Math.ceil((lastTime + 1) / 60) * 60;
  const axisHeight = Math.max(ROW_HEIGHT, (endMin - startMin) * PX_PER_MIN + ROW_HEIGHT);

  // Two-pass lane assignment. First, greedily assign each row to the lowest
  // lane whose previous row finished before this row starts. Then group rows
  // into overlap "clusters" (chains where each adjacent pair is too close
  // vertically) and stamp every row in a cluster with the cluster's lane
  // count, so a single conflict only narrows the rows actually in that
  // conflict — not every row in the day.
  const laneNextFreeTop = [];
  const positionedRows = rowsWithTime.map(({ row, idx, t }) => {
    const top = (t - startMin) * PX_PER_MIN;
    let lane = 0;
    while (laneNextFreeTop[lane] != null && top < laneNextFreeTop[lane]) lane++;
    laneNextFreeTop[lane] = top + ROW_HEIGHT + LANE_GAP;
    return { row, idx, t, top, lane, clusterLanes: 1 };
  });

  if (positionedRows.length > 0) {
    let cluster = [positionedRows[0]];
    const clusters = [cluster];
    for (let i = 1; i < positionedRows.length; i++) {
      const cur = positionedRows[i];
      const prev = positionedRows[i - 1];
      if (cur.top - prev.top < ROW_HEIGHT + LANE_GAP) {
        cluster.push(cur);
      } else {
        cluster = [cur];
        clusters.push(cluster);
      }
    }
    for (const c of clusters) {
      const lanes = Math.max(...c.map(r => r.lane)) + 1;
      for (const r of c) r.clusterLanes = lanes;
    }
  }

  const hourTicks = [];
  for (let m = startMin; m <= endMin; m += 30) hourTicks.push(m);

  // The hour grid and the "now" line live ROW_HEIGHT/2 below where the
  // matching minute-offset would land naively. That offset moves them onto
  // each row's vertical center — where the row's triangle marker sits — so
  // a tick on the hour intersects a row exactly at that train's time.
  const AXIS_Y_OFFSET = ROW_HEIGHT / 2;

  const nowOnAxis = isToday && nowMin >= startMin && nowMin <= endMin
    ? (nowMin - startMin) * PX_PER_MIN + AXIS_Y_OFFSET
    : null;

  // Identify the "next" non-passed row so the auto-scroll effect can re-fire
  // when predictions push the previously-passed train back into the future.
  let nextTrainKey = null;
  for (let i = 0; i < allRows.length; i++) {
    const r = allRows[i];
    const passed = isToday && (timeToMin(r.crossing) ?? 9999) < nowMin - 5;
    if (!passed) { nextTrainKey = `${r.dir}-${r.train}-${i}`; break; }
  }

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    if (isToday && nowOnAxis != null) {
      // Today with a "now" line in range: anchor the now line ~80px below
      // the top of the viewport so the user sees a little past context and
      // the rest of the day below.
      container.scrollTo({ top: Math.max(0, nowOnAxis - 80), behavior: "smooth" });
    } else if (nextTrainRef.current) {
      const rowRect = nextTrainRef.current.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const top = container.scrollTop + rowRect.top - containerRect.top - 24;
      container.scrollTo({ top, behavior: "smooth" });
    } else if (isToday && allRows.length > 0) {
      // Every train for today has already passed — show the end of the list
      // instead of leaving the view stuck at the top.
      container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
    }
  }, [selectedDate, nextTrainKey, isToday]);

  // Color scheme based on dark/light mode
  const bgRgb = isDarkMode ? "15, 17, 23" : "255, 255, 255";
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
      height: "100dvh",
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
        boxShadow: `0 ${HEADER_SHADOW_Y}px ${HEADER_SHADOW_BLUR}px ${HEADER_SHADOW_SPREAD}px rgba(${bgRgb}, ${scrollProgress})`,
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

        {/* Date strip — outer wrapper clips the scrollbar that the inner
            element pushes below the fold via padding + negative margin. */}
        <div style={{ overflow: "hidden", marginBottom: "12px" }}>
        <div className="date-strip" style={{
          display: "flex",
          gap: "6px",
          overflowX: "auto",
          overflowY: "hidden",
          paddingBottom: "20px",
          marginBottom: "-20px",
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
                <span className="date-btn-label">{formatDateLabel(d, calendarTodayStr)}</span>
                <span className="date-btn-sub">
                  {formatDateSub(d)}
                  {isHoliday && <span style={{ marginLeft: 4 }}>🎉</span>}
                </span>
              </button>
            );
          })}
        </div>
        </div>

        {/* Legend */}
        <div style={{ display: "flex", gap: "24px", marginBottom: "12px", fontSize: "10px", letterSpacing: "0.1em" }}>
          <span style={{ display: "flex", alignItems: "center", gap: "6px", color: colors.text }}>
            <span style={{ ...arrowStyle, color: colors.inbound }}>→</span>
            Inbound · N Station
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: "6px", color: colors.text }}>
            <span style={{ ...arrowStyle, color: colors.outbound }}>←</span>
            Outbound · Wachusett
          </span>
        </div>

      </div>

      {/* Scrollable rows + footer */}
      <div ref={scrollContainerRef} style={{ flex: 1, overflowY: "auto", padding: "4px 16px 24px", background: colors.bg }}>
      {/* Time-axis timeline */}
      <div style={{
        position: "relative",
        height: `${axisHeight}px`,
      }}>
        {/* Hour + half-hour gridlines. Hour marks get a label and a darker
            dashed line; half-hour marks are unlabeled and lighter. */}
        {hourTicks.map((m) => {
          const top = (m - startMin) * PX_PER_MIN + AXIS_Y_OFFSET;
          const isHour = m % 60 === 0;
          return (
            <div key={`tick-${m}`} style={{
              position: "absolute",
              top: `${top}px`,
              left: isHour ? `${AXIS_WIDTH - 6}px` : `${AXIS_WIDTH + 2}px`,
              right: 0,
              height: 0,
              borderTop: `1px dashed ${colors.borderSubtle}`,
              opacity: isHour ? 1 : 0.5,
              pointerEvents: "none",
            }}>
              {isHour && (
                <span style={{
                  position: "absolute",
                  right: "100%",
                  top: "-7px",
                  paddingRight: "8px",
                  fontSize: "10px",
                  letterSpacing: "0.08em",
                  color: colors.textDim,
                  fontVariantNumeric: "tabular-nums",
                }}>
                  {formatHourLabel(m)}
                </span>
              )}
            </div>
          );
        })}

        {/* Now indicator */}
        {nowOnAxis != null && (
          <div style={{
            position: "absolute",
            top: `${nowOnAxis}px`,
            left: `${AXIS_WIDTH - 6}px`,
            right: 0,
            height: 0,
            borderTop: `1.5px solid ${colors.accent}`,
            pointerEvents: "none",
            zIndex: 3,
          }}>
            <span style={{
              position: "absolute",
              right: 0,
              top: "-7px",
              fontSize: "9px",
              letterSpacing: "0.12em",
              color: colors.accent,
              background: colors.bg,
              paddingLeft: "6px",
              textTransform: "uppercase",
            }}>
              now
            </span>
          </div>
        )}

        {/* Train rows */}
        {positionedRows.map(({ row, idx, top, lane, clusterLanes }) => {
          const passed = isToday && (timeToMin(row.crossing) ?? 9999) < nowMin - 5;
          const isNext = !passed && nextTrainKey === `${row.dir}-${row.train}-${idx}`;
          const wide = clusterLanes === 1;
          const laneOffset = `calc(${lane} * (100% - ${AXIS_WIDTH}px) / ${clusterLanes})`;
          const laneWidth = `calc((100% - ${AXIS_WIDTH}px) / ${clusterLanes} - ${wide ? 0 : LANE_GAP}px)`;
          return (
            <div key={`${row.train}-${idx}`}
              ref={isNext ? nextTrainRef : null}
              className={`fade-row ${row.dir === "out" ? "row-out" : "row-in"}`}
              style={{
                position: "absolute",
                top: `${top}px`,
                left: `calc(${AXIS_WIDTH}px + ${laneOffset})`,
                width: laneWidth,
                height: `${ROW_HEIGHT}px`,
                display: "grid",
                gridTemplateColumns: wide ? "auto 1fr auto" : "auto auto 1fr",
                alignItems: "center",
                gap: "8px",
                // padding-left budgets space for the absolute-positioned
                // triangle (0–8 px) and live-prediction dot (12–18 px), with
                // matching 4 px gaps on either side of the dot, so the time
                // text starts cleanly at 22 px.
                padding: "0 10px 0 22px",
                background: "transparent",
                borderRadius: "0 4px 4px 0",
                transition: "background 0.12s, opacity 0.4s",
                animationDelay: `${idx * 18}ms`,
                opacity: passed ? 0.25 : 1,
                zIndex: 2,
              }}>
              {/* Time-point marker. Sits at the row's vertical center, which
                  in turn is anchored to the train's exact crossing time, so
                  the triangle's tip pins down a single point on the axis. */}
              <span aria-hidden="true" style={{
                position: "absolute",
                left: 0,
                top: "50%",
                transform: "translateY(-50%)",
                width: 0,
                height: 0,
                borderTop: "6px solid transparent",
                borderBottom: "6px solid transparent",
                borderRight: `8px solid ${row.dir === "out" ? colors.outbound : colors.inbound}`,
                opacity: row.cancelled ? 0.55 : 1,
              }} />
              {row.isLive && !row.cancelled && (
                <span title="Live prediction" style={{
                  position: "absolute",
                  left: 12,
                  top: "50%",
                  transform: "translateY(-50%)",
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "#5dd86b",
                }} />
              )}
              <span style={{
                fontSize: wide ? "15px" : "13px",
                fontWeight: "500",
                color: row.dir === "out" ? colors.outbound : colors.inbound,
                letterSpacing: "0.02em",
                whiteSpace: "nowrap",
                textDecoration: row.cancelled ? "line-through" : "none",
                opacity: row.cancelled ? 0.55 : 1,
                fontVariantNumeric: "tabular-nums",
              }}>
                {wide ? row.crossing : row.crossing.replace(/ (AM|PM)$/, "")}
              </span>
              {wide ? (
                <>
                  <span style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
                    <span aria-hidden="true" style={{
                      ...arrowStyle,
                      color: row.dir === "out" ? colors.outbound : colors.inbound,
                      opacity: row.cancelled ? 0.55 : 1,
                    }}>
                      {row.dir === "out" ? "←" : "→"}
                    </span>
                    <span style={{ fontSize: "10px", color: row.cancelled ? "#e0524b" : colors.textMuted, letterSpacing: "0.08em", fontWeight: row.cancelled ? 600 : "normal", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {row.cancelled ? "CANCELLED" : row.direction}
                    </span>
                  </span>
                  <span style={{ fontSize: "10px", color: colors.textDim, textAlign: "right", letterSpacing: "0.05em", whiteSpace: "nowrap" }}>
                    #{row.train}
                  </span>
                </>
              ) : (
                <>
                  <span aria-hidden="true" style={{
                    ...arrowStyle,
                    fontSize: "18px",
                    color: row.dir === "out" ? colors.outbound : colors.inbound,
                    opacity: row.cancelled ? 0.55 : 1,
                  }}>
                    {row.dir === "out" ? "←" : "→"}
                  </span>
                  <span style={{ fontSize: "10px", color: row.cancelled ? "#e0524b" : colors.textDim, textAlign: "right", letterSpacing: "0.05em", whiteSpace: "nowrap" }}>
                    {row.cancelled ? "CANC" : `#${row.train}`}
                  </span>
                </>
              )}
            </div>
          );
        })}
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
