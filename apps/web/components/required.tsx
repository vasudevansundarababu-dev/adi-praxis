/**
 * Mandatory-field indicators, used on every console and partner-portal form:
 * - `<Req />` after the label text of a required field (a red asterisk; screen readers hear "required");
 * - `<RequiredNote />` once near the top of a form that has required fields;
 * - the control itself carries `required` (or `aria-required="true"` where the browser check is not wanted).
 */
export function Req() {
  return (
    <>
      <span aria-hidden="true" className="ml-0.5 font-semibold text-error">
        *
      </span>
      <span className="sr-only"> (required)</span>
    </>
  );
}

export function RequiredNote({ className = '' }: { className?: string }) {
  return (
    <p className={`text-xs text-fg-muted ${className}`}>
      Fields marked <span aria-hidden="true" className="font-semibold text-error">*</span>
      <span className="sr-only">with an asterisk</span> are required.
    </p>
  );
}
