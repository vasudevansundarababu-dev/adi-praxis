# 5. Finance

Finance owns what SMEs earn and how they are paid: rate cards, earnings and holds, the weekly pay run, reconciliation
with the payout provider, and monthly partner statements. Finance sees **Home** and **Payments**.

**How money flows**

1. A PM links a **rate card** version to each direct-pay requisition.
2. When a Validator accepts a task, an **earning** is written once at that rate card's price. Earnings are never
   edited; a correction is a reversal entry.
3. Every Monday a **pay run** is built for the previous Monday–Sunday. A PM **confirms** it, Finance **approves** and
   **submits** it to the payout provider (Trolley; simulated in test).
4. Held balances, and balances under USD 10 or INR 500, carry into the next run.
5. Each day's payments are **reconciled** against the provider's report; mismatches become **exceptions**.
6. Each month, partners get a **statement** with a fee for each candidate certified that month.

## 5.1 Rate cards

**Payments → Rate cards** lists each rate card and its versions (Currency, Per task, Hourly, Weekly cap).

1. Under **New rate card or version** fill **Name \*** (an existing name adds a new version), **Currency \***, at
   least one **Per accepted task** amount (Authoring, Annotation, RL review), and optionally Hourly rate and Weekly cap.
2. **Create rate card**. A rate card never changes; requisitions keep the version they are linked to.

## 5.2 Earnings and holds

**Payments → Earnings and holds**.

- Enter an **SME id** (36 characters, from a pay run or the candidate record) and select **Look up**, or **Show all**.
- **Reverse…** an earning: **Why** (5+ characters) → **Reverse**. The reversal is a new negative entry.
- **Place a pay hold**: **SME id \***, **Kind \*** (Dispute or Fraud flag), **Reason \*** → **Place hold**. Keep the
  hold id shown in the message.
- **Release a pay hold**: **Hold id \***, **Note (what was resolved) \*** → **Release hold**. The balance goes into the
  next pay run.

## 5.3 Pay runs

**Payments → Pay runs** shows each week with its status, amount to pay, held and carried amounts, and the next step.

1. **Build pay run** (leave the week blank for last week; a week must start on Monday).
2. Wait for a PM to **Confirm pay run** ("Waiting for a PM to confirm.").
3. Open the run, check **Payments**, **Held** and **Carried forward**, and select **Approve pay run**.
   - You cannot approve a run that pays you.
   - If a second-approver threshold is set, another Finance user must approve too ("You approved — a second approver
     is needed"). Otherwise one approval is enough and the audit log records a single-approver action.
4. Select **Submit to payout provider**. Payees are checked again; anyone no longer ready is held. Retrying never pays
   anyone twice. Statuses update as the provider reports (Paid, Returned, Failed).
5. Before submission you can **Cancel run…** with a reason (kept in the audit log) and build the week again.

## 5.4 Payout exceptions

**Payments → Payout exceptions**. Reconciliation runs every day for the previous day. To run it yourself: choose
**Reconcile the day (UTC) \*** → **Run reconciliation**. It reports the lines in the provider's report, mismatches and
new exceptions.

Each **Open** exception (unknown payment, different amount, currency or status, or a payment missing from the report):
enter **What you found and did** → **Resolve**.

## 5.5 Partner statements

**Payments → Partner statements**. Choose **Month \*** → **Build statements**. Each statement lists one fee line per
certified candidate. Lines at zero marked `NO_FEE_TERMS` mean the partner has no agreed fee terms yet (an Admin sets
them). Partners see their statements in the portal.

## 5.6 Things to know

- Amounts can be USD or INR; a payout shows the FX rate when converted.
- Finance without the Admin role sees partner ids rather than names on statements, and SME ids on pay-run lines.
