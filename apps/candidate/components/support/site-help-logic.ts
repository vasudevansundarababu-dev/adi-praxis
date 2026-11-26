/** Pages with their own Help panel scoped to one task (the author's task, or a task to review). */
const TASK_HELP = [/^\/tasks\/[^/]+/, /^\/reviews\/[^/]+/];

/** Whether the site-wide Help panel is shown on a page (signed-in pages only; the header decides that). */
export const siteHelpShown = (path: string) => !TASK_HELP.some((r) => r.test(path));
