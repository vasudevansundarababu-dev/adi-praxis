// Non-functional: performance, compatibility, accessibility, resilience, usability, India-specific.
// Targets marked "proposed" are Claude's proposal (docs/DECISIONS.md); report misses as type:ux with the numbers.
const c = (id, title, o) => ({ id, title, persona: 'Several', category: 'NFR', ...o });

export const CASES = [
  // ── Performance (from India, on the test environment) ──
  c('TC-NFR-001', 'Page load on office broadband and on 4G from India', {
    priority: 'P1', pre: 'Chrome DevTools → Network: "No throttling", then "Fast 4G", then "Slow 4G". Disable cache.',
    steps: ['Measure with DevTools → Lighthouse (mode: navigation, device: mobile and desktop) for: candidate sign-in, candidate home, opportunity page, profile chat, workbench W02, console home, applications list, task review.', 'Record LCP, total blocking time and page weight in the run log.'],
    expected: ['Proposed targets: LCP ≤ 2.5 s on broadband, ≤ 4 s on Fast 4G; no page over 1.5 MB transferred.', 'Slow 4G: pages still load and show progress; no blank screen longer than 10 s.', 'Note: the first request after idle can take 5–10 s (servers scale to zero in test). Record cold and warm separately.'],
    decisions: ['D-PL-08'],
  }),
  c('TC-NFR-002', 'Response times of key actions', {
    priority: 'P1', pre: 'Warm environment (click around for a minute first).',
    steps: ['Time with a stopwatch or DevTools: profile chat reply (real AI); Record decision; Re-run match; W06 Run checks; Submit for review; Draft my task (full draft); Redraft one section.'],
    expected: ['Proposed targets: saves and decisions ≤ 2 s; Run checks ≤ 5 s; chat reply ≤ 15 s; full draft ≤ 90 s; one section ≤ 45 s.', 'Anything slower shows a clear progress state, never a frozen button.'],
    decisions: ['D-M9-04', 'D-M4-04'],
  }),
  c('TC-NFR-003', 'Several testers at once (light load)', {
    priority: 'P2', pre: 'Agree a 30-minute slot (IST) with all testers.',
    steps: ['Everyone runs TC-SME-042 (drafting) and TC-REV-012 at the same time.', 'Note errors and times.'],
    expected: ['No errors; times within 2× of TC-NFR-002. Drafts queue rather than fail.'],
    decisions: ['D-M9-04'],
  }),
  c('TC-NFR-004', 'Staffing match with many candidates', {
    priority: 'P3', pre: 'Lead only: a project with several hundred synthetic candidates (the seed-candidates script; ask a developer).',
    steps: ['Re-run match.'],
    expected: ['SPEC target: the match runs in under 2 s (for up to 50,000 candidates); the page shows the result within 3 s including network. The list is sorted by score.'],
    decisions: ['D-M3-02'],
  }),

  // ── Compatibility ──
  c('TC-NFR-010', 'Browsers and devices used in India', {
    priority: 'P1', pre: 'Devices listed in README "Browsers and devices".',
    steps: ['Run TC-SME-001, TC-SME-011, TC-SME-020 and TC-SME-041 on: Chrome (Windows), Edge (Windows), Firefox (Windows), Safari (macOS), Chrome (Android, mid-range phone), Safari (iPhone).', 'Run TC-REV-012 and TC-PM-006 on Chrome and Edge desktop.'],
    expected: ['Everything works and looks the same; no horizontal scrolling on phones; chips and buttons are tappable.', 'Date pickers accept dates in the browser\'s local format (DD/MM/YYYY in India) and store them correctly.'],
    decisions: ['D-FB-04'],
  }),
  c('TC-NFR-011', 'Screen sizes and zoom', {
    priority: 'P2', pre: 'Chrome.',
    steps: ['Test widths 360, 768, 1024, 1366, 1920 px (DevTools device toolbar).', 'Zoom to 200% on a desktop page.'],
    expected: ['Nothing overlaps or is cut off; the console navigation scrolls sideways on narrow screens; at 200% all content is usable.'],
    decisions: [],
  }),
  c('TC-NFR-012', 'Dark and light system themes', {
    priority: 'P3', pre: 'Switch the operating system between dark and light mode.',
    steps: ['Open candidate home, the chat, the workbench, the console home and the task review in both.'],
    expected: ['Text is readable in both (WCAG AA contrast); no white text on white or dark on dark.'],
    decisions: ['D-FB-04'],
  }),

  // ── Accessibility ──
  c('TC-NFR-020', 'Keyboard only', {
    priority: 'P1', pre: 'Put the mouse away.',
    steps: ['Complete sign-in, the profile chat (including chips), onboarding and W00 interview using only Tab, Shift+Tab, Enter and Space.', 'In the console, record an application decision with the keyboard.'],
    expected: ['Every control is reachable in a sensible order with a visible focus ring; chips toggle with Space/Enter; no keyboard trap.'],
    decisions: ['D-FB-01', 'D-M9-03'],
  }),
  c('TC-NFR-021', 'Screen reader', {
    priority: 'P2', pre: 'NVDA (Windows, free) with Chrome, or VoiceOver (macOS/iPhone).',
    steps: ['Sign in, answer two chat questions, open W00 and upload a file.'],
    expected: ['Buttons and fields are announced with meaningful names; new chat messages and "Saved" are announced; errors are announced.'],
    decisions: [],
  }),
  c('TC-NFR-022', 'Automated accessibility scan', {
    priority: 'P2', pre: 'Chrome with the axe DevTools extension (free) or Lighthouse → Accessibility.',
    steps: ['Scan the pages listed in TC-NFR-001.'],
    expected: ['No "serious" or "critical" issues. Report each finding with its rule id (e.g. color-contrast).'],
    decisions: [],
  }),

  // ── Resilience ──
  c('TC-NFR-030', 'Network drops while working', {
    priority: 'P1', pre: 'A task in the workbench; the profile chat.',
    steps: ['DevTools → Network → Offline. Type in the workbench; send a chat answer.', 'Go back online.'],
    expected: ['A clear message (not a blank page); after reconnecting, autosave resumes and nothing typed is lost; resending the chat answer does not duplicate it.'],
    decisions: ['D-PL-06', 'D-M5-12'],
  }),
  c('TC-NFR-031', 'Double submits and repeated clicks', {
    priority: 'P1', pre: 'Any form.',
    steps: ['Double-click: Record decision, Accept (assignment), Submit for review, Draft my task, Upload, Accept (task review).'],
    expected: ['Each acts once; no duplicate records, emails, drafts or files.'],
    decisions: ['D-PL-06'],
  }),
  c('TC-NFR-032', 'Back, forward and refresh', {
    priority: 'P2', pre: 'Mid-way through onboarding, chat and the workbench.',
    steps: ['Use browser Back/Forward and F5 at each step.'],
    expected: ['You land on a valid page showing the current state; no "resubmit form?" prompts; no lost data.'],
    decisions: [],
  }),
  c('TC-NFR-033', 'Nightly deploy does not lose data', {
    priority: 'P1', pre: 'Work in progress (a half-written task, a half-done profile) before 02:00 IST.',
    steps: ['Next morning, reopen the same items.'],
    expected: ['Everything is as you left it, on the new build.'],
    decisions: ['D-PR-02'],
  }),

  // ── Usability and content ──
  c('TC-NFR-040', 'First-time SME usability (think aloud)', {
    priority: 'P1', pre: 'A colleague who has never seen the product and knows KYC (ideally a real KYC practitioner). You observe; do not help.',
    steps: ['Ask them to apply, finish the profile and draft one task using the interview. Record where they hesitate, what they ask, and the time taken.'],
    expected: ['They finish without help. Every hesitation longer than 10 s is logged as a UX observation (type:ux) with the screen and what they expected.'],
    decisions: ['D-FB-01', 'D-M9-01', 'D-M9-05'],
  }),
  c('TC-NFR-041', 'Messages are clear and kind', {
    priority: 'P2', pre: 'While running all other cases.',
    steps: ['Collect every error, empty-state and status message you see.'],
    expected: ['Each says what happened and what to do next, in plain English, without blame or technical codes. Report the ones that do not.'],
    decisions: [],
  }),
  c('TC-NFR-042', 'Indian names, scripts and formats', {
    priority: 'P2', pre: 'New candidates.',
    steps: ['Sign up with names such as "S. Venkataraman", "Mohammed Aamir Khan", "Priya K. R.", a single name "Sundaram", and a name in Devanagari "प्रिया शर्मा" and Tamil "பிரியா".', 'Use them through the profile, application list and task review.'],
    expected: ['Names display exactly, in every script, without "?" or boxes; single names are accepted; sorting and search do not break.'],
    decisions: [],
  }),
  c('TC-NFR-043', 'Times and dates in IST', {
    priority: 'P2', pre: 'A computer set to India Standard Time.',
    steps: ['Check times shown for "Saved", draft history, decision history and assignment expiry.'],
    expected: ['Times are in your local time (IST) and dates are unambiguous. Report any UTC-looking times.'],
    decisions: ['D-M4C-11'],
  }),
];
