/**
 * ============================================================================
 * المتحكم التفاعلي لواجهة الإكسيل الداخلية والمزامنة بين الأجهزة (app.js)
 * ============================================================================
 */

(function () {
  "use strict";

  const Engine = window.SpreadsheetEngine;
  const Sync = window.SyncManager;

  // حالة التطبيق التفاعلية
  const ui = {
    authMode: "login", // "login" | "register"
    workbook: null,
    calcCache: null,   // ناتج computeSheetMatrix للورقة النشطة
    activeCell: { r: 0, c: 1 },
    selection: { r1: 0, c1: 1, r2: 0, c2: 1 },
    isMouseSelecting: false,
    isFillDragging: false,
    fillSourceVal: "",
    inlineEditing: null, // { r, c, inputEl }
    brushStamp: null,    // عند تفعيل وضع الختم المباشر بالنقرة
    lastStampCode: "ح",
    undoStack: [],
    redoStack: []
  };

  function $(id) {
    return document.getElementById(id);
  }

  function showToast(msg, kind) {
    const container = $("toastContainer");
    if (!container) return;
    const div = document.createElement("div");
    div.className = "toast-msg " + (kind || "");
    div.textContent = msg;
    container.appendChild(div);
    setTimeout(function () {
      if (div.parentNode) div.parentNode.removeChild(div);
    }, 3400);
  }

  function getActiveSheet() {
    if (!ui.workbook || !Array.isArray(ui.workbook.sheets) || ui.workbook.sheets.length === 0) {
      return null;
    }
    const found = ui.workbook.sheets.find(function (s) { return s.id === ui.workbook.activeSheetId; });
    if (found) return found;
    ui.workbook.activeSheetId = ui.workbook.sheets[0].id;
    return ui.workbook.sheets[0];
  }

  function pushUndoSnapshot() {
    const sheet = getActiveSheet();
    if (!sheet) return;
    const snap = JSON.stringify({
      sheetId: sheet.id,
      rows: sheet.rows,
      styles: sheet.styles || {}
    });
    if (ui.undoStack.length > 0 && ui.undoStack[ui.undoStack.length - 1] === snap) return;
    ui.undoStack.push(snap);
    if (ui.undoStack.length > 40) ui.undoStack.shift();
    ui.redoStack = [];
  }

  function performUndo() {
    if (ui.undoStack.length === 0) {
      showToast("لا توجد خطوات سابقة للتراجع عنها", "info");
      return;
    }
    const sheet = getActiveSheet();
    if (!sheet) return;
    ui.redoStack.push(JSON.stringify({ sheetId: sheet.id, rows: sheet.rows, styles: sheet.styles || {} }));
    const prev = JSON.parse(ui.undoStack.pop());
    const targetSheet = ui.workbook.sheets.find(function (s) { return s.id === prev.sheetId; }) || sheet;
    targetSheet.rows = prev.rows;
    targetSheet.styles = prev.styles || {};
    ui.workbook.activeSheetId = targetSheet.id;
    renderAll(true);
  }

  function performRedo() {
    if (ui.redoStack.length === 0) return;
    const sheet = getActiveSheet();
    if (!sheet) return;
    ui.undoStack.push(JSON.stringify({ sheetId: sheet.id, rows: sheet.rows, styles: sheet.styles || {} }));
    const next = JSON.parse(ui.redoStack.pop());
    const targetSheet = ui.workbook.sheets.find(function (s) { return s.id === next.sheetId; }) || sheet;
    targetSheet.rows = next.rows;
    targetSheet.styles = next.styles || {};
    ui.workbook.activeSheetId = targetSheet.id;
    renderAll(true);
  }

  // ==========================================================================
  // 1. إدارة شاشة تسجيل الدخول وإنشاء الحساب
  // ==========================================================================
  function refreshAuthCloudBanner() {
    const hasCloud = Sync.hasCloudConfigured();
    const txt = $("authCloudStatusText");
    if (txt) {
      txt.textContent = hasCloud
        ? "☁️ متصل بـ Google Sheets: تسجيل الدخول يزامن بياناتك تلقائياً على أي جهاز"
        : "💻 وضع محلي سريع: اضغط (إعداد السحابة) لربط Google Sheets للمزامنة بين الأجهزة";
    }
  }

  function setAuthMode(mode) {
    ui.authMode = mode;
    $("tabLogin").classList.toggle("active", mode === "login");
    $("tabRegister").classList.toggle("active", mode === "register");
    $("registerNameGroup").classList.toggle("hidden", mode === "login");
    $("btnSubmitAuth").textContent = mode === "login" ? "تسجيل الدخول وفتح الشيت" : "إنشاء الحساب وبدء العمل";
    hideAuthAlert();
  }

  function showAuthAlert(msg, type) {
    const el = $("authAlert");
    el.textContent = msg;
    el.className = "auth-alert " + (type || "error");
    el.classList.remove("hidden");
  }

  function hideAuthAlert() {
    $("authAlert").classList.add("hidden");
  }

  async function handleAuthSubmit(ev) {
    ev.preventDefault();
    hideAuthAlert();
    const username = $("inpUsername").value.trim();
    const password = $("inpPassword").value;
    const displayName = $("inpDisplayName").value.trim();
    const btn = $("btnSubmitAuth");

    btn.disabled = true;
    const origText = btn.textContent;
    btn.textContent = "جاري التحقق والمزامنة...";

    try {
      let result;
      if (ui.authMode === "register") {
        result = await Sync.registerUser(username, displayName || username, password);
        showToast("مرحباً بك! تم إنشاء حسابك وتجهيز ورقة الحضور والنبطشيات والسهر.");
      } else {
        result = await Sync.loginUser(username, password);
        showToast("تم تسجيل الدخول وتحميل أحدث بياناتك بنجاح.");
      }
      enterWorkspace(result.session, result.workbook);
    } catch (err) {
      showAuthAlert(err.message || "حدث خطأ أثناء تسجيل الدخول", "error");
    } finally {
      btn.disabled = false;
      btn.textContent = origText;
    }
  }

  function enterWorkspace(session, workbook) {
    ui.workbook = workbook && Array.isArray(workbook.sheets) && workbook.sheets.length > 0
      ? workbook
      : Engine.createDefaultWorkbook();

    $("authScreen").classList.add("hidden");
    $("workspaceScreen").classList.remove("hidden");
    $("lblCurrentUser").textContent = "👤 " + (session.displayName || session.username) + " (" + session.username + ")";
    $("lblDeviceBadge").textContent = "الجهاز: " + Sync.getDeviceId();
    $("inpWorkbookTitle").value = ui.workbook.workbookTitle || "سجل الحضور والنبطشيات والسهر الموحد";

    ui.activeCell = { r: 0, c: 1 };
    ui.selection = { r1: 0, c1: 1, r2: 0, c2: 1 };
    ui.undoStack = [];
    ui.redoStack = [];

    renderStampButtons();
    populateMonthYearSelectors();
    renderAll(false);
  }

  // ==========================================================================
  // 2. بناء وعرض شبكة الإكسيل وشريط الأوراق والمؤشرات
  // ==========================================================================
  function populateMonthYearSelectors() {
    const selMonth = $("selMonth");
    selMonth.innerHTML = "";
    window.APP_CONFIG.ARABIC_MONTHS.forEach(function (mName, i) {
      const opt = document.createElement("option");
      opt.value = String(i + 1);
      opt.textContent = (i + 1) + " - " + mName;
      selMonth.appendChild(opt);
    });
  }

  function renderStampButtons() {
    const container = $("stampButtonsContainer");
    container.innerHTML = "";
    const stamps = [
      { code: "ح", title: "حضور (ح)", bg: "#ecfdf5", color: "#047857" },
      { code: "ن", title: "نبطشية (ن)", bg: "#eff6ff", color: "#1d4ed8" },
      { code: "س", title: "سهر (س)", bg: "#fffbeb", color: "#b45309" },
      { code: "س2", title: "سهر ساعتين (س2)", bg: "#fef3c7", color: "#92400e" },
      { code: "ح+ن", title: "حضور + نبطشية (ح+ن)", bg: "#e0f2fe", color: "#1e40af" },
      { code: "ح+س", title: "حضور + سهر (ح+س)", bg: "#ccfbf1", color: "#0f766e" },
      { code: "ح+س2", title: "حضور + سهر2 (ح+س2)", bg: "#d1fae5", color: "#065f46" },
      { code: "ح+ن+س", title: "حضور + نبطشية + سهر", bg: "#ede9fe", color: "#5b21b6" },
      { code: "غ", title: "غياب (غ)", bg: "#fef2f2", color: "#dc2626" },
      { code: "إ", title: "إجازة (إ)", bg: "#f5f3ff", color: "#6d28d9" },
      { code: "م", title: "مأمورية (م)", bg: "#f0f9ff", color: "#0369a1" },
      { code: "ع", title: "عطلة/راحة (ع)", bg: "#f1f5f9", color: "#475569" },
      { code: "", title: "مسح الخلية ⌫", bg: "#ffffff", color: "#334155" }
    ];

    stamps.forEach(function (st) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "stamp-btn" + (ui.brushStamp === st.code ? " active-stamp" : "");
      btn.style.background = st.bg;
      btn.style.color = st.color;
      btn.textContent = st.title;
      btn.addEventListener("click", function () {
        ui.lastStampCode = st.code;
        if (ui.brushStamp !== null) {
          ui.brushStamp = st.code;
          renderStampButtons();
          updateStatusModeLabel();
        } else {
          applyValueToSelection(st.code, true);
        }
        $("gridViewport").focus({ preventScroll: true });
      });
      container.appendChild(btn);
    });
  }

  function renderAll(triggerSave) {
    const sheet = getActiveSheet();
    if (!sheet) return;

    commitInlineEditIfAny(false);

    ui.calcCache = Engine.computeSheetMatrix(sheet);
    syncRibbonControlsWithSheet(sheet);
    renderSheetTabs();
    renderGrid(sheet, ui.calcCache);
    renderKPIs(sheet, ui.calcCache);
    updateSelectionHighlights();
    updateFormulaBar();
    updateStatusStatistics();

    if (triggerSave) {
      Sync.scheduleSave(ui.workbook, sheet);
    }
  }

  function syncRibbonControlsWithSheet(sheet) {
    const isUnified = sheet.type === "unified";
    $("selMonth").disabled = !isUnified;
    $("inpYear").disabled = !isUnified;
    $("btnToggleDays").disabled = !isUnified;
    $("btnOpenRatesModal").disabled = !isUnified;
    $("btnCloneNextMonth").disabled = !isUnified;

    if (isUnified) {
      $("selMonth").value = String(sheet.month || 11);
      $("inpYear").value = String(sheet.year || 2026);
      $("btnToggleDays").textContent = sheet.hideDays ? "📅 إظهار أيام الشهر" : "📅 طي أيام الشهر";
      $("btnToggleDays").classList.toggle("active", Boolean(sheet.hideDays));
    }

    $("printOrgTitle").textContent = ui.workbook.orgName || "الإدارة المالية وشؤون العاملين";
    $("printSheetTitle").textContent = (ui.workbook.workbookTitle || "") + " — " + sheet.title;
    $("printDateLabel").textContent = "تاريخ الطباعة: " + new Date().toLocaleDateString("ar-EG");
  }

  function renderKPIs(sheet, calc) {
    const strip = $("kpiStrip");
    if (!calc.kpis || sheet.type !== "unified") {
      strip.classList.add("hidden");
      return;
    }
    strip.classList.remove("hidden");
    $("kpiEmpCount").textContent = calc.kpis.employees;
    $("kpiTotAtt").textContent = Engine.formatMoney(calc.kpis.totAtt);
    $("kpiTotShift").textContent = Engine.formatMoney(calc.kpis.totShift);
    $("kpiTotOt").textContent = Engine.formatMoney(calc.kpis.totOt);
    $("kpiNetMoney").textContent = Engine.formatMoney(calc.kpis.netTotal) + " ج.م";
  }

  function renderSheetTabs() {
    const list = $("sheetTabsList");
    list.innerHTML = "";
    ui.workbook.sheets.forEach(function (sh) {
      const tab = document.createElement("div");
      tab.className = "sheet-tab" + (sh.id === ui.workbook.activeSheetId ? " active" : "");

      const titleSpan = document.createElement("span");
      titleSpan.textContent = (sh.type === "free" ? "📄 " : "📊 ") + sh.title;
      titleSpan.title = "نقر مزدوج لإعادة تسمية الورقة";
      titleSpan.addEventListener("dblclick", function (ev) {
        ev.stopPropagation();
        const newName = window.prompt("أدخل الاسم الجديد للورقة:", sh.title);
        if (newName && newName.trim()) {
          sh.title = newName.trim();
          renderAll(true);
        }
      });
      tab.appendChild(titleSpan);

      if (ui.workbook.sheets.length > 1) {
        const closeBtn = document.createElement("span");
        closeBtn.className = "tab-action";
        closeBtn.textContent = "✕";
        closeBtn.title = "حذف هذه الورقة";
        closeBtn.addEventListener("click", function (ev) {
          ev.stopPropagation();
          if (window.confirm("هل تريد حذف الورقة (" + sh.title + ") نهائياً؟")) {
            ui.workbook.sheets = ui.workbook.sheets.filter(function (x) { return x.id !== sh.id; });
            if (ui.workbook.activeSheetId === sh.id) {
              ui.workbook.activeSheetId = ui.workbook.sheets[0].id;
            }
            ui.activeCell = { r: 0, c: 0 };
            ui.selection = { r1: 0, c1: 0, r2: 0, c2: 0 };
            renderAll(true);
          }
        });
        tab.appendChild(closeBtn);
      }

      tab.addEventListener("click", function () {
        if (ui.workbook.activeSheetId !== sh.id) {
          ui.workbook.activeSheetId = sh.id;
          ui.activeCell = { r: 0, c: sh.type === "unified" ? 1 : 0 };
          ui.selection = { r1: ui.activeCell.r, c1: ui.activeCell.c, r2: ui.activeCell.r, c2: ui.activeCell.c };
          renderAll(false);
        }
      });

      list.appendChild(tab);
    });
  }

  function renderGrid(sheet, calc) {
    const thead = $("excelThead");
    const tbody = $("excelTbody");
    const tfoot = $("excelTfoot");

    thead.innerHTML = "";
    tbody.innerHTML = "";
    tfoot.innerHTML = "";

    const cols = calc.cols;

    // 1) صف حروف الإكسيل (A, B, C ... AA, AB)
    const lettersTr = document.createElement("tr");
    lettersTr.className = "excel-letters-row";
    const cornerTh = document.createElement("th");
    cornerTh.className = "sticky-col-0";
    cornerTh.textContent = "#";
    lettersTr.appendChild(cornerTh);

    cols.forEach(function (col, cIdx) {
      if (col.hidden) return;
      const th = document.createElement("th");
      if (col.sticky) th.classList.add(col.sticky);
      th.textContent = Engine.colToLetter(cIdx);
      lettersTr.appendChild(th);
    });
    thead.appendChild(lettersTr);

    // 2) صف عناوين الأعمدة الفعلية
    if (sheet.type === "unified") {
      const hdrTr = document.createElement("tr");
      hdrTr.className = "sheet-columns-row";

      const idxTh = document.createElement("th");
      idxTh.className = "sticky-col-0";
      idxTh.textContent = "م";
      hdrTr.appendChild(idxTh);

      cols.forEach(function (col) {
        if (col.hidden) return;
        const th = document.createElement("th");
        if (col.sticky) th.classList.add(col.sticky);
        if (col.headerClass) th.classList.add(col.headerClass);

        if (col.kind === "day") {
          th.classList.add("day-col-header");
          if (col.isWeekend) th.classList.add("is-weekend");
          th.innerHTML = '<span class="day-num">' + col.dayNum + '</span><span class="day-name">' + col.dayName + '</span>';
        } else {
          th.textContent = col.title;
        }
        hdrTr.appendChild(th);
      });
      thead.appendChild(hdrTr);
    }

    // 3) صفوف البيانات
    const stylesMap = sheet.styles || {};
    calc.displayMatrix.forEach(function (rowCells, rIdx) {
      const tr = document.createElement("tr");

      const rowNumTd = document.createElement("td");
      rowNumTd.className = "sticky-col-0";
      rowNumTd.textContent = String(rIdx + 1);
      tr.appendChild(rowNumTd);

      cols.forEach(function (col, cIdx) {
        if (col.hidden) return;
        const cellInfo = rowCells[cIdx];
        const td = document.createElement("td");
        td.dataset.r = String(rIdx);
        td.dataset.c = String(cIdx);

        if (col.sticky) td.classList.add(col.sticky);
        if (col.cellClass) td.classList.add(col.cellClass);
        if (!col.editable) td.classList.add("readonly-calc");

        if (col.kind === "day") {
          td.classList.add("day-cell");
          if (col.isWeekend) td.classList.add("is-weekend-col");
          if (cellInfo.cssClass) td.classList.add(cellInfo.cssClass);
        }

        // تطبيق التنسيقات المخصصة للخلية (خط عريض / لون تعبئة)
        const customStyle = stylesMap[rIdx + ":" + cIdx];
        if (customStyle) {
          if (customStyle.bold) td.style.fontWeight = "800";
          if (customStyle.bg) td.style.backgroundColor = customStyle.bg;
        }

        const val = cellInfo.display;
        if (col.kind === "calc_money" || col.kind === "calc_net") {
          td.textContent = val === 0 ? "0" : Engine.formatMoney(val);
        } else {
          td.textContent = val === undefined || val === null ? "" : String(val);
        }

        tr.appendChild(td);
      });

      tbody.appendChild(tr);
    });

    // 4) صف الإجماليات السفلي للورقة الموحدة
    if (calc.totalsRow) {
      const footTr = document.createElement("tr");
      footTr.className = "totals-footer-row";

      const fIdx = document.createElement("td");
      fIdx.className = "sticky-col-0";
      fIdx.textContent = "∑";
      footTr.appendChild(fIdx);

      cols.forEach(function (col) {
        if (col.hidden) return;
        const td = document.createElement("td");
        if (col.sticky) td.classList.add(col.sticky);
        if (col.key === "net_total") td.classList.add("col-net-total");
        const tv = calc.totalsRow[col.key];
        if (col.kind === "calc_money" || col.kind === "calc_net") {
          td.textContent = Engine.formatMoney(tv);
        } else {
          td.textContent = tv === undefined || tv === null ? "" : String(tv);
        }
        footTr.appendChild(td);
      });

      tfoot.appendChild(footTr);
    }
  }

  // ==========================================================================
  // 3. التحديد، شريط الصيغة (fx)، التحرير المباشر، ومقبض التعبئة
  // ==========================================================================
  function clampCoords(r, c) {
    const sheet = getActiveSheet();
    if (!sheet || !ui.calcCache) return { r: 0, c: 0 };
    const maxR = Math.max(0, sheet.rows.length - 1);
    const maxC = Math.max(0, ui.calcCache.cols.length - 1);
    let nr = Math.max(0, Math.min(maxR, r));
    let nc = Math.max(0, Math.min(maxC, c));

    // تخطي الأعمدة المخفية عند طي الأيام
    if (ui.calcCache.cols[nc] && ui.calcCache.cols[nc].hidden) {
      const dir = c >= ui.activeCell.c ? 1 : -1;
      while (nc >= 0 && nc <= maxC && ui.calcCache.cols[nc].hidden) {
        nc += dir;
      }
      nc = Math.max(0, Math.min(maxC, nc));
    }
    return { r: nr, c: nc };
  }

  function getNormalizedSelection() {
    return {
      minR: Math.min(ui.selection.r1, ui.selection.r2),
      maxR: Math.max(ui.selection.r1, ui.selection.r2),
      minC: Math.min(ui.selection.c1, ui.selection.c2),
      maxC: Math.max(ui.selection.c1, ui.selection.c2)
    };
  }

  function updateSelectionHighlights() {
    const tbody = $("excelTbody");
    if (!tbody) return;

    const oldHandles = tbody.querySelectorAll(".fill-handle");
    oldHandles.forEach(function (h) { h.parentNode.removeChild(h); });

    const prevCells = tbody.querySelectorAll(".cell-selected, .cell-active");
    prevCells.forEach(function (el) {
      el.classList.remove("cell-selected", "cell-active");
    });

    const norm = getNormalizedSelection();
    for (let r = norm.minR; r <= norm.maxR; r++) {
      for (let c = norm.minC; c <= norm.maxC; c++) {
        const td = tbody.querySelector('td[data-r="' + r + '"][data-c="' + c + '"]');
        if (td) td.classList.add("cell-selected");
      }
    }

    const activeTd = tbody.querySelector('td[data-r="' + ui.activeCell.r + '"][data-c="' + ui.activeCell.c + '"]');
    if (activeTd) {
      activeTd.classList.add("cell-active");
      // إضافة مقبض التعبئة السريعة في زاوية التحديد السفلى اليسرى
      const cornerTd = tbody.querySelector('td[data-r="' + norm.maxR + '"][data-c="' + norm.maxC + '"]') || activeTd;
      if (!ui.inlineEditing) {
        cornerTd.style.position = cornerTd.classList.contains("sticky-col-1") || cornerTd.classList.contains("sticky-col-2") ? "sticky" : "relative";
        const handle = document.createElement("div");
        handle.className = "fill-handle";
        handle.title = "اسحب لتعبئة الخلايا المجاورة تلقائياً";
        cornerTd.appendChild(handle);
      }
    }
  }

  function scrollActiveCellIntoView() {
    const tbody = $("excelTbody");
    const td = tbody && tbody.querySelector('td[data-r="' + ui.activeCell.r + '"][data-c="' + ui.activeCell.c + '"]');
    if (td && td.scrollIntoView) {
      td.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }

  function updateFormulaBar() {
    const sheet = getActiveSheet();
    if (!sheet || !ui.calcCache) return;
    const r = ui.activeCell.r;
    const c = ui.activeCell.c;
    const col = ui.calcCache.cols[c];
    if (!col) return;

    $("lblCellAddress").textContent = Engine.colToLetter(c) + (r + 1);
    const fInput = $("inpFormulaBar");
    const hint = $("lblCellHint");

    if (!col.editable) {
      const disp = ui.calcCache.displayMatrix[r] && ui.calcCache.displayMatrix[r][c]
        ? ui.calcCache.displayMatrix[r][c].display
        : "";
      fInput.value = disp === undefined ? "" : String(disp);
      fInput.readOnly = true;
      hint.textContent = "🔒 عمود محسوب تلقائياً (" + col.title + ")";
    } else {
      const raw = sheet.rows[r] && sheet.rows[r][col.key] !== undefined ? sheet.rows[r][col.key] : "";
      fInput.value = String(raw);
      fInput.readOnly = false;
      if (col.kind === "day") {
        hint.textContent = "رموز اليوم: ح | ن | س | س3 | ح+ن | ح+س2 | غ | إ | م | ع";
      } else {
        hint.textContent = col.title + " (يدعم القيم والمعادلات مثل =SUM أو =150*2)";
      }
    }
  }

  function updateStatusStatistics() {
    if (!ui.calcCache) return;
    const norm = getNormalizedSelection();
    let nonEmpty = 0;
    let numCount = 0;
    let sum = 0;

    for (let r = norm.minR; r <= norm.maxR; r++) {
      const rowArr = ui.calcCache.displayMatrix[r];
      if (!rowArr) continue;
      for (let c = norm.minC; c <= norm.maxC; c++) {
        if (ui.calcCache.cols[c] && ui.calcCache.cols[c].hidden) continue;
        const v = rowArr[c] ? rowArr[c].display : "";
        if (v !== "" && v !== null && v !== undefined) {
          nonEmpty++;
          const num = Number(v);
          if (!isNaN(num) && String(v).trim() !== "") {
            numCount++;
            sum += num;
          }
        }
      }
    }

    $("statCount").textContent = "العدد: " + nonEmpty;
    $("statAvg").textContent = "المتوسط: " + (numCount > 0 ? Engine.formatMoney(sum / numCount) : "0");
    $("statSum").textContent = "المجموع: " + Engine.formatMoney(sum);
  }

  function startInlineEdit(r, c, initialText) {
    const sheet = getActiveSheet();
    if (!sheet || !ui.calcCache) return;
    const col = ui.calcCache.cols[c];
    if (!col || !col.editable) {
      showToast("هذه الخلية تُحسب تلقائياً من أيام الشهر والأسعار", "info");
      return;
    }

    commitInlineEditIfAny(false);

    const tbody = $("excelTbody");
    const td = tbody.querySelector('td[data-r="' + r + '"][data-c="' + c + '"]');
    if (!td) return;

    const currentRaw = sheet.rows[r] && sheet.rows[r][col.key] !== undefined ? String(sheet.rows[r][col.key]) : "";
    const startVal = initialText !== undefined ? initialText : currentRaw;

    td.innerHTML = "";
    const inp = document.createElement("input");
    inp.type = "text";
    inp.className = "inline-cell-editor";
    inp.value = startVal;
    td.appendChild(inp);
    inp.focus();
    if (initialText === undefined) {
      inp.select();
    } else {
      inp.setSelectionRange(inp.value.length, inp.value.length);
    }

    ui.inlineEditing = { r: r, c: c, inputEl: inp, originalVal: currentRaw };

    inp.addEventListener("input", function () {
      $("inpFormulaBar").value = inp.value;
    });

    inp.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") {
        ev.preventDefault();
        commitInlineEditIfAny(true);
        moveSelection(1, 0, false);
      } else if (ev.key === "Tab") {
        ev.preventDefault();
        commitInlineEditIfAny(true);
        moveSelection(0, ev.shiftKey ? -1 : 1, false);
      } else if (ev.key === "Escape") {
        ev.preventDefault();
        ui.inlineEditing = null;
        renderAll(false);
      }
    });
  }

  function commitInlineEditIfAny(reRender) {
    if (!ui.inlineEditing) return;
    const edit = ui.inlineEditing;
    ui.inlineEditing = null;
    const sheet = getActiveSheet();
    if (!sheet || !ui.calcCache) return;
    const col = ui.calcCache.cols[edit.c];
    if (!col || !col.editable) return;

    const newVal = edit.inputEl.value.trim();
    const oldVal = String(sheet.rows[edit.r][col.key] !== undefined ? sheet.rows[edit.r][col.key] : "");
    if (newVal !== oldVal) {
      pushUndoSnapshot();
      sheet.rows[edit.r][col.key] = normalizeTypedValue(newVal, col);
      if (reRender !== false) {
        renderAll(true);
      } else {
        Sync.scheduleSave(ui.workbook, sheet);
      }
    } else if (reRender !== false) {
      renderAll(false);
    }
  }

  function normalizeTypedValue(val, col) {
    if (val === "") return "";
    if (val.startsWith("=")) return val;
    if (col.kind === "rate" || col.kind === "free") {
      const num = Number(val);
      if (!isNaN(num) && val !== "") return num;
    }
    return val;
  }

  function applyValueToSelection(newVal, onlyDaysIfStamp) {
    const sheet = getActiveSheet();
    if (!sheet || !ui.calcCache) return;
    const norm = getNormalizedSelection();
    let changed = false;
    let pushedUndo = false;

    for (let r = norm.minR; r <= norm.maxR; r++) {
      for (let c = norm.minC; c <= norm.maxC; c++) {
        const col = ui.calcCache.cols[c];
        if (!col || col.hidden || !col.editable) continue;
        if (onlyDaysIfStamp && sheet.type === "unified" && col.kind !== "day") continue;

        if (!pushedUndo) {
          pushUndoSnapshot();
          pushedUndo = true;
        }
        sheet.rows[r][col.key] = normalizeTypedValue(String(newVal), col);
        changed = true;
      }
    }

    if (changed) {
      renderAll(true);
    } else if (onlyDaysIfStamp && sheet.type === "unified") {
      showToast("حدد خلية أو مجموعة خلايا في أعمدة أيام الشهر (1-31) لتطبيق الختم السريع", "info");
    }
  }

  function moveSelection(dRow, dCol, expandShift) {
    if (expandShift) {
      const next = clampCoords(ui.selection.r2 + dRow, ui.selection.c2 + dCol);
      ui.selection.r2 = next.r;
      ui.selection.c2 = next.c;
    } else {
      const next = clampCoords(ui.activeCell.r + dRow, ui.activeCell.c + dCol);
      ui.activeCell = next;
      ui.selection = { r1: next.r, c1: next.c, r2: next.r, c2: next.c };
    }
    updateSelectionHighlights();
    updateFormulaBar();
    updateStatusStatistics();
    scrollActiveCellIntoView();
  }

  // ==========================================================================
  // 4. النسخ واللصق المتوافق مع Microsoft Excel الحقيقي (Ctrl+C / Ctrl+V)
  // ==========================================================================
  async function copySelectionToClipboard() {
    if (!ui.calcCache) return;
    const norm = getNormalizedSelection();
    const lines = [];
    for (let r = norm.minR; r <= norm.maxR; r++) {
      const rowVals = [];
      for (let c = norm.minC; c <= norm.maxC; c++) {
        if (ui.calcCache.cols[c] && ui.calcCache.cols[c].hidden) continue;
        const v = ui.calcCache.displayMatrix[r][c].display;
        rowVals.push(v === undefined || v === null ? "" : String(v));
      }
      lines.push(rowVals.join("\t"));
    }
    const tsv = lines.join("\r\n");
    try {
      await navigator.clipboard.writeText(tsv);
      showToast("تم نسخ النطاق المحدد للحافظة (متوافق مع Excel)");
    } catch (_) {}
  }

  function pasteTextAtActiveCell(tsvText) {
    if (!tsvText) return;
    const sheet = getActiveSheet();
    if (!sheet || !ui.calcCache) return;

    const rowsText = tsvText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    if (rowsText.length > 1 && rowsText[rowsText.length - 1] === "") rowsText.pop();

    pushUndoSnapshot();
    const startR = ui.activeCell.r;
    const startC = ui.activeCell.c;

    rowsText.forEach(function (line, rOffset) {
      const targetR = startR + rOffset;
      while (sheet.rows.length <= targetR) {
        sheet.rows.push({});
      }
      const cells = line.split("\t");
      let colCursor = startC;
      cells.forEach(function (cellVal) {
        while (colCursor < ui.calcCache.cols.length && ui.calcCache.cols[colCursor].hidden) {
          colCursor++;
        }
        const col = ui.calcCache.cols[colCursor];
        if (col && col.editable) {
          sheet.rows[targetR][col.key] = normalizeTypedValue(cellVal.trim(), col);
        }
        colCursor++;
      });
    });

    renderAll(true);
    showToast("تم لصق البيانات بنجاح");
  }

  // ==========================================================================
  // 5. نوافذ الإعدادات (Google Sheets Cloud Modal & Batch Rates Modal)
  // ==========================================================================
  function openCloudModal() {
    $("inpGasUrl").value = Sync.getScriptUrl();
    $("gasTestResult").classList.add("hidden");
    $("cloudModal").classList.remove("hidden");
  }

  function closeCloudModal() {
    $("cloudModal").classList.add("hidden");
    refreshAuthCloudBanner();
  }

  function openRatesModal() {
    const sheet = getActiveSheet();
    if (!sheet || sheet.type !== "unified") return;
    const settings = sheet.settings || {};
    const firstRow = sheet.rows[0] || {};

    $("inpBatchRateAtt").value = firstRow.rate_att !== undefined ? firstRow.rate_att : 150;
    $("inpBatchRateShift").value = firstRow.rate_shift !== undefined ? firstRow.rate_shift : 250;
    $("inpBatchRateOt").value = firstRow.rate_ot !== undefined ? firstRow.rate_ot : 50;
    $("inpDefaultOtUnit").value = settings.defaultOvertimeUnit !== undefined ? settings.defaultOvertimeUnit : 1;
    $("chkShiftCountsAtt").checked = Boolean(settings.shiftCountsAsAttendance);
    $("chkMissionCountsAtt").checked = settings.missionCountsAsAttendance !== false;
    $("inpAbsPenalty").value = settings.absencePenaltyDays !== undefined ? settings.absencePenaltyDays : 0;

    $("ratesModal").classList.remove("hidden");
  }

  function applyRatesAndSettings() {
    const sheet = getActiveSheet();
    if (!sheet || sheet.type !== "unified") return;

    pushUndoSnapshot();
    sheet.settings = {
      defaultOvertimeUnit: Math.max(0.25, Number($("inpDefaultOtUnit").value || 1)),
      shiftCountsAsAttendance: $("chkShiftCountsAtt").checked,
      missionCountsAsAttendance: $("chkMissionCountsAtt").checked,
      absencePenaltyDays: Math.max(0, Number($("inpAbsPenalty").value || 0))
    };

    if ($("chkApplyRatesAll").checked) {
      const rAtt = $("inpBatchRateAtt").value.trim();
      const rShift = $("inpBatchRateShift").value.trim();
      const rOt = $("inpBatchRateOt").value.trim();

      sheet.rows.forEach(function (row) {
        if (rAtt !== "") row.rate_att = Number(rAtt);
        if (rShift !== "") row.rate_shift = Number(rShift);
        if (rOt !== "") row.rate_ot = Number(rOt);
      });
    }

    $("ratesModal").classList.add("hidden");
    renderAll(true);
    showToast("تم تطبيق الفئات المالية وقواعد الاحتساب على الورقة");
  }

  function updateStatusModeLabel() {
    const el = $("statusModeText");
    if (ui.brushStamp !== null) {
      el.textContent = "🖌️ وضع الختم السريع مفعل: انقر على أي خلية يوم لوضع (" + (ui.brushStamp || "مسح") + ")";
    } else {
      el.textContent = "جاهز — استخدم الأسهم، أو انقر مرتين للتحرير، أو اسحب مقبض الزاوية للتعبئة";
    }
  }

  // ==========================================================================
  // 6. ربط الأحداث والاختصارات وتشغيل النظام
  // ==========================================================================
  function bindEvents() {
    // أحداث شاشة الدخول
    $("tabLogin").addEventListener("click", function () { setAuthMode("login"); });
    $("tabRegister").addEventListener("click", function () { setAuthMode("register"); });
    $("authForm").addEventListener("submit", handleAuthSubmit);
    $("btnOpenCloudFromAuth").addEventListener("click", openCloudModal);

    // أحداث الشريط العلوي
    $("inpWorkbookTitle").addEventListener("change", function () {
      if (!ui.workbook) return;
      ui.workbook.workbookTitle = $("inpWorkbookTitle").value.trim() || "سجل الحضور والنبطشيات والسهر";
      Sync.scheduleSave(ui.workbook, getActiveSheet());
    });

    $("syncStatusPill").addEventListener("click", openCloudModal);
    $("btnOpenCloudModal").addEventListener("click", openCloudModal);

    $("btnSyncNow").addEventListener("click", async function () {
      if (!Sync.hasCloudConfigured()) {
        openCloudModal();
        return;
      }
      try {
        await Sync.pushWorkbookNow(ui.workbook, getActiveSheet());
        await Sync.pollRemoteNow();
        showToast("تمت المزامنة السحابية الفورية بنجاح ✓");
      } catch (err) {
        showToast(err.message || "تعذر إتمام المزامنة الآن", "error");
      }
    });

    $("btnLogout").addEventListener("click", function () {
      if (window.confirm("هل تريد تسجيل الخروج من هذا الجهاز؟ (بياناتك محفوظة بأمان)")) {
        Sync.logout();
        $("workspaceScreen").classList.add("hidden");
        $("authScreen").classList.remove("hidden");
        $("inpPassword").value = "";
        refreshAuthCloudBanner();
      }
    });

    // أحداث شريط الأدوات (Ribbon)
    $("btnUndo").addEventListener("click", performUndo);
    $("btnRedo").addEventListener("click", performRedo);

    $("selMonth").addEventListener("change", function () {
      const sheet = getActiveSheet();
      if (!sheet || sheet.type !== "unified") return;
      sheet.month = Number($("selMonth").value);
      const mName = window.APP_CONFIG.ARABIC_MONTHS[sheet.month - 1];
      if (/^كشف\s/.test(sheet.title)) {
        sheet.title = "كشف " + mName + " " + sheet.year;
      }
      renderAll(true);
    });

    $("inpYear").addEventListener("change", function () {
      const sheet = getActiveSheet();
      if (!sheet || sheet.type !== "unified") return;
      const y = Math.max(2020, Math.min(2099, Number($("inpYear").value || 2026)));
      sheet.year = y;
      const mName = window.APP_CONFIG.ARABIC_MONTHS[sheet.month - 1];
      if (/^كشف\s/.test(sheet.title)) {
        sheet.title = "كشف " + mName + " " + sheet.year;
      }
      renderAll(true);
    });

    $("btnToggleDays").addEventListener("click", function () {
      const sheet = getActiveSheet();
      if (!sheet || sheet.type !== "unified") return;
      sheet.hideDays = !sheet.hideDays;
      if (sheet.hideDays && ui.calcCache && ui.calcCache.cols[ui.activeCell.c] && ui.calcCache.cols[ui.activeCell.c].hidden) {
        ui.activeCell.c = 1;
        ui.selection = { r1: ui.activeCell.r, c1: 1, r2: ui.activeCell.r, c2: 1 };
      }
      renderAll(true);
    });

    $("btnAddRow").addEventListener("click", function () {
      const sheet = getActiveSheet();
      if (!sheet) return;
      pushUndoSnapshot();
      const last = sheet.rows[sheet.rows.length - 1] || {};
      const nextCode = !isNaN(Number(last.code)) && last.code !== "" ? String(Number(last.code) + 1) : "";
      sheet.rows.push({
        code: nextCode,
        name: "",
        dept: "",
        rate_att: last.rate_att !== undefined ? last.rate_att : "",
        rate_shift: last.rate_shift !== undefined ? last.rate_shift : "",
        rate_ot: last.rate_ot !== undefined ? last.rate_ot : ""
      });
      renderAll(true);
    });

    $("btnAdd5Rows").addEventListener("click", function () {
      const sheet = getActiveSheet();
      if (!sheet) return;
      pushUndoSnapshot();
      for (let i = 0; i < 5; i++) {
        const last = sheet.rows[sheet.rows.length - 1] || {};
        const nextCode = !isNaN(Number(last.code)) && last.code !== "" ? String(Number(last.code) + 1) : "";
        sheet.rows.push({
          code: nextCode,
          name: "",
          dept: "",
          rate_att: last.rate_att !== undefined ? last.rate_att : "",
          rate_shift: last.rate_shift !== undefined ? last.rate_shift : "",
          rate_ot: last.rate_ot !== undefined ? last.rate_ot : ""
        });
      }
      renderAll(true);
    });

    $("btnDeleteRow").addEventListener("click", function () {
      const sheet = getActiveSheet();
      if (!sheet || sheet.rows.length <= 1) return;
      pushUndoSnapshot();
      const norm = getNormalizedSelection();
      sheet.rows.splice(norm.minR, norm.maxR - norm.minR + 1);
      if (sheet.rows.length === 0) sheet.rows.push({});
      ui.activeCell.r = Math.min(ui.activeCell.r, sheet.rows.length - 1);
      ui.selection = { r1: ui.activeCell.r, c1: ui.activeCell.c, r2: ui.activeCell.r, c2: ui.activeCell.c };
      renderAll(true);
    });

    // تنسيق الخلايا
    $("btnBoldCell").addEventListener("click", function () {
      const sheet = getActiveSheet();
      if (!sheet) return;
      pushUndoSnapshot();
      sheet.styles = sheet.styles || {};
      const norm = getNormalizedSelection();
      const firstKey = norm.minR + ":" + norm.minC;
      const targetBold = !(sheet.styles[firstKey] && sheet.styles[firstKey].bold);
      for (let r = norm.minR; r <= norm.maxR; r++) {
        for (let c = norm.minC; c <= norm.maxC; c++) {
          const k = r + ":" + c;
          sheet.styles[k] = Object.assign({}, sheet.styles[k] || {}, { bold: targetBold });
        }
      }
      renderAll(true);
    });

    $("inpCellBg").addEventListener("input", function () {
      const sheet = getActiveSheet();
      if (!sheet) return;
      pushUndoSnapshot();
      sheet.styles = sheet.styles || {};
      const color = $("inpCellBg").value;
      const norm = getNormalizedSelection();
      for (let r = norm.minR; r <= norm.maxR; r++) {
        for (let c = norm.minC; c <= norm.maxC; c++) {
          const k = r + ":" + c;
          sheet.styles[k] = Object.assign({}, sheet.styles[k] || {}, { bg: color });
        }
      }
      renderAll(true);
    });

    $("btnClearFormat").addEventListener("click", function () {
      const sheet = getActiveSheet();
      if (!sheet || !sheet.styles) return;
      pushUndoSnapshot();
      const norm = getNormalizedSelection();
      for (let r = norm.minR; r <= norm.maxR; r++) {
        for (let c = norm.minC; c <= norm.maxC; c++) {
          delete sheet.styles[r + ":" + c];
        }
      }
      renderAll(true);
    });

    $("btnOpenRatesModal").addEventListener("click", openRatesModal);

    $("btnCloneNextMonth").addEventListener("click", function () {
      const sheet = getActiveSheet();
      if (!sheet || sheet.type !== "unified") return;
      let nextMonth = Number(sheet.month) + 1;
      let nextYear = Number(sheet.year);
      if (nextMonth > 12) {
        nextMonth = 1;
        nextYear++;
      }
      const newSheet = Engine.createUnifiedSheet({
        year: nextYear,
        month: nextMonth,
        templateEmployees: sheet.rows
      });
      newSheet.settings = Object.assign({}, sheet.settings || {});
      ui.workbook.sheets.push(newSheet);
      ui.workbook.activeSheetId = newSheet.id;
      renderAll(true);
      showToast("تم إنشاء ورقة (" + newSheet.title + ") مع نقل أسماء الموظفين وأسعارهم تلقائياً!");
    });

    // التصدير والاستيراد والطباعة
    $("btnExportExcel").addEventListener("click", function () {
      const sheet = getActiveSheet();
      if (sheet) Engine.exportSheetToExcelXML(sheet, ui.workbook.orgName);
    });

    $("btnExportCsv").addEventListener("click", function () {
      const sheet = getActiveSheet();
      if (sheet) Engine.exportSheetToCSV(sheet);
    });

    $("btnImportCsv").addEventListener("click", function () {
      $("fileImportCsv").click();
    });

    $("fileImportCsv").addEventListener("change", function (ev) {
      const file = ev.target.files && ev.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function () {
        const text = String(reader.result || "");
        const lines = text.replace(/\r\n/g, "\n").split("\n").filter(function (l) { return l.trim() !== ""; });
        if (lines.length < 2) return;
        const sheet = getActiveSheet();
        if (!sheet) return;
        pushUndoSnapshot();
        const cols = Engine.getSheetColumns(sheet);
        const importedRows = [];
        for (let i = 1; i < lines.length; i++) {
          const cells = lines[i].split(",");
          if (cells[0] && cells[0].trim() === "الإجمالي") continue;
          const obj = {};
          let colPtr = 0;
          cells.forEach(function (val) {
            while (colPtr < cols.length && cols[colPtr].hidden) colPtr++;
            if (colPtr < cols.length && cols[colPtr].editable) {
              obj[cols[colPtr].key] = normalizeTypedValue(val.replace(/^"|"$/g, "").trim(), cols[colPtr]);
            }
            colPtr++;
          });
          importedRows.push(obj);
        }
        if (importedRows.length > 0) {
          sheet.rows = importedRows;
          renderAll(true);
          showToast("تم استيراد " + importedRows.length + " صف بنجاح");
        }
      };
      reader.readAsText(file, "utf-8");
      ev.target.value = "";
    });

    $("btnPrintSheet").addEventListener("click", function () {
      window.print();
    });

    // وضع الفرشاة / الختم المباشر
    $("btnToggleBrushMode").addEventListener("click", function () {
      if (ui.brushStamp === null) {
        ui.brushStamp = ui.lastStampCode || "ح";
        $("btnToggleBrushMode").classList.add("active");
      } else {
        ui.brushStamp = null;
        $("btnToggleBrushMode").classList.remove("active");
      }
      renderStampButtons();
      updateStatusModeLabel();
    });

    // شريط الصيغة (fx)
    $("inpFormulaBar").addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") {
        ev.preventDefault();
        const sheet = getActiveSheet();
        const col = ui.calcCache && ui.calcCache.cols[ui.activeCell.c];
        if (sheet && col && col.editable) {
          pushUndoSnapshot();
          sheet.rows[ui.activeCell.r][col.key] = normalizeTypedValue($("inpFormulaBar").value.trim(), col);
          renderAll(true);
          moveSelection(1, 0, false);
          $("gridViewport").focus();
        }
      }
    });

    // إضافة أوراق عمل جديدة من الشريط السفلي
    $("btnAddUnifiedSheet").addEventListener("click", function () {
      const curr = getActiveSheet();
      const newSheet = Engine.createUnifiedSheet({
        templateEmployees: curr && curr.type === "unified" ? curr.rows : null
      });
      newSheet.title = newSheet.title + " (" + (ui.workbook.sheets.length + 1) + ")";
      ui.workbook.sheets.push(newSheet);
      ui.workbook.activeSheetId = newSheet.id;
      renderAll(true);
    });

    $("btnAddFreeSheet").addEventListener("click", function () {
      const newSheet = Engine.createFreeSheet("ورقة حرة " + (ui.workbook.sheets.length + 1));
      ui.workbook.sheets.push(newSheet);
      ui.workbook.activeSheetId = newSheet.id;
      ui.activeCell = { r: 0, c: 0 };
      ui.selection = { r1: 0, c1: 0, r2: 0, c2: 0 };
      renderAll(true);
    });

    // أحداث الماوس على شبكة الخلايا (تحديد، سحب النطاق، مقبض التعبئة، نقر مزدوج)
    const tbody = $("excelTbody");

    tbody.addEventListener("mousedown", function (ev) {
      if (ev.target.classList.contains("inline-cell-editor")) return;

      // فحص مقبض التعبئة السريعة (Fill Handle)
      if (ev.target.classList.contains("fill-handle")) {
        ev.preventDefault();
        const sheet = getActiveSheet();
        const col = ui.calcCache.cols[ui.activeCell.c];
        ui.isFillDragging = true;
        ui.fillSourceVal = (sheet && col && sheet.rows[ui.activeCell.r][col.key] !== undefined)
          ? sheet.rows[ui.activeCell.r][col.key]
          : "";
        return;
      }

      const td = ev.target.closest("td[data-r][data-c]");
      if (!td) return;

      $("gridViewport").focus({ preventScroll: true });

      const r = parseInt(td.dataset.r, 10);
      const c = parseInt(td.dataset.c, 10);

      if (ui.inlineEditing && (ui.inlineEditing.r !== r || ui.inlineEditing.c !== c)) {
        commitInlineEditIfAny(true);
      }

      if (ev.shiftKey) {
        ui.selection.r2 = r;
        ui.selection.c2 = c;
      } else {
        ui.activeCell = { r: r, c: c };
        ui.selection = { r1: r, c1: c, r2: r, c2: c };
        ui.isMouseSelecting = true;
      }

      // إذا كان وضع فرشاة الختم السريع مفعلاً، نطبق الرمز بمجرد النقر على خلية يوم!
      if (ui.brushStamp !== null) {
        const sheet = getActiveSheet();
        const col = ui.calcCache && ui.calcCache.cols[c];
        if (sheet && col && col.editable && (sheet.type === "free" || col.kind === "day")) {
          pushUndoSnapshot();
          sheet.rows[r][col.key] = ui.brushStamp;
          renderAll(true);
          return;
        }
      }

      updateSelectionHighlights();
      updateFormulaBar();
      updateStatusStatistics();
    });

    tbody.addEventListener("mouseover", function (ev) {
      if (!ui.isMouseSelecting && !ui.isFillDragging) return;
      const td = ev.target.closest("td[data-r][data-c]");
      if (!td) return;
      const r = parseInt(td.dataset.r, 10);
      const c = parseInt(td.dataset.c, 10);
      ui.selection.r2 = r;
      ui.selection.c2 = c;

      if (ui.brushStamp !== null && ui.isMouseSelecting) {
        const sheet = getActiveSheet();
        const col = ui.calcCache && ui.calcCache.cols[c];
        if (sheet && col && col.editable && col.kind === "day") {
          sheet.rows[r][col.key] = ui.brushStamp;
        }
      }

      updateSelectionHighlights();
      updateStatusStatistics();
    });

    window.addEventListener("mouseup", function () {
      if (ui.isFillDragging) {
        ui.isFillDragging = false;
        applyValueToSelection(ui.fillSourceVal, false);
      }
      if (ui.isMouseSelecting) {
        ui.isMouseSelecting = false;
        if (ui.brushStamp !== null) {
          renderAll(true);
        }
      }
    });

    tbody.addEventListener("dblclick", function (ev) {
      const td = ev.target.closest("td[data-r][data-c]");
      if (!td) return;
      startInlineEdit(parseInt(td.dataset.r, 10), parseInt(td.dataset.c, 10));
    });

    // اختصارات لوحة المفاتيح الشاملة مثل برنامج الإكسيل
    window.addEventListener("keydown", function (ev) {
      if ($("workspaceScreen").classList.contains("hidden")) return;
      if (!$("cloudModal").classList.contains("hidden") || !$("ratesModal").classList.contains("hidden")) return;

      const activeTag = document.activeElement ? document.activeElement.tagName : "";
      if (activeTag === "INPUT" || activeTag === "TEXTAREA" || activeTag === "SELECT") {
        return;
      }

      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "z") {
        ev.preventDefault();
        performUndo();
        return;
      }
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "y") {
        ev.preventDefault();
        performRedo();
        return;
      }
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "s") {
        ev.preventDefault();
        Sync.pushWorkbookNow(ui.workbook, getActiveSheet())
          .then(function () { showToast("تم الحفظ والمزامنة ✓"); })
          .catch(function () { showToast("تم الحفظ محلياً", "info"); });
        return;
      }
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "c") {
        ev.preventDefault();
        copySelectionToClipboard();
        return;
      }

      // حركة الأسهم (مضبوطة لاتجاه RTL العربي: السهم الأيسر يتقدم للعمود التالي يساراً!)
      if (ev.key === "ArrowDown") { ev.preventDefault(); moveSelection(1, 0, ev.shiftKey); return; }
      if (ev.key === "ArrowUp") { ev.preventDefault(); moveSelection(-1, 0, ev.shiftKey); return; }
      if (ev.key === "ArrowLeft") { ev.preventDefault(); moveSelection(0, 1, ev.shiftKey); return; }
      if (ev.key === "ArrowRight") { ev.preventDefault(); moveSelection(0, -1, ev.shiftKey); return; }
      if (ev.key === "Tab") { ev.preventDefault(); moveSelection(0, ev.shiftKey ? -1 : 1, false); return; }

      if (ev.key === "Enter" || ev.key === "F2") {
        ev.preventDefault();
        startInlineEdit(ui.activeCell.r, ui.activeCell.c);
        return;
      }

      if (ev.key === "Delete" || ev.key === "Backspace") {
        ev.preventDefault();
        applyValueToSelection("", false);
        return;
      }

      // الكتابة المباشرة في الخلية بمجرد ضغط أي حرف أو رقم أو علامة =
      if (!ev.ctrlKey && !ev.metaKey && !ev.altKey && ev.key.length === 1) {
        ev.preventDefault();
        startInlineEdit(ui.activeCell.r, ui.activeCell.c, ev.key);
      }
    });

    window.addEventListener("paste", function (ev) {
      if ($("workspaceScreen").classList.contains("hidden")) return;
      const activeTag = document.activeElement ? document.activeElement.tagName : "";
      if (activeTag === "INPUT" || activeTag === "TEXTAREA") return;
      const text = ev.clipboardData && ev.clipboardData.getData("text/plain");
      if (text) {
        ev.preventDefault();
        pasteTextAtActiveCell(text);
      }
    });

    // أحداث نافذة إعداد Google Sheets السحابية
    $("btnCloseCloudModal").addEventListener("click", closeCloudModal);
    $("btnTestGas").addEventListener("click", async function () {
      const box = $("gasTestResult");
      box.classList.remove("hidden");
      box.className = "auth-alert info";
      box.textContent = "جاري فحص الاتصال بـ Google Sheets...";
      try {
        const res = await Sync.testCloudConnection($("inpGasUrl").value);
        box.textContent = "✅ " + (res.message || "الاتصال ناجح وجاهز للمزامنة!");
      } catch (err) {
        box.className = "auth-alert error";
        box.textContent = "❌ " + (err.message || "تعذر الاتصال");
      }
    });

    $("btnSaveGas").addEventListener("click", async function () {
      const url = $("inpGasUrl").value.trim();
      Sync.setScriptUrl(url);
      closeCloudModal();
      if (url && Sync.getSession()) {
        try {
          await Sync.bridgeLocalAccountToCloud(ui.workbook);
          showToast("تم ربط الحساب ومزامنة البيانات مع Google Sheets بنجاح!");
        } catch (err) {
          showToast(err.message || "تم حفظ الرابط", "info");
        }
      } else {
        showToast(url ? "تم حفظ رابط السحابة بنجاح" : "تم التحويل للوضع المحلي");
      }
    });

    $("btnCopyQuickLink").addEventListener("click", async function () {
      const url = $("inpGasUrl").value.trim() || Sync.getScriptUrl();
      if (!url) {
        showToast("أدخل واحفظ رابط Google Apps Script أولاً", "error");
        return;
      }
      const base = window.location.href.split("?")[0];
      const quickLink = base + "?api=" + encodeURIComponent(url);
      try {
        await navigator.clipboard.writeText(quickLink);
        showToast("تم نسخ رابط الدخول السريع! افتحه على أي جهاز آخر وسيتصل بالسحابة تلقائياً.");
      } catch (_) {
        window.prompt("انسخ هذا الرابط وافتحه على أجهزتك الأخرى:", quickLink);
      }
    });

    $("btnCopyGasCode").addEventListener("click", async function () {
      const codeEl = $("gasScriptCodePreview");
      if (!codeEl) return;
      try {
        await navigator.clipboard.writeText(codeEl.textContent);
        showToast("تم نسخ كود Google Apps Script بالكامل! الصقه في مشروع Apps Script.");
      } catch (_) {
        showToast("يرجى نسخ الكود من ملف google-apps-script/Code.gs", "info");
      }
    });

    // أحداث نافذة الأسعار وقواعد الحساب
    $("btnCloseRatesModal").addEventListener("click", function () {
      $("ratesModal").classList.add("hidden");
    });
    $("btnApplyRatesSettings").addEventListener("click", applyRatesAndSettings);

    // مستمعات حالة المزامنة وتحديثات الأجهزة الأخرى اللحظية
    Sync.setListeners({
      onStatusChange: function (st) {
        const pill = $("syncStatusPill");
        const txt = $("syncStatusText");
        if (pill && txt) {
          pill.className = "sync-pill " + (st.kind || "local");
          txt.textContent = st.text;
        }
      },
      onRemoteWorkbook: function (remoteWb, fromDevice) {
        if (!remoteWb || !Array.isArray(remoteWb.sheets)) return;
        const prevSheetId = ui.workbook ? ui.workbook.activeSheetId : null;
        ui.workbook = remoteWb;
        if (prevSheetId && ui.workbook.sheets.some(function (s) { return s.id === prevSheetId; })) {
          ui.workbook.activeSheetId = prevSheetId;
        }
        $("inpWorkbookTitle").value = ui.workbook.workbookTitle || "سجل الحضور والنبطشيات والسهر";
        renderAll(false);
        showToast("🔄 تمت مزامنة تحديثات جديدة من (" + fromDevice + ")", "info");
      }
    });
  }

  async function initApp() {
    bindEvents();
    refreshAuthCloudBanner();

    const restored = await Sync.restoreSession();
    if (restored && restored.session) {
      enterWorkspace(restored.session, restored.workbook);
    }
  }

  document.addEventListener("DOMContentLoaded", initApp);
})();
