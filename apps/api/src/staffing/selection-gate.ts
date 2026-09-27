/**
 * Whether a candidate has been selected (by a human Reviewer) for a project's pool. FLOW2-SME makes selection
 * and onboarding a precondition for assignment; that flow is built in M4.
 *
 * M3 stub (decided 26 Sep 2026): everyone counts as selected, so staffing can be exercised against synthetic
 * candidates. M4 replaces this with the enrollment/selection check; do not add other behaviour here.
 */
export interface SelectionGate {
  isSelected(args: { candidateId: string; projectId: string }): Promise<boolean>;
}

export const stubSelectionGate: SelectionGate = {
  async isSelected() {
    return true;
  },
};
