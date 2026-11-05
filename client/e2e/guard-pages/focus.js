// Tab never leaves this field: a keyboard trap.
document.querySelector(".trap")?.addEventListener("keydown", (event) => {
  if (event.key === "Tab") event.preventDefault();
});
