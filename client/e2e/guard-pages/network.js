// A 404 from the app, a request to another host (localhost is not 127.0.0.1),
// and a request that fails outright.
void fetch("/api/guard-self-test-missing").catch(() => undefined);
void fetch(`http://localhost:${location.port}/api/health`, { mode: "no-cors" }).catch(
  () => undefined,
);
void fetch("http://127.0.0.1:59999/", { mode: "no-cors" }).catch(() => undefined);
