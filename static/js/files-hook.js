(function () {
  var src = "/makefile/static/js/main.js?v=6";

  function boot() {
    if (window.MakefilePlugin) {
      window.MakefilePlugin.watchFiles();
      window.MakefilePlugin.watchPage();
      return;
    }
    var script = document.createElement("script");
    script.src = src;
    script.onload = boot;
    document.head.appendChild(script);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
