/**
 * Routine item definitions — shared between index.js and focus-queue.js.
 * Each item activates at a specific EST time and must be explicitly checked off.
 *
 * day: only show on this day of week (0=Sun, 6=Sat)
 * skipDays: array of days to skip
 */

export const ROUTINE_ITEMS = [
  {
    time: '06:00', text: 'Set today\'s energy baseline',
    sublabel: 'How rested are you? This scales all your time blocks.',
    isEnergyCheck: true, isBaselineSetter: true,
  },
  {
    time: '06:15', text: 'Exercise',
    sublabel: 'RPE 8/9, not 10. Leave "I could do 30 more mins."',
    hotkeys: { 0: ['reschedule', 'done'], default: ['done', 'reschedule'] },
  },
  { time: '06:15', text: 'Morning journal — look away, dictate what\'s on your mind' },
  { time: '06:15', text: 'Clear up all resources' },
  { time: '06:15', text: 'Manage fleet', isFleet: true },
  { time: '06:15', text: 'Set priorities', isPrioritySort: true },
  { time: '06:15', text: 'Team goals — QA targets + what ships today', sublabel: 'Outline what the team should focus on, starting with QA priorities' },
  // Energy transition check-ins — each shows the value-weighted day bar
  { time: '06:00', text: 'Full tank. Go.', sublabel: '3 sharp · 6 solid', isEnergyCheck: true },
  { time: '07:00', text: 'This is your most valuable hour.', sublabel: '2 sharp · 6 solid', isEnergyCheck: true },
  { time: '08:00', text: 'Most output per hour happens now.', sublabel: '1 sharp · 6 solid', isEnergyCheck: true },
  { time: '09:00', text: '60% of your real output is behind you.', sublabel: '6 solid left — sharp hours spent', isEnergyCheck: true },
  { time: '11:00', text: 'Each hour worth half of a morning hour.', sublabel: '4 solid left — diminishing fast', isEnergyCheck: true },
  { time: '12:00', text: 'This 90 min block = one morning hour.', sublabel: '3 left — scraps', isEnergyCheck: true },
  { time: '13:30', text: 'This whole block = 25 min at 8am.', sublabel: '90 min — almost nothing', isEnergyCheck: true },
  { time: '14:00', text: 'Make sure priorities are still correct', isPrioritySort: true },
  { time: '15:00', text: 'Walk away.', sublabel: 'Done.', isEnergyCheck: true },
  { time: '15:00', text: 'Pill day', day: 0 }, // Sunday only, 3pm EST
  { time: '17:00', text: 'Calendar checked — morning protected?', skipDays: [6] },
  { time: '17:30', text: 'Disconnected' },
]
