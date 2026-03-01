# Call-to-Account Association Discussions — Slack Channel C091XFR1TL4

Extracted from 286 messages across 202 threads. Filtered to 26 relevant threads.

---

## Key Threads by Topic

### 1. Core Association Logic — How it Works Today

**2026-02-10 — Ian D'Silva** (15 messages)
Ian asks "How does call to account mapping work?" after a Sola Impact call got tagged to Sola Rentals.
- **Matthias explains the chain**: participant email → Contact in SFDC → Account that Contact is assigned to
- **Juan Castro's investigation**: Both Sola Impact and Sola Rentals had contacts on the call. System picked the only *open opportunity* at the time of the call, which belonged to Sola Rentals.
- **Ian's feedback**: Suggests deferring to active *account* vs open *opportunity* — "not entirely sure what in SFDC is our source of truth for active account but total active communities or total contracted communities is maybe a decent proxy"
- **Travis flags another misattribution**: A call attributed to Greystar when the contacts aren't attributed to Greystar in SFDC. Says this "is affecting a critical workflow we've built internally (outside of Attention) that extracts issues from call transcripts, so we can automatically create Zendesk tickets."

### 2. Multi-Account Calls — The Core Problem

**2026-02-13 — Ian D'Silva** (24 messages) — **MOST RECENT, ACTIVE THREAD**
Another wrong-account call. This triggers a deeper investigation.
- **Matthias**: "Should we do a mass pull of recent calls and see the matching behavior, so we can address all of these at once?"
- **Root cause identified**: Gong imports sometimes had multi-account linked to a single call. When contacts from multiple accounts are on the same call, the system picks one, sometimes wrong.
- **Matthias proposes**: "From product POV should also extend to support multiple accounts tied to a given call" — asks if both accounts should be linked, or just the primary one.
- **Matthias does historical audit** (Feb 14): "The driving factor for inaccuracies when they do happen is when there are contacts from multiple accounts on same call."
- **Heuristic proposed**: Check the call title for the account name. "Seems like the majority have title there, but there are a few ambiguous cases, mostly office hours."
- **Travis**: "when do you expect the historical analysis and fix to be implemented? if it's going to be more than a couple days, we're going to figure out a solution on our end."
- **Status**: Matthias completed audit, proposed matching heuristics, waiting on the "rule to follow" from Elise team.

### 3. External Calls Mapping to Internal — Domain Issues

**2025-08-06 — Jack Tannenbaum** (14 messages)
External calls mapping to "EliseAI Internal" as an account.
- **Root cause**: `meetelise.com` wasn't registered as an internal domain for that team, so the system treated Elise employees as external contacts.
- **Fix by Brayan**: Excluded `@meetelise.com` in the auto-select. Previously only `@eliseai.com` was excluded.

### 4. Dual Domain / User Association Issues

**2025-06-30 — Rishabh** (60 messages)
Two bots joining the same call because of `eliseai.com` vs `meetelise.com` email mismatch.
- Users signed up with `eliseai.com` but calendars under `meetelise.com`
- Attention doesn't support dual-email per user
- **Fix**: Migrated all users to `meetelise.com` domain
- **Matthias**: "Switching to meetelise would also allow us to associate their gong call history to their account, since the gong calls are all under that domain"

### 5. Gong Call Import — Missing Account/Opp Association

**2025-07-01 — Rishabh** (21 messages)
Gong calls synced but missing accounts/opportunities.
- "For these calls, I do not see accounts or opps associated with them — does it just take a bit longer to aggregate this for gong calls?"
- Rishabh: "if we migrate all of our calls over from Gong, would want them to associate the opportunity + speaker names"

### 6. Outreach Calls — CRM Linking

**2025-07-25 — Sari Elsaka** (5 messages)
Outreach workflow not linked to Salesforce metadata.
- Kyle: "When Outreach syncs calls to salesforce, they stamp a Contact field on the call task record"
- Kyle: "we want to sync to the opp that was a result of the cold call but the opp won't be created until after the cold call takes place" — chicken-and-egg problem for pre-opp cold calls
- Need: "at the very least, will need to cold call connected to the contact/account"

### 7. Account-Level Timeline / Intelligence

**2025-07-29 — Rishabh** (28 messages)
Request for account-level timeline view.
- "Account level timeline view of all calls and emails"
- Led to Olivia designing an accounts page with timeline
- Travis: wants emails per account for intelligence + automations + API export
- **Matthias**: "ideal would be to have a piece in the builder + API where you can provide an account id and either get all emails tied to the account, or all touch points (calls + emails)"

### 8. Helper Bot + Account Context

**2025-09-25 — Travis Atkins** (18 messages)
Kevin Park wants to ping Attention helper with a query for a given account id.
- Use case: CSM marks account at risk → pings Attention to check if certain conversations have taken place → generates action items
- **Matthias**: "Very doable", estimated 3 weeks

**2025-11-18 — Travis Atkins** (26 messages)
Helper bot doesn't read Slack channel context, only individual threads.
- Travis compares Attention vs competitor "Kai" which reads all slacks, emails, calls
- Kai produced much more actionable output with linked sources
- **Matthias**: "Will make sure it can read slack + zendesk"

### 9. Call Labels / Tags for Categorization

**2025-12-05 — Ian D'Silva** (74 messages)
Deep thread about call labels, backfilling, and using them for analytics.
- Multi-match labels (one call = multiple tags) not supported natively
- Retroactive backfilling requires engineering work
- 30k call backfill coordinated over several weeks

### 10. Filtering by Contact Persona

**2026-01-24 — Jorge** (13 messages)
Want to filter calls by contact persona (Exec, Leasing, etc.)
- Chain: participant email → Contact → Persona field → filter/analytics
- Need this in All Calls view and analytics/scorecards

### 11. Call Ownership vs Participation

**2026-02-02 — Katherine Tomlin** (40 messages)
Auditing AE coverage after book changes.
- Ronnie: "we don't have such a direct relationship between conversation and participants"
- Can only report on calls *owned by* an AE, not calls they *participated in*
- Workaround: daily Google Sheet report of AE-owned calls

---

## Summary: Recurring Pain Points

1. **Multi-account calls**: When contacts from multiple accounts are on the same call, system picks one account (sometimes wrong). Proposed fix: use call title as tiebreaker, or support multiple accounts per call.

2. **Domain matching**: Internal domains must be fully configured. The `meetelise.com` vs `eliseai.com` issue caused several problems.

3. **Gong/Outreach imports**: Imported calls may lack proper account/opp association. Cold calls have a chicken-and-egg problem with opp creation.

4. **Participant vs owner**: No direct relationship between conversations and participants — only the call "owner" is tracked, making reports incomplete.

5. **Account-level intelligence**: Strong demand for querying all calls/emails/slack for a given account. Helper bot and agents need this context.

---

## Active / Open Items (as of Feb 14, 2026)

- **Call-to-account misattribution fix**: Matthias completed audit, identified multi-contact calls as root cause. Proposed matching by call title. Waiting on rule guidance from Elise team. Travis wants fix ASAP or they'll build their own solution.
- **Support multiple accounts per call**: Matthias proposed extending the product to support this.
- **Participant tracking**: No direct conversation-to-participant relationship exists yet.
