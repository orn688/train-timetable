import { useState, useEffect, useRef } from "react";

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

// Weekday outbound: Porter times (from schedule)
const wdOutbound = [
  { train: "1401", porter: "5:50 AM" },
  { train: "405",  porter: "6:30 AM" },
  { train: "407",  porter: "7:40 AM" },
  { train: "409",  porter: "8:40 AM" },
  { train: "1411", porter: "9:40 AM" },
  { train: "413",  porter: "10:40 AM" },
  { train: "1415", porter: "11:40 AM" },
  { train: "417",  porter: "12:40 PM" },
  { train: "1419", porter: "1:40 PM" },
  { train: "421",  porter: "2:40 PM" },
  { train: "425",  porter: "3:50 PM" },
  { train: "1427", porter: "4:35 PM" },
  { train: "429",  porter: "5:10 PM" },
  { train: "431",  porter: "5:40 PM" },
  { train: "435",  porter: "6:40 PM" },
  { train: "439",  porter: "7:40 PM" },
  { train: "443",  porter: "9:10 PM" },
  { train: "445",  porter: "10:40 PM" },
  { train: "447",  porter: "12:00 AM" },
];

// Weekday inbound: Porter times (from schedule)
const wdInbound = [
  { train: "400",  porter: "5:47 AM" },
  { train: "402",  porter: "6:45 AM" },
  { train: "406",  porter: "7:18 AM" },
  { train: "1408", porter: "7:52 AM" },
  { train: "410",  porter: "8:39 AM" },
  { train: "414",  porter: "9:43 AM" },
  { train: "416",  porter: "10:47 AM" },
  { train: "1418", porter: "11:47 AM" },
  { train: "420",  porter: "12:47 PM" },
  { train: "1422", porter: "1:47 PM" },
  { train: "424",  porter: "2:47 PM" },
  { train: "1426", porter: "3:47 PM" },
  { train: "428",  porter: "4:47 PM" },
  { train: "434",  porter: "5:57 PM" },
  { train: "1436", porter: "6:34 PM" },
  { train: "438",  porter: "7:39 PM" },
  { train: "442",  porter: "8:52 PM" },
  { train: "446",  porter: "10:47 PM" },
  { train: "448",  porter: "12:17 AM" },
];

// Weekend outbound: Porter times
const weOutbound = [
  { train: "5407", porter: "7:55 AM" },
  { train: "5413", porter: "10:25 AM" },
  { train: "5417", porter: "12:25 PM" },
  { train: "5421", porter: "2:25 PM" },
  { train: "5427", porter: "4:25 PM" },
  { train: "5435", porter: "6:25 PM" },
  { train: "5441", porter: "8:50 PM" },
  { train: "5447", porter: "11:50 PM" },
];

// Weekend inbound: Porter times
const weInbound = [
  { train: "5402", porter: "6:22 AM" },
  { train: "5412", porter: "9:22 AM" },
  { train: "5418", porter: "11:47 AM" },
  { train: "5422", porter: "1:47 PM" },
  { train: "5426", porter: "3:47 PM" },
  { train: "5434", porter: "5:47 PM" },
  { train: "5438", porter: "7:47 PM" },
  { train: "5444", porter: "10:17 PM" },
];

const OUTBOUND_CROSSING_OFFSET = 2; // minutes before Porter
const INBOUND_CROSSING_OFFSET = 5; // minutes after Porter (inc. stop time + slower approach)

// MBTA holidays on which Commuter Rail runs a weekend schedule
const MBTA_HOLIDAYS = {
  "2025-11-27": "Thanksgiving",
  "2025-12-25": "Christmas",
  "2026-01-01": "New Year's Day",
  "2026-01-19": "Martin Luther King Jr. Day",
  "2026-02-16": "Presidents' Day",
  "2026-04-20": "Patriots' Day",
  "2026-05-25": "Memorial Day",
  "2026-06-19": "Juneteenth",
  "2026-07-04": "Independence Day",
  "2026-09-07": "Labor Day",
  "2026-10-12": "Columbus Day",
  "2026-11-11": "Veterans Day",
  "2026-11-26": "Thanksgiving",
  "2026-12-25": "Christmas",
  "2027-01-01": "New Year's Day",
};

const getLocalDateStr = () => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const getDayType = () => {
  const now = new Date();
  const dow = now.getDay(); // 0=Sun, 6=Sat
  const dateStr = getLocalDateStr();
  if (dow === 0 || dow === 6 || dateStr in MBTA_HOLIDAYS) return "weekend";
  return "weekday";
};

const getHolidayNote = () => MBTA_HOLIDAYS[getLocalDateStr()] ?? null;

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
  const [day, setDay] = useState(getDayType);
  const [dir, setDir] = useState("both");
  const [nowMin, setNowMin] = useState(() => {
    const n = new Date();
    const total = n.getHours() * 60 + n.getMinutes();
    return total < 240 ? total + 24 * 60 : total;
  });

  useEffect(() => {
    const interval = setInterval(() => {
      const n = new Date();
      const total = n.getHours() * 60 + n.getMinutes();
      setNowMin(total < 240 ? total + 24 * 60 : total);
    }, 30000); // update every 30 seconds
    return () => clearInterval(interval);
  }, []);

  const todayType = getDayType();
  const [isScrolled, setIsScrolled] = useState(false);
  const nextTrainRef = useRef(null);
  const headerRef = useRef(null);
  const scrollContainerRef = useRef(null);

  useEffect(() => {
    if (nextTrainRef.current && scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      const rowRect = nextTrainRef.current.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const top = container.scrollTop + rowRect.top - containerRect.top - 24;
      container.scrollTo({ top, behavior: "smooth" });
    }
  }, [day, dir]); // on initial load and when tabs change

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const onScroll = () => setIsScrolled(container.scrollTop > 0);
    container.addEventListener("scroll", onScroll);
    return () => container.removeEventListener("scroll", onScroll);
  }, []);

  const outboundData = day === "weekday" ? wdOutbound : weOutbound;
  const inboundData = day === "weekday" ? wdInbound : weInbound;

  const outboundRows = outboundData.map(r => ({
    ...r,
    crossing: addMinutes(r.porter, -OUTBOUND_CROSSING_OFFSET),
    direction: "→ Wachusett",
  }));
  const inboundRows = inboundData.map(r => ({
    ...r,
    crossing: addMinutes(r.porter, INBOUND_CROSSING_OFFSET),
    direction: "→ North Station",
  }));

  let allRows = [];
  if (dir === "both") {
    allRows = [...outboundRows.map(r => ({ ...r, dir: "out" })), ...inboundRows.map(r => ({ ...r, dir: "in" }))];
    allRows.sort((a, b) => (timeToMin(a.crossing) ?? 9999) - (timeToMin(b.crossing) ?? 9999));
  } else if (dir === "outbound") {
    allRows = outboundRows.map(r => ({ ...r, dir: "out" }));
  } else {
    allRows = inboundRows.map(r => ({ ...r, dir: "in" }));
  }

  return (
    <div style={{
      height: "100vh",
      display: "flex",
      flexDirection: "column",
      background: "#0f1117",
      fontFamily: "'DM Mono', 'Courier New', monospace",
      color: "#e8e4d9",
      overflow: "hidden",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Bebas+Neue&display=swap');
        * { box-sizing: border-box; }
        .tab-btn {
          padding: 8px 16px;
          border: 1.5px solid #2a2f3a;
          background: transparent;
          color: #888;
          font-family: 'DM Mono', monospace;
          font-size: 11px;
          letter-spacing: 0.08em;
          cursor: pointer;
          transition: all 0.15s;
          text-transform: uppercase;
        }
        .tab-btn.active {
          background: #e8c96d;
          color: #0f1117;
          border-color: #e8c96d;
          font-weight: 500;
        }
        .tab-btn:hover:not(.active) {
          border-color: #555;
          color: #ccc;
        }
        .row-out { border-left: 3px solid #5b9cf6; }
        .row-in  { border-left: 3px solid #e87c5b; }
        .row-out:hover, .row-in:hover { background: rgba(255,255,255,0.04); }
        @keyframes fadeIn { from { transform: translateY(6px); } to { transform: none; } }
        .fade-row { animation: fadeIn 0.2s ease both; }
      `}</style>

      {/* Header */}
      <div ref={headerRef} style={{
        flexShrink: 0,
        background: "#0f1117",
        padding: "24px 16px 0",
        zIndex: 10,
        boxShadow: isScrolled ? "0 8px 24px 8px #0f1117" : "none",
      }}>
        <div style={{
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: "38px",
          letterSpacing: "0.04em",
          lineHeight: 1,
          color: "#e8e4d9",
        }}>
          FITCHBURG LINE
        </div>
        <div style={{ fontSize: "12px", color: "#e8c96d", letterSpacing: "0.15em", marginTop: "4px", textTransform: "uppercase" }}>
          Park St. Crossing · Somerville
        </div>
        <div style={{ fontSize: "10px", color: "#555", marginTop: "6px", letterSpacing: "0.05em" }}>
          Between Porter Square & North Station
        </div>
        {getHolidayNote() && (
          <div style={{
            display: "inline-block",
            marginTop: "8px",
            padding: "3px 8px",
            background: "rgba(232,201,109,0.15)",
            border: "1px solid rgba(232,201,109,0.4)",
            borderRadius: "4px",
            fontSize: "10px",
            color: "#e8c96d",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}>
            🎉 {getHolidayNote()} — Weekend Schedule
          </div>
        )}
        <div style={{ marginBottom: "16px" }} />

        {/* Day toggle */}
        <div style={{ display: "flex", gap: "0", marginBottom: "12px" }}>
        <button className={`tab-btn ${day === "weekday" ? "active" : ""}`}
          style={{ borderRadius: "4px 0 0 4px" }}
          onClick={() => setDay("weekday")}>
          Weekday{todayType === "weekday" && <span style={{ display: "inline-block", width: 5, height: 5, borderRadius: "50%", background: day === "weekday" ? "#0f1117" : "#e8c96d", marginLeft: 6, verticalAlign: "middle", marginBottom: 1 }} />}
        </button>
        <button className={`tab-btn ${day === "weekend" ? "active" : ""}`}
          style={{ borderRadius: "0 4px 4px 0", borderLeft: "none" }}
          onClick={() => setDay("weekend")}>
          Weekend{todayType === "weekend" && <span style={{ display: "inline-block", width: 5, height: 5, borderRadius: "50%", background: day === "weekend" ? "#0f1117" : "#e8c96d", marginLeft: 6, verticalAlign: "middle", marginBottom: 1 }} />}
        </button>
        </div>

        {/* Direction toggle */}
        <div style={{ display: "flex", gap: "0", marginBottom: "12px" }}>
        {["both", "outbound", "inbound"].map((d, i) => (
          <button key={d}
            className={`tab-btn ${dir === d ? "active" : ""}`}
            style={{
              borderRadius: i === 0 ? "4px 0 0 4px" : i === 2 ? "0 4px 4px 0" : "0",
              borderLeft: i > 0 ? "none" : undefined,
            }}
            onClick={() => setDir(d)}>
            {d === "both" ? "All Trains" : d === "outbound" ? "→ Wachusett" : "→ N Station"}
          </button>
        ))}
        </div>

        {/* Legend */}
        <div style={{ display: "flex", gap: "16px", marginBottom: "12px", fontSize: "10px", letterSpacing: "0.1em" }}>
          <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ width: 10, height: 10, background: "#5b9cf6", borderRadius: 2, display: "inline-block" }} />
            Outbound → Wachusett
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ width: 10, height: 10, background: "#e87c5b", borderRadius: 2, display: "inline-block" }} />
            Inbound → N Station
          </span>
        </div>

        {/* Table header */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "90px 1fr 80px",
          padding: "8px 12px",
          fontSize: "9px",
          letterSpacing: "0.15em",
          color: "#555",
          textTransform: "uppercase",
          borderBottom: "1px solid #1e2330",
        }}>
          <span>ETA</span>
          <span>Direction</span>
          <span style={{ textAlign: "right" }}>Train #</span>
        </div>
      </div>

      {/* Scrollable rows + footer */}
      <div ref={scrollContainerRef} style={{ flex: 1, overflowY: "auto", padding: "4px 16px 24px" }}>
      {/* Rows */}
      <div>
        {(() => {
          let attachedRef = false;
          return allRows.map((row, i) => {
            const passed = day === todayType && (timeToMin(row.crossing) ?? 9999) < nowMin - 5;
            const isNext = !passed && !attachedRef;
            if (isNext) attachedRef = true;
            return (
            <div key={`${row.train}-${i}`}
              ref={isNext ? nextTrainRef : null}
              className={`fade-row ${row.dir === "out" ? "row-out" : "row-in"}`}
              style={{
                display: "grid",
                gridTemplateColumns: "90px 1fr 80px",
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
              color: row.dir === "out" ? "#5b9cf6" : "#e87c5b",
              letterSpacing: "0.02em",
            }}>
              {row.crossing}
            </span>
            <span style={{ fontSize: "10px", color: "#888", letterSpacing: "0.08em", alignSelf: "center" }}>
              {row.direction}
            </span>
            <span style={{ fontSize: "10px", color: "#555", textAlign: "right", alignSelf: "center", letterSpacing: "0.05em" }}>
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
        background: "#16191f",
        borderTop: "1px solid #1e2330",
        fontSize: "10px",
        color: "#555",
        lineHeight: 1.7,
        letterSpacing: "0.04em",
      }}>
        ⚠ Crossing times are <em>estimated</em> — ~{OUTBOUND_CROSSING_OFFSET} min before Porter (outbound) or ~{INBOUND_CROSSING_OFFSET} min after Porter (inbound). Source: MBTA Fall/Winter 2025 schedule, effective Oct 27, 2025. Always check <span style={{ color: "#e8c96d" }}>mbta.com</span> for alerts & delays.
      </div>
    </div>
  );
}
