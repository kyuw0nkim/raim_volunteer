/**
 * RAIM 업무 대시보드 — 아뜰리에 관리 보드 ↔ 스프레드시트
 *
 * 보드.gs 와 같은 프로젝트에 넣습니다. 웹앱 주소·접속 코드는 자원봉사 보드와 같고,
 * 보드가 board=atelier 로 요청하면 doGet/doPost(보드.gs)가 여기 함수를 부릅니다.
 *
 * 탭은 모두 '아뜰리에_'로 시작하고, 한 줄 = 한 건이라 시트에서 바로 읽을 수 있습니다.
 * 시트를 직접 고쳐도 되지만, 보드에서 저장하면 보드 내용으로 덮어씁니다.
 */

const 아뜰리에_탭 = {
  tasks: { tab: '아뜰리에_업무', cols: [
    ['id', 'id'], ['업무', 'name'], ['종류', 'type'], ['주기(일)', 'every'], ['알림(일)', 'warn'],
    ['방법', 'guide'], ['연결', 'link'], ['필요표시일', 'flagDate'], ['필요표시자', 'flagBy'], ['필요메모', 'flagMemo'],
    ['제안미룸', 'snooze'],
  ] },
  logs: { tab: '아뜰리에_업무기록', cols: [
    ['id', 'id'], ['날짜', 'date'], ['업무id', 'task'], ['업무', 'taskName'], ['한 사람', 'by'], ['메모', 'memo'],
  ] },
  items: { tab: '아뜰리에_재고', cols: [
    ['id', 'id'], ['품목', 'name'], ['단위', 'unit'], ['수량', 'qty'], ['부족 기준', 'min'], ['위치', 'place'],
    ['확인일', 'date'], ['확인자', 'by'],
  ] },
  stockLogs: { tab: '아뜰리에_재고기록', cols: [
    ['id', 'id'], ['날짜', 'date'], ['품목id', 'item'], ['품목', 'itemName'], ['수량', 'qty'], ['확인자', 'by'], ['메모', 'memo'],
  ] },
  issues: { tab: '아뜰리에_장비이슈', cols: [
    ['id', 'id'], ['등록일', 'date'], ['장비', 'equip'], ['내용', 'text'], ['등록자', 'by'], ['상태', 'status'],
    ['처리일', 'doneDate'], ['처리자', 'doneBy'], ['처리 내용', 'doneNote'],
  ] },
  checkItems: { tab: '아뜰리에_점검항목', cols: [
    ['구분', 'kind'], ['항목', 'label'],
  ] },
  checks: { tab: '아뜰리에_점검기록', cols: [
    ['날짜', 'date'], ['구분', 'kind'], ['항목', 'label'], ['한 사람', 'by'], ['시각', 'time'],
  ] },
};

function 아뜰리에_버전_() {
  return Number(PropertiesService.getScriptProperties().getProperty('ATELIER_VERSION') || 0);
}

function 아뜰리에_헤더_(def) {
  return def.cols.map(c => c[0]);
}

function 아뜰리에_탭만들기_() {
  Object.keys(아뜰리에_탭).forEach(key => {
    const def = 아뜰리에_탭[key];
    보드_시트_(def.tab, 아뜰리에_헤더_(def));
  });
}

function 아뜰리에_읽기_(def) {
  const sheet = 보드_시트_(def.tab, 아뜰리에_헤더_(def));
  const values = sheet.getDataRange().getDisplayValues();
  const header = values[0] || [];
  // 열 순서가 바뀌어도 헤더 이름으로 찾습니다.
  const idx = def.cols.map(c => header.indexOf(c[0]));
  return values.slice(1)
    .filter(r => r.some(v => String(v).trim() !== ''))
    .map(r => {
      const o = {};
      def.cols.forEach((c, i) => { o[c[1]] = idx[i] >= 0 ? String(r[idx[i]]) : ''; });
      return o;
    });
}

function 아뜰리에_쓰기_(def, list) {
  const header = 아뜰리에_헤더_(def);
  const rows = (list || []).map(o => def.cols.map(c => (o[c[1]] == null ? '' : String(o[c[1]]))));
  보드_덮어쓰기_(보드_시트_(def.tab, header), header, rows);
}

function 아뜰리에_불러오기_() {
  const state = {};
  Object.keys(아뜰리에_탭).forEach(key => { state[key] = 아뜰리에_읽기_(아뜰리에_탭[key]); });
  state.seeded = PropertiesService.getScriptProperties().getProperty('ATELIER_SEEDED') === '1';
  return state;
}

function 아뜰리에_저장_(state) {
  Object.keys(아뜰리에_탭).forEach(key => 아뜰리에_쓰기_(아뜰리에_탭[key], state[key]));
  if (state.seeded) PropertiesService.getScriptProperties().setProperty('ATELIER_SEEDED', '1');
}

/** 자원봉사 보드에서 날짜별로 휴관을 켜고 끈 것 ({yyyymmdd: true/false}). 없으면 월요일 휴관. */
function 아뜰리에_휴관지정_() {
  const out = {};
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(보드CONFIG.날짜탭명);
  if (!sheet) return out;
  sheet.getDataRange().getDisplayValues().slice(1).forEach(r => {
    const k = 보드_키_(r[0]);
    if (k && r[2] !== '') out[k] = r[2] === '1';
  });
  return out;
}

function 아뜰리에_휴관인지_(closed, k) {
  if (typeof closed[k] === 'boolean') return closed[k];
  return 보드_요일_(k) === 1;
}

/** 마지막으로 한 날 + 주기. 휴관일이면 다음 운영일로. 기록이 없으면 오늘. */
function 아뜰리에_다음예정_(task, logs, closed, today) {
  const done = logs.filter(l => l.task === task.id).map(l => l.date).sort();
  const last = done.length ? done[done.length - 1] : '';
  let due = last ? 보드_날짜더하기_(last, Number(task.every) || 7) : today;
  for (let i = 0; i < 14 && 아뜰리에_휴관인지_(closed, due); i += 1) due = 보드_날짜더하기_(due, 1);
  return { last, due };
}

function 아뜰리에_지난일수_(from, to) {
  const t = k => Date.UTC(Number(k.slice(0, 4)), Number(k.slice(4, 6)) - 1, Number(k.slice(6, 8)));
  return Math.round((t(to) - t(from)) / 86400000);
}

/** 매일 아침(운영일): 오늘까지 해야 하는 주기 업무, 필요 표시된 업무, 제안 업무, 재고 부족, 미해결 장비 이슈 */
function 아뜰리에_알림_아침() {
  const today = 보드_오늘_();
  const closed = 아뜰리에_휴관지정_();
  if (아뜰리에_휴관인지_(closed, today)) return;
  const s = 아뜰리에_불러오기_();
  const lines = [];

  const due = [];
  const flagged = [];
  const suggested = [];
  s.tasks.forEach(t => {
    if (t.flagDate) flagged.push('- ' + t.name + ' (' + (t.flagBy || '') + (t.flagMemo ? ': ' + t.flagMemo : '') + ')');
    if (t.type !== '주기') {
      // 필요시 업무: '제안(일)'만큼 안 했으면 제안. '나중에'로 미뤘으면 그날까지 빼기
      const warn = Number(t.warn);
      if (t.flagDate || !t.warn || !warn || (t.snooze && t.snooze > today)) return;
      const last = s.logs.filter(l => l.task === t.id).map(l => l.date).sort().pop() || '';
      if (last === today) return;
      const since = last ? 아뜰리에_지난일수_(last, today) : null;
      if (since == null || since >= warn) suggested.push('- ' + t.name + (since == null ? ' (기록 없음)' : ' (마지막 ' + since + '일 전)'));
      return;
    }
    const n = 아뜰리에_다음예정_(t, s.logs, closed, today);
    if (n.due <= today) {
      const late = 아뜰리에_지난일수_(n.due, today);
      due.push('- ' + t.name + (late > 0 ? '  ← ' + late + '일 지남' : '  (오늘)'));
    }
  });
  if (due.length) { lines.push('■ 오늘 할 루틴 업무'); lines.push.apply(lines, due); lines.push(''); }
  if (flagged.length) { lines.push('■ 필요하다고 표시된 업무'); lines.push.apply(lines, flagged); lines.push(''); }
  if (suggested.length) { lines.push('■ 제안 업무 (필요해 보이면 보드에서 ‘필요해요’)'); lines.push.apply(lines, suggested); lines.push(''); }

  const low = s.items.filter(i => i.min !== '' && Number(i.qty) <= Number(i.min));
  if (low.length) {
    lines.push('■ 재고 부족');
    low.forEach(i => lines.push('- ' + i.name + ' ' + i.qty + (i.unit || '') + ' (기준 ' + i.min + ')'));
    lines.push('');
  }

  const open = s.issues.filter(i => i.status !== '해결');
  if (open.length) {
    lines.push('■ 해결 안 된 장비 이슈');
    open.forEach(i => lines.push('- ' + (i.equip ? '[' + i.equip + '] ' : '') + i.text + ' (' + 보드_표시_(i.date) + ')'));
  }

  if (lines.length) 보드_메일_('오늘 할 일', lines, '[RAIM 아뜰리에]', 'atelier/');
}
