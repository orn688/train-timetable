#!/usr/bin/env node

/**
 * Update schedule data from MBTA API
 * Fetches the latest Fitchburg Line schedule and updates src/scheduleData.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MBTA_API_BASE = 'https://api-v3.mbta.com';
const ROUTE_ID = 'CR-Fitchburg';
const PORTER_STOP_ID = 'place-portr';

const formatIsoTimeToAmPm = (isoStr) => {
  const match = isoStr.match(/T(\d{2}):(\d{2})/);
  if (!match) return null;
  const h = Number(match[1]);
  const m = match[2];
  const display12 = h % 12 === 0 ? 12 : h % 12;
  const ampm = h < 12 ? 'AM' : 'PM';
  return `${display12}:${m} ${ampm}`;
};

const isWeekday = (date) => {
  const dow = date.getDay();
  return dow !== 0 && dow !== 6; // 0=Sun, 6=Sat
};

const formatDate = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

async function fetchSchedules() {
  try {
    console.log('Fetching Fitchburg Line schedules from MBTA API...');

    // Get next weekday and weekend dates
    const today = new Date();
    let nextWeekday = new Date(today);
    let nextWeekend = new Date(today);

    // Find next weekday
    while (!isWeekday(nextWeekday)) {
      nextWeekday.setDate(nextWeekday.getDate() + 1);
    }

    // Find next weekend day
    while (isWeekday(nextWeekend)) {
      nextWeekend.setDate(nextWeekend.getDate() + 1);
    }

    const weekdayDate = formatDate(nextWeekday);
    const weekendDate = formatDate(nextWeekend);

    console.log(`Fetching weekday schedule for ${weekdayDate}...`);
    const { outbound: wdOutbound, inbound: wdInbound } = await fetchPorterSchedules(weekdayDate);

    console.log(`Fetching weekend schedule for ${weekendDate}...`);
    const { outbound: weOutbound, inbound: weInbound } = await fetchPorterSchedules(weekendDate);

    console.log('Fetching MBTA holidays...');
    const holidays = await fetchMBTAHolidays();

    for (const [name, rows] of [['wdOutbound', wdOutbound], ['wdInbound', wdInbound], ['weOutbound', weOutbound], ['weInbound', weInbound]]) {
      if (rows.length === 0) {
        throw new Error(`Refusing to write empty schedule: ${name} returned no rows`);
      }
    }

    generateScheduleFile(wdOutbound, wdInbound, weOutbound, weInbound, holidays);
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
    throw new Error(`MBTA API error: ${response.statusText}`);
  }

  const body = await response.json();
  const schedules = body.data || [];
  const tripNames = new Map();
  for (const item of body.included || []) {
    if (item.type === 'trip') {
      tripNames.set(item.id, item.attributes?.name);
    }
  }

  const outbound = [];
  const inbound = [];
  for (const s of schedules) {
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

  // Holidays appear as added_dates on Weekend services, paired with a name in added_dates_notes
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

  if (Object.keys(holidays).length === 0) {
    throw new Error('No holidays found in MBTA API response');
  }

  return holidays;
}

function generateScheduleFile(wdOut, wdIn, weOut, weIn, holidays) {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];

  // Format holidays object with proper indentation
  const holidaysStr = Object.entries(holidays)
    .map(([date, name]) => `  "${date}": "${name}"`)
    .join(',\n');

  const content = `// Train schedule data for the Fitchburg Line
// This file is automatically updated weekly by GitHub Actions
// Schedule data and holidays are fetched from the MBTA API
// Last updated: ${dateStr}

export const OUTBOUND_CROSSING_OFFSET = 2; // minutes before Porter
export const INBOUND_CROSSING_OFFSET = 5; // minutes after Porter (inc. stop time + slower approach)

// Weekday outbound: Porter times (from MBTA schedule)
export const wdOutbound = ${JSON.stringify(wdOut, null, 2)};

// Weekday inbound: Porter times (from MBTA schedule)
export const wdInbound = ${JSON.stringify(wdIn, null, 2)};

// Weekend outbound: Porter times
export const weOutbound = ${JSON.stringify(weOut, null, 2)};

// Weekend inbound: Porter times
export const weInbound = ${JSON.stringify(weIn, null, 2)};

// MBTA holidays on which Commuter Rail runs a weekend schedule
// Automatically fetched from MBTA API
export const MBTA_HOLIDAYS = {
${holidaysStr}
};`;

  const filePath = path.join(__dirname, '../src/scheduleData.js');
  fs.writeFileSync(filePath, content);
  console.log(`Updated ${filePath}`);
}

// Run the update
await fetchSchedules();