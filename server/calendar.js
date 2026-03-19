/**
 * Google Calendar integration — polls for upcoming meetings,
 * injects pulse items into the focus queue.
 */

import { google } from 'googleapis'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const KEY_PATH = resolve(__dirname, '..', 'config', 'gcal-service-account.json')

// Calendar to fetch — set to your primary calendar email
const CALENDAR_ID = process.env.GCAL_CALENDAR_ID || 'matthias@attention.tech'
const POLL_INTERVAL_MS = 60_000 // 1 min
const MEETING_HORIZON_MS = 10 * 60_000 // inject pulse items for meetings <10 min away
const BANNER_HORIZON_MS = 12 * 60 * 60_000 // cache next 12h for the banner

let auth = null
let calendar = null
let lastInjectedEventId = null

function initAuth() {
  try {
    const key = JSON.parse(readFileSync(KEY_PATH, 'utf8'))
    auth = new google.auth.GoogleAuth({
      credentials: key,
      scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
    })
    calendar = google.calendar({ version: 'v3', auth })
    console.log('[calendar] Authenticated with service account')
    return true
  } catch (err) {
    console.error('[calendar] Auth failed:', err.message)
    return false
  }
}

async function getUpcomingEvents() {
  if (!calendar) return []
  const now = new Date()
  const horizon = new Date(now.getTime() + MEETING_HORIZON_MS)

  try {
    const res = await calendar.events.list({
      calendarId: CALENDAR_ID,
      timeMin: now.toISOString(),
      timeMax: horizon.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 5,
    })
    return (res.data.items || []).map(event => ({
      id: event.id,
      title: event.summary || '(no title)',
      start: event.start?.dateTime || event.start?.date,
      end: event.end?.dateTime || event.end?.date,
      meetLink: event.hangoutLink || event.conferenceData?.entryPoints?.[0]?.uri || null,
      htmlLink: event.htmlLink,
      location: event.location || null,
      attendees: (event.attendees || []).length,
    }))
  } catch (err) {
    console.error('[calendar] Fetch failed:', err.message)
    return []
  }
}

export function startCalendarPoller(readData, saveData, createTask) {
  if (!initAuth()) {
    console.error('[calendar] Disabled — no valid service account key')
    return
  }

  console.log(`[calendar] Polling every ${POLL_INTERVAL_MS / 1000}s for ${CALENDAR_ID}`)

  const poll = async () => {
    // Wider fetch for banner cache
    try {
      const now = new Date()
      const bannerHorizon = new Date(now.getTime() + BANNER_HORIZON_MS)
      const res = await calendar.events.list({
        calendarId: CALENDAR_ID,
        timeMin: now.toISOString(),
        timeMax: bannerHorizon.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 20,
      })
      cachedEvents = (res.data.items || []).map(event => ({
        id: event.id,
        title: event.summary || '(no title)',
        start: event.start?.dateTime || event.start?.date,
        end: event.end?.dateTime || event.end?.date,
        meetLink: event.hangoutLink || event.conferenceData?.entryPoints?.[0]?.uri || null,
        htmlLink: event.htmlLink,
      }))
    } catch {}

    // Banner handles display — no pulse injection needed
  }

  // Initial poll
  poll()
  // Then every minute
  setInterval(poll, POLL_INTERVAL_MS)
}

// Cache of upcoming events for the banner endpoint
let cachedEvents = []

export function getNextMeeting() {
  const now = Date.now()
  // Skip events that have already started — show the next upcoming one
  return cachedEvents.find(e => new Date(e.start).getTime() > now) || null
}

export function getCurrentMeeting() {
  const now = Date.now()
  return cachedEvents.find(e => {
    const start = new Date(e.start).getTime()
    const end = new Date(e.end).getTime()
    return start <= now && end > now
  }) || null
}

export function calendarRouter(express) {
  const router = express.Router()

  router.get('/next', (_req, res) => {
    const current = getCurrentMeeting()
    const next = getNextMeeting()

    const fmt = (e) => {
      if (!e) return null
      const start = new Date(e.start)
      const end = new Date(e.end)
      const minsUntil = Math.round((start.getTime() - Date.now()) / 60_000)
      const minsLeft = Math.round((end.getTime() - Date.now()) / 60_000)
      const timeStr = start.toLocaleTimeString('en-US', {
        timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true,
      })
      return {
        title: e.title !== '(no title)' ? e.title : 'Meeting',
        time: timeStr,
        minsUntil,
        minsLeft,
        meetLink: e.meetLink,
        htmlLink: e.htmlLink,
      }
    }

    res.json({
      current: fmt(current),
      next: fmt(next),
    })
  })

  return router
}

// Standalone test
export { getUpcomingEvents, initAuth }
