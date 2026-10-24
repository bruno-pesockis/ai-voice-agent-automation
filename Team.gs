// ===== Team.gs — колеры: закрепление клиник, история звонков (Log), утренняя сводка =====
// ID таблицы (TM_SHEET_ID) и имена колеров (TM_CALLERS) хранятся в Script Properties, а не в коде.
const TM_COL = 18;            // столбец R — «Колер»
const TM_TZ = 'Europe/Riga';

// Открыть таблицу колеров по ID из Script Properties.
function tmSs_() {
  const id = PropertiesService.getScriptProperties().getProperty('TM_SHEET_ID');
  if (!id) throw new Error('Script Property TM_SHEET_ID is not set (Project Settings → Script Properties).');
  return SpreadsheetApp.openById(id);
}

// Имена колеров из Script Properties (ключ TM_CALLERS, через запятую), как они стоят в столбце R таблицы.
function tmCallers_() {
  const raw = PropertiesService.getScriptProperties().getProperty('TM_CALLERS') || '';
  const list = raw.split(',').map(function (x) { return x.trim(); }).filter(String);
  if (!list.length) throw new Error('Script Property TM_CALLERS is not set (comma-separated caller names, e.g. "Anna, Ben").');
  return list;
}

// ---------- запустить ОДИН раз ----------
function teamSetup() {
  const ss = tmSs_();
  const sh = ss.getSheetByName('Calls');
  sh.getRange(1, TM_COL).setValue('Колер').setFontWeight('bold');

  let lg = ss.getSheetByName('Log');
  if (!lg) {
    lg = ss.insertSheet('Log');
    lg.appendRow(['Когда (Рига)', 'Клиника', 'Телефон', 'Колер', 'Звонок №', 'Кто ответил', 'Итог', 'ЛПР', 'Email', 'Перезвон', 'Заметка']);
    lg.getRange(1, 1, 1, 11).setFontWeight('bold');
    lg.setFrozenRows(1);
  }

  const n = teamAssign_(true);
  teamWatch_(false); // запомнить текущее состояние, в Log пока ничего не пишем

  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['teamWatch', 'teamDaily'].indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('teamWatch').timeBased().everyMinutes(10).create();
  ScriptApp.newTrigger('teamDaily').timeBased().atHour(8).nearMinute(0).everyDays(1).inTimezone(TM_TZ).create();

  const msg = '👥 Колеры настроены: закреплено клиник ' + n + '. История звонков пишется в лист Log, сводка каждый день в 8:00 по Риге.';
  console.log(msg);
  try { const o = nbProp_('NB_OWNER_CHAT'); if (o) nbSend_(o, msg); } catch (e) {}
}

// ---------- закрепление клиник за колерами ----------
// first=true: уже прозвоненные — первому колеру, остальные пополам по строкам.
// first=false: новые строки без колера — тому, у кого меньше непрозвоненных.
function teamAssign_(first) {
  const sh = tmSs_().getSheetByName('Calls');
  const last = sh.getLastRow();
  if (last < 2) return 0;
  const callers = tmCallers_();
  const v = sh.getRange(2, 1, last - 1, TM_COL).getValues();
  const col = sh.getRange(2, TM_COL, last - 1, 1).getValues();
  const called = function (r) { return [3, 4, 5].some(function (c) { return String(r[c]).trim() !== ''; }); };
  let changed = 0;

  if (first) {
    const free = [];
    v.forEach(function (r, i) {
      if (String(col[i][0]).trim() || !String(r[1]).trim()) return;
      if (called(r)) { col[i][0] = callers[0]; changed++; } else free.push(i);
    });
    // поровну между колерами, подряд идущими блоками строк
    free.forEach(function (i, k) { col[i][0] = callers[Math.floor(k * callers.length / free.length)]; changed++; });
  } else {
    const load = {};
    callers.forEach(function (c) { load[c] = 0; });
    v.forEach(function (r, i) { const c = String(col[i][0]).trim(); if (c in load && !called(r)) load[c]++; });
    v.forEach(function (r, i) {
      if (String(col[i][0]).trim() || !String(r[1]).trim()) return;
      const who = callers.slice().sort(function (a, b) { return load[a] - load[b]; })[0];
      col[i][0] = who; load[who]++; changed++;
    });
  }
  if (changed) sh.getRange(2, TM_COL, last - 1, 1).setValues(col);
  return changed;
}

// ---------- каждые 10 минут: новые клиники получают колера, изменения звонков пишутся в Log ----------
function teamWatch() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return;
  try { teamAssign_(false); teamWatch_(true); } finally { lock.releaseLock(); }
}

function teamWatch_(write) {
  const ss = tmSs_();
  const sh = ss.getSheetByName('Calls');
  const last = sh.getLastRow();
  if (last < 2) return;
  const v = sh.getRange(2, 1, last - 1, TM_COL).getValues();

  // состояние храним на скрытом листе: в свойствах скрипта 500 клиник не помещаются
  let st = ss.getSheetByName('TM_State');
  const fresh = !st;
  if (!st) { st = ss.insertSheet('TM_State'); st.hideSheet(); }
  const state = {};
  if (st.getLastRow() > 0) st.getRange(1, 1, st.getLastRow(), 2).getValues()
    .forEach(function (r) { if (r[0] !== '') state[String(r[0])] = String(r[1]); });

  // строки с одним номером (дубли) обрабатываем вместе, иначе они «меняются» на каждом запуске
  const groups = {};
  v.forEach(function (r) {
    const key = String(r[2]).replace(/\D/g, '').slice(-10);
    if (!key) return;
    (groups[key] = groups[key] || []).push(r);
  });
  const SEP = ' ¦ ';
  const sigOf = function (r) { return [r[3], r[5], r[8]].map(function (x) { return String(x).trim(); }).join('|'); }; // D, F, I

  const out = [];
  const now = Utilities.formatDate(new Date(), TM_TZ, 'yyyy-MM-dd HH:mm');
  Object.keys(groups).forEach(function (key) {
    const rows = groups[key];
    const sigs = rows.map(sigOf);
    const joined = sigs.slice().sort().join(SEP);
    if (state[key] === joined) return;
    const before = (state[key] || '').split(SEP);
    state[key] = joined;
    if (!write || fresh) return;
    rows.forEach(function (r, i) {
      if (before.indexOf(sigs[i]) >= 0) return;                         // эта строка не менялась
      if (String(r[3]).trim() === '' && String(r[5]).trim() === '') return; // звонка ещё не было
      out.push([now, r[1], r[2], r[TM_COL - 1], r[3], r[4], r[5], r[6], r[7], r[8], r[10]]);
    });
  });

  const keys = Object.keys(state);
  st.clearContents();
  if (keys.length) st.getRange(1, 1, keys.length, 2).setNumberFormat('@')
    .setValues(keys.map(function (k) { return [k, state[k]]; }));
  if (out.length) {
    const lg = ss.getSheetByName('Log');
    lg.getRange(lg.getLastRow() + 1, 1, out.length, 11).setValues(out);
  }
}

// ---------- запустить ОДИН раз после исправления: чистит Log от повторов и показывает дубли в Calls ----------
function teamFixLog() {
  const ss = tmSs_();
  const lg = ss.getSheetByName('Log');
  let removed = 0, kept = 0;
  if (lg && lg.getLastRow() > 1) {
    const rows = lg.getRange(2, 1, lg.getLastRow() - 1, 11).getValues();
    const seen = {};
    const keep = rows.filter(function (r) {
      const k = r.slice(1).map(function (x) { return String(x).trim(); }).join('|'); // всё, кроме времени
      if (seen[k]) return false;
      seen[k] = true; return true;
    });
    removed = rows.length - keep.length; kept = keep.length;
    lg.getRange(2, 1, rows.length, 11).clearContent();
    if (keep.length) lg.getRange(2, 1, keep.length, 11).setValues(keep);
  }
  // пересчитать состояние без записи в Log
  const st = ss.getSheetByName('TM_State');
  if (st) st.clearContents();
  teamWatch_(false);

  // дубли номеров в Calls
  const sh = ss.getSheetByName('Calls');
  const v = sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues();
  const pos = {};
  v.forEach(function (r, i) {
    const key = String(r[2]).replace(/\D/g, '').slice(-10);
    if (key) (pos[key] = pos[key] || []).push({ row: i + 2, name: r[1] });
  });
  const dup = Object.keys(pos).filter(function (k) { return pos[k].length > 1; })
    .map(function (k) { return '• ' + pos[k][0].name + ': строки ' + pos[k].map(function (p) { return p.row; }).join(', '); });

  const msg = '🧽 Log почищен: убрано повторов ' + removed + ', осталось настоящих записей ' + kept + '.\n' +
    (dup.length ? 'Дубли в Calls (одинаковый номер), удали лишнюю строку — ту, где нет данных о звонках:\n' + dup.join('\n')
                : 'Дублей в Calls нет.');
  console.log(msg);
  try { const o = nbProp_('NB_OWNER_CHAT'); if (o) nbSend_(o, msg); } catch (e) {}
}

// ---------- дубли в Calls: сливаем в одну строку ----------
// Главная строка — та, где номер звонка (D) больше; при равенстве — где дата (A) позже.
// Пустые поля главной строки заполняются из старой, заметки (K) склеиваются, старая строка удаляется.
// Запустить ОДИН раз: сливает дубли сейчас и ставит ночную проверку в 3:00 по Риге.
function teamDedupeSetup() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'teamDedupe') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('teamDedupe').timeBased().atHour(3).nearMinute(0).everyDays(1).inTimezone(TM_TZ).create();
  teamDedupe();
}

function teamDedupe() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;
  try {
    const ss = tmSs_();
    const sh = ss.getSheetByName('Calls');
    const last = sh.getLastRow();
    if (last < 2) return;
    const W = TM_COL; // A..R
    const v = sh.getRange(2, 1, last - 1, W).getValues();

    const groups = {};
    v.forEach(function (r, i) {
      const key = String(r[2]).replace(/\D/g, '').slice(-10);
      if (key) (groups[key] = groups[key] || []).push(i);
    });
    const dupKeys = Object.keys(groups).filter(function (k) { return groups[k].length > 1; });
    if (!dupKeys.length) return;

    const stamp = Utilities.formatDate(new Date(), TM_TZ, 'dd.MM HH:mm');
    sh.copyTo(ss).setName('Calls before merge ' + stamp);

    const num = function (x) { const n = Number(String(x).replace(/\D/g, '')); return isNaN(n) ? 0 : n; };
    const time = function (x) { return x instanceof Date ? x.getTime() : 0; };
    const toDelete = [];
    const report = [];

    dupKeys.forEach(function (k) {
      const idx = groups[k].slice().sort(function (a, b) {
        return num(v[b][3]) - num(v[a][3]) || time(v[b][0]) - time(v[a][0]) || b - a;
      });
      const main = idx[0];
      const row = v[main].slice();
      idx.slice(1).forEach(function (o) {
        const old = v[o];
        for (let c = 0; c < W; c++) {
          if (c === 10) { // K — заметки: старая + новая
            row[c] = nbJoin_(old[c], row[c]);
          } else if (String(row[c]).trim() === '' && String(old[c]).trim() !== '') {
            row[c] = old[c];
          }
        }
        if (num(old[3]) > num(row[3])) row[3] = old[3];
        toDelete.push(o + 2);
      });
      sh.getRange(main + 2, 1, 1, W).setValues([row]);
      report.push('• ' + row[1] + ': оставлена строка ' + (main + 2) + ', удалены ' +
        idx.slice(1).map(function (o) { return o + 2; }).join(', '));
    });

    toDelete.sort(function (a, b) { return b - a; }).forEach(function (r) { sh.deleteRow(r); });

    // номера строк сдвинулись — пересчитать состояние Log без записи
    const st = ss.getSheetByName('TM_State');
    if (st) st.clearContents();
    teamWatch_(false);

    const msg = '🔗 Дубли в Calls объединены (' + dupKeys.length + '):\n' + report.join('\n') +
      '\nНомера строк ниже удалённых сдвинулись. Копия до слияния: лист «Calls before merge ' + stamp + '».';
    console.log(msg);
    try { const o = nbProp_('NB_OWNER_CHAT'); if (o) nbSend_(o, msg); } catch (e) {}
  } finally { lock.releaseLock(); }
}

// ---------- каждый день в 8:00 по Риге: сводка за вчера ----------
function teamDaily() {
  const ss = tmSs_();
  const lg = ss.getSheetByName('Log');
  if (!lg || lg.getLastRow() < 2) return;
  const y = new Date(Date.now() - 24 * 3600 * 1000);
  const day = Utilities.formatDate(y, TM_TZ, 'yyyy-MM-dd');
  const rows = lg.getRange(2, 1, lg.getLastRow() - 1, 11).getValues()
    .filter(function (r) { return String(r[0]).indexOf(day) === 0 ||
      (r[0] instanceof Date && Utilities.formatDate(r[0], TM_TZ, 'yyyy-MM-dd') === day); });

  const NO_TALK = ['VOICEMAIL', 'NO ANSWER', 'CLOSED'];
  const GOOD = ['CALLBACK BOOKED', 'EMAIL ONLY', 'TRIAL YES', 'SETUP CALL BOOKED', 'SEND INFO'];
  const by = {};
  rows.forEach(function (r) {
    const c = String(r[3]).trim() || '(без колера)';
    const s = by[c] || (by[c] = { calls: 0, talk: 0, good: 0, email: 0, yes: 0, res: {} });
    const res = String(r[6]).trim().toUpperCase();
    s.calls++;
    const who = String(r[5]).trim().toLowerCase();
    const talked = res && NO_TALK.indexOf(res) < 0 && who !== '' && who.indexOf('voicemail') < 0;
    if (talked) s.talk++;
    if (GOOD.indexOf(res) >= 0) s.good++;
    if (/@/.test(String(r[8]))) s.email++;
    if (res === 'TRIAL YES') s.yes++;
    if (res) s.res[res] = (s.res[res] || 0) + 1;
  });

  const pct = function (a, b) { return b ? Math.round(a * 100 / b) + '%' : '—'; };
  const lines = ['📊 Колеры за ' + Utilities.formatDate(y, TM_TZ, 'dd.MM') + ' (по Риге)'];
  if (!rows.length) lines.push('Звонков в истории нет.');
  Object.keys(by).sort().forEach(function (c) {
    const s = by[c];
    lines.push('');
    lines.push('👤 ' + c);
    lines.push('Звонков: ' + s.calls + ' · ответил живой человек: ' + s.talk + ' (' + pct(s.talk, s.calls) + ')');
    lines.push('Шаг вперёд (перезвон, email, отправить инфо, неделя): ' + s.good + ' (' + pct(s.good, s.talk) + ' от живых разговоров)');
    lines.push('Email получено: ' + s.email + (s.yes ? ' · 🎉 Согласились на неделю: ' + s.yes : ''));
    lines.push(Object.keys(s.res).sort(function (a, b) { return s.res[b] - s.res[a]; })
      .map(function (k) { return k + ' ' + s.res[k]; }).join(' · '));
  });
  const msg = lines.join('\n');
  console.log(msg);
  const o = nbProp_('NB_OWNER_CHAT');
  if (o) nbSend_(o, msg);
}
