/**
 * 拉測回報：把 App 上審核通過的出勤寫回 TOCC 的兩份 Google Sheet
 *
 * 貼到「拉測工作紀錄」Sheet 的「擴充功能 → Apps Script」使用（新增一個指令碼檔案），安裝步驟見 apps-script/README.md。
 *
 * - 讀已通過的出勤：https://longdong.firebaseio.com/v2/pullTestsApproved.json（公開可讀，不需要金鑰）。
 * - 拉測工作紀錄（這份 Sheet）：在出勤年份的分頁、對應月份裡新增一天（日期、出勤人員、每條路線的材質與結果、備註），
 *   版面與公式複製既有的區塊；月總計的範圍跟著更新。
 * - 路線資料 Sheet：合格的 bolt 在拉測日期（新到舊）最上面加上這次的日期，位置不夠時在這條路線的區塊裡插一列。
 * - 每筆出勤只寫一次：寫過或寫失敗的出勤 id 記在「App 匯入紀錄」分頁；失敗的要手動處理後刪掉那一列才會重試。
 * - 先檢查兩份 Sheet 都找得到要寫的位置，才開始寫入；找不到就整筆不寫，記下原因並寄信給安裝的帳號。
 */

var APPROVED_URL = 'https://longdong.firebaseio.com/v2/pullTestsApproved.json'
var ROUTES_SHEET_ID = '1QHFNQSPgKgQrTNnYn246wfotOYqOkzHjLltZ26keBgg'
var LOG_TAB = 'App 匯入紀錄'
var RESULT_TEXT = { pass: '合格', fail: '不合格', untested: '未測', cancelled: '取消', exempt: '免測' }
/** 工作紀錄的欄位（版面見 2026 分頁）：A 區域、B 編號、C 路線名稱（公式）、F～AA 是 B01～A04、AB 確保站配件、AF 備註 */
var COL = { area: 1, number: 2, name: 3, firstBolt: 6, hardware: 28, note: 32 }
/** 路線資料 Sheet 的表頭在第 2 列 */
var ROUTES_HEADER_ROW = 2

/* ---------- 選單與觸發 ---------- */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('拉測回報')
    .addItem('試跑（只列出會寫什麼）', 'dryRun')
    .addItem('立即匯入', 'importNow')
    .addItem('啟用自動匯入（每 10 分鐘）', 'enableAutoImport')
    .addToUi()
}

function enableAutoImport() {
  var triggers = ScriptApp.getProjectTriggers()
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'importApproved') ScriptApp.deleteTrigger(triggers[i])
  }
  ScriptApp.newTrigger('importApproved').timeBased().everyMinutes(10).create()
  SpreadsheetApp.getUi().alert('已啟用：每 10 分鐘把 App 上審核通過的出勤寫進這份 Sheet 與路線資料 Sheet。')
}

function importNow() {
  var result = importApproved()
  SpreadsheetApp.getUi().alert(result.length ? result.join('\n') : '沒有新的出勤。')
}

function dryRun() {
  var result = importApproved(true)
  SpreadsheetApp.getUi().alert(result.length ? result.join('\n\n') : '沒有新的出勤。')
}

/* ---------- 匯入 ---------- */

/** 匯入還沒處理過的出勤（日期舊到新）；dry 為 true 時不寫入，只回傳會寫什麼。回傳每筆的結果說明 */
function importApproved(dry) {
  var lock = LockService.getScriptLock()
  lock.waitLock(30000)
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet()
    var routesSs = SpreadsheetApp.openById(ROUTES_SHEET_ID)
    var log = logSheet(ss)
    var done = {}
    if (log.getLastRow() > 1) {
      log.getRange(2, 1, log.getLastRow() - 1, 1).getValues().forEach(function (r) {
        done[r[0]] = true
      })
    }
    var approved = JSON.parse(UrlFetchApp.fetch(APPROVED_URL).getContentText()) || {}
    var ids = Object.keys(approved)
      .filter(function (id) {
        return !done[id]
      })
      .sort(function (a, b) {
        return approved[a].date < approved[b].date ? -1 : approved[a].date > approved[b].date ? 1 : 0
      })
    var out = []
    var errors = []
    ids.forEach(function (id) {
      var o = approved[id]
      try {
        var plan = planOuting(ss, routesSs, id, o)
        if (dry) {
          out.push(describePlan(o, plan))
          return
        }
        writeWorkLog(ss, o, plan.workLog)
        writeRouteTests(o, plan.routes, id)
        log.appendRow([id, new Date(), '已寫入', o.date])
        out.push(o.date + '：已寫入 ' + Object.keys(o.routes).length + ' 條路線')
      } catch (err) {
        var msg = String(err && err.message ? err.message : err)
        if (!dry) log.appendRow([id, new Date(), '失敗', o.date, msg])
        out.push(o.date + '：' + (dry ? '會失敗' : '失敗') + '：' + msg)
        errors.push(o.date + '（' + id + '）：' + msg)
      }
    })
    if (errors.length && !dry) {
      MailApp.sendEmail(Session.getEffectiveUser().getEmail(), '拉測回報：有出勤沒有寫進 Sheet', errors.join('\n') + '\n\n處理後到「' + LOG_TAB + '」分頁刪掉那一列，下次會重試。')
    }
    return out
  } finally {
    lock.releaseLock()
  }
}

function logSheet(ss) {
  var sheet = ss.getSheetByName(LOG_TAB)
  if (!sheet) {
    sheet = ss.insertSheet(LOG_TAB)
    sheet.appendRow(['出勤 id', '處理時間', '結果', '出勤日期', '原因'])
    sheet.hideSheet()
  }
  return sheet
}

/* ---------- 先找好所有要寫的位置（找不到就丟錯，整筆不寫） ---------- */

function planOuting(ss, routesSs, id, o) {
  var year = o.date.slice(0, 4)
  var sheet = ss.getSheetByName(year)
  if (!sheet) throw new Error('工作紀錄沒有「' + year + '」分頁')
  var colA = sheet.getRange(1, 1, sheet.getLastRow(), 1)
  var display = colA.getDisplayValues().map(firstCell)
  var raw = colA.getValues().map(firstCell)
  var month = o.date.slice(5, 7)
  var found = findMonth(display, month)
  var workLog = { sheet: sheet, month: month }
  if (found) {
    workLog.marker = found.marker
    workLog.insertAt = dayInsertRow(raw, found.marker, found.total, toDate(o.date))
  } else {
    workLog.newMonthAt = newMonthRow(display, month)
    if (!workLog.newMonthAt) throw new Error('工作紀錄「' + year + '」分頁找不到放 ' + month + ' 月的位置，請手動新增月份列')
  }
  workLog.templates = findTemplates(sheet, display)

  var routes = []
  Object.keys(o.routes).forEach(function (key) {
    var r = o.routes[key]
    var tab = routesSs.getSheetByName(r.area)
    if (!tab) throw new Error('路線資料沒有「' + r.area + '」分頁')
    var header = tab.getRange(ROUTES_HEADER_ROW, 1, 1, tab.getLastColumn()).getDisplayValues()[0]
    var idCol = header.indexOf('路線ID') + 1
    if (!idCol) throw new Error('「' + r.area + '」分頁沒有「路線ID」欄')
    var last = tab.getLastRow()
    var ids = tab.getRange(1, idCol, last, 1).getDisplayValues().map(firstCell)
    var numbers = tab.getRange(1, 2, last, 1).getDisplayValues().map(firstCell)
    var block = routeBlock(ids, numbers, key.split(':')[1])
    if (!block) throw new Error('「' + r.area + '」分頁找不到路線ID ' + key.split(':')[1] + '（' + r.name + '）')
    var cols = {}
    Object.keys(r.bolts).forEach(function (pos) {
      if (r.bolts[pos].result !== 'pass') return
      var c = header.indexOf(pos) + 1
      if (!c) throw new Error('「' + r.area + '」分頁沒有 ' + pos + ' 欄（' + r.name + '）')
      cols[pos] = c
    })
    routes.push({ key: key, tab: tab, row: block.row, end: block.end, cols: cols })
  })
  return { workLog: workLog, routes: routes }
}

function describePlan(o, plan) {
  var w = plan.workLog
  var where = w.insertAt ? '在第 ' + w.insertAt + ' 列前新增這一天' : '在第 ' + w.newMonthAt + ' 列前新增 ' + w.month + ' 月'
  var lines = [o.date + '：工作紀錄「' + w.sheet.getName() + '」分頁' + where]
  plan.routes.forEach(function (r) {
    var route = o.routes[r.key]
    var pos = Object.keys(r.cols)
    lines.push('・' + route.area + ' #' + (route.number || '') + ' ' + route.name + '：路線資料第 ' + r.row + ' 列，合格 ' + (pos.length ? pos.join('、') : '無'))
  })
  return lines.join('\n')
}

/** 工作紀錄的樣板列：日期列、出勤人員列、路線區塊（表頭、路線、結果、統計、空白共五列）、月份列、月總計三列 */
function findTemplates(sheet, display) {
  var last = sheet.getLastRow()
  var values = sheet.getRange(1, 1, last, COL.firstBolt).getValues()
  var t = {}
  for (var i = 0; i < last; i++) {
    var a = values[i][0]
    var b = String(values[i][1])
    if (!t.date && a instanceof Date) t.date = i + 1
    if (!t.crew && /^出勤人員/.test(b)) t.crew = i + 1
    if (!t.block && values[i][COL.firstBolt - 1] === 'B01') t.block = i + 1
    if (!t.marker && /^\d{1,2}$/.test(display[i])) t.marker = i + 1
    if (!t.total && /月總計$/.test(display[i])) t.total = i + 1
  }
  if (!t.date || !t.crew || !t.block || !t.marker || !t.total) throw new Error('工作紀錄「' + sheet.getName() + '」分頁找不到可複製的樣板（日期、出勤人員、路線區塊、月份、月總計）')
  return t
}

/* ---------- 寫入 ---------- */

/** 在 at 列之前插入 n 列之後，樣板列的新位置 */
function shiftTemplates(t, at, n) {
  var out = {}
  Object.keys(t).forEach(function (k) {
    out[k] = t[k] >= at ? t[k] + n : t[k]
  })
  return out
}

function writeWorkLog(ss, o, w) {
  var sheet = w.sheet
  var crew = o.crew || []
  var keys = Object.keys(o.routes)
  var dayRows = 1 + crew.length + keys.length * 5
  var cols = sheet.getLastColumn()
  var t = w.templates
  var at
  var marker
  if (w.insertAt) {
    at = w.insertAt
    marker = w.marker
    sheet.insertRowsBefore(at, dayRows)
    t = shiftTemplates(t, at, dayRows)
  } else {
    // 新的月份：月份列、這一天、空白列、月總計三列
    var monthRows = 1 + dayRows + 1 + 3
    sheet.insertRowsBefore(w.newMonthAt, monthRows)
    t = shiftTemplates(t, w.newMonthAt, monthRows)
    marker = w.newMonthAt
    at = marker + 1
    copyRow(sheet, t.marker, marker, cols)
    sheet.getRange(marker, 1).setNumberFormat('@').setValue(w.month)
    var totalAt = at + dayRows + 1
    sheet.getRange(t.total, 1, 3, cols).copyTo(sheet.getRange(totalAt, 1, 3, cols))
    sheet.getRange(totalAt, 1).setFormula('=TEXTJOIN(" ","",A' + marker + ',"月總計")')
  }

  var row = at
  copyRow(sheet, t.date, row, cols)
  sheet.getRange(row, 1).setValue(toDate(o.date))
  row++
  crew.forEach(function (name, i) {
    copyRow(sheet, t.crew, row, cols)
    sheet.getRange(row, 2, 1, 2).setValues([['出勤人員 ' + (i + 1), name]])
    row++
  })
  var header = sheet.getRange(t.block, 1, 1, cols).getDisplayValues()[0]
  keys.forEach(function (key) {
    var r = o.routes[key]
    sheet.getRange(t.block, 1, 5, cols).copyTo(sheet.getRange(row, 1, 5, cols))
    var routeRow = row + 1
    var resultRow = row + 2
    // 清掉樣板的內容，留下公式（C～E 路線名稱、統計）
    sheet.getRange(routeRow, COL.firstBolt, 1, COL.hardware - COL.firstBolt + 1).clearContent()
    sheet.getRange(routeRow, COL.note).clearContent()
    sheet.getRange(resultRow, COL.firstBolt, 1, COL.hardware - COL.firstBolt).clearContent()
    sheet.getRange(routeRow, COL.area).setValue(r.area)
    if (r.number) sheet.getRange(routeRow, COL.number).setValue(isNaN(Number(r.number)) ? r.number : Number(r.number))
    else sheet.getRange(routeRow, COL.number, 1, 2).setValues([['', r.name]])
    Object.keys(r.bolts).forEach(function (pos) {
      var c = header.indexOf(pos) + 1
      if (!c) throw new Error('工作紀錄的表頭沒有 ' + pos)
      sheet.getRange(routeRow, c).setValue(r.bolts[pos].material)
      sheet.getRange(resultRow, c).setValue(RESULT_TEXT[r.bolts[pos].result])
    })
    if (r.anchorHardware) sheet.getRange(routeRow, COL.hardware).setValue(r.anchorHardware)
    sheet.getRange(routeRow, COL.note).setValue((r.note ? r.note + '\n' : '') + 'App 上傳')
    row += 5
  })
  updateMonthTotals(sheet, marker)
}

function copyRow(sheet, from, to, cols) {
  sheet.getRange(from, 1, 1, cols).copyTo(sheet.getRange(to, 1, 1, cols))
}

/** 月總計三列的公式範圍改成月份列的下一列到月總計的上一列 */
function updateMonthTotals(sheet, marker) {
  var display = sheet.getRange(1, 1, sheet.getLastRow(), 1).getDisplayValues().map(firstCell)
  var total = -1
  for (var i = marker; i < display.length; i++) {
    if (/月總計$/.test(display[i])) {
      total = i + 1
      break
    }
  }
  if (total < 0) throw new Error('找不到 ' + display[marker - 1] + ' 月的月總計')
  var range = sheet.getRange(total, 1, 3, sheet.getLastColumn())
  range.setFormulas(totalFormulas(range.getFormulas(), marker + 1, total - 1))
}

function writeRouteTests(o, routes, id) {
  var date = toDate(o.date)
  routes.forEach(function (r) {
    Object.keys(r.cols).forEach(function (pos) {
      var c = r.cols[pos]
      var first = r.row + 3
      var count = r.end - first + 1
      var existing = count > 0 ? r.tab.getRange(first, c, count, 1).getValues().map(firstCell) : []
      var tests = mergeTests(existing, date)
      if (!tests) return
      if (tests.length > count) {
        r.tab.insertRowsAfter(r.end, tests.length - count)
        r.end += tests.length - count
        routes.forEach(function (other) {
          if (other !== r && other.tab.getSheetId() === r.tab.getSheetId() && other.row > r.row) {
            other.row += tests.length - count
            other.end += tests.length - count
          }
        })
      }
      var format = r.tab.getRange(r.row + 1, c).getNumberFormat()
      r.tab.getRange(first, c, tests.length, 1).setValues(tests.map(function (v) {
        return [v]
      })).setNumberFormat(format)
      r.tab.getRange(first, c).setNote('拉測 ' + o.date + '，App 出勤 ' + id)
    })
  })
}

/* ---------- 純函式（tests/pullTestsScript.test.ts 直接測） ---------- */

function firstCell(r) {
  return r[0]
}

function toDate(iso) {
  var p = iso.split('-')
  return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]))
}

function sameDay(a, b) {
  return a instanceof Date && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

/** 月份列（A 欄只有月份，例如「10」「09」）與它的月總計列（1 起算）；找不到 null */
function findMonth(display, month) {
  for (var i = 0; i < display.length; i++) {
    if (/^\d{1,2}$/.test(display[i]) && Number(display[i]) === Number(month)) {
      for (var j = i + 1; j < display.length; j++) {
        if (/^\d{1,2}$/.test(display[j])) break
        if (/月總計$/.test(display[j])) return { marker: i + 1, total: j + 1 }
      }
      return null
    }
  }
  return null
}

/** 這一天要插在哪一列之前：月份裡日期新到舊，放在第一個比它舊的日期之前；都比它新就放在月總計之前 */
function dayInsertRow(raw, marker, total, date) {
  for (var i = marker; i < total - 1; i++) {
    if (raw[i] instanceof Date && raw[i].getTime() < date.getTime()) return i + 1
  }
  return total
}

/** 新的月份要插在哪一列之前：第一個比它早的月份列之前；沒有比它早的月份時 null */
function newMonthRow(display, month) {
  for (var i = 0; i < display.length; i++) {
    if (/^\d{1,2}$/.test(display[i]) && Number(display[i]) < Number(month)) return i + 1
  }
  return null
}

/** 月總計公式裡的範圍（例如 D9:D36、A9:A36）換成 first～last 列 */
function totalFormulas(formulas, first, last) {
  return formulas.map(function (row) {
    return row.map(function (f) {
      return f ? f.replace(/\b([A-Z]{1,2})\d+:\1\d+\b/g, '$1' + first + ':$1' + last) : f
    })
  })
}

/** 路線資料裡這條路線的區塊：路線列，到下一條路線（或下方的圖例）之前；找不到 null */
function routeBlock(ids, numbers, id) {
  var row = ids.indexOf(id)
  if (row < 0) return null
  var end = row + 1
  while (end < ids.length && !ids[end] && !numbers[end]) end++
  return { row: row + 1, end: end }
}

/** 拉測日期（新到舊）加上這次的日期；已經有這一天時 null（不重複寫） */
function mergeTests(existing, date) {
  var tests = existing.filter(function (v) {
    return v !== '' && v !== null
  })
  for (var i = 0; i < tests.length; i++) if (sameDay(tests[i], date)) return null
  return [date].concat(tests)
}
