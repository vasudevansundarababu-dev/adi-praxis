/** Pino options for Cloud Logging: `severity` instead of numeric levels, `message` as the text field. */
export const cloudLogger = {
  messageKey: 'message',
  formatters: {
    level: (label: string) => ({ severity: label === 'warn' ? 'WARNING' : label.toUpperCase() }),
  },
};
