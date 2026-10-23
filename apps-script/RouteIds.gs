/**
 * 龍洞路線資料庫：路線ID 自動產生與保護
 *
 * 貼到 Google Sheet 的「擴充功能 → Apps Script」使用，安裝步驟見 apps-script/README.md。
 *
 * - 每條路線一個固定不變的 ID（6 碼短碼，例如 7kq2mx），App 用它記錄使用者的收藏與攀登紀錄。
 * - 新增路線（填好編號與名稱）時自動產生 ID。
 * - 「路線ID」欄不能手動修改：任何人改到這一欄（打字、清除、貼上），都會立刻還原成原本的 ID。
 *   原本的 ID 依序從：編輯前的值 → 已發布的網站資料（同編號、同名，未編號者同分頁、同名）找回；都找不到才產生新的。
 *   例外：改成已發布、且沒被其他路線使用的 ID 會被接受（匯入錯誤訊息要維護者把 ID 改回原本的）。
 * - 選單「路線ID → 補上缺少的 ID」：替沒有 ID 的路線找回或產生 ID，也會修正重複的 ID。
 *   先保留格式正確且不重複的現有 ID，再處理其餘的列，新路線不會搶走既有路線的 ID。
 */

var ID_HEADER = '路線ID'
// 對照表的鍵改變時換名稱，避免讀到舊格式的快取
var CACHE_KEY = 'published-ids-v2'
var HEADER_FIRST_CELL = '分區'
// 正式站（firebase.json 的 hosting.site）
var PUBLISHED_URL = 'https://longdong.web.app/data/longdong.json'
// 不含容易看錯的 0/o、1/l/i
var ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz'
var ID_LENGTH = 6
var ID_PATTERN = /^[2-9a-hjkmnp-z]{6}$/
var ROUTE_NUMBER = /^#?\s*\d+(\.\d+)?$/
// 分頁下方的材質圖例與統計表，讀到這裡就停止
var LEGEND = /^(\d{3}|Ti)-[A-Za-z0-9]+$|^統計$/
var CJK = /[㐀-鿿豈-﫿]/

/* ---------- 選單與觸發 ---------- */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('路線ID')
    .addItem('啟用自動保護', 'enableProtection')
    .addItem('補上缺少的 ID', 'fillMissingIds')
    .addToUi()
}

/**
 * 安裝「編輯時」觸發程式。需要授權（讀取已發布的網站資料以還原 ID），只要做一次。
 * 以安裝者的身分執行，所以其他編輯者改到「路線ID」欄也會被還原。
 */
function enableProtection() {
  var ss = SpreadsheetApp.getActiveSpreadsheet()
  var triggers = ScriptApp.getProjectTriggers()
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'handleEdit') ScriptApp.deleteTrigger(triggers[i])
  }
  ScriptApp.newTrigger('handleEdit').forSpreadsheet(ss).onEdit().create()
  SpreadsheetApp.getUi().alert('已啟用：新增路線會自動產生路線ID，「路線ID」欄被修改時會自動還原。')
}

/** 選單功能：所有區域分頁中，沒有 ID 或 ID 重複的路線，找回原本的 ID 或產生新的 */
function fillMissingIds() {
  var lock = LockService.getDocumentLock()
  lock.waitLock(30000)
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet()
    var published = loadPublished(true)
    var restored = 0
    var created = 0
    var sheets = ss.getSheets()
    for (var i = 0; i < sheets.length; i++) {
      var layout = readLayout(sheets[i], true)
      if (!layout) continue
      var result = repairRows(sheets[i], layout, null, null, published)
      restored += result.restored
      created += result.created
    }
    SpreadsheetApp.getUi().alert('完成：找回原本的 ID ' + restored + ' 條、新產生 ' + created + ' 條。')
  } finally {
    lock.releaseLock()
  }
}

/** 編輯觸發（由 enableProtection 安裝）：改到「路線ID」欄就還原，新路線自動產生 ID */
function handleEdit(e) {
  var sheet = e.range.getSheet()
  var layout = readLayout(sheet, false)
  if (!layout) return
  var firstCol = e.range.getColumn()
  var lastCol = e.range.getLastColumn()
  var touchesId = firstCol <= layout.idCol && layout.idCol <= lastCol
  var touchesRoute =
    (firstCol <= layout.numberCol && layout.numberCol <= lastCol) || (firstCol <= layout.nameCol && layout.nameCol <= lastCol)
  if (!touchesId && !touchesRoute) return

  var lock = LockService.getDocumentLock()
  if (!lock.tryLock(10000)) return
  try {
    // 單一儲存格的編輯，Google 會提供編輯前的值
    var oldValue = touchesId && e.range.getNumRows() === 1 && e.range.getNumColumns() === 1 ? e.oldValue : null
    var published
    try {
      published = loadPublished(false)
    } catch (err) {
      // 讀不到已發布資料就不動任何 ID：產生新 ID 會取代原本的 ID，交給維護者稍後重跑
      sheet.getParent().toast(err.message + '。這次沒有處理路線ID，請稍後執行「路線ID → 補上缺少的 ID」。', '路線ID', 30)
      return
    }
    var rows = { from: e.range.getRow(), to: e.range.getLastRow() }
    var result = repairRows(sheet, layout, rows, oldValue, published)
    if (touchesId && result.restored + result.created > 0) {
      sheet.getParent().toast('「路線ID」欄不能手動修改，已自動還原。', '路線ID', 5)
    }
  } finally {
    lock.releaseLock()
  }
}

/* ---------- 核心：決定每一列應有的 ID ---------- */

/**
 * 檢查並修正一個分頁中路線列的 ID。rows 為 null 表示整頁。
 * 回傳 { restored: 找回原本 ID 的數量, created: 新產生的數量 }
 */
function repairRows(sheet, layout, rows, oldValue, published) {
  var start = layout.headerRow + 1
  var count = sheet.getLastRow() - layout.headerRow
  if (count <= 0) return { restored: 0, created: 0 }
  var numbers = sheet.getRange(start, layout.numberCol, count, 1).getDisplayValues()
  var names = sheet.getRange(start, layout.nameCol, count, 1).getDisplayValues()
  var idRange = sheet.getRange(start, layout.idCol, count, 1)
  var ids = idRange.getDisplayValues()

  // 其他分頁的 ID，以及本頁「不在這次處理範圍」的 ID，都算已使用
  var usedElsewhere = collectExistingIds(sheet.getParent(), sheet.getSheetId())
  var targets = []
  for (var i = 0; i < count; i++) {
    var no = String(numbers[i][0]).trim()
    if (LEGEND.test(no)) {
      count = i
      break
    }
    if (!isRouteRow(no, names[i][0])) continue
    var row = start + i
    if (rows && (row < rows.from || row > rows.to)) {
      var other = String(ids[i][0]).trim()
      if (other) usedElsewhere[other] = true
    } else {
      targets.push(i)
    }
  }

  var restored = 0
  var created = 0
  var changed = false
  var claimed = {}
  var publishedIds = collectPublishedIds(published)
  var currents = []
  var candidatesOf = []
  for (var t = 0; t < targets.length; t++) {
    var k = targets[t]
    currents[t] = String(ids[k][0]).trim()
    candidatesOf[t] = (oldValue ? [String(oldValue).trim()] : []).concat(
      lookupPublished(published, sheet.getName(), numbers[k][0], names[k][0]),
    )
  }
  // 整頁補上時分兩輪，結果不受列的順序影響：先保留現有的 ID，再替其餘的列找回或產生
  var kept = rows ? [] : keepExistingIds(currents, candidatesOf, usedElsewhere, publishedIds)
  for (var j = 0; j < kept.length; j++) if (kept[j]) claimed[currents[j]] = true
  for (t = 0; t < targets.length; t++) {
    if (kept[t]) continue
    k = targets[t]
    var current = currents[t]
    // 整頁補上的第二輪只處理空白、格式不對或重複的 ID，現有值不再採用
    var decision = resolveRowId(rows ? current : '', candidatesOf[t], function (id) {
      return usedElsewhere[id] === true || claimed[id] === true
    }, publishedIds[current] === true)
    var id = decision.id || newUniqueId(mergeUsed(usedElsewhere, claimed))
    claimed[id] = true
    if (id !== current) {
      ids[k][0] = id
      changed = true
      if (decision.id) restored++
      else created++
    }
  }
  if (changed) idRange.setValues(ids)
  return { restored: restored, created: created }
}

/**
 * 整頁補上的第一輪（純函式，方便測試）：回傳各列是否保留現有的 ID。保留的條件：
 * - 格式正確、在 Sheet 中不重複
 * - 是已發布的 ID；或不是，但這條路線沒有可找回的已發布 ID（沒被任何列使用的候選）
 */
function keepExistingIds(currents, candidatesOf, usedElsewhere, publishedIds) {
  var count = {}
  for (var i = 0; i < currents.length; i++) count[currents[i]] = (count[currents[i]] || 0) + 1
  var free = function (id) {
    return ID_PATTERN.test(id) && !usedElsewhere[id] && !count[id]
  }
  var kept = []
  for (i = 0; i < currents.length; i++) {
    var c = currents[i]
    kept[i] =
      ID_PATTERN.test(c) && count[c] === 1 && !usedElsewhere[c] && (publishedIds[c] === true || !candidatesOf[i].some(free))
  }
  return kept
}

/**
 * 決定一列的 ID（純函式，方便測試）：
 * 1. 現有值是已發布的 ID 且沒被別列使用，就保留（例如維護者依匯入錯誤訊息把 ID 改回原本的）
 * 2. 依序檢查 candidates（編輯前的值、已發布資料中同一條路線的 ID），格式正確且沒被別列使用就用它
 * 3. 沒有候選時，現有值格式正確且沒被別列使用，就保留
 * 4. 否則回傳 { id: null }，由呼叫端產生新 ID
 */
function resolveRowId(current, candidates, isUsed, currentIsPublished) {
  if (currentIsPublished && ID_PATTERN.test(current) && !isUsed(current)) return { id: current }
  for (var i = 0; i < candidates.length; i++) {
    var c = candidates[i]
    if (ID_PATTERN.test(c) && !isUsed(c)) return { id: c }
  }
  if (ID_PATTERN.test(current) && !isUsed(current)) return { id: current }
  return { id: null }
}

/* ---------- 已發布的網站資料 ---------- */

/**
 * 讀取已發布的資料，建立「分頁|編號|名稱」等對照。forceRefresh 為 true 時不用快取。
 * 讀不到時丟出錯誤：當成「沒有已發布的 ID」繼續，會替路線產生新 ID 取代原本的。
 */
function loadPublished(forceRefresh) {
  var cache = CacheService.getScriptCache()
  var cached = forceRefresh ? null : cache.get(CACHE_KEY)
  if (cached) return JSON.parse(cached)
  var res
  try {
    res = UrlFetchApp.fetch(PUBLISHED_URL, { muteHttpExceptions: true })
  } catch (err) {
    throw new Error(publishedError(err.message))
  }
  var index = parsePublished(res.getResponseCode(), res.getContentText())
  cache.put(CACHE_KEY, JSON.stringify(index), 21600)
  return index
}

/** 已發布資料的回應 → 對照表（純函式，方便測試）；讀不懂就丟出錯誤 */
function parsePublished(status, text) {
  if (status !== 200) throw new Error(publishedError('HTTP ' + status))
  var data
  try {
    data = JSON.parse(text)
  } catch (err) {
    throw new Error(publishedError('內容不是 JSON'))
  }
  // 網站資料還是舊規則的 ID（尚未改用 Sheet 的「路線ID」）：本來就沒有可找回的 ID
  if (data.idSource !== 'sheet') return {}
  return buildPublishedIndex(data)
}

function publishedError(reason) {
  return '讀不到已發布的網站資料（' + PUBLISHED_URL + '，' + reason + '），無法找回原本的路線ID'
}

/**
 * 已發布資料 → { 鍵: [ID…] }。鍵有三種：
 * - 編號|名稱（路線編號在全龍洞唯一，搬到別的分頁也找得到；未編號者為 分頁|名稱）
 * - 分頁|名稱、分頁|編號
 */
function buildPublishedIndex(data) {
  var index = {}
  var add = function (key, id) {
    if (!index[key]) index[key] = []
    if (index[key].indexOf(id) < 0) index[key].push(id)
  }
  for (var a = 0; a < data.areas.length; a++) {
    var area = data.areas[a]
    for (var s = 0; s < area.sectors.length; s++) {
      var routes = area.sectors[s].routes
      for (var r = 0; r < routes.length; r++) {
        var id = routes[r].id.split('/').pop()
        var no = routes[r].number || ''
        var name = routes[r].name.zh
        add(fullKey(area.name.zh, no, name), id)
        add('name|' + area.name.zh + '|' + name, id)
        if (no) add('number|' + area.name.zh + '|' + no, id)
      }
    }
  }
  return index
}

/** 已發布資料中所有的 ID → { ID: true } */
function collectPublishedIds(index) {
  var ids = {}
  for (var key in index) {
    for (var i = 0; i < index[key].length; i++) ids[index[key][i]] = true
  }
  return ids
}

/** 找出這一列在已發布資料中對應的 ID；只採用唯一對應，避免誤配 */
function lookupPublished(index, sheetName, rawNumber, rawName) {
  var no = normalizeNumber(rawNumber)
  var name = zhName(rawName)
  var keys = [fullKey(sheetName, no, name), 'name|' + sheetName + '|' + name]
  if (no) keys.push('number|' + sheetName + '|' + no)
  var out = []
  for (var i = 0; i < keys.length; i++) {
    var ids = index[keys[i]]
    if (ids && ids.length === 1 && out.indexOf(ids[0]) < 0) out.push(ids[0])
  }
  return out
}

/** 同一條路線的鍵：有編號時不分分頁（與匯入程式的 ID 檢查一致） */
function fullKey(sheetName, no, name) {
  return no ? 'full|#' + no + '|' + name : 'full|' + sheetName + '|' + name
}

/** "# 523" → "523"；"0"、"# 0"、"0.00" 視為未編號 */
function normalizeNumber(raw) {
  var m = String(raw).trim().match(/^#?\s*(\d+(?:\.\d+)?)$/)
  if (!m || Number(m[1]) === 0) return ''
  return m[1]
}

/** 與匯入程式相同的中文名稱規則：NFKC 正規化，含漢字的行以空白相連 */
function zhName(raw) {
  var lines = String(raw)
    .normalize('NFKC')
    .split(/\r?\n/)
    .map(function (l) {
      return l.replace(/\s+/g, ' ').trim()
    })
    .filter(function (l) {
      return l && !/^[–—-]+$/.test(l)
    })
  var zh = lines.filter(function (l) {
    return CJK.test(l)
  })
  return (zh.length ? zh : lines).join(' ')
}

/* ---------- Sheet 版面 ---------- */

/**
 * 找出欄位位置（1 起算）。不是區域分頁則回傳 null。
 * createIdColumn 為 true 時，若沒有「路線ID」欄，加在最右邊（不會移動既有欄位）。
 */
function readLayout(sheet, createIdColumn) {
  var top = sheet.getRange(1, 1, Math.min(5, sheet.getMaxRows()), sheet.getLastColumn()).getDisplayValues()
  for (var r = 0; r < top.length; r++) {
    if (String(top[r][0]).trim() !== HEADER_FIRST_CELL) continue
    var header = top[r].map(function (h) {
      return String(h).trim()
    })
    var numberCol = header.indexOf('路線編號') + 1
    var nameCol = header.indexOf('路線名稱') + 1
    if (!numberCol || !nameCol) return null
    var idCol = header.indexOf(ID_HEADER) + 1
    if (!idCol) {
      if (!createIdColumn) return null
      idCol = sheet.getLastColumn() + 1
      if (idCol > sheet.getMaxColumns()) sheet.insertColumnAfter(sheet.getMaxColumns())
      sheet.getRange(r + 1, idCol).setValue(ID_HEADER).setFontWeight('bold')
    }
    return { headerRow: r + 1, numberCol: numberCol, nameCol: nameCol, idCol: idCol }
  }
  return null
}

function isRouteRow(number, name) {
  return ROUTE_NUMBER.test(String(number).trim()) && String(name).trim() !== ''
}

/** 所有區域分頁中已有的 ID；exceptSheetId 指定的分頁不算 */
function collectExistingIds(ss, exceptSheetId) {
  var used = {}
  var sheets = ss.getSheets()
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getSheetId() === exceptSheetId) continue
    var layout = readLayout(sheets[i], false)
    if (!layout) continue
    var count = sheets[i].getLastRow() - layout.headerRow
    if (count <= 0) continue
    var values = sheets[i].getRange(layout.headerRow + 1, layout.idCol, count, 1).getDisplayValues()
    for (var r = 0; r < values.length; r++) {
      var id = String(values[r][0]).trim()
      if (id) used[id] = true
    }
  }
  return used
}

function mergeUsed(a, b) {
  var out = {}
  for (var k in a) out[k] = true
  for (var j in b) out[j] = true
  return out
}

function newUniqueId(used) {
  for (var attempt = 0; attempt < 100; attempt++) {
    var id = randomId()
    if (!used[id]) {
      used[id] = true
      return id
    }
  }
  throw new Error('無法產生不重複的 ID')
}

function randomId() {
  var s = ''
  for (var i = 0; i < ID_LENGTH; i++) s += ALPHABET.charAt(Math.floor(Math.random() * ALPHABET.length))
  return s
}

// 讓單元測試可以載入（Apps Script 環境沒有 module，這段不會執行）
if (typeof module !== 'undefined') {
  module.exports = {
    randomId: randomId,
    newUniqueId: newUniqueId,
    isRouteRow: isRouteRow,
    resolveRowId: resolveRowId,
    repairRows: repairRows,
    buildPublishedIndex: buildPublishedIndex,
    parsePublished: parsePublished,
    lookupPublished: lookupPublished,
    normalizeNumber: normalizeNumber,
    zhName: zhName,
    ID_PATTERN: ID_PATTERN,
    PUBLISHED_URL: PUBLISHED_URL,
  }
}
