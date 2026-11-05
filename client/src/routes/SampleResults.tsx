import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { ErrorStrip } from "../components/ErrorStrip";
import { ResultsPage } from "../components/results/ResultsPage";
import { useT } from "../i18n/useT";
import { useAnalysis } from "../state/hooks";
import { app } from "../state/instance";

/** /results/sample/:id is reloadable: samples are fixtures, fetched with zero AI calls. */
export function SampleResults() {
  const t = useT();
  const { id = "" } = useParams();
  const { current, sampleError } = useAnalysis();

  useEffect(() => {
    // A page load of this URL restores the sample's ticks; a click on the landing
    // page has already asked for a fresh copy, and this call then changes nothing.
    void app.analysis.openSample(id, { fresh: false });
  }, [id]);

  if (current?.source === "sample" && current.sampleId === id) {
    return <ResultsPage sample />;
  }
  if (sampleError !== null) {
    return (
      <div className="cc-page cc-shell cc-shell--pending">
        <ErrorStrip error={sampleError} />
        <p>
          <Link className="cc-mono-link" to="/">
            {t("results.checkAnother")}
          </Link>
        </p>
      </div>
    );
  }
  // Holds a screen of height while the fixture loads, so the results replace it
  // without pushing the footer out of view (prompt 18, audit item 1).
  return (
    <div className="cc-page cc-shell cc-shell--pending">
      <p role="status">{t("landing.openingSample")}</p>
    </div>
  );
}
