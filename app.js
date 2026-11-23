// Кабинет торгового: заявки и изменения по личному ключу (#t=… в ссылке), push-уведомления.
// Данные — функции Supabase agent_feed / agent_subscribe (OperTool: agent_feed.py).
(function () {
  "use strict";
  var C = window.OPERTOOL || {};
  var $ = function (id) { return document.getElementById(id); };
  var state = { feed: null, day: null, open: {} };

  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }

  function token() {
    var m = /[#&]t=([A-Za-z0-9_\-]+)/.exec(location.hash);
    if (m) { store("ot_token", m[1]); return m[1]; }
    return store("ot_token");
  }

  function rpc(fn, body) {
    var h = { "Content-Type": "application/json", "apikey": C.supabaseKey };
    if (/^eyJ/.test(C.supabaseKey || "")) h.Authorization = "Bearer " + C.supabaseKey; // старый anon-ключ
    var base = String(C.supabaseUrl || "").replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
    return fetch(base + "/rest/v1/rpc/" + fn, { method: "POST", headers: h, body: JSON.stringify(body) })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); });
  }

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function money(v) { return Number(v || 0).toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + " ₸"; }
  function plural(n, one, few, many) {
    var a = n % 10, b = n % 100;
    return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many;
  }
  function ddmm(d) { return d.slice(8, 10) + "." + d.slice(5, 7); }
  function iso(dt) { return dt.getFullYear() + "-" + String(dt.getMonth() + 1).padStart(2, "0") + "-" + String(dt.getDate()).padStart(2, "0"); }
  var STATUS = { work: "в работе", transferred: "оформлена", deleted: "отменена" };

  function dayName(d, now) {
    var t = new Date(now.slice(0, 10) + "T00:00:00");
    var names = {}; names[iso(new Date(t - 864e5))] = "Вчера"; names[iso(t)] = "Сегодня"; names[iso(new Date(+t + 864e5))] = "Завтра";
    return (names[d] ? names[d] + ", " : "") + ddmm(d);
  }

  function askCode(msg) {
    $("title").textContent = "Мои заявки";
    $("sub").textContent = "";
    $("tabs").innerHTML = "";
    $("push").innerHTML = "";
    $("list").innerHTML = '<div class="notice">' + esc(msg) +
      '<input class="code" id="code" placeholder="Вставьте ссылку или код от оператора">' +
      '<button id="go">Открыть</button></div>';
    $("go").onclick = function () {
      var v = $("code").value.trim(), m = /t=([A-Za-z0-9_\-]+)/.exec(v);
      store("ot_token", m ? m[1] : v);
      load();
    };
  }

  function render() {
    var f = state.feed, now = f.now || iso(new Date());
    $("title").textContent = f.agent;
    $("sub").textContent = "Обновлено " + now.slice(11, 16);
    var days = {}, qs = {}, issues = f.issues || [];
    f.orders.forEach(function (o) { days[o.day] = (days[o.day] || 0) + 1; });
    issues.forEach(function (i) {
      days[i.day] = days[i.day] || 0;
      if (i.status === "open") qs[i.day] = (qs[i.day] || 0) + 1;
    });
    var keys = Object.keys(days).sort();
    if (!state.day || !days[state.day]) {
      var today = now.slice(0, 10), tom = iso(new Date(new Date(today + "T00:00:00").getTime() + 864e5));
      state.day = days[tom] ? tom : days[today] ? today : keys[keys.length - 1];
    }
    $("tabs").innerHTML = keys.map(function (d) {
      return '<button class="tab' + (d === state.day ? " on" : "") + '" data-d="' + d + '">' + esc(dayName(d, now)) +
        (qs[d] ? ' <span class="qn">' + qs[d] + "</span>" : "") + "</button>";
    }).join("");
    Array.prototype.forEach.call($("tabs").children, function (b) { b.onclick = function () { state.day = b.dataset.d; render(); }; });

    var evs = {};
    f.events.forEach(function (e) { (evs[e.order_key] = evs[e.order_key] || []).push(e); });
    var list = f.orders.filter(function (o) { return o.day === state.day; });
    var dayIssues = issues.filter(function (i) { return i.day === state.day; }), byOrder = {}, loose = [];
    dayIssues.forEach(function (i) {
      var nums = (i.docs || []).map(function (d) { return d.num; });
      var o = list.filter(function (o) { return o.docs.some(function (d) { return nums.indexOf(d.num) >= 0; }); })[0];
      if (o) (byOrder[o.order_key] = byOrder[o.order_key] || []).push(i); else loose.push(i);
    });
    if (!list.length && !loose.length) { $("list").innerHTML = '<div class="empty">Заявок нет</div>'; return; }
    function qOpen(i) {
      return '<div class="q"><div class="qt">Вопрос: ' + esc(i.text) + "</div>" +
        (i.detail ? '<div class="qd">' + esc(i.detail) + "</div>" : "") + "</div>";
    }
    function qClosed(i) {
      return '<div class="ev"><div class="w">' + ddmm(i.closed_at) + " " + i.closed_at.slice(11, 16) + "</div>" +
        '<div class="t ok">Вопрос снят</div><div class="l">' + esc(i.text) + "</div></div>";
    }
    var looseHtml = loose.filter(function (i) { return i.status === "open"; }).map(function (i) {
      return '<div class="card ask"><div class="head"><div class="main"><div class="name">' + esc(i.kname) + "</div>" +
        qOpen(i) + "</div></div></div>";
    }).join("");
    // итог дня: заявки без отменённых, сумма сейчас (меняется с каждым обходом) и при появлении
    var live = list.filter(function (o) { return o.status !== "deleted"; });
    var tNow = live.reduce(function (a, o) { return a + Number(o.sum_now || 0); }, 0);
    var tFirst = live.reduce(function (a, o) { return a + Number(o.sum_first || 0); }, 0);
    var nDel = list.length - live.length;
    var totalHtml = list.length ? '<div class="total"><div class="tl">Итого за ' +
      esc(dayName(state.day, now).toLowerCase()) + "</div>" +
      '<div class="tr"><div><div class="ts">' + live.length + " " + plural(live.length, "заявка", "заявки", "заявок") + "</div>" +
      (nDel ? '<div class="tm">отменено: ' + nDel + "</div>" : "") + "</div>" +
      '<div class="right"><div class="ts">' + money(tNow) + "</div>" +
      (Math.abs(tNow - tFirst) > 0.005 ? '<div class="tm">было ' + money(tFirst) + "</div>" : "") +
      '</div></div><button class="share" id="share">Поделиться итогом дня</button></div>' : "";
    $("list").innerHTML = totalHtml + looseHtml + list.map(function (o) {
      var es = (evs[o.order_key] || []).slice().reverse();
      var iss = byOrder[o.order_key] || [];
      var open = iss.filter(function (i) { return i.status === "open"; });
      var closed = iss.filter(function (i) { return i.status !== "open"; });
      var hot = es.some(function (e) { return e.important; });
      var diff = Math.abs(Number(o.sum_now) - Number(o.sum_first)) > 0.005;
      return '<div class="card' + (open.length ? " ask" : hot ? " hot" : "") + (state.open[o.order_key] ? " open" : "") + '" data-k="' + esc(o.order_key) + '">' +
        '<div class="head"><div class="main"><div class="name">' + esc(o.kname) + "</div>" +
        '<div class="meta">' + esc([o.shop ? "магазин №" + o.shop : "", o.stores.replace(/Склад /g, "")].filter(Boolean).join(" · ")) + "</div>" +
        '<span class="chip st-' + esc(o.status) + '">' + (STATUS[o.status] || o.status) + "</span> " +
        (o.changes ? '<span class="chip chg">изменений: ' + o.changes + "</span>" : "") +
        open.map(qOpen).join("") + "</div>" +
        '<div class="right"><div class="sum">' + money(o.sum_now) + "</div>" +
        (diff ? '<div class="was">' + money(o.sum_first) + "</div>" : "") + "</div></div>" +
        '<div class="events">' + closed.map(qClosed).join("") + es.map(function (e) {
          return '<div class="ev' + (e.important ? " imp" : "") + '"><div class="w">' + ddmm(e.at) + " " + e.at.slice(11, 16) +
            " · № " + esc(e.doc_num) + "</div>" + '<div class="t">' + esc(e.title) + "</div>" +
            (e.lines || []).slice(0, 30).map(function (l) { return '<div class="l">' + esc(l) + "</div>"; }).join("") + "</div>";
        }).join("") + "</div></div>";
    }).join("");
    if ($("share")) $("share").onclick = function () { share(f.agent, state.day, live, nDel, tNow); };
    Array.prototype.forEach.call(document.querySelectorAll(".card .head"), function (h) {
      h.onclick = function () { var c = h.parentNode, k = c.dataset.k; state.open[k] = !state.open[k]; c.classList.toggle("open"); };
    });
  }

  // ---------------------------------------------------------------- итог дня в общий чат
  function shareText(agent, day, live, nDel, total) {
    var n = live.length;
    var lines = [agent + " — итог за " + ddmm(day),
      n + " " + plural(n, "заявка", "заявки", "заявок") + (nDel ? " (отменено: " + nDel + ")" : "") + " на " + money(total)];
    live.slice().sort(function (a, b) { return a.first_at < b.first_at ? -1 : 1; }).forEach(function (o, i) {
      lines.push((i + 1) + ". " + o.kname + (o.shop ? " №" + o.shop : "") + " — " + money(o.sum_now));
    });
    return lines.join("\n");
  }

  function share(agent, day, live, nDel, total) {
    var text = shareText(agent, day, live, nDel, total), btn = $("share");
    function copied(ok) {
      if (!btn) return;
      btn.textContent = ok ? "Скопировано — вставьте в чат" : "Не удалось скопировать";
      setTimeout(function () { if ($("share")) $("share").textContent = "Поделиться итогом дня"; }, 3000);
    }
    if (navigator.share) {
      navigator.share({ text: text }).catch(function (e) { if (e && e.name !== "AbortError") copy(text, copied); });
    } else copy(text, copied);
  }

  function copy(text, done) {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(fallback()); });
    } else done(fallback());
    function fallback() {
      var t = document.createElement("textarea");
      t.value = text; t.style.position = "fixed"; t.style.opacity = "0";
      document.body.appendChild(t); t.select();
      var ok = false; try { ok = document.execCommand("copy"); } catch (e) {}
      document.body.removeChild(t);
      return ok;
    }
  }

  function load() {
    var t = token();
    if (!C.supabaseUrl || !C.supabaseKey) { askCode("Кабинет не настроен: нет config.js. Сообщите оператору."); return; }
    if (!t) { askCode("Откройте кабинет по личной ссылке от оператора."); return; }
    rpc("agent_feed", { p_token: t }).then(function (f) {
      if (f.error) { askCode("Ссылка больше не действует. Попросите у оператора новую."); return; }
      state.feed = f;
      render();
      pushUi();
    }).catch(function () {
      $("sub").textContent = "Нет связи, показаны прошлые данные";
    });
  }

  // ---------------------------------------------------------------- уведомления
  function b64(s) {
    var p = "=".repeat((4 - s.length % 4) % 4), raw = atob((s + p).replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(raw, function (c) { return c.charCodeAt(0); });
  }
  var standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  var ios = /iPhone|iPad|iPod/.test(navigator.userAgent);

  function pushUi() {
    var box = $("push");
    if (!C.vapidPublicKey) { box.innerHTML = ""; return; }
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      box.innerHTML = ios && !standalone
        ? '<div class="notice">Чтобы получать уведомления: «Поделиться» → «На экран „Домой“», затем откройте кабинет с главного экрана.</div>'
        : "";
      return;
    }
    navigator.serviceWorker.register("sw.js").then(function (reg) {
      return reg.pushManager.getSubscription().then(function (sub) {
        if (sub && Notification.permission === "granted") {
          rpc("agent_subscribe", { p_token: token(), p_sub: sub.toJSON() }).catch(function () {});
          box.innerHTML = "";
          return;
        }
        if (Notification.permission === "denied") {
          box.innerHTML = '<div class="notice">Уведомления запрещены в настройках браузера для этого сайта.</div>';
          return;
        }
        box.innerHTML = '<div class="notice">Включите уведомления — сообщим, если заявку отменят, изменят товары, количество или сумму, или если по заявке есть вопрос.<br><button id="pb">Включить уведомления</button></div>';
        $("pb").onclick = function () {
          Notification.requestPermission().then(function (p) {
            if (p !== "granted") { pushUi(); return; }
            return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(C.vapidPublicKey) })
              .then(function (s) { return rpc("agent_subscribe", { p_token: token(), p_sub: s.toJSON() }); })
              .then(function () { box.innerHTML = '<div class="notice">Уведомления включены.</div>'; });
          }).catch(function (e) { box.innerHTML = '<div class="notice">Не удалось включить уведомления: ' + esc(e.message) + "</div>"; });
        };
      });
    }).catch(function () { box.innerHTML = ""; });
  }

  load();
  window.addEventListener("hashchange", load);
  setInterval(function () { if (!document.hidden) load(); }, 60000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) load(); });
})();
