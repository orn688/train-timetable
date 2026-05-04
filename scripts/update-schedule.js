#!/usr/bin/env node

/**
 * Update schedule data from MBTA API
 * Fetches the latest Fitchburg Line schedule and updates src/scheduleData.js
 */

const fs = require('fs');
const path = require('path');

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

    // Generate the scheduleData.js file
    generateScheduleFile(wdOutbound, wdInbound, weOutbound, weInbound);
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

function generateScheduleFile(wdOut, wdIn, weOut, weIn) {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];

  const content = `// Train schedule data for the Fitchburg Line
// This file is automatically updated weekly by GitHub Actions
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
export const MBTA_HOLIDAYS = {
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
};`;

  const filePath = path.join(__dirname, '../src/scheduleData.js');
  fs.writeFileSync(filePath, content);
  console.log(`Updated ${filePath}`);
}

// Run the update
fetchSchedules();