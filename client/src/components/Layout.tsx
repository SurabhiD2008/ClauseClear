import { useLayoutEffect } from "react";
import { NavigationType, Outlet, useLocation, useNavigationType } from "react-router-dom";
import { Footer } from "./Footer";
import { Header } from "./Header";
import { StatusBar } from "./StatusBar";

/**
 * Every page: the header, the page itself inside <main id="main">, the footer,
 * and the fixed status bar for notices that come and go.
 */
export function Layout() {
  const { pathname } = useLocation();
  const navigationType = useNavigationType();

  // A link to another page opens it at the top, before it paints. A sample
  // opened from low on the landing page kept that scroll, so its loading view
  // showed the footer, which the results then moved (prompt 18, CLS 0.346 on
  // mobile). Reload, Back and Forward ("POP") keep the browser's own scroll
  // restoration; an in-page hash is scrolled to by the page itself afterwards.
  useLayoutEffect(() => {
    if (navigationType !== NavigationType.Pop) window.scrollTo(0, 0);
  }, [pathname, navigationType]);

  return (
    <>
      <Header />
      <main id="main" tabIndex={-1}>
        <Outlet />
      </main>
      <Footer />
      <StatusBar />
    </>
  );
}
