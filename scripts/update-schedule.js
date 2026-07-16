#!/usr/bin/env node

/**
 * Update schedule data from MBTA API.
 * Fetches per-date Fitchburg Line schedules for today + the next 6 days
 * and writes src/scheduleData.js.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MBTA_API_BASE = 'https://api-v3.mbta.com';
const ROUTE_ID = 'CR-Fitchburg';
const PORTER_STOP_ID = 'place-portr';
const DAYS_AHEAD = 7;

const formatIsoTimeToAmPm = (isoStr) => {
  const match = isoStr.match(/T(\d{2}):(\d{2})/);
  if (!match) return null;
  const h = Number(match[1]);
  const m = match[2];
  const display12 = h % 12 === 0 ? 12 : h % 12;
  const ampm = h < 12 ? 'AM' : 'PM';
  return `${display12}:${m} ${ampm}`;
};

const formatDate = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

async function run() {
  try {
    console.log('Fetching Fitchburg Line schedules from MBTA API...');

    const today = new Date();
    const dates = [];
    for (let i = 0; i < DAYS_AHEAD; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      dates.push(formatDate(d));
    }

    const schedules = {};
    for (const dateStr of dates) {
      console.log(`Fetching schedule for ${dateStr}...`);
      const { outbound, inbound } = await fetchPorterSchedules(dateStr);
      if (outbound.length === 0 && inbound.length === 0) {
        throw new Error(`Refusing to write empty schedule: ${dateStr} returned no rows`);
      }
      schedules[dateStr] = { outbound, inbound };
    }

    console.log('Fetching MBTA holidays...');
    const holidays = await fetchMBTAHolidays();

    generateScheduleFile(schedules, holidays);
    console.log('✓ Schedule data updated successfully');
  } catch (error) {
    console.error('Error fetching schedules:', error.message);
    process.exit(1);
  }
}

async function fetchPorterSchedules(dateStr) {
  const params = new URLSearchParams({
    'filter[route]': ROUTE_ID,
    'filter[stop]': PORTER_STOP_ID,
    'filter[date]': dateStr,
    'include': 'trip',
    'sort': 'arrival_time',
  });

  const url = `${MBTA_API_BASE}/schedules?${params.toString()}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`MBTA API error for ${dateStr}: ${response.statusText}`);
  }

  const body = await response.json();
  const tripNames = new Map();
  for (const item of body.included || []) {
    if (item.type === 'trip') {
      tripNames.set(item.id, item.attributes?.name);
    }
  }

  const outbound = [];
  const inbound = [];
  for (const s of body.data || []) {
    const attrs = s.attributes || {};
    const tripId = s.relationships?.trip?.data?.id;
    const train = tripNames.get(tripId);
    const isoTime = attrs.arrival_time || attrs.departure_time;
    if (!train || !isoTime) continue;
    const porter = formatIsoTimeToAmPm(isoTime);
    if (!porter) continue;
    const row = { train, porter };
    if (attrs.direction_id === 0) outbound.push(row);
    else if (attrs.direction_id === 1) inbound.push(row);
  }

  return { outbound, inbound };
}

async function fetchMBTAHolidays() {
  const params = new URLSearchParams({
    'filter[route]': ROUTE_ID,
  });

  const url = `${MBTA_API_BASE}/services?${params.toString()}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`MBTA API error when fetching holidays: ${response.statusText}`);
  }

  const data = await response.json();
  const services = data.data || [];

  const holidays = {};
  for (const service of services) {
    const attrs = service.attributes || {};
    if (attrs.schedule_type !== 'Weekend') continue;
    const dates = attrs.added_dates || [];
    const notes = attrs.added_dates_notes || [];
    for (let i = 0; i < dates.length; i++) {
      const date = dates[i];
      const name = notes[i];
      if (date && name) {
        holidays[date] = name;
      }
    }
  }

  return holidays;
}

function generateScheduleFile(schedules, holidays) {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];

  const schedulesStr = Object.entries(schedules)
    .map(([date, { outbound, inbound }]) => {
      const outStr = JSON.stringify(outbound, null, 2).replace(/\n/g, '\n    ');
      const inStr = JSON.stringify(inbound, null, 2).replace(/\n/g, '\n    ');
      return `  "${date}": {\n    outbound: ${outStr},\n    inbound: ${inStr},\n  }`;
    })
    .join(',\n');

  const holidaysStr = Object.entries(holidays)
    .map(([date, name]) => `  "${date}": ${JSON.stringify(name)}`)
    .join(',\n');

  const content = `// Train schedule data for the Fitchburg Line
// This file is automatically updated daily by GitHub Actions.
// Each entry under SCHEDULES is the Porter Square schedule for that specific date.

export const LAST_UPDATED = "${dateStr}";

// Per-date Porter Square schedules (from MBTA /schedules?filter[date]=...)
export const SCHEDULES = {
${schedulesStr},
};

// MBTA holidays on which Commuter Rail runs a weekend schedule.
// Used for UI labeling — the schedule rows above already reflect actual service.
export const MBTA_HOLIDAYS = {
${holidaysStr}
};
`;

  const filePath = path.join(__dirname, '../src/scheduleData.js');
  fs.writeFileSync(filePath, content);
  console.log(`Updated ${filePath}`);
}

await run();
