import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider, createBrowserRouter } from "react-router-dom";
import "./styles";
import { Layout } from "./components/Layout";
import { Checklist } from "./routes/Checklist";
import { Landing } from "./routes/Landing";
import { NotFound } from "./routes/NotFound";
import { Results } from "./routes/Results";
import { SampleResults } from "./routes/SampleResults";
import { loadLatinFonts } from "./lib/fonts";
import { languageStore } from "./state/language";

// The routes table from SPEC section 9.
const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: "/", element: <Landing /> },
      { path: "/results", element: <Results /> },
      { path: "/results/sample/:id", element: <SampleResults /> },
      { path: "/checklist", element: <Checklist /> },
      { path: "*", element: <NotFound /> },
    ],
  },
]);

const root = document.getElementById("root");
if (root === null) {
  throw new Error("Missing #root element");
}

// A saved Hindi choice is restored before the first render, so the first paint
// is already Hindi: painting English and then swapping moved the whole page. The
// Latin faces are waited for too (at most 3 s), so no font swaps in after the
// first paint (prompt 18, audit item 2).
const element = root;
void Promise.all([languageStore.init(), loadLatinFonts()]).finally(() => {
  createRoot(element).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
});
