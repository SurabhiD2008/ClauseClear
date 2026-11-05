/** "RENT ......... 18,000 / month". Render inside a <dl>. */
export function LeaderRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="cc-leader">
      <dt className="cc-leader__label">{label}</dt>
      <span className="cc-leader__dots" aria-hidden="true" />
      <dd className="cc-leader__value">{value}</dd>
    </div>
  );
}
