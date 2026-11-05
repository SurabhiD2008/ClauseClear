setTimeout(() => {
  throw new Error("guard self-test: uncaught error");
}, 0);
void Promise.reject(new Error("guard self-test: unhandled rejection"));
