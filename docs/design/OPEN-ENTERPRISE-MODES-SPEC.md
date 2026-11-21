# Open and Enterprise modes: specification

**Revision:** 1, 20 Nov 2026. **From:** Product Owner. **For:** the ADI Forge, RL Gym and Template Studio teams.
**Status:** agreed direction, future build. Requirements: TS-44 and TS-50 to TS-56 in
`docs/design/TEMPLATE-STUDIO-REQUIREMENTS-LOG.md`.

> **Until the non-negotiables in `CLAUDE.md` and `docs/SPEC.md` are rewritten (section 8), today's rule applies
> everywhere:** task content is synthetic only, and no identity numbers or images are stored. That includes QA and
> staging. Nothing in this document permits real data before that change.

---

## 1. The idea

ADI Forge (authoring), RL Gym and the Template Studio each run in one of two modes, from the **same code**.

| | **Open** | **Enterprise** |
|---|---|---|
| **Where** | ADI Labs' GCP projects | Inside the bank's or enterprise's own environment (its cloud project or on-premises) |
| **Data** | Enterprise-sourced data, **de-identified**: PII replaced with synthetic values (SSN, PAN, Aadhaar, names, accounts, addresses) | **Real data, including PII**, from a training dump the enterprise supplies |
| **Who can see the data** | ADI Labs staff, SMEs, RL Gym, approved evaluator vendors | **Only the enterprise's own people.** ADI Labs staff cannot. |
| **Used for** | Public, reproducible, industry-standard benchmarks | **Private benchmarks and telemetry** on the enterprise's own data |
| **Data source** | The Studio's dataset generator and the data intake utility | The enterprise's dump, through its own intake utility |

**What a dump is:** a snapshot or copy the enterprise prepares for training and evaluating agents. It is isolated
from the enterprise's live systems, and it is **never production data**. The environments built from it are copies
too, never connected to live systems. A copy of customer data is still personal data under privacy law (GLBA and
state laws in the US, DPDP in India), so the protections below apply to it.

## 2. One build, separate deployments (TS-55)

- **One build.** Both modes run the same source code and the same images, built once and pinned by `@sha256`.
  The Open benchmark and the private Enterprise runs therefore never drift apart.
- **Two deploy pipelines.**
  - **Open:** deploys to ADI Labs' projects, using the shared release registry.
  - **Enterprise:** delivers the **same image digests** into the enterprise's environment. It has its own
    credentials, its own registry, its own secrets and no connection back to Open. The enterprise's operators run
    it, or ADI Labs runs it under the enterprise's access controls.
- **Mode is fixed per deployment (TS-50),** set in deploy configuration as `MODE=open` or `MODE=enterprise`. With no
  mode, or an unknown one, every service refuses to start.

**Enforcement in three places**

| Layer | Open | Enterprise |
|---|---|---|
| Deploy configuration | `MODE=open`; Open registry and Open evaluator vendors | `MODE=enterprise`; enterprise registry; vendor list approved by the enterprise |
| Network rules | Normal outbound access for approved services | **Outbound traffic denied by default.** No route to Open services; only vendors the enterprise approved |
| Code | Refuses data that is not marked `deidentified` or `synthetic` | Refuses features that send data out (Open registry publish, unapproved vendors, ADI Labs telemetry with PII) |

## 3. Data flow rules

1. **Enterprise to Open: nothing by default.** Only what the enterprise explicitly approves may leave: aggregate
   scores, or telemetry checked to contain no PII. Each outbound item is logged and audited.
2. **Open to Enterprise is allowed.** Releases (template, environment, domain packs) can be delivered into an
   Enterprise deployment by digest, so the bank runs the same benchmark privately on its own data.
3. **Enterprise data enters Open only through de-identification** (section 4), with a licence that allows it
   (section 5).
4. Every dataset, task and export carries a `content_classification` of one of these:
   - `synthetic`: generated, no real person;
   - `deidentified`: from a licensed dump, PII replaced, re-identification check passed;
   - `enterprise_pii`: real; valid only in Enterprise.

   Open refuses `enterprise_pii` everywhere.

## 4. De-identification for Open (TS-51)

Redaction alone is not enough. People can be identified from combinations of other fields.

| Field type | Treatment |
|---|---|
| **Direct identifiers:** names, SSN/ITIN, PAN, Aadhaar, passport, account and card numbers, phone, email, street address, ID images | **Replaced** with synthetic values in the right format. Aadhaar and similar numbers are always synthetic, never masked originals. ID images are removed, never stored. |
| **Quasi-identifiers:** date of birth, ZIP or PIN code, employer, job title, rare attributes | **Generalised:** e.g. date of birth to an age band, ZIP code to its first 3 digits, rare values to a category |
| **Free text:** notes, narratives, document text | **Scrubbed** for names, numbers and places, then checked again |
| **Dates and amounts** | Shifted or bucketed consistently within a case, so the case still makes sense |

A recorded **re-identification check** must pass before a dataset enters Open, e.g. a minimum group size for each
combination of quasi-identifiers, plus a sample review by a person. Each item records its source dataset, licence and
de-identification version.

## 5. Data intake utility (TS-56)

Every dataset passes through it, in both modes, before any other use.

| Step | What it does |
|---|---|
| 1. **Register** | Supplier, licence terms (Open use allowed? publication? retention period?), contract end date, permitted modes, and the dump's encryption-key reference |
| 2. **De-identify** (Open only) | Section 4, with the re-identification check recorded |
| 3. **Gate** | Refuses a dataset that has no licence record or an expired licence, or whose licence forbids the requested mode or use |
| 4. **Purge** | On contract end or retention expiry, destroys the dump's key (section 6) and records the purge |

It sits next to the Studio's dataset generator (TS-47), as a Studio module or a small separate tool. In Enterprise
it runs inside the enterprise's environment.

## 6. Append-only records with purge (TS-53)

`ApprovedTaskRecord` and `RLReviewRecord` stay append-only, which is a non-negotiable. Deletion is still possible:

- **One encryption key per dump.** Everything derived from the dump is encrypted under that key: the environment
  seed, the datasets, and the PII inside tasks the enterprise's SMEs author.
- **Purge = destroy the key.** When the contract ends or the retention period runs out, the key is destroyed. The
  record chains stay intact and verifiable, but the data in them can no longer be read.
- **Per-person removal**, where an enterprise's contract requires it, uses a key per data subject. It is built only
  when a customer needs it.
- Keys live in the enterprise's key service (e.g. Cloud KMS in its project). ADI Labs never holds them.

## 7. What changes in each app

| App | Open mode | Enterprise mode |
|---|---|---|
| **ADI Forge** | As today. Rejects `enterprise_pii`. Exports go to the Open RL Gym. | SMEs are the enterprise's own staff. PII fields are encrypted under the dump key. Exports go only to the enterprise's own RL Gym. Never publishes to the Open registry. |
| **RL Gym** | Public benchmarks. Canary and re-qualification as in TS-48. External vendors receive synthetic or de-identified data only. | Private benchmarks and telemetry. Only vendors the enterprise approved. Results stay inside, except approved aggregates. |
| **Studio** | Builds releases, the dataset generator, the intake utility. Publishes to the Open registry. | Delivers Open releases into Enterprise by digest. Its intake utility runs inside the enterprise for the dump. Optional enterprise-specific packs stay in the enterprise registry. |

## 8. Non-negotiables, rewritten per mode (TS-54)

This is the proposed replacement text for the non-negotiables in `CLAUDE.md` and `docs/SPEC.md`. **It needs the owner's
explicit approval before it is applied.**

**Both modes**
- `ApprovedTaskRecord` and `RLReviewRecord` are append-only, enforced in the database. Purge works only by
  destroying keys.
- AI output never makes a final selection, rejection or task-acceptance decision. A human reviewer does.
- Every state change is authorised, idempotent and written to the audit log.
- Every deployment declares its mode, and a deployment without one does not start.

**Open mode**
- Task content and datasets are `synthetic` or `deidentified` only. No real customer or employer data.
- No real identity numbers or identity images are stored. Identity numbers are synthetic.

**Enterprise mode**
- Real PII is allowed only inside the enterprise's environment, under its access controls. ADI Labs staff cannot see it.
- Identity images are not stored unless the enterprise's contract explicitly requires it. Default: not stored.
- Nothing leaves except what the enterprise approves.

## 9. Build order (when this is taken up)

1. The owner approves section 8 and the docs are changed. A privacy or legal review runs alongside.
2. Mode setting and enforcement (section 2) in all three apps, tested with synthetic data only.
3. The data intake utility (section 5) with licence register and purge, tested with synthetic dumps.
4. The de-identification pipeline and re-identification check (section 4).
5. The first Enterprise deployment, with a pilot bank in its own environment and keys.

## 10. Open questions

1. Who runs Enterprise deployments: the enterprise's operators, or ADI Labs under the enterprise's access controls?
2. Which re-identification test and threshold count as passing (e.g. minimum group size)?
3. Which telemetry may leave an Enterprise deployment by default, if any?
4. Do enterprises want their private results compared with the Open benchmark (e.g. anonymised percentiles)?
