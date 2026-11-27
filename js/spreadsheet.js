/**
 * ============================================================================
 * محرك الإكسيل الداخلي وحسابات الورقة الموحدة (الحضور + النبطشيات + السهر)
 * ============================================================================
 */

(function () {
  "use strict";

  // تحويل رقم العمود إلى حرف إكسيل (0 -> A, 25 -> Z, 26 -> AA)
  function colToLetter(colIdx) {
    let n = colIdx + 1;
    let str = "";
    while (n > 0) {
      const rem = (n - 1) % 26;
      str = String.fromCharCode(65 + rem) + str;
      n = Math.floor((n - 1) / 26);
    }
    return str;
  }

  // تحويل حرف إكسيل إلى رقم عمود (A -> 0, AA -> 26)
  function letterToCol(letters) {
    const clean = String(letters || "").toUpperCase().trim();
    let idx = 0;
    for (let i = 0; i < clean.length; i++) {
      const code = clean.charCodeAt(i);
      if (code < 65 || code > 90) return -1;
      idx = idx * 26 + (code - 64);
    }
    return idx - 1;
  }

  function getDaysInMonth(year, month1Based) {
    return new Date(year, month1Based, 0).getDate();
  }

  function getDayInfo(year, month1Based, dayNum) {
    const d = new Date(year, month1Based - 1, dayNum);
    const dow = d.getDay(); // 0 = Sunday .. 5 = Friday, 6 = Saturday
    return {
      dow: dow,
      shortName: window.APP_CONFIG.ARABIC_DAYS_SHORT[dow],
      isFriday: dow === 5,
      isWeekend: dow === 5 // الجمعة عطلة رسمية مميزة بصرياً (مع إمكانية التسجيل فيها للنبطشيات والسهر)
    };
  }

  /**
   * محلل ذكي لرموز اليوم الواحد يدعم الرموز المفردة والمركبة في نفس الخلية:
   * أمثلة مدعومة:
   * "ح" -> 1 حضور
   * "ن" -> 1 نبطشية (أو ن2 = نبطشيتين)
   * "س" -> 1 وحدة/ساعة سهر افتراضية | "س3" أو "س2.5" -> 3 أو 2.5 ساعات سهر
   * "ح+ن" أو "ح ن" -> 1 حضور + 1 نبطشية في نفس اليوم
   * "ح+س" أو "ح+س3" -> 1 حضور + 3 ساعات سهر في نفس اليوم
   * "ح+ن+س2" -> 1 حضور + 1 نبطشية + 2 سهر
   * "غ" -> غياب | "إ" أو "ا" -> إجازة | "م" -> مأمورية | "ع" أو "ر" -> عطلة/راحة
   */
  function parseDayCell(rawVal, sheetSettings) {
    const settings = Object.assign({
      defaultOvertimeUnit: 1,
      shiftCountsAsAttendance: false,
      missionCountsAsAttendance: true
    }, sheetSettings || {});

    const res = {
      att: 0,
      shift: 0,
      overtime: 0,
      absent: 0,
      leave: 0,
      mission: 0,
      off: 0,
      cssClass: ""
    };

    if (rawVal === null || rawVal === undefined) return res;
    const text = String(rawVal).trim();
    if (!text) return res;

    // توحيد الفواصل الشائعة (+ ، / - مسافة)
    const tokens = text
      .replace(/[+،,\/\\\-_|]+/g, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    let hasAtt = false;
    let hasShift = false;
    let hasOt = false;

    for (let i = 0; i < tokens.length; i++) {
      const tk = tokens[i];

      // فحص الحضور "ح" أو "ح1"
      if (/^ح(\d+(\.\d+)?)?$/.test(tk)) {
        const m = tk.match(/^ح(\d+(\.\d+)?)?$/);
        const qty = m && m[1] ? parseFloat(m[1]) : 1;
        res.att += qty;
        hasAtt = true;
        continue;
      }

      // فحص النبطشية "ن" أو "ن2"
      if (/^ن(\d+(\.\d+)?)?$/.test(tk)) {
        const m = tk.match(/^ن(\d+(\.\d+)?)?$/);
        const qty = m && m[1] ? parseFloat(m[1]) : 1;
        res.shift += qty;
        if (settings.shiftCountsAsAttendance && !hasAtt) {
          res.att += 1;
        }
        hasShift = true;
        continue;
      }

      // فحص السهر "س" أو "س3" أو "س1.5"
      if (/^س(\d+(\.\d+)?)?$/.test(tk)) {
        const m = tk.match(/^س(\d+(\.\d+)?)?$/);
        const qty = m && m[1] ? parseFloat(m[1]) : Number(settings.defaultOvertimeUnit || 1);
        res.overtime += qty;
        hasOt = true;
        continue;
      }

      // فحص الغياب "غ"
      if (/^غ(\d+(\.\d+)?)?$/.test(tk)) {
        const m = tk.match(/^غ(\d+(\.\d+)?)?$/);
        res.absent += m && m[1] ? parseFloat(m[1]) : 1;
        continue;
      }

      // فحص الإجازة "إ" أو "ا" أو "أ" أو "اج"
      if (/^(إ|ا|أ|اج|إجازة|اجازة)$/.test(tk)) {
        res.leave += 1;
        continue;
      }

      // فحص المأمورية "م"
      if (/^م(\d+(\.\d+)?)?$/.test(tk)) {
        res.mission += 1;
        if (settings.missionCountsAsAttendance) {
          res.att += 1;
          hasAtt = true;
        }
        continue;
      }

      // فحص العطلة / الراحة "ع" أو "ر"
      if (/^(ع|ر|راحة|عطلة)$/.test(tk)) {
        res.off += 1;
        continue;
      }

      // في حال كتب المستخدم حروفاً ملتصقة بدون فاصل مثل "حن" أو "حس2"
      if (tk.length > 1 && /[حنس]/.test(tk)) {
        const subMatches = tk.match(/[حنسغإامع](\d+(\.\d+)?)?/g);
        if (subMatches && subMatches.length > 1) {
          const subRes = parseDayCell(subMatches.join("+"), settings);
          res.att += subRes.att;
          res.shift += subRes.shift;
          res.overtime += subRes.overtime;
          res.absent += subRes.absent;
          res.leave += subRes.leave;
          res.mission += subRes.mission;
          res.off += subRes.off;
          if (subRes.att > 0) hasAtt = true;
          if (subRes.shift > 0) hasShift = true;
          if (subRes.overtime > 0) hasOt = true;
        }
      }
    }

    // تحديد لون الخلية المناسب
    if (hasAtt && hasShift && hasOt) res.cssClass = "code-triple";
    else if (hasAtt && hasShift) res.cssClass = "code-att-shift";
    else if (hasAtt && hasOt) res.cssClass = "code-att-ot";
    else if (hasShift && hasOt) res.cssClass = "code-att-shift";
    else if (hasShift) res.cssClass = "code-shift";
    else if (hasOt) res.cssClass = "code-overtime";
    else if (hasAtt) res.cssClass = "code-att";
    else if (res.absent > 0) res.cssClass = "code-absent";
    else if (res.leave > 0) res.cssClass = "code-leave";
    else if (res.mission > 0) res.cssClass = "code-mission";
    else if (res.off > 0) res.cssClass = "code-off";

    return res;
  }

  /**
   * بناء هيكل الأعمدة الديناميكي للورقة الموحدة حسب الشهر والسنة
   */
  function buildUnifiedColumns(sheet) {
    const year = Number(sheet.year || 2026);
    const month = Number(sheet.month || 11);
    const daysCount = getDaysInMonth(year, month);
    const cols = [];

    cols.push({ key: "code", title: "الكود", kind: "meta", sticky: "sticky-col-1", editable: true, width: 72 });
    cols.push({ key: "name", title: "اسم الموظف", kind: "meta", sticky: "sticky-col-2", editable: true, width: 185 });
    cols.push({ key: "dept", title: "القسم / الوظيفة", kind: "meta", editable: true, width: 120 });

    for (let d = 1; d <= daysCount; d++) {
      const info = getDayInfo(year, month, d);
      cols.push({
        key: "d_" + d,
        dayNum: d,
        dayName: info.shortName,
        isWeekend: info.isWeekend,
        title: String(d),
        kind: "day",
        editable: true,
        hidden: Boolean(sheet.hideDays)
      });
    }

    // أعمدة تجميع الأعداد التلقائية
    cols.push({ key: "tot_att", title: "إجمالي الحضور", kind: "calc_count", headerClass: "hdr-att", cellClass: "col-summary-att", editable: false });
    cols.push({ key: "tot_shift", title: "إجمالي النبطشيات", kind: "calc_count", headerClass: "hdr-shift", cellClass: "col-summary-shift", editable: false });
    cols.push({ key: "tot_ot", title: "إجمالي السهر", kind: "calc_count", headerClass: "hdr-ot", cellClass: "col-summary-ot", editable: false });
    cols.push({ key: "tot_abs", title: "الغياب", kind: "calc_count", cellClass: "col-summary-abs", editable: false });
    cols.push({ key: "tot_leave", title: "الإجازات", kind: "calc_count", cellClass: "col-money-calc", editable: false });

    // أعمدة الفئات المالية والمستحقات التلقائية
    cols.push({ key: "rate_att", title: "فئة يوم الحضور", kind: "rate", headerClass: "hdr-fin", cellClass: "col-rate", editable: true });
    cols.push({ key: "amt_att", title: "مستحق الحضور", kind: "calc_money", headerClass: "hdr-att", cellClass: "col-money-calc", editable: false });

    cols.push({ key: "rate_shift", title: "فئة النبطشية", kind: "rate", headerClass: "hdr-fin", cellClass: "col-rate", editable: true });
    cols.push({ key: "amt_shift", title: "مستحق النبطشيات", kind: "calc_money", headerClass: "hdr-shift", cellClass: "col-money-calc", editable: false });

    cols.push({ key: "rate_ot", title: "فئة السهر", kind: "rate", headerClass: "hdr-fin", cellClass: "col-rate", editable: true });
    cols.push({ key: "amt_ot", title: "مستحق السهر", kind: "calc_money", headerClass: "hdr-ot", cellClass: "col-money-calc", editable: false });

    cols.push({ key: "bonus", title: "مكافآت / إضافي", kind: "rate", headerClass: "hdr-fin", cellClass: "col-rate", editable: true });
    cols.push({ key: "deduct", title: "خصومات / سلف", kind: "rate", headerClass: "hdr-fin", cellClass: "col-rate", editable: true });
    cols.push({ key: "net_total", title: "صافي المستحق", kind: "calc_net", headerClass: "hdr-net", cellClass: "col-net-total", editable: false });
    cols.push({ key: "notes", title: "ملاحظات", kind: "notes", editable: true });

    return cols;
  }

  function buildFreeColumns(sheet) {
    const colCount = Math.max(8, Number(sheet.colCount || 14));
    const cols = [];
    for (let c = 0; c < colCount; c++) {
      cols.push({
        key: "c_" + c,
        title: colToLetter(c),
        kind: "free",
        editable: true
      });
    }
    return cols;
  }

  function getSheetColumns(sheet) {
    return sheet.type === "free" ? buildFreeColumns(sheet) : buildUnifiedColumns(sheet);
  }

  /**
   * محرك معادلات إكسيل آمن وسريع يدعم:
   * =SUM(A1:B5), =AVERAGE(C1:C10), =MIN(...), =MAX(...), =COUNT(...), =IF(A1>5, 100, 0)
   * والعمليات الحسابية المباشرة مثل =AJ2*2+50
   */
  function evaluateExcelFormula(formulaStr, resolveCellVal, depth) {
    if (depth > 8) return "#LOOP!";
    let expr = String(formulaStr || "").trim();
    if (!expr.startsWith("=")) return expr;
    expr = expr.slice(1).trim();
    if (!expr) return 0;

    // توسيع النطاقات داخل الدوال مثل SUM(A1:C3)
    function expandRangeValues(rangeText) {
      const parts = rangeText.split(",");
      const vals = [];
      for (let p = 0; p < parts.length; p++) {
        const seg = parts[p].trim();
        const rangeMatch = seg.match(/^([A-Za-z]+)(\d+)\s*:\s*([A-Za-z]+)(\d+)$/);
        if (rangeMatch) {
          const c1 = letterToCol(rangeMatch[1]);
          const r1 = parseInt(rangeMatch[2], 10) - 1;
          const c2 = letterToCol(rangeMatch[3]);
          const r2 = parseInt(rangeMatch[4], 10) - 1;
          const minR = Math.max(0, Math.min(r1, r2));
          const maxR = Math.min(500, Math.max(r1, r2));
          const minC = Math.max(0, Math.min(c1, c2));
          const maxC = Math.min(200, Math.max(c1, c2));
          for (let r = minR; r <= maxR; r++) {
            for (let c = minC; c <= maxC; c++) {
              vals.push(resolveCellVal(r, c, depth + 1));
            }
          }
        } else {
          const singleMatch = seg.match(/^([A-Za-z]+)(\d+)$/);
          if (singleMatch) {
            vals.push(resolveCellVal(parseInt(singleMatch[2], 10) - 1, letterToCol(singleMatch[1]), depth + 1));
          } else if (seg !== "") {
            const num = Number(seg);
            vals.push(isNaN(num) ? seg : num);
          }
        }
      }
      return vals;
    }

    // معالجة دالة IF(cond, trueVal, falseVal) البسيطة
    expr = expr.replace(/\bIF\s*\(([^()]+)\)/gi, function (_, inner) {
      const args = inner.split(",");
      if (args.length < 3) return "0";
      const condRes = safeMathEval(replaceCellRefs(args[0], resolveCellVal, depth));
      return condRes ? args[1].trim() : args[2].trim();
    });

    // معالجة الدوال التجميعية (من الداخل للخارج)
    let prev = "";
    let guard = 0;
    while (prev !== expr && guard < 12) {
      prev = expr;
      guard++;
      expr = expr.replace(/\b(SUM|AVERAGE|AVG|MIN|MAX|COUNT|COUNTA)\s*\(([^()]*)\)/gi, function (_, fnName, argsStr) {
        const fn = fnName.toUpperCase();
        const rawVals = expandRangeValues(argsStr);
        const nums = rawVals
          .filter(function (v) { return v !== "" && v !== null && v !== undefined && !isNaN(Number(v)); })
          .map(Number);

        if (fn === "SUM") return String(nums.reduce(function (a, b) { return a + b; }, 0));
        if (fn === "AVERAGE" || fn === "AVG") return nums.length ? String(nums.reduce(function (a, b) { return a + b; }, 0) / nums.length) : "0";
        if (fn === "MIN") return nums.length ? String(Math.min.apply(null, nums)) : "0";
        if (fn === "MAX") return nums.length ? String(Math.max.apply(null, nums)) : "0";
        if (fn === "COUNT") return String(nums.length);
        if (fn === "COUNTA") return String(rawVals.filter(function (v) { return String(v).trim() !== ""; }).length);
        return "0";
      });
    }

    const withRefs = replaceCellRefs(expr, resolveCellVal, depth);
    const val = safeMathEval(withRefs);
    return val;
  }

  function replaceCellRefs(str, resolveCellVal, depth) {
    return str.replace(/\b([A-Za-z]{1,3})(\d{1,4})\b/g, function (full, colLetters, rowDigits) {
      const c = letterToCol(colLetters);
      const r = parseInt(rowDigits, 10) - 1;
      if (c < 0 || r < 0) return "0";
      const v = resolveCellVal(r, c, depth + 1);
      const n = Number(v);
      return (v === "" || v === null || isNaN(n)) ? "0" : String(n);
    });
  }

  function safeMathEval(mathExpr) {
    const cleaned = String(mathExpr || "").trim();
    if (!cleaned) return 0;
    // السماح فقط بالأرقام والعمليات الحسابية والمقارنات الآمنة
    if (!/^[0-9+\-*/().,%\s<>=!]+$/.test(cleaned)) {
      return "#VALUE!";
    }
    try {
      const normalized = cleaned.replace(/%/g, "/100").replace(/([^<>!])=([^=])/g, "$1==$2");
      // eslint-disable-next-line no-new-func
      const result = Function('"use strict"; return (' + normalized + ');')();
      if (typeof result === "boolean") return result ? 1 : 0;
      if (typeof result === "number" && isFinite(result)) {
        return Math.round(result * 100) / 100;
      }
      return "#DIV/0!";
    } catch (_) {
      return "#ERROR!";
    }
  }

  /**
   * حساب كافة القيم للصفوف والإجماليات الكلية للورقة النشطة
   */
  function computeSheetMatrix(sheet) {
    const cols = getSheetColumns(sheet);
    const rows = Array.isArray(sheet.rows) ? sheet.rows : [];
    const settings = sheet.settings || {};

    if (sheet.type === "free") {
      const cache = {};
      function resolveFree(r, c, depth) {
        if (r < 0 || r >= rows.length || c < 0 || c >= cols.length) return 0;
        const k = r + ":" + c;
        if (Object.prototype.hasOwnProperty.call(cache, k)) return cache[k];
        const colKey = cols[c].key;
        const raw = rows[r] && rows[r][colKey] !== undefined ? rows[r][colKey] : "";
        if (typeof raw === "string" && raw.trim().startsWith("=")) {
          cache[k] = "#LOOP!";
          cache[k] = evaluateExcelFormula(raw, resolveFree, depth || 0);
          return cache[k];
        }
        cache[k] = raw;
        return raw;
      }

      const displayMatrix = rows.map(function (_, r) {
        return cols.map(function (col, c) {
          const raw = rows[r][col.key] !== undefined ? rows[r][col.key] : "";
          const val = resolveFree(r, c, 0);
          return { raw: raw, display: val, cssClass: "" };
        });
      });

      return {
        cols: cols,
        displayMatrix: displayMatrix,
        totalsRow: null,
        kpis: null
      };
    }

    // الحساب المتكامل للورقة الموحدة (حضور + نبطشيات + سهر + ماليات)
    const daysCount = getDaysInMonth(Number(sheet.year || 2026), Number(sheet.month || 11));
    const colIndexByKey = {};
    cols.forEach(function (col, idx) { colIndexByKey[col.key] = idx; });

    const computedRowMaps = rows.map(function () { return {}; });
    const cellClasses = rows.map(function () { return {}; });

    // خطوة 1: تحليل خلايا الأيام لكل موظف
    rows.forEach(function (rowObj, rIdx) {
      let totAtt = 0;
      let totShift = 0;
      let totOt = 0;
      let totAbs = 0;
      let totLeave = 0;

      for (let d = 1; d <= daysCount; d++) {
        const k = "d_" + d;
        const rawDay = rowObj[k] !== undefined ? rowObj[k] : "";
        const parsed = parseDayCell(rawDay, settings);
        totAtt += parsed.att;
        totShift += parsed.shift;
        totOt += parsed.overtime;
        totAbs += parsed.absent;
        totLeave += parsed.leave;
        computedRowMaps[rIdx][k] = rawDay;
        if (parsed.cssClass) {
          cellClasses[rIdx][k] = parsed.cssClass;
        }
      }

      computedRowMaps[rIdx].code = rowObj.code || "";
      computedRowMaps[rIdx].name = rowObj.name || "";
      computedRowMaps[rIdx].dept = rowObj.dept || "";
      computedRowMaps[rIdx].tot_att = round2(totAtt);
      computedRowMaps[rIdx].tot_shift = round2(totShift);
      computedRowMaps[rIdx].tot_ot = round2(totOt);
      computedRowMaps[rIdx].tot_abs = round2(totAbs);
      computedRowMaps[rIdx].tot_leave = round2(totLeave);
    });

    // دالة مساعدة لحل المعادلات في خلايا الأسعار/المكافآت/الخصومات
    function resolveUnifiedCell(r, c, depth) {
      if (r < 0 || r >= rows.length || c < 0 || c >= cols.length) return 0;
      const key = cols[c].key;
      if (Object.prototype.hasOwnProperty.call(computedRowMaps[r], key)) {
        return computedRowMaps[r][key];
      }
      const raw = rows[r][key] !== undefined ? rows[r][key] : "";
      if (typeof raw === "string" && raw.trim().startsWith("=")) {
        return evaluateExcelFormula(raw, resolveUnifiedCell, depth || 0);
      }
      return raw;
    }

    // خطوة 2: حساب المبالغ المالية لكل موظف
    rows.forEach(function (rowObj, rIdx) {
      const rateAtt = toNum(resolveField(rowObj, rIdx, "rate_att", colIndexByKey, resolveUnifiedCell));
      const rateShift = toNum(resolveField(rowObj, rIdx, "rate_shift", colIndexByKey, resolveUnifiedCell));
      const rateOt = toNum(resolveField(rowObj, rIdx, "rate_ot", colIndexByKey, resolveUnifiedCell));
      const bonus = toNum(resolveField(rowObj, rIdx, "bonus", colIndexByKey, resolveUnifiedCell));
      const manualDeduct = toNum(resolveField(rowObj, rIdx, "deduct", colIndexByKey, resolveUnifiedCell));

      // خصم الغياب التلقائي الاختياري (إذا كان مفعلاً في إعدادات الورقة، الافتراضي 0 ما لم يفعله المستخدم)
      const absencePenaltyFactor = Number(settings.absencePenaltyDays || 0);
      const autoAbsDeduct = round2(computedRowMaps[rIdx].tot_abs * rateAtt * absencePenaltyFactor);
      const totalDeduct = round2(manualDeduct + autoAbsDeduct);

      const amtAtt = round2(computedRowMaps[rIdx].tot_att * rateAtt);
      const amtShift = round2(computedRowMaps[rIdx].tot_shift * rateShift);
      const amtOt = round2(computedRowMaps[rIdx].tot_ot * rateOt);
      const netTotal = round2(amtAtt + amtShift + amtOt + bonus - totalDeduct);

      computedRowMaps[rIdx].rate_att = rowObj.rate_att === "" || rowObj.rate_att === undefined ? "" : rateAtt;
      computedRowMaps[rIdx].amt_att = amtAtt;
      computedRowMaps[rIdx].rate_shift = rowObj.rate_shift === "" || rowObj.rate_shift === undefined ? "" : rateShift;
      computedRowMaps[rIdx].amt_shift = amtShift;
      computedRowMaps[rIdx].rate_ot = rowObj.rate_ot === "" || rowObj.rate_ot === undefined ? "" : rateOt;
      computedRowMaps[rIdx].amt_ot = amtOt;
      computedRowMaps[rIdx].bonus = rowObj.bonus === "" || rowObj.bonus === undefined ? "" : bonus;
      computedRowMaps[rIdx].deduct = (rowObj.deduct === "" || rowObj.deduct === undefined) && autoAbsDeduct === 0 ? "" : totalDeduct;
      computedRowMaps[rIdx].net_total = netTotal;

      const rawNotes = rowObj.notes !== undefined ? rowObj.notes : "";
      computedRowMaps[rIdx].notes = (typeof rawNotes === "string" && rawNotes.trim().startsWith("="))
        ? evaluateExcelFormula(rawNotes, resolveUnifiedCell, 0)
        : rawNotes;
    });

    // خطوة 3: بناء مصفوفة العرض وصف الإجماليات السفلي ومؤشرات الأداء العليا (KPIs)
    const totalsMap = {};
    cols.forEach(function (col) { totalsMap[col.key] = ""; });
    totalsMap.code = "الإجمالي";
    let activeEmployees = 0;

    rows.forEach(function (rowObj, rIdx) {
      if (String(rowObj.name || "").trim() !== "") {
        activeEmployees++;
      }
    });
    totalsMap.name = activeEmployees + " موظف";

    // حساب قوة اليوم في صف الإجماليات (عدد الحاضرين/النبطشية/السهر في كل يوم)
    for (let d = 1; d <= daysCount; d++) {
      const k = "d_" + d;
      let dayActiveCount = 0;
      for (let r = 0; r < rows.length; r++) {
        const p = parseDayCell(rows[r][k], settings);
        if (p.att > 0 || p.shift > 0 || p.overtime > 0) {
          dayActiveCount++;
        }
      }
      totalsMap[k] = dayActiveCount > 0 ? dayActiveCount : "";
    }

    const sumKeys = ["tot_att", "tot_shift", "tot_ot", "tot_abs", "tot_leave", "amt_att", "amt_shift", "amt_ot", "bonus", "deduct", "net_total"];
    sumKeys.forEach(function (sk) {
      let s = 0;
      for (let r = 0; r < rows.length; r++) {
        s += toNum(computedRowMaps[r][sk]);
      }
      totalsMap[sk] = round2(s);
    });

    const displayMatrix = rows.map(function (rowObj, rIdx) {
      return cols.map(function (col) {
        const raw = rowObj[col.key] !== undefined ? rowObj[col.key] : "";
        const val = computedRowMaps[rIdx][col.key];
        return {
          raw: raw,
          display: val,
          cssClass: cellClasses[rIdx][col.key] || ""
        };
      });
    });

    return {
      cols: cols,
      displayMatrix: displayMatrix,
      totalsRow: totalsMap,
      kpis: {
        employees: activeEmployees,
        totAtt: totalsMap.tot_att || 0,
        totShift: totalsMap.tot_shift || 0,
        totOt: totalsMap.tot_ot || 0,
        netTotal: totalsMap.net_total || 0
      }
    };
  }

  function resolveField(rowObj, rIdx, key, colIndexByKey, resolver) {
    const raw = rowObj[key];
    if (typeof raw === "string" && raw.trim().startsWith("=")) {
      return resolver(rIdx, colIndexByKey[key], 0);
    }
    return raw;
  }

  function toNum(v) {
    if (v === "" || v === null || v === undefined) return 0;
    const n = Number(v);
    return isNaN(n) ? 0 : n;
  }

  function round2(n) {
    return Math.round((Number(n) || 0) * 100) / 100;
  }

  function formatMoney(val) {
    if (val === "" || val === null || val === undefined) return "";
    const n = Number(val);
    if (isNaN(n)) return String(val);
    return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }

  /**
   * إنشاء ورقة موحدة جديدة لشهر وسنة محددين (مع إمكانية نسخ أسماء الموظفين وأسعارهم أو إنشاء بيانات نموذجية)
   */
  function createUnifiedSheet(options) {
    const opts = options || {};
    const now = new Date();
    const year = Number(opts.year || now.getFullYear());
    const month = Number(opts.month || (now.getMonth() + 1));
    const monthName = window.APP_CONFIG.ARABIC_MONTHS[month - 1] || ("شهر " + month);
    const title = opts.title || ("كشف " + monthName + " " + year);

    let rows = [];
    if (Array.isArray(opts.templateEmployees) && opts.templateEmployees.length > 0) {
      rows = opts.templateEmployees.map(function (emp) {
        return {
          code: emp.code || "",
          name: emp.name || "",
          dept: emp.dept || "",
          rate_att: emp.rate_att !== undefined ? emp.rate_att : "",
          rate_shift: emp.rate_shift !== undefined ? emp.rate_shift : "",
          rate_ot: emp.rate_ot !== undefined ? emp.rate_ot : "",
          bonus: "",
          deduct: "",
          notes: ""
        };
      });
    } else if (opts.withSampleData) {
      rows = [
        { code: "101", name: "أحمد محمد عبد الرحمن", dept: "الحسابات", d_1: "ح", d_2: "ح+س2", d_3: "ح+ن", d_4: "ح", d_5: "ن", d_7: "ح", d_8: "ح+س3", rate_att: 150, rate_shift: 250, rate_ot: 50, bonus: 0, deduct: 0, notes: "" },
        { code: "102", name: "محمود حسن إبراهيم", dept: "التشغيل", d_1: "ح+ن", d_2: "ح", d_3: "ح", d_4: "ح+س2", d_6: "ع", d_7: "ح+ن", d_8: "ح", rate_att: 140, rate_shift: 250, rate_ot: 50, bonus: 100, deduct: 0, notes: "مكافأة التزام" },
        { code: "103", name: "سارة خالد مصطفى", dept: "الشؤون الإدارية", d_1: "ح", d_2: "ح", d_3: "إ", d_4: "ح+س2", d_7: "ح", d_8: "ح", rate_att: 150, rate_shift: 220, rate_ot: 45, bonus: 0, deduct: 0, notes: "" },
        { code: "104", name: "كريم طارق السيد", dept: "الأمن والنبطشيات", d_1: "ن", d_2: "ح+س3", d_3: "ن", d_4: "ح", d_5: "ن+س2", d_7: "غ", d_8: "ح+ن", rate_att: 130, rate_shift: 260, rate_ot: 45, bonus: 0, deduct: 50, notes: "" },
        { code: "105", name: "مصطفى عادل حسين", dept: "الدعم الفني", d_1: "ح", d_2: "ح+ن", d_3: "ح", d_4: "م", d_7: "ح+س4", d_8: "ح", rate_att: 160, rate_shift: 250, rate_ot: 55, bonus: 0, deduct: 0, notes: "" },
        { code: "106", name: "", dept: "", rate_att: 150, rate_shift: 250, rate_ot: 50 },
        { code: "107", name: "", dept: "", rate_att: 150, rate_shift: 250, rate_ot: 50 },
        { code: "108", name: "", dept: "", rate_att: 150, rate_shift: 250, rate_ot: 50 },
        { code: "109", name: "", dept: "", rate_att: 150, rate_shift: 250, rate_ot: 50 },
        { code: "110", name: "", dept: "", rate_att: 150, rate_shift: 250, rate_ot: 50 }
      ];
    } else {
      for (let i = 1; i <= 12; i++) {
        rows.push({ code: String(100 + i), name: "", dept: "", rate_att: "", rate_shift: "", rate_ot: "" });
      }
    }

    return {
      id: "sh_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
      type: "unified",
      title: title,
      year: year,
      month: month,
      hideDays: false,
      settings: {
        defaultOvertimeUnit: 1,
        shiftCountsAsAttendance: false,
        missionCountsAsAttendance: true,
        absencePenaltyDays: 0
      },
      styles: {},
      rows: rows
    };
  }

  function createFreeSheet(title) {
    const rows = [];
    for (let r = 0; r < 22; r++) {
      rows.push({});
    }
    return {
      id: "sh_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
      type: "free",
      title: title || "ورقة إكسيل حرة",
      colCount: 14,
      styles: {},
      rows: rows
    };
  }

  function createDefaultWorkbook() {
    const firstSheet = createUnifiedSheet({ withSampleData: true });
    return {
      workbookTitle: "سجل الحضور والنبطشيات والسهر الموحد",
      orgName: "الإدارة المالية وشؤون العاملين",
      activeSheetId: firstSheet.id,
      sheets: [firstSheet]
    };
  }

  /**
   * بناء ملخص مقروء ليتم عرضه اختيارياً في تبويب مرئي داخل Google Sheets
   */
  function buildReadableSummaryForCloud(sheet) {
    if (!sheet || sheet.type !== "unified") return null;
    const calc = computeSheetMatrix(sheet);
    const summaryKeys = ["code", "name", "dept", "tot_att", "tot_shift", "tot_ot", "tot_abs", "tot_leave", "amt_att", "amt_shift", "amt_ot", "bonus", "deduct", "net_total", "notes"];
    const keyToIdx = {};
    calc.cols.forEach(function (c, i) { keyToIdx[c.key] = i; });

    const headerRow = summaryKeys.map(function (k) {
      return calc.cols[keyToIdx[k]] ? calc.cols[keyToIdx[k]].title : k;
    });

    const outRows = [headerRow];
    calc.displayMatrix.forEach(function (rowCells) {
      const nameVal = String(rowCells[keyToIdx.name].display || "").trim();
      const codeVal = String(rowCells[keyToIdx.code].display || "").trim();
      if (!nameVal && !codeVal) return;
      outRows.push(summaryKeys.map(function (k) {
        const v = rowCells[keyToIdx[k]].display;
        return v === undefined || v === null ? "" : v;
      }));
    });

    if (calc.totalsRow) {
      outRows.push(summaryKeys.map(function (k) {
        return calc.totalsRow[k] !== undefined ? calc.totalsRow[k] : "";
      }));
    }

    return { title: sheet.title, rows: outRows };
  }

  /**
   * تصدير الورقة الحالية إلى ملف إكسيل حقيقي منسق (.xls SpreadsheetML يدعم العربية والألوان واتجاه RTL بدون إنترنت)
   */
  function exportSheetToExcelXML(sheet, orgName) {
    const calc = computeSheetMatrix(sheet);
    const visibleCols = calc.cols.filter(function (c) { return !c.hidden; });

    function escXml(str) {
      return String(str === undefined || str === null ? "" : str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }

    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<?mso-application progid="Excel.Sheet"?>\n' +
      '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"\n' +
      ' xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"\n' +
      ' xmlns:x="urn:schemas-microsoft-com:office:excel">\n' +
      '<Styles>\n' +
      '  <Style ss:ID="Default" ss:Name="Normal"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Font ss:FontName="Cairo" ss:Size="11"/></Style>\n' +
      '  <Style ss:ID="Title"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Font ss:FontName="Cairo" ss:Size="14" ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#107C41" ss:Pattern="Solid"/></Style>\n' +
      '  <Style ss:ID="Header"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Font ss:FontName="Cairo" ss:Size="11" ss:Bold="1" ss:Color="#0F172A"/><Interior ss:Color="#D1FAE5" ss:Pattern="Solid"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/></Borders></Style>\n' +
      '  <Style ss:ID="Cell"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/></Borders></Style>\n' +
      '  <Style ss:ID="NetCell"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Font ss:FontName="Cairo" ss:Size="11" ss:Bold="1" ss:Color="#065F46"/><Interior ss:Color="#DCFCE7" ss:Pattern="Solid"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/></Borders></Style>\n' +
      '  <Style ss:ID="Footer"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Font ss:FontName="Cairo" ss:Size="11" ss:Bold="1"/><Interior ss:Color="#E2E8F0" ss:Pattern="Solid"/><Borders><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="2"/></Borders></Style>\n' +
      '</Styles>\n';

    const safeSheetName = escXml((sheet.title || "ورقة1").slice(0, 28));
    xml += '<Worksheet ss:Name="' + safeSheetName + '" ss:RightToLeft="1">\n<Table>\n';

    // عنوان الكشف العلوي
    xml += '<Row ss:Height="28"><Cell ss:MergeAcross="' + (visibleCols.length - 1) + '" ss:StyleID="Title"><Data ss:Type="String">' +
      escXml((orgName ? orgName + " - " : "") + sheet.title) + '</Data></Cell></Row>\n';

    // صف العناوين
    xml += '<Row ss:Height="24">';
    visibleCols.forEach(function (col) {
      const hdrLabel = col.kind === "day" ? (col.title + " (" + col.dayName + ")") : col.title;
      xml += '<Cell ss:StyleID="Header"><Data ss:Type="String">' + escXml(hdrLabel) + '</Data></Cell>';
    });
    xml += '</Row>\n';

    // صفوف البيانات
    calc.displayMatrix.forEach(function (rowCells) {
      xml += '<Row ss:Height="21">';
      calc.cols.forEach(function (col, cIdx) {
        if (col.hidden) return;
        const val = rowCells[cIdx].display;
        const isNumber = val !== "" && val !== null && val !== undefined && !isNaN(Number(val)) && col.kind !== "meta" && col.kind !== "day" && col.kind !== "notes";
        const styleId = col.key === "net_total" ? "NetCell" : "Cell";
        const typeAttr = isNumber ? "Number" : "String";
        xml += '<Cell ss:StyleID="' + styleId + '"><Data ss:Type="' + typeAttr + '">' + escXml(val) + '</Data></Cell>';
      });
      xml += '</Row>\n';
    });

    // صف الإجماليات
    if (calc.totalsRow) {
      xml += '<Row ss:Height="24">';
      calc.cols.forEach(function (col) {
        if (col.hidden) return;
        const tv = calc.totalsRow[col.key] !== undefined ? calc.totalsRow[col.key] : "";
        const isNum = tv !== "" && !isNaN(Number(tv));
        xml += '<Cell ss:StyleID="Footer"><Data ss:Type="' + (isNum ? "Number" : "String") + '">' + escXml(tv) + '</Data></Cell>';
      });
      xml += '</Row>\n';
    }

    xml += '</Table>\n<WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><DisplayRightToLeft/></WorksheetOptions>\n</Worksheet>\n</Workbook>';

    const blob = new Blob(["\uFEFF" + xml], { type: "application/vnd.ms-excel;charset=utf-8;" });
    triggerDownload(blob, (sheet.title || "كشف_الحضور_والنبطشيات") + ".xls");
  }

  function exportSheetToCSV(sheet) {
    const calc = computeSheetMatrix(sheet);
    const visibleIndices = [];
    calc.cols.forEach(function (c, idx) {
      if (!c.hidden) visibleIndices.push(idx);
    });

    function csvCell(v) {
      const s = String(v === undefined || v === null ? "" : v);
      if (/[",\n\r]/.test(s)) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    }

    const lines = [];
    lines.push(visibleIndices.map(function (i) { return csvCell(calc.cols[i].title); }).join(","));
    calc.displayMatrix.forEach(function (row) {
      lines.push(visibleIndices.map(function (i) { return csvCell(row[i].display); }).join(","));
    });
    if (calc.totalsRow) {
      lines.push(visibleIndices.map(function (i) { return csvCell(calc.totalsRow[calc.cols[i].key]); }).join(","));
    }

    const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    triggerDownload(blob, (sheet.title || "sheet") + ".csv");
  }

  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 250);
  }

  window.SpreadsheetEngine = {
    colToLetter: colToLetter,
    letterToCol: letterToCol,
    getDaysInMonth: getDaysInMonth,
    getDayInfo: getDayInfo,
    parseDayCell: parseDayCell,
    getSheetColumns: getSheetColumns,
    computeSheetMatrix: computeSheetMatrix,
    createUnifiedSheet: createUnifiedSheet,
    createFreeSheet: createFreeSheet,
    createDefaultWorkbook: createDefaultWorkbook,
    buildReadableSummaryForCloud: buildReadableSummaryForCloud,
    exportSheetToExcelXML: exportSheetToExcelXML,
    exportSheetToCSV: exportSheetToCSV,
    formatMoney: formatMoney
  };
})();
