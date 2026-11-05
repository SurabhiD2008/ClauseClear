import { Link } from "react-router-dom";
import { Marker } from "./motifs/Marker";

/** "Clause" + "Clear" over a marker highlight. Links home; 44 px tall. */
export function Wordmark() {
  return (
    <Link to="/" className="cc-wordmark">
      {/* One flex item, so the accessible name stays "ClauseClear", not "Clause Clear". */}
      <span>
        Clause<Marker>Clear</Marker>
      </span>
    </Link>
  );
}
