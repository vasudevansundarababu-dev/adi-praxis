/**
 * Plain-words help for the project's Policy page (policy-library projects, e.g. KYC Judgment; D-089–D-092 and the fact
 * list, 26 Nov 2026). One source for the Support Bot's help pack and the page's own "How this page works" section.
 * Each paragraph starts with its heading (before the first full stop), which the offline bot matches on; paragraphs are
 * separated by blank lines. Keep it in step with the page when it changes.
 */
export const POLICY_PAGE_HELP = `POLICY PAGE (PM, Admin). For a policy-library project (for example KYC Judgment), the project's Policy page (headed "Policy rules") builds the policy library the benchmark uses. For these projects the Policies tab on the project page opens it; other projects keep their rules on the Policies tab itself. It opens with a setup checklist of five steps: Documents, Facts, AI suggestions, Review and Export. The step to do next is highlighted. Each step's button takes you to the part of the page where you do it.

POLICY CHECKLIST STEP 1, DOCUMENTS. Upload each policy document (official texts such as a federal or state rule, and the bank's own policies) and set its details: kind (official text or bank policy), ISO jurisdiction (US, or a state such as US-CA), and for an official text where and when it was downloaded. Also set the date it is in force from. A document is "Ready" when all of these are set. Rules are extracted from the documents as drafts.

POLICY CHECKLIST STEP 2, FACTS. Load the fact catalog: the list of facts the environment knows about each case. "See the fact list" shows every fact with its variable, description, type and allowed values, where it comes from, and how many rules use it. Click a rule count to see those rules in the review queue. The list is read-only.

WHAT IS A FACT. A fact is one thing known about a case, which a rule's condition can test. Each fact has a variable name (the id conditions use), a type (yes/no, a choice from a list, a number, a date or text) and where it comes from. Most facts are case data: a field of each case, such as the product or the customer's citizenship. A derived fact is not in the case data; a rule of the library defines it from other facts. Example: us_person (is this party a US person?) is not in the case data. A rule of the library, such as R-US-PERSON-DEFINITION, defines it from case facts like citizenship, and once that rule is approved other rules can use us_person in their conditions. Until then the page warns that no approved rule defines "US person".

WHAT IS A VARIABLE. The variable is the fact's id exactly as conditions write it, in lower case with underscores, for example product, citizenship or us_person. The fact list shows it in monospace.

WHAT IS A CONDITION ("WHEN IT APPLIES"). A rule's condition says which cases the rule applies to, written over facts. Example: product == teen_joint means the rule applies only to teen joint accounts. Conditions can combine tests: all of them, any of them, or not. A rule that applies to every case can say so: its condition then reads "Applies wherever the project's approved scope applies". A rule cannot be approved until its condition is set. Every fact a condition names must be in the fact catalog or be defined by a rule.

POLICY CHECKLIST STEP 3, AI SUGGESTIONS. "Suggest library details (AI)" asks the AI to fill in each draft's library details and condition from its source text, for all drafts or for one document's. Admins see a cost estimate first. The AI only fills drafts nobody has edited, and only with values that pass the checks. Where a person has already edited a draft, its suggestion is offered on the rule page instead of written in. If no worker is running, the page says so and the request waits. An AI suggestion is never an approval: every rule still needs a person to check it against its source and confirm it.

POLICY CHECKLIST STEP 4, REVIEW. The review queue lists every draft rule with its document, jurisdiction, status and next action, 25 rows a page. Filter by document, next action, jurisdiction, status or a fact, or search by rule key or title. Click a next action to open the rule at the field to fix. In a policy-library project the review queue is the only place to approve rules.

LIBRARY DETAILS. Each rule needs five library details. Kind: regulation, policy or business rule. Issuer: federal, state or bank. Jurisdiction: an ISO code such as US or US-CA (the rule's own, else its document's). Subject: whether the rule is about the case or about one party. Scope: the business process it belongs to, such as account opening, and optionally the customer types, product lines and channels it covers.

IN FORCE FROM, AND INHERITANCE. Every rule needs the date it is in force from. Set it once on the document and every rule from that document inherits it. A rule's own date, set on its page, wins over the document's. The rule's date comes from the document its requirement quote cites.

NEXT ACTION "SET WHEN IT APPLIES". The rule has no condition yet. Open it and set the condition: the facts and values of the cases it applies to (for example product == teen_joint), or say it applies to every case in the project's scope. The AI suggestions step can propose one for you to check.

NEXT ACTION "FILL IN LIBRARY DETAILS". One or more of kind, issuer, jurisdiction, subject or scope is missing, or the jurisdiction is not a real ISO code. Open the rule and fill them in.

NEXT ACTION "SET THE IN-FORCE DATE". Neither the rule nor its document has an in-force date. Set the date on the document (in the Documents step) so all its rules inherit it, or on the rule itself.

NEXT ACTION "LINK TO A SOURCE QUOTE" AND "CHECK THE QUOTE". Every rule must be backed by an exact quote from its document. Link one, or check a quote that no longer matches the document text exactly, and fix it.

NEXT ACTION "ANSWER THE OPEN QUESTION". Extraction or the AI left a question about the rule, for example an unclear threshold. Read it on the rule page, answer it, and update the rule if needed.

NEXT ACTION "COMPLETE THE RULE'S DEFINITION". The rule is missing part of its definition (what it requires, who or what it applies to, or its effect). Fill in the missing parts on its page.

NEXT ACTION "SAY HOW IT CHANGES THE VERSION BEFORE". The rule had an approved version before this draft. Say how the new version changes it (it contradicts, withdraws, tightens, narrows or clarifies it) with a short summary.

NEXT ACTION "APPROVE THE DEFINITION IT DEPENDS ON FIRST". The rule's condition uses a derived fact (such as us_person) whose defining rule is not approved yet. Approve the defining rule first; this rule then clears.

NEXT ACTION "CHECK STUDIO'S COVERAGE ANSWER". Studio checked whether the environment's cases cover this rule's condition ("Check coverage with Studio") and found gaps. Read the answer on the rule page and change the condition or accept it.

READY TO CONFIRM, AND "CONFIRM ALL READY". A rule with nothing left to do reads "Ready to confirm". "Confirm all ready" approves every ready rule within the current filter in one step. Your confirm is the approval. If any of those rules changed or gained a flag since the page loaded, nothing is confirmed and the page says why; reload and try again.

POLICY CHECKLIST STEP 5, EXPORT. "Export policy library (C1)" builds the policy library the benchmark serves: every approved rule with its versions, conditions, library details and derived facts, as one file with a revision number. If anything is missing, the export lists what to fix and nothing is exported. Each export is kept; download its exact file from the list.

WHY AI SUGGESTIONS ARE NOT APPROVAL. The AI can be wrong about what a rule says or when it applies. So it only drafts: it fills in suggestions for drafts nobody edited, and offers them for drafts a person has edited. A person checks each rule against its source quote and confirms it in the review queue. Only that confirm approves a rule, and only approved rules are exported.`;

/** The help as [heading, body] pairs, for the page's own help section. */
export function policyHelpSections(text = POLICY_PAGE_HELP): { heading: string; body: string }[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const i = p.indexOf('. ');
      return i < 0 ? { heading: p, body: '' } : { heading: p.slice(0, i), body: p.slice(i + 2) };
    });
}
