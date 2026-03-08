/**
 * Routine item definitions — shared between index.js and focus-queue.js.
 * Each item activates at a specific EST time and must be explicitly checked off.
 *
 * day: only show on this day of week (0=Sun, 6=Sat)
 * skipDays: array of days to skip
 */

export const ROUTINE_ITEMS = [
  {
    time: '06:15', text: 'Exercise',
    sublabel: 'RPE 8/9, not 10. Leave "I could do 30 more mins."',
    hotkeys: { 0: ['reschedule', 'done'], default: ['done', 'reschedule'] },
  },
  { time: '07:30', text: 'Morning journal — look away, dictate what\'s on your mind' },
  { time: '07:45', text: 'Manage fleet', isFleet: true },
  { time: '07:50', text: 'Set priorities', isPrioritySort: true },
  { time: '15:00', text: 'Pill day', day: 0 }, // Sunday only, 3pm EST
  { time: '17:00', text: 'Calendar checked — morning protected?', skipDays: [6] },
  { time: '17:30', text: 'Disconnected' },
]
