/**
 * ============================================================================
 * محرك المصادقة والمزامنة اللحظية متعددة الأجهزة (Cloud Sync + Local Fallback)
 * يعمل مع Google Apps Script (Google Sheets) بدون مشاكل CORS عبر بروتوكول
 * Simple Request (text/plain;charset=utf-8) ويعمل أيضاً بوضع أوفلاين/محلي مرن.
 * ============================================================================
 */

(function () {
  "use strict";

  const STORAGE_KEYS = {
    SCRIPT_URL: "fin_sys_gas_url_v1",
    LAST_DEFAULT_URL: "fin_sys_default_gas_url_v1",
    SESSION: "fin_sys_session_v1",
    LOCAL_USERS: "fin_sys_local_users_v1",
    DEVICE_ID: "fin_sys_device_id_v1",
    WB_PREFIX: "fin_sys_wb_v1_"
  };

  /**
   * خوارزمية SHA-256 قياسية مدمجة بـ JavaScript نقي لتعمل بتطابق 100%
   * سواء فُتح الموقع عبر https:// أو مباشرة كملف محلي file:/// على أي جهاز.
   */
  function sha256Hex(asciiInput) {
    const utf8 = unescape(encodeURIComponent(String(asciiInput || "")));
    const K = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ];
    const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const l = utf8.length * 8;
    const words = [];
    for (let i = 0; i < utf8.length; i++) {
      words[i >> 2] |= utf8.charCodeAt(i) << (24 - (i % 4) * 8);
    }
    words[l >> 5] |= 0x80 << (24 - (l % 32));
    words[(((l + 64) >> 9) << 4) + 15] = l;

    const W = new Array(64);
    function rotr(n, x) { return (x >>> n) | (x << (32 - n)); }

    for (let i = 0; i < words.length; i += 16) {
      let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (let t = 0; t < 64; t++) {
        if (t < 16) {
          W[t] = words[i + t] | 0;
        } else {
          const s0 = rotr(7, W[t - 15]) ^ rotr(18, W[t - 15]) ^ (W[t - 15] >>> 3);
          const s1 = rotr(17, W[t - 2]) ^ rotr(19, W[t - 2]) ^ (W[t - 2] >>> 10);
          W[t] = (W[t - 16] + s0 + W[t - 7] + s1) | 0;
        }
        const S1 = rotr(6, e) ^ rotr(11, e) ^ rotr(25, e);
        const ch = (e & f) ^ (~e & g);
        const temp1 = (h + S1 + ch + K[t] + W[t]) | 0;
        const S0 = rotr(2, a) ^ rotr(13, a) ^ rotr(22, a);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const temp2 = (S0 + maj) | 0;
        h = g; g = f; f = e; e = (d + temp1) | 0; d = c; c = b; b = a; a = (temp1 + temp2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }

    return H.map(function (v) {
      return ("00000000" + (v >>> 0).toString(16)).slice(-8);
    }).join("");
  }

  function getOrCreateDeviceId() {
    let id = localStorage.getItem(STORAGE_KEYS.DEVICE_ID);
    if (!id) {
      const platform = (navigator.platform || "Web").replace(/\s+/g, "");
      const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
      id = platform + "-" + rand;
      localStorage.setItem(STORAGE_KEYS.DEVICE_ID, id);
    }
    return id;
  }

  function getDefaultScriptUrl() {
    const def = (window.APP_CONFIG && window.APP_CONFIG.DEFAULT_SCRIPT_URL) || "";
    return String(def).trim();
  }

  function hasFixedDefaultUrl() {
    return Boolean(getDefaultScriptUrl());
  }

  // إذا تم تثبيت أو تحديث الرابط الافتراضي في config.js، يتم تفعيله تلقائياً حتى على الأجهزة السابقة
  function syncDefaultUrlFromConfig() {
    const def = getDefaultScriptUrl();
    if (!def) return;
    const prevDef = localStorage.getItem(STORAGE_KEYS.LAST_DEFAULT_URL) || "";
    if (prevDef !== def) {
      localStorage.setItem(STORAGE_KEYS.LAST_DEFAULT_URL, def);
      localStorage.removeItem(STORAGE_KEYS.SCRIPT_URL);
    }
  }

  // فحص ما إذا كان الرابط يحتوي على باراميتر ?api=... لربط الأجهزة الجديدة تلقائياً بضغطة واحدة
  function checkUrlForCloudApi() {
    try {
      const params = new URLSearchParams(window.location.search);
      const apiParam = params.get("api");
      if (apiParam && /^https:\/\/script\.google\.com\/macros\/s\//i.test(apiParam.trim())) {
        const cleanApi = apiParam.trim();
        if (cleanApi !== getDefaultScriptUrl()) {
          localStorage.setItem(STORAGE_KEYS.SCRIPT_URL, cleanApi);
        }
      }
    } catch (_) {}
  }

  syncDefaultUrlFromConfig();
  checkUrlForCloudApi();

  const state = {
    session: null,       // { username, displayName, token, passwordHash }
    revision: 0,
    dirty: false,
    isSaving: false,
    isPolling: false,
    pollTimer: null,
    saveTimer: null,
    onStatusChange: null,
    onRemoteWorkbook: null
  };

  function getScriptUrl() {
    const saved = localStorage.getItem(STORAGE_KEYS.SCRIPT_URL);
    if (saved && saved.trim()) return saved.trim();
    return getDefaultScriptUrl();
  }

  function setScriptUrl(url) {
    const clean = String(url || "").trim();
    const def = getDefaultScriptUrl();
    if (clean && clean !== def) {
      localStorage.setItem(STORAGE_KEYS.SCRIPT_URL, clean);
    } else {
      localStorage.removeItem(STORAGE_KEYS.SCRIPT_URL);
    }
  }

  function resetToDefaultScriptUrl() {
    localStorage.removeItem(STORAGE_KEYS.SCRIPT_URL);
    return getDefaultScriptUrl();
  }

  function hasCustomUrlOverride() {
    const saved = localStorage.getItem(STORAGE_KEYS.SCRIPT_URL);
    return Boolean(saved && saved.trim() && saved.trim() !== getDefaultScriptUrl());
  }

  function hasCloudConfigured() {
    return Boolean(getScriptUrl());
  }

  async function callCloudApi(payload) {
    const url = getScriptUrl();
    if (!url) {
      throw new Error("لم يتم إعداد رابط Google Apps Script بعد.");
    }
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=utf-8"
      },
      body: JSON.stringify(payload),
      redirect: "follow"
    });
    if (!resp.ok) {
      throw new Error("تعذر الاتصال بالخادم السحابي (HTTP " + resp.status + ")");
    }
    const text = await resp.text();
    try {
      return JSON.parse(text);
    } catch (_) {
      throw new Error("استجابة غير متوقعة من Google Apps Script. تأكد من ضبط صلاحية النشر Who has access إلى Anyone.");
    }
  }

  function saveLocalMirror(username, workbook, revision, dirty) {
    const key = STORAGE_KEYS.WB_PREFIX + String(username).toLowerCase();
    const packet = {
      workbook: workbook,
      revision: Number(revision || 0),
      dirty: Boolean(dirty),
      savedAt: new Date().toISOString(),
      deviceId: getOrCreateDeviceId()
    };
    localStorage.setItem(key, JSON.stringify(packet));
  }

  function loadLocalMirror(username) {
    const key = STORAGE_KEYS.WB_PREFIX + String(username).toLowerCase();
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }

  function emitStatus(kind, text) {
    if (typeof state.onStatusChange === "function") {
      state.onStatusChange({ kind: kind, text: text, hasCloud: hasCloudConfigured() });
    }
  }

  /**
   * إنشاء حساب مستخدم جديد (سحابياً إذا كان مربوطاً بـ Google Sheets، أو محلياً قابلاً للترقية السحابية لاحقاً)
   */
  async function registerUser(usernameRaw, displayNameRaw, passwordRaw) {
    const username = String(usernameRaw || "").trim().toLowerCase();
    const displayName = String(displayNameRaw || username).trim();
    const password = String(passwordRaw || "");

    if (username.length < 3) throw new Error("اسم المستخدم يجب ألا يقل عن 3 أحرف.");
    if (password.length < 4) throw new Error("كلمة المرور يجب ألا تقل عن 4 أحرف أو أرقام.");

    const passwordHash = sha256Hex(username + "::" + password);
    const initialWb = window.SpreadsheetEngine.createDefaultWorkbook();

    if (hasCloudConfigured()) {
      const res = await callCloudApi({
        action: "register",
        username: username,
        displayName: displayName,
        passwordHash: passwordHash,
        deviceId: getOrCreateDeviceId(),
        initialWorkbook: initialWb
      });
      if (!res.ok) throw new Error(res.error || "تعذر إنشاء الحساب السحابي.");

      const session = {
        username: username,
        displayName: res.user.displayName || displayName,
        token: res.user.token,
        passwordHash: passwordHash,
        mode: "cloud"
      };
      state.session = session;
      state.revision = Number(res.revision || 1);
      state.dirty = false;
      localStorage.setItem(STORAGE_KEYS.SESSION, JSON.stringify(session));
      saveLocalMirror(username, initialWb, state.revision, false);
      startBackgroundSync();
      emitStatus("synced", "متصل ومتزامن سحابياً");
      return { session: session, workbook: initialWb };
    }

    // وضع محلي فوري عند عدم وضع رابط السحابة بعد
    const localUsers = JSON.parse(localStorage.getItem(STORAGE_KEYS.LOCAL_USERS) || "{}");
    if (localUsers[username]) {
      throw new Error("اسم المستخدم موجود بالفعل محلياً، سجل الدخول مباشرة.");
    }
    localUsers[username] = { username: username, displayName: displayName, passwordHash: passwordHash };
    localStorage.setItem(STORAGE_KEYS.LOCAL_USERS, JSON.stringify(localUsers));

    const session = { username: username, displayName: displayName, token: "local", passwordHash: passwordHash, mode: "local" };
    state.session = session;
    state.revision = 1;
    state.dirty = true;
    localStorage.setItem(STORAGE_KEYS.SESSION, JSON.stringify(session));
    saveLocalMirror(username, initialWb, 1, true);
    emitStatus("local", "وضع محلي (اضغط لربط Google Sheets)");
    return { session: session, workbook: initialWb };
  }

  /**
   * تسجيل الدخول ومزامنة أحدث بيانات المستخدم فوراً من السحابة
   */
  async function loginUser(usernameRaw, passwordRaw) {
    const username = String(usernameRaw || "").trim().toLowerCase();
    const password = String(passwordRaw || "");
    if (!username || !password) throw new Error("يرجى إدخال اسم المستخدم وكلمة المرور.");

    const passwordHash = sha256Hex(username + "::" + password);

    if (hasCloudConfigured()) {
      const res = await callCloudApi({
        action: "login",
        username: username,
        passwordHash: passwordHash,
        deviceId: getOrCreateDeviceId()
      });
      if (!res.ok) throw new Error(res.error || "فشل تسجيل الدخول.");

      const wb = res.workbook || window.SpreadsheetEngine.createDefaultWorkbook();
      const session = {
        username: username,
        displayName: res.user.displayName || username,
        token: res.user.token,
        passwordHash: passwordHash,
        mode: "cloud"
      };
      state.session = session;
      state.revision = Number(res.revision || 0);
      state.dirty = false;
      localStorage.setItem(STORAGE_KEYS.SESSION, JSON.stringify(session));
      saveLocalMirror(username, wb, state.revision, false);
      startBackgroundSync();
      emitStatus("synced", "متزامن سحابياً عبر الأجهزة");
      return { session: session, workbook: wb };
    }

    // تسجيل الدخول في الوضع المحلي
    const localUsers = JSON.parse(localStorage.getItem(STORAGE_KEYS.LOCAL_USERS) || "{}");
    const u = localUsers[username];
    if (!u) throw new Error("الحساب غير موجود محلياً. أنشئ حساباً جديداً للدخول أولاً.");
    if (u.passwordHash !== passwordHash) throw new Error("كلمة المرور غير صحيحة.");

    const mirror = loadLocalMirror(username);
    const wb = (mirror && mirror.workbook) ? mirror.workbook : window.SpreadsheetEngine.createDefaultWorkbook();
    const session = { username: username, displayName: u.displayName || username, token: "local", passwordHash: passwordHash, mode: "local" };
    state.session = session;
    state.revision = mirror ? Number(mirror.revision || 1) : 1;
    state.dirty = true;
    localStorage.setItem(STORAGE_KEYS.SESSION, JSON.stringify(session));
    emitStatus("local", "وضع محلي (اضغط لربط Google Sheets)");
    return { session: session, workbook: wb };
  }

  /**
   * استعادة الجلسة عند إعادة فتح الصفحة ومزامنة آخر نسخة سحابية تلقائياً
   */
  async function restoreSession() {
    const raw = localStorage.getItem(STORAGE_KEYS.SESSION);
    if (!raw) return null;
    try {
      const savedSession = JSON.parse(raw);
      if (!savedSession || !savedSession.username) return null;
      state.session = savedSession;
      const mirror = loadLocalMirror(savedSession.username);
      const localWb = (mirror && mirror.workbook) ? mirror.workbook : window.SpreadsheetEngine.createDefaultWorkbook();
      state.revision = mirror ? Number(mirror.revision || 0) : 0;
      state.dirty = mirror ? Boolean(mirror.dirty) : false;

      if (hasCloudConfigured()) {
        startBackgroundSync();
        emitStatus("syncing", "جاري فحص التحديثات السحابية...");
        // فحص صامت في الخلفية فور الفتح
        setTimeout(function () {
          if (state.session && state.session.mode === "local") {
            bridgeLocalAccountToCloud(localWb).catch(function () {});
          } else {
            pollRemoteNow().catch(function () {});
          }
        }, 150);
      } else {
        emitStatus("local", "وضع محلي (اضغط لربط Google Sheets)");
      }

      return { session: savedSession, workbook: localWb };
    } catch (_) {
      return null;
    }
  }

  /**
   * ترقية تلقائية سلسة إذا كان المستخدم يعمل محلياً ثم أضاف رابط Google Apps Script
   */
  async function bridgeLocalAccountToCloud(currentWorkbook) {
    if (!state.session || !hasCloudConfigured()) return;
    emitStatus("syncing", "جاري ربط الحساب ومزامنة البيانات مع Google Sheets...");
    try {
      // محاولة تسجيل الدخول أولاً إذا كان نفس الحساب موجوداً على السحابة من جهاز آخر
      const loginRes = await callCloudApi({
        action: "login",
        username: state.session.username,
        passwordHash: state.session.passwordHash,
        deviceId: getOrCreateDeviceId()
      });

      if (loginRes.ok) {
        state.session.token = loginRes.user.token;
        state.session.mode = "cloud";
        localStorage.setItem(STORAGE_KEYS.SESSION, JSON.stringify(state.session));

        if (loginRes.workbook && Number(loginRes.revision || 0) > 0) {
          state.revision = Number(loginRes.revision);
          state.dirty = false;
          saveLocalMirror(state.session.username, loginRes.workbook, state.revision, false);
          if (typeof state.onRemoteWorkbook === "function") {
            state.onRemoteWorkbook(loginRes.workbook, loginRes.updatedByDevice || "السحابة");
          }
        } else {
          await pushWorkbookNow(currentWorkbook);
        }
        startBackgroundSync();
        emitStatus("synced", "تم الربط والمزامنة مع Google Sheets");
        return;
      }

      // إذا لم يكن مسجلاً في السحابة بعد، ننشئه تلقائياً مع رفع المصنف الحالي
      const regRes = await callCloudApi({
        action: "register",
        username: state.session.username,
        displayName: state.session.displayName,
        passwordHash: state.session.passwordHash,
        deviceId: getOrCreateDeviceId(),
        initialWorkbook: currentWorkbook
      });
      if (!regRes.ok) throw new Error(regRes.error || "تعذر ربط الحساب بالسحابة.");

      state.session.token = regRes.user.token;
      state.session.mode = "cloud";
      state.revision = Number(regRes.revision || 1);
      state.dirty = false;
      localStorage.setItem(STORAGE_KEYS.SESSION, JSON.stringify(state.session));
      saveLocalMirror(state.session.username, currentWorkbook, state.revision, false);
      startBackgroundSync();
      emitStatus("synced", "تم رفع البيانات وتفعيل المزامنة السحابية");
    } catch (err) {
      emitStatus("error", err.message || "خطأ في الاتصال بالسحابة");
      throw err;
    }
  }

  function scheduleSave(workbook, activeSheet) {
    if (!state.session) return;
    state.dirty = true;
    saveLocalMirror(state.session.username, workbook, state.revision, true);

    if (!hasCloudConfigured()) {
      emitStatus("local", "محفوظ محلياً (اضغط لربط السحابة)");
      return;
    }

    emitStatus("syncing", "جاري الحفظ والمزامنة...");
    if (state.saveTimer) clearTimeout(state.saveTimer);
    const delay = (window.APP_CONFIG && window.APP_CONFIG.AUTO_SAVE_DEBOUNCE_MS) || 1200;
    state.saveTimer = setTimeout(function () {
      pushWorkbookNow(workbook, activeSheet).catch(function () {});
    }, delay);
  }

  async function pushWorkbookNow(workbook, activeSheet) {
    if (!state.session) return;
    if (state.saveTimer) {
      clearTimeout(state.saveTimer);
      state.saveTimer = null;
    }

    saveLocalMirror(state.session.username, workbook, state.revision, true);

    if (!hasCloudConfigured()) {
      emitStatus("local", "محفوظ محلياً (اربط Google Sheets للمزامنة)");
      return;
    }

    if (state.session.mode === "local" || state.session.token === "local") {
      await bridgeLocalAccountToCloud(workbook);
      return;
    }

    if (state.isSaving) return;
    state.isSaving = true;
    emitStatus("syncing", "جاري الرفع إلى Google Sheets...");

    try {
      const summary = activeSheet ? window.SpreadsheetEngine.buildReadableSummaryForCloud(activeSheet) : null;
      const res = await callCloudApi({
        action: "save",
        username: state.session.username,
        token: state.session.token,
        deviceId: getOrCreateDeviceId(),
        workbook: workbook,
        readableSummary: summary
      });
      if (!res.ok) throw new Error(res.error || "تعذر الحفظ السحابي");

      state.revision = Number(res.revision || (state.revision + 1));
      state.dirty = false;
      saveLocalMirror(state.session.username, workbook, state.revision, false);
      emitStatus("synced", "تمت المزامنة سحابياً ✓");
    } catch (err) {
      emitStatus("error", "حُفظ محلياً - بانتظار الشبكة للمزامنة");
      throw err;
    } finally {
      state.isSaving = false;
    }
  }

  async function pollRemoteNow() {
    if (!state.session || !hasCloudConfigured()) return false;
    if (state.session.mode === "local" || state.isSaving || state.isPolling) return false;

    // إذا كان هناك تعديلات محلية لم تُرفع بعد، ارفعها أولاً بدلاً من الكتابة فوقها
    if (state.dirty) {
      const mirror = loadLocalMirror(state.session.username);
      if (mirror && mirror.workbook) {
        await pushWorkbookNow(mirror.workbook);
      }
      return false;
    }

    state.isPolling = true;
    try {
      const res = await callCloudApi({
        action: "poll",
        username: state.session.username,
        token: state.session.token,
        clientRevision: state.revision
      });
      if (!res.ok) {
        emitStatus("error", res.error || "تعذر التحقق من التحديثات");
        return false;
      }

      if (res.hasUpdate && res.workbook) {
        state.revision = Number(res.revision || state.revision);
        state.dirty = false;
        saveLocalMirror(state.session.username, res.workbook, state.revision, false);
        emitStatus("synced", "متزامن سحابياً (تحديث جديد)");
        if (typeof state.onRemoteWorkbook === "function") {
          state.onRemoteWorkbook(res.workbook, res.updatedByDevice || "جهاز آخر");
        }
        return true;
      }

      emitStatus("synced", "متزامن سحابياً ✓");
      return false;
    } catch (_) {
      emitStatus("error", "غير متصل مؤقتاً - يعمل محلياً");
      return false;
    } finally {
      state.isPolling = false;
    }
  }

  function startBackgroundSync() {
    stopBackgroundSync();
    const interval = (window.APP_CONFIG && window.APP_CONFIG.AUTO_POLL_INTERVAL_MS) || 12000;
    state.pollTimer = setInterval(function () {
      if (document.visibilityState === "visible") {
        pollRemoteNow().catch(function () {});
      }
    }, interval);
  }

  function stopBackgroundSync() {
    if (state.pollTimer) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
  }

  function logout() {
    stopBackgroundSync();
    if (state.saveTimer) clearTimeout(state.saveTimer);
    state.session = null;
    state.revision = 0;
    state.dirty = false;
    localStorage.removeItem(STORAGE_KEYS.SESSION);
  }

  async function testCloudConnection(candidateUrl) {
    const clean = String(candidateUrl || "").trim();
    if (!clean) throw new Error("يرجى لصق رابط تطبيق الويب (Web App URL) أولاً.");
    const resp = await fetch(clean, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "ping" }),
      redirect: "follow"
    });
    if (!resp.ok) throw new Error("فشل الاتصال بالرابط (HTTP " + resp.status + ")");
    const data = await resp.json();
    if (!data || !data.ok) throw new Error((data && data.error) || "استجابة غير صالحة");
    return data;
  }

  // مزامنة فورية عند العودة إلى نافذة المتصفح أو التبديل بين التبويبات المفتوحة على نفس الجهاز
  window.addEventListener("focus", function () {
    if (state.session && hasCloudConfigured()) {
      pollRemoteNow().catch(function () {});
    }
  });

  window.addEventListener("storage", function (ev) {
    if (!state.session) return;
    const expectedKey = STORAGE_KEYS.WB_PREFIX + state.session.username;
    if (ev.key === expectedKey && ev.newValue) {
      try {
        const packet = JSON.parse(ev.newValue);
        if (packet && packet.workbook && packet.deviceId === getOrCreateDeviceId()) {
          if (typeof state.onRemoteWorkbook === "function") {
            state.onRemoteWorkbook(packet.workbook, "تبويب آخر");
          }
        }
      } catch (_) {}
    }
  });

  window.SyncManager = {
    getScriptUrl: getScriptUrl,
    getDefaultScriptUrl: getDefaultScriptUrl,
    hasFixedDefaultUrl: hasFixedDefaultUrl,
    hasCustomUrlOverride: hasCustomUrlOverride,
    resetToDefaultScriptUrl: resetToDefaultScriptUrl,
    setScriptUrl: setScriptUrl,
    hasCloudConfigured: hasCloudConfigured,
    getDeviceId: getOrCreateDeviceId,
    registerUser: registerUser,
    loginUser: loginUser,
    restoreSession: restoreSession,
    scheduleSave: scheduleSave,
    pushWorkbookNow: pushWorkbookNow,
    pollRemoteNow: pollRemoteNow,
    bridgeLocalAccountToCloud: bridgeLocalAccountToCloud,
    testCloudConnection: testCloudConnection,
    logout: logout,
    setListeners: function (handlers) {
      state.onStatusChange = handlers.onStatusChange || null;
      state.onRemoteWorkbook = handlers.onRemoteWorkbook || null;
    },
    getSession: function () {
      return state.session;
    }
  };
})();
