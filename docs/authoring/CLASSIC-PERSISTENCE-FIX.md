# Classic authoring persistence — 10 November 2026

The eight-section design preview previously rendered only explanatory copy beyond the first two Classic sections. That condition is not present in the production React components: KYC uses W01–W06 with real controls, while other current templates use GenericAuthoring with a persistent title/body form. This change does not claim those generic forms have become full per-template eight-section workbenches.

## Product changes

- KYC section navigation, reviewer-comment jumps and validation correction jumps flush pending changes before changing sections. A failed save keeps the current section and the typed answer, with a retryable error. Navigation buttons are disabled while the save is pending.
- New projects with an explicit authoring experience start directly in the Classic workbench instead of exposing the legacy generative document/interview start screen. Legacy unconfigured projects retain their existing entry point.
- View as Agent flushes Classic changes before requesting the preview and keeps the editor mounted while hidden. Returning restores the section and local field state. Classic/Chatbot switching continues to await the shared autosave barrier and persist unsent chat text separately from confirmed task output.
- No database migration, provider call, payout, cloud change or deployment is included.

## Validation scope

The actual Chrome/API/PostgreSQL test covers immediate KYC content-section changes, reload readback, failed-save retention, agent-preview return, shared Classic/Chatbot changes and unsent chat drafts. The catalogue loop checks each remaining template using its actual shared generic editor, server output readback, reload and reverse switching. KYC W06 is a validation/submission section rather than a narrative answer field.

Validation passed: one actual Chrome/API/PostgreSQL journey covering KYC and the other 13 catalogue templates; 23 candidate component tests; candidate typecheck; candidate production build. Browser coverage includes failed-save retention, section and view switching, reload, phone read-only, agent preview and PM project-mode creation. Evidence: /private/tmp/praxis-classic-persistence-browser.txt, /private/tmp/praxis-classic-candidate-tests.txt, /private/tmp/praxis-classic-types.txt and /private/tmp/praxis-classic-production-build.txt. The final empty-collection explanatory copy was added during the browser run and separately typechecked; it does not alter save logic. Two earlier browser attempts failed because of duplicate catalogue test-fixture setup, corrected before the passing run. No live model or deployed-environment acceptance is claimed.

## Figma handoff

The separate design pack at /Users/vasudevansundarababu/Documents/Codex/praxis-figma-handoff.zip contains seven PNG reference screens, a copy-ready design prompt, requirements and standalone interactive previews. The common eight-section UI and multi-agent/reviewer screens describe the target design, not completed functionality for every template.
