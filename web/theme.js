"use strict";
// Al Día: applies the colour theme the visitor chose (light or dark) before the page paints. Without a choice the page
// follows the system setting (prefers-color-scheme). A file, not an inline script: the CSP allows scripts from this site only.
(function () {
  // Tells the stylesheet that scripts run, so the home page's note can start in its first frame instead of flashing.
  document.documentElement.className += " js";
  try {
    var t = window.localStorage.getItem("aldia:theme");
    if (t === "dark" || t === "light") document.documentElement.setAttribute("data-theme", t);
  } catch (e) {
    /* storage blocked: the system setting applies */
  }
})();
