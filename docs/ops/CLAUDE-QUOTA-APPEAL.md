# Claude on Vertex AI quota appeal (QA project)

Owner uses this text to appeal the automatic denial of 10 Nov 2026. Paste it into the quota request's justification
box, and into a Google Cloud support case or a message to Google Cloud sales.

## Request

- Project: `adi-praxis-test-0928`
- Service: Vertex AI API (`aiplatform.googleapis.com`)
- Quota: "Global online prediction requests per base model per minute"
  (`GlobalOnlinePredictionRequestsPerMinutePerProjectPerBaseModel`)
- Base model `anthropic-claude-sonnet`: **5** requests per minute
- Base model `anthropic-claude-haiku`: **5** requests per minute
- Base model `anthropic-count-tokens`: **5** requests per minute

## Justification (paste as is)

> We are building ADI Praxis, an internal platform where subject-matter experts author synthetic training tasks with
> the help of a chatbot. This project is our QA environment. We need a small Claude quota to test the chatbot
> before release: one or two people, manual testing only, typically under 100 requests per day. The application
> enforces a hard daily cap of 300 calls per client, and the project has a 500 USD monthly billing budget with alerts.
> Claude Sonnet 5.5 and Claude Haiku 5.5 are enabled in Model Garden and their terms are accepted. Our earlier
> request for 30 per minute was automatically denied; we are asking for 5 per minute. No real customer data is used;
> all content is synthetic.

## Where to send it

1. **Quota page:** console → IAM & Admin → Quotas & System Limits. Filter **Name: Global online prediction requests
   per base model per minute**, find the rows `anthropic-claude-sonnet` and `anthropic-claude-haiku`, Edit quota → 5,
   paste the justification.
2. **Support case:** console → Support → Create case → category "Quota" (or "Vertex AI"), paste the request and the
   justification. Include the trace id of the denial if asked: `05b3461a-0d48-426d-ac4d-d3e1f86febb7`.
3. **Sales (often fastest for partner models):** cloud.google.com/contact, ask for "Anthropic Claude on Vertex AI
   quota" for the project above.
