/**
 * RAIM 업무 대시보드 ↔ 스프레드시트 연동 (자원봉사 보드)
 *
 * - GitHub Pages 보드가 이 스크립트(웹앱)를 통해 시트에 저장·불러오기를 합니다.
 * - 라메 명단은 기존 '라임메이트' 탭에서 읽습니다.
 * - 보드에 입력한 명단으로 '보드_활동기록입력' 탭을 만들어서,
 *   기존 ① 이름순 / ② 첫 활동일순 활동기록부 변환이 그대로 읽을 수 있게 합니다.
 * - 금요일 오후, 매일 저녁 메일 알림을 보냅니다.
 * - 아뜰리에 관리 보드는 같은 웹앱을 쓰고, 요청에 board=atelier 가 붙습니다 (처리는 아뜰리에.gs).
 * - 접속 코드: 전체 코드(BOARD_TOKEN)는 두 보드 모두, 보드별 코드는 그 보드만 열 수 있습니다.
 *
 * 기존 코드와 겹치지 않도록 이 파일의 이름은 모두 '보드'로 시작합니다.
 * 처음 한 번: 편집기에서 보드_설치 실행 → 실행 로그에서 접속 코드 확인
 */

const 보드CONFIG = {
  기록탭명: '보드_기록',            // 보드 데이터 원본 (봉사자 한 명 = 한 줄)
  날짜탭명: '보드_날짜',            // 날짜별 명단 확인 / 휴관 / 공지 문구
  입력탭명: '보드_활동기록입력',     // 활동기록부 변환(①②)이 읽는 탭
  기록부반영시작일: '20261001',      // 이 날짜부터 입력 탭에 넣습니다 (9월은 기존 탭과 겹치지 않게). 비우면 전체.
  원본탭명: '원본',                  // 월말에 붙여넣는 1365 명단. 보드에서 결석한 사람은 '미승인' 칸에 1을 표시합니다
  알림받을메일: '',                  // 비우면 스크립트 소유자 메일 (여러 명이면 쉼표로)
  보드주소: '',                      // GitHub Pages 주소 (알림 메일에 링크로 들어감). 예: https://kyuw0nkim.github.io/raim_volunteer/
  주말알림요일: ScriptApp.WeekDay.FRIDAY,
  주말알림시: 15,
  저녁알림시: 18,
  아뜰리에알림시: 9,                 // 아뜰리에 아침 알림 (운영일만)
};

const 보드_설정탭명 = '보드_설정';        // 배치 규칙·라메 명단 (항목 | 값(JSON))
const 보드_설정헤더 = ['항목', '값'];
const 보드_기록헤더 = ['id', '날짜', '시간대', '봉사자', '휴대폰', '배치', '로공방모집', '고정', '출석', '1365입력', '메모', '주말'];
const 보드_날짜헤더 = ['날짜', '명단확인', '휴관', '로공방운영', '공지추가', '확인항목'];
// 기존 열_찾기()가 인식하는 헤더 이름 (봉사자성명 / 휴대폰 / 활동일자 / 시작시간 / 미승인)
const 보드_입력헤더 = ['봉사자성명', '휴대폰', '활동일자', '시작시간', '미승인', '배치', '출석'];

const 보드_배치라벨 = { '1F': '1층 전시안내', '2F': '2층 교육장', '3F': '3층 상주', '4F': '4층 로공방', '-': '미정' };
const 보드_요일 = ['일', '월', '화', '수', '목', '금', '토'];

/* =====================================================
 * 웹앱 (보드가 호출)
 * ===================================================== */

function doGet(e) {
  try {
    const p = (e && e.parameter) || {};
    const perm = 보드_권한_(p.token);
    if (!perm) return 보드_json_({ ok: false, code: 'auth' });
    if (p.action === 'codes') return 보드_json_(보드_공유코드_(p.token));
    if (p.action === 'summary') return 보드_json_(보드_요약_(perm, p.sv));
    if (!perm[p.board === 'atelier' ? 'atelier' : 'volunteer']) return 보드_json_({ ok: false, code: 'forbidden' });
    // 보드가 가진 판(v)과 같으면 내용 없이 same 만 돌려줍니다. 가장 흔하고 가장 빠른 경우예요.
    if (p.action === 'load' && p.board === 'atelier') {
      const version = 아뜰리에_버전_();
      const closedVersion = 보드_버전_();   // 휴관 정보는 자원봉사 보드 데이터에서 옵니다
      if (p.v !== undefined && Number(p.v) === version && Number(p.cv) === closedVersion) {
        return 보드_json_({ ok: true, board: 'atelier', version, closedVersion, same: true, patch: 1 });
      }
      return 보드_json_({
        ok: true,
        board: 'atelier',
        patch: 1,   // 이 웹앱은 바뀐 부분만 받아 저장할 수 있어요
        version,
        closedVersion,
        state: 보드_캐시_('ATELIER', version, 아뜰리에_불러오기_),
        closed: 보드_캐시_('CLOSED', closedVersion, 아뜰리에_휴관지정_),
      });
    }
    if (p.action === 'load') {
      const version = 보드_버전_();
      const lime = 보드_라메명단_캐시_();
      if (p.v !== undefined && Number(p.v) === version) {
        return 보드_json_({ ok: true, board: 'volunteer', version, same: true, lime, patch: 1 });
      }
      return 보드_json_({
        ok: true,
        board: 'volunteer',
        patch: 1,
        version,
        state: 보드_캐시_('BOARD', version, 보드_불러오기_),
        lime,
      });
    }
    return 보드_json_({ ok: false, code: 'bad_request' });
  } catch (err) {
    return 보드_json_({ ok: false, code: 'error', message: String(err && err.message || err) });
  }
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return 보드_json_({ ok: false, code: 'bad_request' });
  }
  const perm = 보드_권한_(body.token);
  if (!perm) return 보드_json_({ ok: false, code: 'auth' });
  if (body.action !== 'save') return 보드_json_({ ok: false, code: 'bad_request' });

  const atelier = body.board === 'atelier';
  if (!perm[atelier ? 'atelier' : 'volunteer']) return 보드_json_({ ok: false, code: 'forbidden' });
  const versionKey = atelier ? 'ATELIER_VERSION' : 'BOARD_VERSION';
  const lock = LockService.getScriptLock();
  try {
    // 다른 저장이 시트를 쓰는 중이면 기다렸다가, 너무 오래 걸리면 busy로 알려 줍니다 (보드가 조금 뒤 다시 시도)
    if (!lock.tryLock(25000)) return 보드_json_({ ok: false, code: 'busy' });
    const current = Number(PropertiesService.getScriptProperties().getProperty(versionKey) || 0);
    if (Number(body.baseVersion) !== current) {
      return 보드_json_({ ok: false, code: 'conflict', version: current });
    }
    // patch = 바뀐 부분만 (자원봉사: 날짜별, 아뜰리에: 목록별). 판이 같으니 지금 시트 내용 + 바뀐 부분 = 보드 내용
    if (!body.patch && !body.state) return 보드_json_({ ok: false, code: 'bad_request' });
    if (atelier) {
      if (body.patch) {
        const lists = body.patch.lists || {};
        const s = 보드_캐시_('ATELIER', current, 아뜰리에_불러오기_);
        Object.keys(lists).forEach(k => { if (아뜰리에_탭[k]) s[k] = lists[k]; });
        if (body.patch.seeded) s.seeded = true;
        아뜰리에_저장_(s, Object.keys(lists));
      } else 아뜰리에_저장_(body.state);
    } else if (body.patch) {
      const s = 보드_캐시_('BOARD', current, 보드_불러오기_);
      const days = body.patch.days || {};
      Object.keys(days).forEach(k => { if (days[k]) s.days[k] = days[k]; else delete s.days[k]; });
      if (body.patch.settings) s.settings = body.patch.settings;
      보드_저장_(s);
    } else 보드_저장_(body.state);
    const next = current + 1;
    PropertiesService.getScriptProperties().setProperty(versionKey, String(next));
    return 보드_json_({ ok: true, version: next });
  } catch (err) {
    return 보드_json_({ ok: false, code: 'error', message: String(err && err.message || err) });
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

/**
 * 대시보드용 요약: 숫자와 할 일 목록만 보냅니다 (보드 전체·봉사자 연락처는 보내지 않음).
 * sv가 지금 판과 같으면 same만 돌려줘요. 판 = 두 보드 판 + 휴관 판 + 오늘 날짜
 */
function 보드_요약_(perm, sv) {
  const today = 보드_오늘_();
  // 휴관 정보는 자원봉사 판에 들어 있어서, 아뜰리에만 보는 코드도 자원봉사 판이 바뀌면 다시 계산해요
  const key = [보드_버전_(), perm.atelier ? 아뜰리에_버전_() : '-', perm.volunteer ? 'v' : '', today].join('.');
  if (sv === key) return { ok: true, same: true, key };
  const out = { ok: true, key, today };
  if (perm.volunteer) {
    const days = 보드_캐시_('BOARD', 보드_버전_(), 보드_불러오기_).days;
    const closedToday = 보드_휴관인지_(days, today);
    let noAtt = 0;
    let entry = 0;
    Object.keys(days).forEach(k => {
      if (보드_휴관인지_(days, k)) return;
      days[k].vols.forEach(v => {
        if (k <= today && v.attend == null) noAtt += 1;
        if (v.attend === 'o' && !v.entered) entry += 1;
      });
    });
    const vols = !closedToday && days[today] ? days[today].vols : [];
    out.volunteer = {
      closedToday, todayN: vols.length, noAtt, entry,
      am: vols.filter(v => v.slot !== '오후').length,
      pm: vols.filter(v => v.slot === '오후').length,
      unchecked: 보드_미확인_(days, today, 보드_날짜더하기_(today, 7)),   // 앞으로 7일 중 1365 명단 미확인 운영일
    };
  }
  if (perm.atelier) out.atelier = 아뜰리에_요약_(today);
  return out;
}

function 보드_json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** 접속 코드로 열 수 있는 보드. 맞는 코드가 없으면 null */
function 보드_권한_(token) {
  const props = PropertiesService.getScriptProperties();
  const t = String(token || '');
  if (!t) return null;
  if (t === props.getProperty('BOARD_TOKEN')) return { volunteer: true, atelier: true };
  if (t === props.getProperty('VOLUNTEER_TOKEN')) return { volunteer: true };
  if (t === props.getProperty('ATELIER_TOKEN')) return { atelier: true };
  return null;
}

function 보드_버전_() {
  return Number(PropertiesService.getScriptProperties().getProperty('BOARD_VERSION') || 0);
}

/* =====================================================
 * 캐시: 판(version)이 바뀌지 않았으면 시트를 다시 읽지 않습니다.
 * 저장하면 판이 올라가서 다음 불러오기 때 한 번 새로 읽어요.
 * ===================================================== */

const 보드_캐시조각 = 30000;   // 한글 기준 값 하나가 100KB를 넘지 않게 나눠 저장

function 보드_캐시_(name, version, read) {
  const cache = CacheService.getScriptCache();
  try {
    const meta = JSON.parse(cache.get(name + '_META') || 'null');
    if (meta && meta.version === version) {
      const keys = [];
      for (let i = 0; i < meta.n; i += 1) keys.push(name + '_' + i);
      const parts = cache.getAll(keys);
      if (keys.every(k => parts[k] != null)) return JSON.parse(keys.map(k => parts[k]).join(''));
    }
  } catch (err) {}
  const value = read();
  try {
    const s = JSON.stringify(value);
    const n = Math.ceil(s.length / 보드_캐시조각) || 1;
    const obj = {};
    obj[name + '_META'] = JSON.stringify({ version, n });
    for (let i = 0; i < n; i += 1) obj[name + '_' + i] = s.slice(i * 보드_캐시조각, (i + 1) * 보드_캐시조각);
    cache.putAll(obj, 21600);
  } catch (err) {}
  return value;
}

/** 라메 명단은 10분 동안 캐시합니다. 라임메이트 탭을 고친 뒤 바로 보려면 보드_캐시비우기 실행 */
function 보드_라메명단_캐시_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('BOARD_LIME');
  if (hit) {
    try { return JSON.parse(hit); } catch (err) {}
  }
  const lime = 보드_라메명단_();
  try { cache.put('BOARD_LIME', JSON.stringify(lime), 600); } catch (err) {}
  return lime;
}

/**
 * 시트의 보드_·아뜰리에_·라임메이트 탭을 직접 고쳤을 때 실행하세요.
 * 판을 올려서, 열려 있는 보드들이 시트 내용을 다시 읽게 합니다.
 */
function 보드_캐시비우기() {
  CacheService.getScriptCache().removeAll(['BOARD_META', 'ATELIER_META', 'CLOSED_META', 'BOARD_LIME']);
  const props = PropertiesService.getScriptProperties();
  ['BOARD_VERSION', 'ATELIER_VERSION'].forEach(k => {
    props.setProperty(k, String(Number(props.getProperty(k) || 0) + 1));
  });
  Logger.log('캐시를 비웠어요. 보드를 새로고침하면 시트 내용이 보여요.');
}

/* =====================================================
 * 시트 읽기 / 쓰기
 * ===================================================== */

function 보드_시트_(name, header) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/**
 * 탭 내용을 rows로 맞춥니다. 시트 쓰기가 가장 느려서, 지금 내용과 비교해 처음 달라지는 줄부터만 다시 씁니다
 * (보통 최근 날짜만 바뀌므로 몇 줄만 씀). 같으면 아무것도 쓰지 않아요.
 */
function 보드_덮어쓰기_(sheet, header, rows) {
  const width = header.length;
  const lastRow = sheet.getLastRow();
  const lastCol = Math.max(width, sheet.getLastColumn());
  const old = lastRow > 0 ? sheet.getRange(1, 1, lastRow, lastCol).getDisplayValues() : [];
  const sameRow = (o, r) => {
    if (!o) return false;
    for (let c = 0; c < lastCol; c += 1) {
      if (String(o[c] == null ? '' : o[c]) !== (c < width ? String(r[c] == null ? '' : r[c]) : '')) return false;
    }
    return true;
  };
  if (!sameRow(old[0], header)) sheet.getRange(1, 1, 1, width).setValues([header]).setFontWeight('bold');
  let first = 0;
  while (first < rows.length && sameRow(old[first + 1], rows[first])) first += 1;
  if (first === rows.length && lastRow - 1 <= rows.length) return;
  if (lastRow >= first + 2) sheet.getRange(first + 2, 1, lastRow - first - 1, lastCol).clearContent();
  if (first < rows.length) {
    const range = sheet.getRange(first + 2, 1, rows.length - first, width);
    range.setNumberFormat('@');   // 날짜·전화번호가 숫자로 바뀌거나 메모가 수식으로 읽히지 않게
    range.setValues(rows.slice(first));
  }
}

function 보드_키_(value) {
  const digits = String(value == null ? '' : value).replace(/[^0-9]/g, '');
  return digits.length === 8 ? digits : '';
}

function 보드_배치코드_(label) {
  const text = String(label || '').trim();
  for (const code in 보드_배치라벨) {
    if (보드_배치라벨[code] === text || code === text) return code;
  }
  return '-';
}

function 보드_불러오기_() {
  const days = {};
  const newDay = () => ({ checked: false, note: '', vols: [] });

  const dateSheet = 보드_시트_(보드CONFIG.날짜탭명, 보드_날짜헤더);
  dateSheet.getDataRange().getDisplayValues().slice(1).forEach(r => {
    const k = 보드_키_(r[0]);
    if (!k) return;
    const d = newDay();
    d.checked = r[1] === '1';
    if (r[2] !== '') d.closed = r[2] === '1';
    if (r[3] !== '') d.rog = r[3] === '1';
    d.note = r[4] || '';
    // 1365 공고별 확인 (예: "ex_am,ex_pm"). 비어 있으면 보드가 명단확인 값으로 채웁니다.
    if (r[5]) {
      d.chk = {};
      String(r[5]).split(',').forEach(c => { c = c.trim(); if (c) d.chk[c] = true; });
    }
    days[k] = d;
  });

  const volSheet = 보드_시트_(보드CONFIG.기록탭명, 보드_기록헤더);
  volSheet.getDataRange().getDisplayValues().slice(1).forEach(r => {
    const k = 보드_키_(r[1]);
    if (!k || !String(r[3]).trim()) return;
    if (!days[k]) days[k] = newDay();
    days[k].vols.push({
      id: r[0] || Utilities.getUuid().slice(0, 7),
      slot: r[2] === '오후' ? '오후' : '오전',
      name: String(r[3]).trim(),
      phone: r[4] || '',
      place: 보드_배치코드_(r[5]),
      rog: r[6] === '1',
      locked: r[7] === '1',
      attend: r[8] === '출석' ? 'o' : r[8] === '결석' ? 'x' : null,
      entered: r[9] === '1',
      memo: r[10] || '',
      we: r[11] === '1',
    });
  });

  return { v: 2, days, settings: 보드_설정읽기_() };
}

function 보드_저장_(state) {
  const days = state.days || {};
  const keys = Object.keys(days).filter(보드_키_).sort();

  const dateRows = keys.map(k => {
    const d = days[k] || {};
    const tri = v => (v === true ? '1' : v === false ? '0' : '');
    const chk = Object.keys(d.chk || {}).filter(c => d.chk[c]).join(',');
    return [k, d.checked ? '1' : '', tri(d.closed), tri(d.rog), d.note || '', chk];
  });

  const volRows = [];
  keys.forEach(k => {
    (days[k].vols || []).forEach(v => {
      volRows.push([
        v.id || '',
        k,
        v.slot === '오후' ? '오후' : '오전',
        String(v.name || '').trim(),
        v.phone || '',
        보드_배치라벨[v.place] || '미정',
        v.rog ? '1' : '',
        v.locked ? '1' : '',
        v.attend === 'o' ? '출석' : v.attend === 'x' ? '결석' : '',
        v.entered ? '1' : '',
        v.memo || '',
        v.we ? '1' : '',
      ]);
    });
  });

  보드_덮어쓰기_(보드_시트_(보드CONFIG.날짜탭명, 보드_날짜헤더), 보드_날짜헤더, dateRows);
  보드_덮어쓰기_(보드_시트_(보드CONFIG.기록탭명, 보드_기록헤더), 보드_기록헤더, volRows);

  // 활동기록부 입력 탭: 결석은 미승인=1 로 넣어서 기존 변환에서 빠지게 합니다.
  const start = 보드_키_(보드CONFIG.기록부반영시작일);
  const inputRows = volRows
    .filter(r => !start || r[1] >= start)
    .map(r => [r[3], r[4], r[1], r[2], r[8] === '결석' ? '1' : '', r[5], r[8]]);
  보드_덮어쓰기_(보드_시트_(보드CONFIG.입력탭명, 보드_입력헤더), 보드_입력헤더, inputRows);

  // 원본 탭이 있으면 결석 표시를 미승인 칸에도 맞춰 둡니다 (실패해도 보드 저장은 그대로)
  try { 보드_원본미승인_(volRows); } catch (err) {}

  const settings = state.settings || {};
  보드_덮어쓰기_(보드_시트_(보드_설정탭명, 보드_설정헤더), 보드_설정헤더,
    Object.keys(settings).sort().map(k => [k, JSON.stringify(settings[k])]));
}

/**
 * 배치 규칙·라메 명단. 예전에는 스크립트 속성(값 하나 약 9KB 한도)에 두었는데, 명단이 길어지면 저장이 실패할 수 있어
 * '보드_설정' 탭으로 옮겼습니다. 탭이 비어 있으면 예전 속성에서 읽어요 (다음 저장 때 탭으로 옮겨짐).
 */
function 보드_설정읽기_() {
  const settings = {};
  보드_시트_(보드_설정탭명, 보드_설정헤더).getDataRange().getDisplayValues().slice(1).forEach(r => {
    if (!r[0]) return;
    try { settings[r[0]] = JSON.parse(r[1]); } catch (err) {}
  });
  if (Object.keys(settings).length) return settings;
  try {
    return JSON.parse(PropertiesService.getScriptProperties().getProperty('BOARD_SETTINGS') || '{}');
  } catch (err) {
    return {};
  }
}

/** 기존 '라임메이트' 탭의 이름 열을 읽습니다. */
function 보드_라메명단_() {
  const tabName = (typeof CONFIG !== 'undefined' && CONFIG.라임메이트탭명) || '라임메이트';
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(tabName);
  if (!sheet) return [];
  const values = sheet.getDataRange().getDisplayValues();
  const nameHeaders = ['이름', '성명', '봉사자성명', '봉사자명'];
  for (let row = 0; row < Math.min(values.length, 20); row += 1) {
    const col = values[row].findIndex(v => nameHeaders.includes(String(v).replace(/\s/g, '')));
    if (col < 0) continue;
    const names = [];
    values.slice(row + 1).forEach(r => {
      const n = String(r[col] || '').replace(/\s+/g, ' ').trim();
      if (n && !names.includes(n)) names.push(n);
    });
    return names;
  }
  return [];
}

/* =====================================================
 * 원본 탭 미승인 표시 (월말 1365 명단)
 * ===================================================== */

/**
 * '원본' 탭(1365에서 받은 명단, 공고마다 '순번 | 봉사자성명 | … | 활동일자 | 시작시간 …' 머리줄이 반복됨)에서
 * 봉사자성명 + 활동일자 + 시작시간(12시 전 = 오전, 이후 = 오후)이 보드와 같은 줄을 찾아
 * 보드에서 결석이면 '미승인' 칸에 1, 출석·미표시면 비웁니다.
 * - '미승인' 머리글이 없으면 머리줄 마지막 칸 다음 열에 만듭니다.
 * - 같은 날·같은 시간대에 이름이 같은 기록이 둘 이상이면 휴대폰 번호로 고릅니다.
 * - 보드에 없는 줄은 손대지 않습니다 (손으로 넣은 미승인 그대로).
 * volRows: '보드_기록' 탭과 같은 모양의 줄들
 */
function 보드_원본미승인_(volRows) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(보드CONFIG.원본탭명);
  if (!sheet || sheet.getLastRow() < 2) return null;
  const layout = 보드_원본구조_(sheet);
  if (!layout) return null;
  const { values, flagCol, headers } = layout;

  const nameKey = n => String(n || '').replace(/\s+/g, '').toLowerCase();
  const digits = p => String(p || '').replace(/[^0-9]/g, '');
  const board = {};
  volRows.forEach(r => {
    const k = 보드_키_(r[1]);
    const name = nameKey(r[3]);
    if (!k || !name) return;
    const key = k + '|' + (r[2] === '오후' ? '오후' : '오전') + '|' + name;
    (board[key] = board[key] || []).push({ name: String(r[3]).trim(), k, slot: r[2], phone: digits(r[4]), absent: r[8] === '결석', used: false });
  });

  const changes = [];   // [행 번호(0부터), 새 값]
  const cell = row => String((values[row] || [])[flagCol] == null ? '' : values[row][flagCol]);
  let cols = null, minK = '', maxK = '', marked = 0, notOnBoard = 0;
  for (let row = 0; row < values.length; row += 1) {
    if (headers[row]) {
      cols = headers[row];
      if (cell(row) !== '미승인') changes.push([row, '미승인']);
      continue;
    }
    if (!cols) continue;
    const r = values[row];
    const k = 보드_키_(r[cols.date]);
    const name = nameKey(r[cols.name]);
    if (!k || !name) continue;
    if (!minK || k < minK) minK = k;
    if (!maxK || k > maxK) maxK = k;
    const hour = parseInt(String(r[cols.time] == null ? '' : r[cols.time]).replace(/[^0-9:]/g, ''), 10);
    const slot = hour >= 12 ? '오후' : '오전';
    const list = board[k + '|' + slot + '|' + name];
    if (!list) { notOnBoard += 1; continue; }
    const phone = cols.phone >= 0 ? digits(r[cols.phone]) : '';
    const free = list.filter(x => !x.used);
    const hit = (phone && free.find(x => x.phone === phone)) || free[0] || list[0];
    hit.used = true;
    const want = hit.absent ? '1' : '';
    if (hit.absent) marked += 1;
    if (cell(row) !== want) changes.push([row, want]);
  }

  changes.forEach(([row, v]) => sheet.getRange(row + 1, flagCol + 1).setValue(v === '1' ? 1 : v));

  // 보드에는 결석인데 원본 명단(같은 기간)에 없는 사람
  const missing = [];
  Object.keys(board).forEach(key => board[key].forEach(x => {
    if (x.absent && !x.used && x.k >= minK && x.k <= maxK) missing.push(x.name + ' ' + x.k.slice(4, 6) + '/' + x.k.slice(6) + ' ' + x.slot);
  }));
  return { marked, changed: changes.length, notOnBoard, missing };
}

/** 원본 탭의 머리줄 위치와 열, 미승인 열(0부터)을 찾습니다. 머리줄이 하나도 없으면 null */
function 보드_원본구조_(sheet) {
  const values = sheet.getDataRange().getDisplayValues();
  const headers = {};
  let flagCol = -1, lastCol = -1;
  values.forEach((r, row) => {
    const h = r.map(v => String(v).replace(/\s/g, ''));
    const name = h.indexOf('봉사자성명'), date = h.indexOf('활동일자'), time = h.indexOf('시작시간');
    if (name < 0 || date < 0 || time < 0) return;
    headers[row] = { name, date, time, phone: h.indexOf('휴대폰') };
    const f = h.indexOf('미승인');
    if (f >= 0 && flagCol < 0) flagCol = f;
    h.forEach((v, c) => { if (v && v !== '미승인' && c > lastCol) lastCol = c; });
  });
  if (lastCol < 0) return null;
  return { values, headers, flagCol: flagCol >= 0 ? flagCol : lastCol + 1 };
}

function 보드_원본결과문구_(res) {
  if (!res) return "'" + 보드CONFIG.원본탭명 + "' 탭에서 봉사자성명·활동일자·시작시간 머리줄을 찾지 못했어요.";
  let msg = '미승인 ' + res.marked + '명 표시';
  if (res.notOnBoard) msg += ' · 보드에 없는 줄 ' + res.notOnBoard + '개 (그대로 둠)';
  if (res.missing.length) msg += ' · 보드엔 결석인데 원본에 없음: ' + res.missing.join(', ');
  return msg;
}

/** 편집기에서 직접 실행해도 됩니다. 보드_기록 탭의 결석으로 원본 탭 미승인 칸을 채웁니다. */
function 보드_원본미승인표시() {
  const rows = 보드_시트_(보드CONFIG.기록탭명, 보드_기록헤더).getDataRange().getDisplayValues().slice(1);
  const msg = 보드_원본결과문구_(보드_원본미승인_(rows));
  Logger.log(msg);
  try { SpreadsheetApp.getActiveSpreadsheet().toast(msg, '미승인 표시', 10); } catch (err) {}
}

/** 원본 탭을 고치거나 붙여넣으면 자동으로 실행됩니다 (보드_알림설치가 예약). 미승인 칸만 손으로 고친 건 건드리지 않아요. */
function 보드_원본바뀜(e) {
  const range = e && e.range;
  if (!range || range.getSheet().getName() !== 보드CONFIG.원본탭명) return;
  if (range.getNumColumns() === 1) {
    const layout = 보드_원본구조_(range.getSheet());
    if (layout && layout.flagCol + 1 === range.getColumn()) return;
  }
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return;
  try {
    보드_원본미승인표시();
  } finally {
    lock.releaseLock();
  }
}

/* =====================================================
 * 설치 · 알림
 * ===================================================== */

/** 처음 한 번 실행: 탭 만들기, 접속 코드 만들기, 알림 예약 */
function 보드_설치() {
  const props = PropertiesService.getScriptProperties();
  let token = props.getProperty('BOARD_TOKEN');
  if (!token) {
    token = Utilities.getUuid().replace(/-/g, '').slice(0, 10);
    props.setProperty('BOARD_TOKEN', token);
  }
  if (!props.getProperty('BOARD_VERSION')) props.setProperty('BOARD_VERSION', '0');
  if (!props.getProperty('ATELIER_VERSION')) props.setProperty('ATELIER_VERSION', '0');

  보드_시트_(보드CONFIG.기록탭명, 보드_기록헤더);
  보드_시트_(보드CONFIG.날짜탭명, 보드_날짜헤더);
  보드_시트_(보드CONFIG.입력탭명, 보드_입력헤더);
  보드_시트_(보드_설정탭명, 보드_설정헤더);
  아뜰리에_탭만들기_();
  보드_알림설치();

  Logger.log('설치 완료. 보드 접속 코드: ' + token);
}

/**
 * 보드의 '연결 링크 복사'가 부릅니다. 전체 코드로 물으면 보드별 전용 코드를 알려 주고(없으면 만듦),
 * 전용 코드로 물으면 그 코드가 열 수 있는 보드만 알려 줍니다.
 */
function 보드_공유코드_(token) {
  const props = PropertiesService.getScriptProperties();
  const scope = Object.keys(보드_권한_(token) || {});
  if (String(token || '') !== props.getProperty('BOARD_TOKEN')) return { ok: true, full: false, scope };
  const out = { ok: true, full: true, scope };
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    [['volunteer', 'VOLUNTEER_TOKEN'], ['atelier', 'ATELIER_TOKEN']].forEach(([board, key]) => {
      let t = props.getProperty(key);
      if (!t) { t = 보드_새코드_(); props.setProperty(key, t); }
      out[board] = t;
    });
  } finally {
    lock.releaseLock();
  }
  return out;
}

function 보드_새코드_() {
  return Utilities.getUuid().replace(/-/g, '').slice(0, 10);
}

/** 전체 접속 코드(두 보드 모두)를 새로 만듭니다 (코드가 새어 나갔을 때). 보드에서 새 코드로 다시 연결하세요. */
function 보드_접속코드바꾸기() {
  보드_코드만들기_('BOARD_TOKEN', '전체(두 보드)', '');
}

/** 자원봉사 보드만 열 수 있는 코드. 다시 실행하면 새 코드로 바뀌고 예전 코드는 막힙니다. */
function 보드_접속코드_자원봉사만() {
  보드_코드만들기_('VOLUNTEER_TOKEN', '자원봉사 보드 전용', 'volunteer/');
}

/** 아뜰리에 관리 보드만 열 수 있는 코드. 다시 실행하면 새 코드로 바뀌고 예전 코드는 막힙니다. */
function 보드_접속코드_아뜰리에만() {
  보드_코드만들기_('ATELIER_TOKEN', '아뜰리에 보드 전용', 'atelier/');
}

/** 보드별 코드를 없앱니다 (그 코드로는 더 이상 못 엶). */
function 보드_보드별코드_모두없애기() {
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty('VOLUNTEER_TOKEN');
  props.deleteProperty('ATELIER_TOKEN');
  Logger.log('보드별 접속 코드를 없앴어요. 전체 코드만 남아 있어요.');
}

function 보드_코드만들기_(key, label, path) {
  const token = 보드_새코드_();
  PropertiesService.getScriptProperties().setProperty(key, token);
  Logger.log(label + ' 접속 코드: ' + token);
  // 보드주소가 있으면 바로 공유할 수 있는 연결 링크도 만들어 줍니다
  let url = '';
  try { url = ScriptApp.getService().getUrl() || ''; } catch (err) {}
  if (보드CONFIG.보드주소 && /\/exec$/.test(url)) {
    Logger.log('연결 링크: ' + 보드CONFIG.보드주소.replace(/\/?$/, '/') + path + '#c=' + encodeURIComponent(url) + '&t=' + token);
    Logger.log('(링크의 웹앱 주소가 보드에서 쓰는 주소와 같은지 한 번 확인하세요)');
  } else {
    Logger.log('이 코드로 연결한 기기에서 "연결 링크 복사"를 누르면 공유용 링크가 만들어져요.');
  }
}

function 보드_알림설치() {
  const handlers = ['보드_알림_주말', '보드_알림_저녁', '아뜰리에_알림_아침', '보드_원본바뀜'];
  ScriptApp.getProjectTriggers().forEach(t => {
    if (handlers.includes(t.getHandlerFunction())) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('보드_알림_주말').timeBased().everyWeeks(1)
    .onWeekDay(보드CONFIG.주말알림요일).atHour(보드CONFIG.주말알림시).create();
  ScriptApp.newTrigger('보드_알림_저녁').timeBased().everyDays(1)
    .atHour(보드CONFIG.저녁알림시).create();
  ScriptApp.newTrigger('아뜰리에_알림_아침').timeBased().everyDays(1)
    .atHour(보드CONFIG.아뜰리에알림시).create();
  // 원본 탭에 명단을 붙여넣으면 미승인 칸을 채웁니다
  ScriptApp.newTrigger('보드_원본바뀜').forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet()).onEdit().create();
}

function 보드_오늘_() {
  return Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyyMMdd');
}

// 시간대 설정과 상관없이 날짜 계산이 맞도록 UTC로 계산합니다.
function 보드_날짜더하기_(k, n) {
  const d = new Date(Date.UTC(Number(k.slice(0, 4)), Number(k.slice(4, 6)) - 1, Number(k.slice(6, 8)) + n));
  const p = x => (x < 10 ? '0' : '') + x;
  return d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate());
}

function 보드_요일_(k) {
  return new Date(Date.UTC(Number(k.slice(0, 4)), Number(k.slice(4, 6)) - 1, Number(k.slice(6, 8)))).getUTCDay();
}

function 보드_표시_(k) {
  return Number(k.slice(4, 6)) + '/' + Number(k.slice(6, 8)) + ' (' + 보드_요일[보드_요일_(k)] + ')';
}

function 보드_휴관인지_(days, k) {
  const d = days[k];
  if (d && typeof d.closed === 'boolean') return d.closed;
  return 보드_요일_(k) === 1;
}

function 보드_미확인_(days, from, to) {
  const out = [];
  for (let k = from; k <= to; k = 보드_날짜더하기_(k, 1)) {
    if (!보드_휴관인지_(days, k) && !(days[k] && days[k].checked)) out.push(k);
  }
  return out;
}

function 보드_메일_(subject, lines, prefix, path) {
  const to = 보드CONFIG.알림받을메일 || Session.getEffectiveUser().getEmail();
  const base = 보드CONFIG.보드주소 ? 보드CONFIG.보드주소.replace(/\/?$/, '/') : '';
  const link = base ? '\n\n열기: ' + base + (path == null ? 'volunteer/' : path) : '';
  MailApp.sendEmail(to, (prefix || '[RAIM 봉사]') + ' ' + subject, lines.join('\n') + link);
}

/** 금요일 오후: 앞으로 7일 중 1365 명단을 아직 안 본 운영일 */
function 보드_알림_주말() {
  const days = 보드_불러오기_().days;
  const today = 보드_오늘_();
  const list = 보드_미확인_(days, 보드_날짜더하기_(today, 1), 보드_날짜더하기_(today, 7));
  if (!list.length) return;
  보드_메일_('1365 명단 확인 필요 ' + list.length + '일', [
    '아직 1365 명단을 확인하지 않은 운영일이에요.',
    '',
  ].concat(list.map(k => '- ' + 보드_표시_(k) + ([0, 6].includes(보드_요일_(k)) ? '  ← 주말' : ''))));
}

/** 매일 저녁: 오늘 출석 미표시, 1365 실적 입력 대기, 가까운 날 명단 미확인 */
function 보드_알림_저녁() {
  const days = 보드_불러오기_().days;
  const today = 보드_오늘_();
  const lines = [];

  const todayVols = (days[today] && !보드_휴관인지_(days, today)) ? days[today].vols : [];
  const noAttend = todayVols.filter(v => v.attend == null);
  if (noAttend.length) {
    lines.push('■ 오늘 출석 표시 안 됨 ' + noAttend.length + '명');
    noAttend.forEach(v => lines.push('- ' + v.name + ' (' + v.slot + ')'));
    lines.push('');
  }

  const backlog = [];
  Object.keys(days).sort().forEach(k => {
    if (k > today) return;
    const n = days[k].vols.filter(v => v.attend === 'o' && !v.entered).length;
    if (n) backlog.push('- ' + 보드_표시_(k) + ' ' + n + '명');
  });
  if (backlog.length) {
    lines.push('■ 1365 실적 입력 대기');
    lines.push.apply(lines, backlog);
    lines.push('');
  }

  const soon = 보드_미확인_(days, 보드_날짜더하기_(today, 1), 보드_날짜더하기_(today, 2));
  if (soon.length) {
    lines.push('■ 이틀 안에 있는데 명단 미확인');
    soon.forEach(k => lines.push('- ' + 보드_표시_(k)));
  }

  if (lines.length) 보드_메일_('오늘 마무리할 일', lines);
}
