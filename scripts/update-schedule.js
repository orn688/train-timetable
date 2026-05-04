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
const PORTER_STOP_ID = 'place-porter';
const NORTH_STATION_STOP_ID = 'place-north';

// Time helpers
const timeToMin = (timeStr) => {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
};

const minToTime = (mins) => {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  const display12 = h % 12 === 0 ? 12 : h % 12;
  const ampm = h < 12 ? 'AM' : 'PM';
  return `${display12}:${String(m).padStart(2, '0')} ${ampm}`;
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
    const wdOutbound = await fetchSchedulesByStop(PORTER_STOP_ID, weekdayDate, 'outbound');
    const wdInbound = await fetchSchedulesByStop(NORTH_STATION_STOP_ID, weekdayDate, 'inbound');

    console.log(`Fetching weekend schedule for ${weekendDate}...`);
    const weOutbound = await fetchSchedulesByStop(PORTER_STOP_ID, weekendDate, 'outbound');
    const weInbound = await fetchSchedulesByStop(NORTH_STATION_STOP_ID, weekendDate, 'inbound');

    console.log('Fetching MBTA holidays...');
    const holidays = await fetchMBTAHolidays();

    // Generate the scheduleData.js file
    generateScheduleFile(wdOutbound, wdInbound, weOutbound, weInbound, holidays);
    console.log('✓ Schedule data updated successfully');
  } catch (error) {
    console.error('Error fetching schedules:', error.message);
    process.exit(1);
  }
}

async function fetchSchedulesByStop(stopId, dateStr, direction) {
  const params = new URLSearchParams({
    'filter[route]': ROUTE_ID,
    'filter[stop]': stopId,
    'filter[date]': dateStr,
    'sort': 'arrival_time',
  });

  const url = `${MBTA_API_BASE}/schedules?${params.toString()}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`MBTA API error: ${response.statusText}`);
  }

  const data = await response.json();
  const schedules = data.data || [];

  // Filter by direction and extract train/time info
  return schedules
    .filter(s => {
      if (direction === 'outbound') return s.direction_id === 0;
      if (direction === 'inbound') return s.direction_id === 1;
      return true;
    })
    .map(s => ({
      train: s.trip?.short_name || s.trip?.name || 'Unknown',
      time: s.arrival_time ? s.arrival_time.substring(0, 5) : 'N/A',
    }))
    .filter(item => item.time !== 'N/A')
    .sort((a, b) => timeToMin(a.time) - timeToMin(b.time));
}

async function fetchMBTAHolidays() {
  // Fetch services to identify holidays
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

  // Build holidays object from service calendars
  const holidays = {};

  for (const service of services) {
    if (service.schedule_name && service.schedule_name.toLowerCase().includes('holiday')) {
      // This is likely a special holiday service
      const startDate = service.start_date;
      const endDate = service.end_date;

      if (startDate && endDate) {
        const start = new Date(startDate);
        const end = new Date(endDate);

        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
          const dateStr = formatDate(d);
          // Try to get holiday name from service name
          const name = extractHolidayName(service.schedule_name);
          if (name) {
            holidays[dateStr] = name;
          }
        }
      }
    }
  }

  if (Object.keys(holidays).length === 0) {
    throw new Error('No holidays found in MBTA API response');
  }

  return holidays;
}

function extractHolidayName(serviceName) {
  // Parse holiday names from service schedule names
  const nameMap = {
    'thanksgiving': 'Thanksgiving',
    'christmas': 'Christmas',
    'new year': "New Year's Day",
    'mlk': 'Martin Luther King Jr. Day',
    'presidents': "Presidents' Day",
    'patriots': "Patriots' Day",
    'memorial': 'Memorial Day',
    'juneteenth': 'Juneteenth',
    'independence': 'Independence Day',
    'labor': 'Labor Day',
    'columbus': 'Columbus Day',
    'veterans': "Veterans Day",
  };

  const lower = serviceName.toLowerCase();
  for (const [key, name] of Object.entries(nameMap)) {
    if (lower.includes(key)) {
      return name;
    }
  }
  return null;
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