// The guard exempts shifts in the 500 ms after <html lang> changes, but only when
// a click or key press came first (AUDIT.md, "Guard exemptions"). This page makes
// each case on purpose:
//   ?mode=click  click: lang changes 1.5 s later and the page moves at once: exempt
//   ?mode=auto   no click: lang changes after 1.5 s and the page moves: counted
//   ?mode=late   click: lang changes after 1.5 s, the page moves 800 ms later: counted
const mode = new URLSearchParams(location.search).get("mode") ?? "click";
const push = () => {
  const block = document.createElement("div");
  block.className = "pushdown";
  document.querySelector("main")?.prepend(block);
};
const swap = (moveAfter) => {
  setTimeout(() => {
    document.documentElement.lang = "hi";
    setTimeout(push, moveAfter);
  }, 1500);
};
if (mode === "auto") swap(0);
document.getElementById("switch")?.addEventListener("click", () => {
  swap(mode === "late" ? 800 : 0);
});
