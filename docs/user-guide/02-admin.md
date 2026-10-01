# 2. Admin

An Admin sets up the platform so PMs can run projects and experts can work: workflow templates, guidelines with their
courses and tests, staffing partners, contributor terms, diversity attributes, RL failure codes and machine keys. An
Admin also has every Validator page and most PM pages. A full list of Admin functions, including the ones that only
exist in the API, is in [Roles, user IDs and admin functions](ROLES-AND-ADMIN.md#4-admin-functions).

**What an Admin cannot do:** create a project (only a PM can), or approve and submit a pay run (only Finance can).

## 2.1 Workflow templates

A template defines a kind of task. Projects can only be created from a **published** template, and a project keeps
the version it was created with.

**Add a domain**

1. **Projects → Templates**. At the bottom, fill **Add a domain \*** and select **Add domain**.

**Create and publish a template**

1. On **Templates**, select **New template**.
2. Choose **Domain \***, type **Workflow name \*** and select **Create draft**.
3. Fill the draft editor:
   - **Primary work**, **Verification / reward**, **Human gate (decisions workers must not make)**
   - **Default TPT (minutes, 1–480)**, **Skills (comma separated)**, **Task modes** (Authoring, Annotation)
   - **Distinct-task target \***, **Max tasks per expert \***, **Open-slot share (%)**, **Similarity threshold (0–1)**
   - **Coverage dimensions** (key, label, values) and **Coverage cells** (tags, **Quota \***, Required)
   - **Edge-case catalog** (name, **Quota \***, Required, description)
   - **Task definition schema (JSON)** and **Collection schema (JSON)**
4. Select **Save draft**. If something is wrong you see "Fix these before saving:" and a list.
5. Select **Publish**. Published versions cannot be edited ("Save your changes before publishing. Published versions
   can't be edited.").

**Change or retire a template**

- **New version** creates an editable draft copy. Projects already using the old version keep it.
- **Retire** → **Confirm retire** hides the workflow from new projects. Existing projects keep their version.
- The **Versions** sidebar shows every version.

## 2.2 Guidelines, courses and certification tests

Guidelines are the domain rules. From them Claude drafts a **knowledge map**, a **course** and a **certification
test** for each tier (Expert, Reviewer, Annotator). **Nothing reaches candidates until an Admin approves every part
and publishes the tier.**

**Create a package and upload a version**

1. **Certification → Guidelines**. Under **New guidelines package** fill **Domain \***, **Task family \*** (for
   example "KYC review") and **Name \*** (for example "Banking KYC guidelines"). Select **Create package**.
2. On the package card, under **Upload a new version \***, choose a PDF, DOCX, MD or TXT file up to 10 MB.
   Tick **Major change** if SMEs must take an update module and quiz before their next task.
3. Select **Upload**. The version page opens: "Version n uploaded (n sections). Generation has started."

**Watch generation**

- **Generation runs** lists each run: Started, Scope, Stage, Status (Queued, Running, Succeeded, Failed), Model and
  cost. While a run is active you see "Running now: refresh to see progress".
- To redo part of the work, use **Regenerate**: choose Everything, Knowledge map, Course, Blueprint or Item families,
  and **For tier** (default "Every unpublished tier"). Only one run at a time.

**Check the knowledge map**

The knowledge map lists rules, steps, thresholds, edge cases and failure modes, each citing its guideline section.
For each item: **Approve**, **Reject**, **Edit text** (then **Save**), and **Mark critical** for rules a candidate must
never miss (shown as "Critical rule"). Filter by Kind and Status (To review, Approved, Rejected).

**Approve each tier's course**

1. On the version page, open a tier's **Course**.
2. Read each module against its cited sections: explanation, good and bad examples, the quiz (✓ marks the right
   answer) and practice items. Candidates must score 80% on each module's quiz to unlock the next.
3. To change a module: **Edit module** → **Title \***, **Explanation \***, **Quiz (JSON) \*** → **Save module**. The
   course then needs approval again.
4. Under "Your decision on this course", optionally add a **Note**, then **Approve course** or **Reject**.

**Approve each tier's blueprint and item families**

The blueprint says how long the test is and how it is scored. Every candidate gets **different but equivalent
questions** generated from item families; the right answer always comes from the family's rule, never from the model.

1. Open the tier's **Blueprint**. Check Items, Time limit, Pass rules and Competencies.
2. To change them: **Edit length, time, pass rules and weights** → Items (5–100), Time limit (10–300 minutes),
   Overall pass mark %, Planted errors %, Written answer pass score, People confirming each authoring grade, "Fail on
   any critical-rule miss", and **Competency weights**, which must total 100. **Save blueprint**, then approve again.
3. **Approve blueprint** (or **Reject**).
4. Under **Item families**, check each family: its samples must pass "Key from rule", "Independent solve agrees",
   "Cited section supports it" and "Difficulty in band". Then **Approve family**. You can also **Generate another
   sample**, **Edit family** or **Reject** (only an Admin can reject).
   - Expert-tier families also need a Validator's approval (or an Expert's, once the domain has two certified
     Experts).
   - A family flagged after repeated validation failures must be edited or regenerated first.

**Publish a tier**

When a tier card shows **Ready to publish**, select **Publish *Tier*** → **Yes, publish *Tier***. Candidates can start
the course and test at once. A published tier cannot change: upload a new version instead.

A PM then links the package to a requisition ([PM chapter](03-pm.md#36-requisitions-sme-supply)).

## 2.3 Staffing partners

**Add a partner**

1. **Partners → Partners**. Under **Add a partner** fill **Partner name \***, Business check (Pending, Verified,
   Rejected), Domains (blank = any), Fee terms version, the tiers it may supply (none ticked = any) and contacts.
2. Select **Add partner**, then open the partner.

**On the partner's page**

- **Settings** → **Save settings**. **Suspend partner** stops it at once and ends every API token; **Reactivate
  partner** restores it.
- **Fee terms**: **Fee per certified candidate \***, **Currency \*** (USD or INR), **Terms version \*** → **Save fee
  terms**. New terms apply to candidates certified from now on. Without terms, fees are recorded at zero.
- **Portal users**: **Name \***, **Email \***, **Initial password (12+ characters) \*** → **Add user**. Give the
  password to the person through a secure channel. Portal users cannot be disabled yet; suspend the partner instead.
- **API clients and webhooks** are read-only here; the partner manages them in the portal.

## 2.4 Console users

**Admin → Users** lists everyone with their roles (Admin, PM, Validator, Finance) and status. **There is no screen yet
to add users, change roles or disable accounts.** Use the API with an Admin session or ask the platform team:

| To | Call |
| --- | --- |
| Add a user | `POST /api/v1/users` with `email`, `name`, `roles` (for example `["PM"]`) and an initial `password` |
| Change roles | `PATCH /api/v1/users/{id}/roles` with `roles` |
| Disable or re-enable | `PATCH /api/v1/users/{id}/status` with `status` `DISABLED` or `ACTIVE` (signs the user out everywhere) |

You cannot remove your own Admin role or disable yourself.

## 2.5 Diversity taxonomy, terms, failure codes and API keys

**Taxonomy** (Admin → Taxonomy): the demographic filters PMs set in step 4 of the project wizard. Add one with
**Label \***, **Key (lower_snake_case) \***, **Type \*** (single choice, multiple choice, number range, city and
radius, language and level) and **Allowed values (JSON) \*** → **Add attribute**.

**Contributor terms** (Admin → Terms): the documents experts accept in onboarding. **Publish new version** → **Title
\*** and **Approved text \*** (at least 20 characters) → **Publish version N**. Experts must accept the new version
before their next assignment. A "Placeholder" pill marks text that blocks onboarding in production.

**Failure codes** (Admin → Failure codes): reasons Validators attach to RL review failures. **Add code** with
**Code \*** (upper case, for example `WRONG_TOOL`) and **Label \***. **Deactivate** hides a code from new reviews;
past verdicts keep it.

**API clients** (Admin → API clients): keys for RL Gym and for client systems that push annotation inputs. Enter
**Name \***, choose **Kind \*** ("Client system (task inputs)" or "RL Gym") and select **Create key**. **Copy the key
now: it is never shown again.** **Revoke** stops it at once.

## 2.6 Doing Validator and PM work

An Admin sees every review queue for every project (see the [Validator chapter](04-validator.md)) and every project
(see the [PM chapter](03-pm.md)). On Payments an Admin can build, confirm and cancel pay runs, manage rate cards,
earnings, holds, exceptions and statements, but not approve or submit a pay run.

## 2.7 Things only available through the API (release 1.1)

- The **Approved Task Dataset**: browse, export, correction records, and verify the hash chain
  (`/api/v1/dataset…`). A nightly job also verifies the chain.
- **SME standing and tier changes** (`POST /api/v1/sme/{id}/standing`).
- The **audit log** has no screen or API; it is in the database.
