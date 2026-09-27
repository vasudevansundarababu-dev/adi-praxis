/**
 * Per-workflow task definition and collection rules are a separate spec (SPEC: Admin template catalog, Rules).
 * This is the named interface the platform calls; v1 stubs it to pass until that spec lands.
 * Do not add behaviour here without the task-definition spec.
 */
export interface TemplateSchemas {
  workflowName: string;
  taskDefinitionSchema: unknown;
  collectionSchema: unknown;
}

export type ValidationResult = { ok: true } | { ok: false; errors: string[] };

export interface TaskDefinitionValidator {
  /** Validates the inputs a task instance carries against the template's task_definition_schema. */
  validateTaskInput(template: TemplateSchemas, data: unknown): Promise<ValidationResult>;
  /** Validates a worker's submission against the template's collection_schema. */
  validateSubmission(template: TemplateSchemas, data: unknown): Promise<ValidationResult>;
}

/** v1 stub: every input and submission passes. */
export const passThroughValidator: TaskDefinitionValidator = {
  async validateTaskInput() {
    return { ok: true };
  },
  async validateSubmission() {
    return { ok: true };
  },
};
