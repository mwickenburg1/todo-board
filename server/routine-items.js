/**
 * Routine item definitions — shared between index.js and focus-queue.js.
 * Each item activates at a specific EST time and must be explicitly checked off.
 *
 * day: only show on this day of week (0=Sun, 6=Sat)
 * skipDays: array of days to skip
 */

export const ROUTINE_ITEMS = [
  { time: '06:15', text: 'Exercise done' },
  { time: '09:00', text: 'At least 3 Claude instances launched with specs', skipDays: [6] },
  { time: '11:00', text: '11am review: check board, review Claude outputs, relaunch/redirect', skipDays: [6] },
  { time: '12:00', text: 'Pill day', day: 0 }, // Sunday only
  { time: '14:00', text: "Tomorrow's top 3 identified. Review Claude outputs, prep specs.", skipDays: [6] },
  { time: '16:30', text: 'Board set for morning. Claude outputs reviewed. Replies cleared. Blockers noted.', skipDays: [6] },
  { time: '17:00', text: 'Deep work item written as one sentence with first step', skipDays: [6] },
  { time: '17:00', text: "Can I sit down at 7:45 and go? If not, what's missing?", skipDays: [6] },
  { time: '17:00', text: "Calendar checked — morning protected?", skipDays: [6] },
  { time: '17:30', text: 'Disconnected' },
]
