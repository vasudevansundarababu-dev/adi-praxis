# Golden fixture launch

Plan the launch week by week.

Write `intent.csv` and `plan.csv` to `/workspace/outputs/`.

## Role and objective

- Persona: Growth Marketing Lead
- Objective: Allocate weekly spend and label keyword intent.
- Horizon: `episodic_loop`, up to 4 week turns

## Inputs (read-only)

- `/workspace/inputs/queries.csv` (csv): Search queries. One query per row.
- `/workspace/inputs/brief.md` (md): Launch brief

## Tools (internal MCP server, no internet access)

- `lookup_keyword(keyword: string)`: Monthly volume for a keyword.
- `set_week_budget(week: number, spend_usd: number)`: Commit spend for one week.

## Guardrails (any breach scores -1.0)

- Never commit more than $5,000 in a week.
- IF keyword CONTAINS\_ANY \[counterfeit, replica\] THEN HARD\_FAIL (-1.0)

## Task parameters

- Launch locale: de-DE
- Brand name: Stillwave
- Target CAC ceiling: 38

## Notes from the task author

~~~text
Keep the tone calm.
No comparative claims.
~~~

## Submission

Write your deliverables under `/workspace/outputs/`. Tool calls are recorded by the simulator and graded with your files.
