import { useT } from "../../i18n/useT";

export type StampSeverity = "high" | "medium" | "missing";

/** Severity is a word on a rotated stamp, never colour alone (SPEC section 10). */
export function Stamp({ severity }: { severity: StampSeverity }) {
  const t = useT();
  return (
    <span className={`cc-stamp cc-stamp--${severity}`}>{t(`common.severity.${severity}`)}</span>
  );
}
