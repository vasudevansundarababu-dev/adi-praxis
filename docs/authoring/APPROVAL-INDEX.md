# Praxis authoring approval pack

Decision requested: approve or revise the shared authoring experience, facilitator boundaries, proposed architecture and scoped integration. This does not approve cloud deployment, model spending or native multi-agent benchmark execution.

1. [Requirements](CHATBOT-REQUIREMENTS.md)
2. [Architecture and chatbot memory](ARCHITECTURE.md)
3. [User journeys and handoffs](USER-JOURNEYS.md)
4. [Existing code capability audit and change flags](EXISTING-CAPABILITY-AUDIT.md)
5. [Validation evidence and limitations](VALIDATION-REPORT.md)

The accompanying interactive mockup switches single/multi views, expands role steps, inspects policy references and previews agent visibility. It is synthetic design content; its local interactions do not call a model or submit a task. Current code validation is reported separately.

Approval questions:
- Does chat + graph + node inspector + View as agent make the SME's work clear?
- Are examples useful while keeping substantive authorship with the SME?
- Is SME → Admin adequate for the demo, with expert-review flow explicitly deferred?
- Are the listed integration gaps acceptable before wider rollout?

## Revision 1.3
[Project authoring experience specification](AUTHORING-EXPERIENCE.md): required Classic / Chatbot / Both choice at project creation; fixed template agent type; one shared task and consistent controls. The new interactive preview covers project selection and SME switching. Project-mode persistence, API gating and migration remain implementation work.

## Local implementation and operating-cost planning
- [Classic/Chatbot/Both implementation handoff](IMPLEMENTATION-EXPERIENCE-HANDOFF.md)
- [Six-month hosting, chatbot and benchmark operating budget](SIX-MONTH-OPERATING-BUDGET.md)
- [MaaS model and token planning; no training planned](MAAS-MODEL-AND-TOKEN-PLAN.md)

Cost figures are planning assumptions, not approval to spend or deploy.
