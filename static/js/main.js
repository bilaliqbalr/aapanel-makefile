(function (global) {
  var pollTimer = null;
  var clockTimer = null;
  var bannerClock = null;
  var active = null;

  function token() {
    var el = document.getElementById("request_token_head");
    return el ? el.getAttribute("token") || "" : "";
  }

  function post(method, data) {
    var body = new URLSearchParams();
    Object.keys(data || {}).forEach(function (key) {
      if (data[key] === undefined || data[key] === null) return;
      body.append(key, String(data[key]));
    });
    return fetch("/plugin?action=a&name=makefile&s=" + encodeURIComponent(method), {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "x-http-token": token(),
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      },
      body: body.toString(),
    }).then(function (response) {
      return response.json();
    });
  }

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function panelDocument() {
    try {
      if (window.parent && window.parent.document && window.parent.document.body) return window.parent.document;
    } catch (err) {}
    return document;
  }

  function isDark(doc) {
    var roots = [];
    if (doc && doc.documentElement) roots.push(doc.documentElement);
    try {
      var parentRoot = window.parent && window.parent.document && window.parent.document.documentElement;
      if (parentRoot && roots.indexOf(parentRoot) === -1) roots.push(parentRoot);
    } catch (err) {}
    for (var i = 0; i < roots.length; i++) {
      if (roots[i].classList.contains("dark") || roots[i].getAttribute("theme-mode") === "dark") return true;
    }
    return false;
  }

  function bindTheme(el, doc) {
    function sync() {
      el.classList.toggle("mk-dark", isDark(doc));
    }
    sync();
    var root = doc && doc.documentElement;
    if (!root || typeof MutationObserver === "undefined") return function () {};
    var obs = new MutationObserver(sync);
    obs.observe(root, { attributes: true, attributeFilter: ["class", "theme-mode"] });
    return function () { obs.disconnect(); };
  }

  function underDark(selector, body) {
    var scopes = ["html.dark ", "html[theme-mode=\"dark\"] ", ".mk-dark "];
    return scopes.map(function (scope) {
      return selector.split(",").map(function (part) {
        return scope + part.trim();
      }).join(",") + "{" + body + "}";
    }).join("");
  }

  function ensureStyle(doc) {
    doc = doc || document;
    if (doc.getElementById("makefile-plugin-style")) return;
    var style = doc.createElement("style");
    style.id = "makefile-plugin-style";
    style.textContent = [
      "#makefile-app{display:flex;flex-direction:column;height:calc(100vh - 120px);min-height:280px;overflow:hidden}",
      ".mk-page{font:13px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#333;padding:16px 16px 8px;max-width:960px;display:flex;flex-direction:column;flex:1;min-height:0;height:100%;box-sizing:border-box}",
      ".mk-row{display:flex;gap:8px;align-items:center;margin-bottom:12px;flex:0 0 auto}",
      ".mk-row input[type=text]{flex:1;height:32px;border:1px solid #ddd;border-radius:4px;padding:0 8px}",
      ".mk-btn{height:32px;padding:0 14px;border:0;border-radius:4px;background:#20a53a;color:#fff;cursor:pointer}",
      ".mk-btn:disabled{opacity:.55;cursor:default}",
      ".mk-btn.mk-stop{background:#d9534f}",
      ".mk-btn.mk-ghost{background:#fff;color:#333;border:1px solid #ddd}",
      ".mk-warn{background:#fff6e8;border:1px solid #f0d7a6;color:#8a5a00;padding:8px 10px;border-radius:4px;margin-bottom:12px}",
      ".mk-list{flex:1 1 auto;min-height:0;overflow-x:hidden;overflow-y:auto;-webkit-overflow-scrolling:touch}",
      ".mk-target{display:flex;gap:10px;align-items:flex-start;justify-content:space-between;padding:10px 4px;border-bottom:1px solid #eee}",
      ".mk-name{font-weight:600}",
      ".mk-comment{color:#777;margin-top:2px}",
      ".mk-note{color:#999;font-size:12px;margin-top:4px}",
      ".mk-badge{display:inline-block;margin-left:6px;padding:0 6px;border-radius:8px;background:#eef6ff;color:#245;font-size:11px;font-weight:600}",
      ".mk-overlay{position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:2000000000;display:flex;align-items:flex-start;justify-content:center;padding:40px 16px}",
      ".mk-dialog{background:#fff;width:min(880px,100%);height:min(720px,calc(100vh - 80px));display:flex;flex-direction:column;overflow:hidden;border-radius:6px;box-shadow:0 8px 30px rgba(0,0,0,.2)}",
      ".mk-head{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid #eee;flex:0 0 auto}",
      ".mk-head h3{margin:0;font-size:15px}",
      ".mk-body{padding:16px;display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden}",
      ".mk-out{position:fixed;inset:0;z-index:2000000001;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:24px}",
      ".mk-out-box{background:#fff;width:min(920px,100%);height:min(680px,88vh);display:flex;flex-direction:column;border-radius:6px;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,.28)}",
      ".mk-status{display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:8px 16px;color:#555;border-bottom:1px solid #eee;flex:0 0 auto}",
      ".mk-meta{font-variant-numeric:tabular-nums;color:#222}",
      ".mk-log{flex:1;min-height:0;overflow:auto;background:#1e1e1e;color:#e8e8e8;margin:0;padding:12px;white-space:pre-wrap;word-break:break-word;font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace}",
      ".mk-out-actions{padding:10px 16px;flex:0 0 auto;border-top:1px solid #eee}",
      "@keyframes mk-spin{to{transform:rotate(360deg)}}",
      ".mk-spin{display:inline-block;width:14px;height:14px;border:2px solid #d9d9d9;border-top-color:#20a53a;border-radius:50%;animation:mk-spin .7s linear infinite}",
      "#makefile-files-btn{position:fixed;right:18px;bottom:168px;z-index:1990000000;height:34px;padding:0 12px;border:0;border-radius:4px;background:#20a53a;color:#fff;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.15)}",
      underDark(".mk-page,.mk-dialog,.mk-out-box", "background:#1e1e22;color:#e8e8e8;color-scheme:dark"),
      underDark(".mk-head,.mk-status,.mk-out-actions,.mk-target", "border-color:#3a3a42"),
      underDark(".mk-status,.mk-comment", "color:#c4c4c4"),
      underDark(".mk-note", "color:#9a9aa3"),
      underDark(".mk-meta,.mk-head h3,.mk-page h3,.mk-name", "color:#f3f3f3"),
      underDark(".mk-row input[type=text]", "background:#2a2a30;color:#f3f3f3;border-color:#4a4a52"),
      underDark(".mk-btn.mk-ghost", "background:#2a2a30;color:#f3f3f3;border-color:#4a4a52"),
      underDark(".mk-warn", "background:#3a2e14;border-color:#6b5424;color:#f3d7a1"),
      underDark(".mk-badge", "background:#243044;color:#d5e4ff"),
      underDark(".mk-log", "background:#121214;color:#e8e8e8"),
      underDark(".mk-spin", "border-color:#555;border-top-color:#20a53a"),
    ].join("");
    (doc.head || doc.documentElement).appendChild(style);
  }

  function fitList(list) {
    if (!list) return;
    var top = list.getBoundingClientRect().top;
    var limit = window.innerHeight - 16;
    var parent = list.parentElement;
    while (parent && parent !== document.body) {
      var style = window.getComputedStyle(parent);
      var clips = /(auto|scroll|hidden)/.test(style.overflowY) || /(auto|scroll|hidden)/.test(style.overflow);
      if (clips) {
        var rect = parent.getBoundingClientRect();
        if (rect.height > 80 && rect.bottom < limit) limit = rect.bottom - 8;
      }
      parent = parent.parentElement;
    }
    var height = limit - top - 8;
    if (height < 140) height = Math.max(140, Math.floor(window.innerHeight * 0.45));
    list.style.maxHeight = height + "px";
    list.style.overflowY = "auto";
  }

  function kindNote(target) {
    if (target.kind === "stream") return "Follows logs until you press Stop.";
    if (target.kind === "interactive") return "Interactive shell. Use the panel Terminal.";
    if (target.danger) return "Deletes Docker volumes (down -v).";
    if (target.needs_arg) return "Needs a short migration message.";
    return "";
  }

  function renderSession(host, dirPath, data) {
    host.innerHTML = "";
    if (!data.status) {
      host.innerHTML = '<div class="mk-warn">' + esc(data.msg || "Could not read the Makefile.") + "</div>";
      fitList(host);
      return;
    }
    if (bannerClock) {
      clearInterval(bannerClock);
      bannerClock = null;
    }
    if (data.active_run && data.active_run.run_id) {
      var banner = document.createElement("div");
      banner.className = "mk-warn";
      var label = data.active_run.running ? "Still running" : "Last run";
      var sessionName = data.active_run.tmux_session || "";
      banner.appendChild(document.createTextNode(label + ": make " + data.active_run.target_name));
      if (sessionName) {
        var sessionEl = document.createElement("span");
        sessionEl.className = "mk-meta";
        sessionEl.style.marginLeft = "10px";
        sessionEl.textContent = "tmux " + sessionName;
        banner.appendChild(sessionEl);
      }
      if (data.active_run.running) {
        var timerEl = document.createElement("span");
        timerEl.className = "mk-meta";
        timerEl.style.marginLeft = "10px";
        var left0 = timeoutLeft(data.active_run);
        timerEl.textContent = formatLeft(left0);
        banner.appendChild(timerEl);
        if (left0 !== null) {
          var leftAt = Date.now();
          bannerClock = setInterval(function () {
            timerEl.textContent = formatLeft(left0 - (Date.now() - leftAt) / 1000);
          }, 1000);
        }
      }
      var view = document.createElement("button");
      view.className = "mk-btn";
      view.type = "button";
      view.style.marginLeft = "8px";
      view.textContent = "View";
      view.onclick = function () { resumeRun(dirPath, data.active_run); };
      banner.appendChild(view);
      if (data.active_run.running || sessionName) {
        var closeTmux = document.createElement("button");
        closeTmux.className = "mk-btn mk-stop";
        closeTmux.type = "button";
        closeTmux.style.marginLeft = "8px";
        closeTmux.textContent = "Close tmux";
        closeTmux.onclick = function () {
          if (!window.confirm("Stop the run and close tmux session" + (sessionName ? " " + sessionName : "") + "?")) return;
          closeTmux.disabled = true;
          post("stop_run", { run_id: data.active_run.run_id }).then(function () {
            loadInto(host, dirPath);
          }).catch(function () {
            closeTmux.disabled = false;
          });
        };
        banner.appendChild(closeTmux);
      }
      host.appendChild(banner);
    }
    if (!data.docker_ok) {
      var warn = document.createElement("div");
      warn.className = "mk-warn";
      warn.textContent = data.docker_msg || "Docker is not available on the host.";
      host.appendChild(warn);
    }
    (data.targets || []).forEach(function (target) {
      var row = document.createElement("div");
      row.className = "mk-target";
      var note = kindNote(target);
      var badge = target.kind === "stream" ? '<span class="mk-badge">logs</span>' : "";
      if (target.danger) badge += '<span class="mk-badge">volumes</span>';
      row.innerHTML =
        '<div><div class="mk-name">' + esc(target.target) + badge + "</div>" +
        (target.comment ? '<div class="mk-comment">' + esc(target.comment) + "</div>" : "") +
        (note ? '<div class="mk-note">' + esc(note) + "</div>" : "") +
        (target.needs_arg ? '<div class="mk-row" style="margin-top:8px"><input type="text" data-arg placeholder="describe change"></div>' : "") +
        "</div>";
      var button = document.createElement("button");
      button.className = "mk-btn";
      button.type = "button";
      button.textContent = "Run";
      if (!target.runnable) button.disabled = true;
      button.onclick = function () {
        var arg = "";
        var input = row.querySelector("[data-arg]");
        if (input) arg = input.value || "";
        if (target.needs_arg && !arg.trim()) {
          window.alert("Enter the migration message first.");
          return;
        }
        if (!window.confirm("Run make " + target.target + "?")) return;
        if (target.danger) {
          var second = window.confirm("This deletes Docker volumes (down -v). Data in those volumes will be removed. Continue?");
          if (!second) return;
        }
        runTarget(dirPath, target, arg);
      };
      row.appendChild(button);
      host.appendChild(row);
    });
    fitList(host);
  }

  function writeLog(ui, text) {
    if (!ui || !ui.log || !text) return;
    var nearBottom = ui.log.scrollHeight - ui.log.scrollTop - ui.log.clientHeight < 48;
    ui.log.textContent += text;
    if (ui.stick || nearBottom) ui.log.scrollTop = ui.log.scrollHeight;
  }

  function openOutput(dirPath, target) {
    var doc = panelDocument();
    ensureStyle(doc);
    var old = doc.getElementById("makefile-output");
    if (old) {
      if (old.__mkUnbind) old.__mkUnbind();
      old.remove();
    }
    var overlay = doc.createElement("div");
    overlay.id = "makefile-output";
    overlay.className = "mk-out";
    overlay.__mkUnbind = bindTheme(overlay, doc);
    overlay.innerHTML =
      '<div class="mk-out-box" role="dialog" aria-label="Make output">' +
      '<div class="mk-head"><h3>make ' + esc(target.target) + "</h3>" +
      '<button type="button" class="mk-btn mk-ghost" data-close>Close</button></div>' +
      '<div class="mk-status"><span class="mk-spin" data-spin></span><span data-status>Starting…</span>' +
      '<span class="mk-meta" data-session></span><span class="mk-meta" data-timer></span></div>' +
      '<pre class="mk-log" data-log></pre>' +
      '<div class="mk-out-actions"><button type="button" class="mk-btn mk-stop" data-stop>Stop and close tmux</button></div>' +
      "</div>";
    doc.body.appendChild(overlay);
    var ui = {
      overlay: overlay,
      log: overlay.querySelector("[data-log]"),
      status: overlay.querySelector("[data-status]"),
      session: overlay.querySelector("[data-session]"),
      timer: overlay.querySelector("[data-timer]"),
      spin: overlay.querySelector("[data-spin]"),
      stopBtn: overlay.querySelector("[data-stop]"),
      stick: true,
    };
    ui.log.addEventListener("scroll", function () {
      ui.stick = ui.log.scrollHeight - ui.log.scrollTop - ui.log.clientHeight < 48;
    });
    writeLog(ui, "Starting make " + target.target + " in " + dirPath + "\n");
    function close() {
      if (clockTimer) clearInterval(clockTimer);
      clockTimer = null;
      if (overlay.__mkUnbind) overlay.__mkUnbind();
      if (active && active.runId) {
        var leave = doc.defaultView.confirm("A target is still running. Stop it before closing?");
        if (leave) post("stop_run", { run_id: active.runId });
      }
      if (pollTimer) clearTimeout(pollTimer);
      active = null;
      overlay.remove();
    }
    overlay.querySelector("[data-close]").onclick = close;
    ui.stopBtn.onclick = function () {
      if (!active || !active.runId) return;
      ui.stopBtn.disabled = true;
      ui.status.textContent = "Stopping…";
      post("stop_run", { run_id: active.runId }).then(function () {
        poll(ui);
      });
    };
    return ui;
  }

  function formatLeft(seconds) {
    if (seconds === null || seconds === undefined) return "no timeout";
    var s = Math.max(0, Math.floor(Number(seconds) || 0));
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var sec = s % 60;
    function pad(n) { return (n < 10 ? "0" : "") + n; }
    var clock = h > 0 ? h + ":" + pad(m) + ":" + pad(sec) : pad(m) + ":" + pad(sec);
    return "timeout " + clock + " left";
  }

  function timeoutLeft(data) {
    if (!data || !Number(data.timeout_sec)) return null;
    if (data.timeout_left_sec === null || data.timeout_left_sec === undefined || data.timeout_left_sec === "") return null;
    return Number(data.timeout_left_sec);
  }

  function showSession(ui, session) {
    if (!ui || !ui.session) return;
    ui.session.textContent = session ? "tmux " + session : "";
  }

  function armClock(ui, left) {
    if (clockTimer) clearInterval(clockTimer);
    clockTimer = null;
    if (!ui || !ui.timer) return;
    if (!active) {
      ui.timer.textContent = "";
      return;
    }
    active.left = left;
    active.leftAt = Date.now();
    ui.timer.textContent = formatLeft(left);
    if (left === null) return;
    clockTimer = setInterval(function () {
      if (!active || active.ui !== ui) {
        clearInterval(clockTimer);
        clockTimer = null;
        return;
      }
      ui.timer.textContent = formatLeft(active.left - (Date.now() - active.leftAt) / 1000);
    }, 1000);
  }

  function setPhase(ui, text, spinning) {
    if (!ui.status) return;
    ui.status.textContent = text;
    if (ui.spin) ui.spin.style.display = spinning ? "inline-block" : "none";
  }

  function resumeRun(dirPath, run) {
    var ui = openOutput(dirPath, { target: run.target_name || "session" });
    active = { runId: run.run_id, offset: 0, ui: ui, session: run.tmux_session || "" };
    ui.stopBtn.disabled = !run.running;
    showSession(ui, active.session);
    setPhase(ui, run.running ? "Running…" : "Session", !!run.running);
    if (run.running) armClock(ui, timeoutLeft(run));
    else if (ui.timer) ui.timer.textContent = "";
    poll(ui);
  }

  function runTarget(dirPath, target, makeArg) {
    var ui = openOutput(dirPath, target);
    post("start_run", {
      dir_path: dirPath,
      target_name: target.target,
      make_arg: makeArg || "",
    }).then(function (data) {
      if (!data.status && !data.run_id) {
        setPhase(ui, "Failed", false);
        ui.stopBtn.disabled = true;
        writeLog(ui, (data.msg || "Could not start.") + "\n");
        return;
      }
      if (!data.status && data.msg) writeLog(ui, data.msg + "\n");
      active = { runId: data.run_id, offset: 0, ui: ui, session: data.tmux_session || "" };
      ui.stopBtn.disabled = false;
      showSession(ui, active.session);
      setPhase(ui, "Running…", true);
      armClock(ui, timeoutLeft(data));
      poll(ui);
    }).catch(function (err) {
      setPhase(ui, "Failed", false);
      ui.stopBtn.disabled = true;
      writeLog(ui, String(err) + "\n");
    });
  }

  function poll(ui) {
    if (pollTimer) clearTimeout(pollTimer);
    if (!active || !active.runId) return;
    post("run_status", { run_id: active.runId, log_offset: active.offset }).then(function (data) {
      if (!active || active.ui !== ui) return;
      if (!data.status) {
        setPhase(ui, "Failed", false);
        writeLog(ui, (data.msg || "Lost the run.") + "\n");
        ui.stopBtn.disabled = true;
        return;
      }
      if (data.chunk) writeLog(ui, data.chunk);
      active.offset = data.next_offset || active.offset;
      if (data.tmux_session) {
        active.session = data.tmux_session;
        showSession(ui, data.tmux_session);
      }
      if (data.phase === "running") {
        setPhase(ui, "Running " + (data.target_name || "") + "…", true);
        armClock(ui, timeoutLeft(data));
        ui.stopBtn.disabled = false;
        pollTimer = setTimeout(function () { poll(ui); }, 1000);
        return;
      }
      if (clockTimer) clearInterval(clockTimer);
      clockTimer = null;
      ui.stopBtn.disabled = true;
      if (ui.timer) ui.timer.textContent = "";
      var code = data.exit_code === null || data.exit_code === undefined ? "" : " " + data.exit_code;
      setPhase(ui, (data.phase || "finished") + code, false);
      writeLog(ui, "\n[" + (data.phase || "finished") + code + "]\n");
      active = null;
    }).catch(function () {
      if (!active || active.ui !== ui) return;
      pollTimer = setTimeout(function () { poll(ui); }, 2000);
    });
  }

  var PATH_KEY = "makefile-last-dir";

  function rememberPath(dirPath) {
    var value = String(dirPath || "").trim();
    if (!value) return;
    try { localStorage.setItem(PATH_KEY, value); } catch (err) {}
  }

  function recalledPath() {
    try { return localStorage.getItem(PATH_KEY) || ""; } catch (err) { return ""; }
  }

  function loadInto(host, dirPath) {
    host.innerHTML = '<div class="mk-comment">Reading Makefile…</div>';
    rememberPath(dirPath);
    post("list_targets", { dir_path: dirPath }).then(function (data) {
      if (data && data.dir_path) rememberPath(data.dir_path);
      renderSession(host, data.dir_path || dirPath, data);
    }).catch(function (err) {
      host.innerHTML = '<div class="mk-warn">' + esc(err) + "</div>";
    });
  }

  function pageHtml() {
    return (
      '<div class="mk-page">' +
      "<h3>Makefile</h3>" +
      '<div class="mk-row"><input type="text" data-path placeholder="/absolute/project/path"><button class="mk-btn" type="button" data-load>Load</button></div>' +
      '<div class="mk-list" data-body></div></div>'
    );
  }

  function mountPage(root) {
    if (!root || root.getAttribute("data-ready") === "1") return;
    ensureStyle();
    root.__mkUnbind = bindTheme(root, document);
    root.setAttribute("data-ready", "1");
    root.innerHTML = pageHtml();
    var page = root.querySelector(".mk-page") || root;
    var pathInput = root.querySelector("[data-path]");
    var saved = recalledPath();
    if (saved) pathInput.value = saved;
    root.querySelector("[data-load]").onclick = function () {
      loadInto(root.querySelector("[data-body]"), pathInput.value.trim());
    };
    pathInput.addEventListener("keydown", function (event) {
      if (event.key === "Enter") root.querySelector("[data-load]").click();
    });
    window.addEventListener("resize", function () { fitList(root.querySelector("[data-body]")); });
    if (saved) loadInto(root.querySelector("[data-body]"), saved);
    return page;
  }

  function openDialog(dirPath) {
    ensureStyle();
    var existing = document.getElementById("makefile-overlay");
    if (existing) {
      if (existing.__mkUnbind) existing.__mkUnbind();
      existing.remove();
    }
    var overlay = document.createElement("div");
    overlay.id = "makefile-overlay";
    overlay.className = "mk-overlay";
    overlay.__mkUnbind = bindTheme(overlay, document);
    overlay.innerHTML =
      '<div class="mk-dialog" role="dialog" aria-label="Makefile">' +
      '<div class="mk-head"><h3>Makefile</h3><button type="button" class="mk-btn mk-ghost" data-close>Close</button></div>' +
      '<div class="mk-body"><div class="mk-list" data-body></div></div></div>';
    document.body.appendChild(overlay);
    function close() {
      if (overlay.__mkUnbind) overlay.__mkUnbind();
      if (active && active.runId) {
        var leave = window.confirm("A target is still running. Stop it before closing?");
        if (leave) post("stop_run", { run_id: active.runId });
      }
      if (pollTimer) clearTimeout(pollTimer);
      overlay.remove();
    }
    overlay.querySelector("[data-close]").onclick = close;
    overlay.addEventListener("click", function (event) {
      if (event.target === overlay) close();
    });
    rememberPath(dirPath);
    loadInto(overlay.querySelector("[data-body]"), dirPath);
  }

  function onFilesPage() {
    return location.pathname === "/files" || /\/files$/.test(location.pathname);
  }

  var lastDir = "";
  var checkedDir = "";
  var button = null;

  function showButton(dirPath) {
    ensureStyle(document);
    if (!button) {
      button = document.createElement("button");
      button.id = "makefile-files-btn";
      button.type = "button";
      button.textContent = "Makefile";
      button.onclick = function () {
        if (lastDir) openDialog(lastDir);
      };
      document.body.appendChild(button);
    }
    lastDir = dirPath;
    button.style.display = onFilesPage() ? "inline-block" : "none";
  }

  function hideButton() {
    if (button) button.style.display = "none";
    lastDir = "";
  }

  function considerDir(dirPath) {
    if (!onFilesPage()) {
      hideButton();
      checkedDir = "";
      return;
    }
    if (!dirPath || dirPath.charAt(0) !== "/") return;
    if (dirPath === checkedDir) {
      if (button && lastDir) button.style.display = "inline-block";
      return;
    }
    checkedDir = dirPath;
    post("list_targets", { dir_path: dirPath }).then(function (data) {
      if (checkedDir !== dirPath || !onFilesPage()) return;
      if (data.status && data.targets && data.targets.length) showButton(data.dir_path || dirPath);
      else hideButton();
    }).catch(function () {
      if (checkedDir === dirPath) hideButton();
    });
  }

  function pathFromCookie() {
    var parts = ("; " + document.cookie).split("; Path=");
    if (parts.length < 2) return "";
    return decodeURIComponent(parts.pop().split(";").shift() || "");
  }

  function rememberRequest(url, body, responseText) {
    if (String(url || "").indexOf("/files") === -1) return;
    var action = "";
    var found = "";
    if (typeof body === "string" && body.indexOf("=") !== -1) {
      try {
        var params = new URLSearchParams(body);
        action = params.get("action") || "";
        found = params.get("path") || "";
      } catch (err) {}
    }
    if (action && action !== "GetDir" && action !== "GetDirNew") return;
    if (responseText && responseText.charAt(0) === "{") {
      try {
        var payload = JSON.parse(responseText);
        var listed = payload.PATH || (payload.data && payload.data.PATH) || "";
        var isDir = payload.DIR || payload.FILES || (payload.data && (payload.data.DIR || payload.data.FILES));
        if (listed && isDir) found = listed;
      } catch (err) {}
    }
    if (found) considerDir(found);
  }

  function watchFiles() {
    if (global.__makefileFilesHook) {
      if (onFilesPage()) considerDir(pathFromCookie());
      return;
    }
    global.__makefileFilesHook = true;

    var origFetch = global.fetch;
    if (origFetch) {
      global.fetch = function (input, init) {
        var url = typeof input === "string" ? input : (input && input.url) || "";
        var body = init && init.body;
        return origFetch.apply(this, arguments).then(function (response) {
          try {
            rememberRequest(url, typeof body === "string" ? body : "", "");
            if (String(url).indexOf("/files") !== -1) {
              response.clone().text().then(function (text) {
                rememberRequest(url, typeof body === "string" ? body : "", text);
              }).catch(function () {});
            }
          } catch (err) {}
          return response;
        });
      };
    }

    var origOpen = XMLHttpRequest.prototype.open;
    var origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url) {
      this.__mkUrl = url;
      return origOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function (body) {
      var xhr = this;
      xhr.addEventListener("load", function () {
        try {
          rememberRequest(xhr.__mkUrl, typeof body === "string" ? body : "", xhr.responseText);
        } catch (err) {}
      });
      return origSend.apply(this, arguments);
    };

    global.setInterval(function () {
      if (!onFilesPage()) {
        hideButton();
        return;
      }
      var query = new URLSearchParams(location.search).get("path");
      if (query) considerDir(query);
      else considerDir(pathFromCookie());
    }, 1500);
  }

  function watchPage() {
    if (global.__makefilePageHook) return;
    global.__makefilePageHook = true;
    var root = document.getElementById("makefile-app");
    if (root) mountPage(root);
    var observer = new MutationObserver(function () {
      var node = document.getElementById("makefile-app");
      if (node) mountPage(node);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.getElementById("makefile-app")) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () { mountPage(document.getElementById("makefile-app")); });
    } else {
      mountPage(document.getElementById("makefile-app"));
    }
  }

  global.MakefilePlugin = {
    mountPage: mountPage,
    open: openDialog,
    watchFiles: watchFiles,
    watchPage: watchPage,
  };
})(window);
