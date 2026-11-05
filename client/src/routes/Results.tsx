import { isRunActive } from "@clauseclear/shared";
import { Navigate } from "react-router-dom";
import { ResultsPage } from "../components/results/ResultsPage";
import { useAnalysis } from "../state/hooks";

/**
 * /results reads the analysis from memory. After a refresh there is none, so it
 * goes home with the "isn't stored" note (SPEC section 9). A run started from
 * this page ("Not right? Change it") also clears the result; then the landing
 * page shows that run's progress and follows it to the new result.
 */
export function Results() {
  const { current, run } = useAnalysis();
  if (current === null) {
    if (isRunActive(run.machine.status)) {
      return <Navigate to="/" replace state={{ followRun: run.machine.runId }} />;
    }
    return <Navigate to="/" replace state={{ note: "resultGone" }} />;
  }
  if (current.source === "sample") {
    return <Navigate to={`/results/sample/${current.sampleId}`} replace />;
  }
  return <ResultsPage sample={false} />;
}
