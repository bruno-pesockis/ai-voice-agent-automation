// ===== Notebook.gs — тетрадь колера → Calls, письма через Gemini с кнопкой «Отправить» =====
// Все приватные значения (ID таблицы, токен бота, chat id, ключ Gemini, имена, телефон, подпись)
// хранятся в Script Properties, а не в коде. Список — в README.
const NB_SHEET = 'Calls';
const NB_TZ = 'America/New_York';
const NB_MODEL = 'gemini-flash-latest';
const NB_YELLOW = '#fff2cc';
const NB_WHO = ['Front desk', 'Office manager', 'Doctor', 'Voicemail'];
const NB_RESULTS = ['CALLBACK BOOKED', 'EMAIL ONLY', 'TRIAL YES', 'SETUP CALL BOOKED', 'SEND INFO', 'FOLLOW-UP', 'NOT NOW',
  'NOT INTERESTED', 'NO', 'HUNG UP', 'HAS AI', 'DSO', 'DO NOT CALL', 'VOICEMAIL', 'CLOSED', 'NO ANSWER'];
// Варианты столбца J. «Question for <имя владельца>» собирается из NB_OWNER_NAME.
function nbActions_() {
  return ['Send email', 'Send text', 'Setup call', 'Phone check', nbQuestionAction_(), 'Done', 'Callback', 'Yes — free week'];
}
function nbQuestionAction_() { return 'Question for ' + nbNeed_('NB_OWNER_NAME'); }
const NB_NAME_RE = /^(Dr\. )?[A-Z][A-Za-z'\-]*( \([A-Za-z ]+\))?$/;
const NB_CB_RE = /^(Mon|Tue|Wed|Thu|Fri) ([01]?[0-9]|2[0-3]):[0-5][0-9] ET$/;
const NB_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const NB_FIELD_RU = { row: 'номер строки', clinic: 'клиника', call_no: 'номер звонка', who: 'кто ответил', result: 'итог',
  decision_maker: 'ЛПР', email: 'email', callback: 'перезвон', action: 'действие', note: 'заметка', question: 'вопрос', answered_by: 'имя ответившего' };

const NB_HELP =
  'Присылай фото страницы тетради — лучше как файл (скрепка → Файл), так почерк читается точнее. Можно и текстом.\n\n' +
  'Одна строка = одна клиника:\n' +
  '№строки | клиника | кто | итог | ЛПР | email | перезвон | кто ответил | заметка\n\n' +
  'Пример: 67 Sunny Family | FD | CB | Jane | — | Wed 10:00 | Amy | дружелюбные\n\n' +
  'Кто: FD ресепшн, OM офис-менеджер, DR врач, VM автоответчик.\n' +
  'Итог: CB перезвон, EM только email, SI прислать инфо, NN не сейчас, NI не интересно, NO отказ, HU бросили трубку, ' +
  'AI уже есть AI, DNC не звонить, VM автоответчик, NA не ответили, CL закрыто.\n' +
  'Второй звонок — допиши «#2». Вопрос владельцу — начни с «?».\n\n' +
  'Через минуту придёт отчёт. Жёлтые строки в таблице — проверь руками.';

const NB_PROMPT =
  'You read a cold caller\'s handwritten call notebook (a photo of a page, sometimes with typed text) and turn every clinic entry into data. Today in Florida is {TODAY}.\n\n' +
  'Each entry is usually one line, roughly: sheet row number | clinic (often shortened) | who answered | result | decision-maker | email | callback | answered by | note. ' +
  'The order can vary, parts can be missing, and notes are often in Russian.\n\n' +
  'Codes. who: FD = Front desk, OM = Office manager, DR = Doctor, VM = Voicemail. ' +
  'result: CB = CALLBACK BOOKED, EM = EMAIL ONLY, SI = SEND INFO, NN = NOT NOW, NI = NOT INTERESTED, NO = NO, HU = HUNG UP, AI = HAS AI, ' +
  'DNC = DO NOT CALL, VM = VOICEMAIL, NA = NO ANSWER, CL = CLOSED, DSO = DSO, FU = FOLLOW-UP, TY = TRIAL YES, SC = SETUP CALL BOOKED. Full words are fine too.\n\n' +
  'Rules:\n' +
  '- row: the sheet row number written at the start of the entry; null if there is none.\n' +
  '- clinic: the clinic name as written.\n' +
  '- call_no: 2 if the entry is marked as a second call ("#2", "2й", "второй"), otherwise 1.\n' +
  '- who: exactly one of Front desk, Office manager, Doctor, Voicemail, or "".\n' +
  '- result: exactly one of ' + NB_RESULTS.join(', ') + ', or "".\n' +
  '- decision_maker, answered_by: a first name in Latin letters starting with a capital ("Samantha"), or "Dr. Lastname". Add a role in brackets only if written, e.g. "Kim (OM)". "" if none.\n' +
  '- email: lowercase, no spaces. Handwriting confuses l/1, o/0, rn/m, i/j, a/o; read carefully. If any character is a guess, still give your best reading and add "email" to unsure.\n' +
  '- callback: exactly like "Wed 10:00 ET" (Mon, Tue, Wed, Thu, Fri; 24-hour clock). Resolve "завтра"/"tomorrow" and dates against today. If only a range is written ("8-12"), use its start. "" if none.\n' +
  '- action: "" unless the notes clearly ask for one of: Send text, Setup call, Phone check.\n' +
  '- note: everything else from the entry, short, in the language it was written. Do not translate.\n' +
  '- question: text marked as a question for the owner (starts with "?", "вопрос", "Q:"), otherwise "".\n' +
  '- unsure: names of every field you are not sure you read correctly (row, clinic, who, result, decision_maker, email, callback, answered_by, note).\n' +
  '- raw: the entry exactly as you read it, one line.\n' +
  'Skip crossed-out entries. Never invent anything that is not written. Return every entry, top to bottom.';

const NB_SCHEMA = {
  type: 'OBJECT', required: ['entries'],
  properties: { entries: { type: 'ARRAY', items: {
    type: 'OBJECT', required: ['clinic', 'who', 'result', 'note', 'unsure', 'raw'],
    properties: {
      row: { type: 'INTEGER', nullable: true }, clinic: { type: 'STRING' }, call_no: { type: 'INTEGER', nullable: true },
      who: { type: 'STRING' }, result: { type: 'STRING' }, decision_maker: { type: 'STRING' }, email: { type: 'STRING' },
      callback: { type: 'STRING' }, action: { type: 'STRING' }, note: { type: 'STRING' }, question: { type: 'STRING' },
      answered_by: { type: 'STRING' }, unsure: { type: 'ARRAY', items: { type: 'STRING' } }, raw: { type: 'STRING' }
    } } } }
};

// ---------- установка ----------
function nbSetup() {
  nbTg_('deleteWebhook', { drop_pending_updates: false });
  ScriptApp.getProjectTriggers().forEach(function (t) {
    const f = t.getHandlerFunction();
    if (f === 'nbPoll' || f === 'mlOnEdit') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('nbPoll').timeBased().everyMinutes(1).create();
  ScriptApp.newTrigger('mlOnEdit').forSpreadsheet(nbNeed_('NB_SHEET_ID')).onEdit().create();
  console.log('Готово: бот проверяет сообщения каждую минуту, письма по «Send email» тоже идут через него.');
}

function nbTest() {
  const entries = nbGemini_(null,
    '67 Sunny Family | FD | CB | Jane | — | завтра 10-12 | Amy | дружелюбные\n' +
    '65 Bright Tooth | FD | SI | — | office@example.com | | Lily | в целом не надо\n' +
    '44 Oak Street | FD | HU | скинули через 5 сек');
  console.log(JSON.stringify(entries, null, 2));
}

// ---------- опрос Telegram ----------
function nbPoll() {
  if (!nbProp_('NB_BOT_TOKEN')) return;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    mlSendDue_();
    const props = PropertiesService.getScriptProperties();
    const res = nbTg_('getUpdates', { offset: Number(props.getProperty('NB_OFFSET') || 0), timeout: 0,
      allowed_updates: ['message', 'callback_query'] });
    if (!res.ok) return;
    res.result.forEach(function (u) {
      props.setProperty('NB_OFFSET', String(u.update_id + 1));
      try { nbHandle_(u); } catch (err) {
        console.log(err.stack);
        const chat = (u.message && u.message.chat.id) || (u.callback_query && u.callback_query.message.chat.id);
        if (chat) nbSend_(chat, '⚠️ Ошибка: ' + err.message);
      }
    });
  } finally { lock.releaseLock(); }
}

function nbHandle_(u) {
  if (u.callback_query) return mlOnButton_(u.callback_query);
  const m = u.message;
  if (!m) return;
  const chat = String(m.chat.id);
  const owner = nbProp_('NB_OWNER_CHAT');
  const allowed = (nbProp_('NB_ALLOWED_CHATS') + ',' + owner).split(',').map(function (s) { return s.trim(); }).filter(String);
  if (allowed.indexOf(chat) < 0) { nbSend_(chat, 'Нет доступа. Твой chat id: ' + chat + ' — отправь его владельцу.'); return; }
  const text = (m.text || m.caption || '').trim();
  if (/^\/(start|help)/.test(text)) { nbSend_(chat, NB_HELP + '\n\nТвой chat id: ' + chat); return; }
  let image = null;
  if (m.photo && m.photo.length) image = nbFile_(m.photo[m.photo.length - 1].file_id, 'image/jpeg');
  else if (m.document && /^image\//.test(m.document.mime_type || '')) image = nbFile_(m.document.file_id, m.document.mime_type);
  if (!image && !text) { nbSend_(chat, 'Пришли фото страницы тетради (лучше как файл) или текст.'); return; }
  const entries = nbGemini_(image, text);
  if (!entries.length) { nbSend_(chat, 'Ничего не разобрал. Пересними ровно, при хорошем свете, страница целиком в кадре.'); return; }
  nbApply_(entries, chat);
}

function nbApply_(entries, chat) {
  const sh = nbSs_().getSheetByName(NB_SHEET);
  const names = sh.getRange(2, 2, sh.getLastRow() - 1, 1).getValues().map(function (r) { return String(r[0]); });
  const ok = [], unsure = [], skipped = [], callbacks = [], questions = [], drafts = [];
  let already = 0;

  entries.forEach(function (e) {
    const found = nbFindRow_(e, names);
    if (!found.row) { skipped.push('• ' + (e.raw || e.clinic) + '\n   ' + found.why); return; }
    const row = found.row;
    const flags = (e.unsure || []).map(function (f) { return NB_FIELD_RU[f] || f; });
    if (found.moved) flags.push('строка ' + e.row + ' → ' + row + ' (по названию)');
    const v = nbNormalize_(e, flags);

    const rng = sh.getRange(row, 4, 1, 10); // D..M
    const cur = rng.getValues()[0];
    // эта клиника с этим номером звонка уже записана (страницу сфотографировали повторно) — не трогаем
    if (String(cur[2]).trim() && (Number(cur[0]) || 1) >= v.call_no) { already++; return; }
    const vals = [
      v.call_no, v.who || cur[1], v.result || cur[2], v.dm || cur[3], v.email || cur[4],
      v.callback || cur[5], v.action || cur[6], nbJoin_(cur[7], v.note), nbJoin_(cur[8], v.question), v.answered || cur[9]
    ];
    rng.setValues([vals]);
    if (flags.length) rng.setBackground(NB_YELLOW);

    const clinic = names[row - 2];
    const label = row + ' ' + clinic + ': ' + [vals[1], vals[2], vals[3], vals[4], vals[5]].filter(String).join(' · ');
    if (flags.length) unsure.push('• ' + label + '\n   ❓ ' + flags.join(', ')); else ok.push('• ' + label);
    if (vals[6] === 'Callback' && vals[5]) callbacks.push('• ' + clinic + ' — ' + vals[5] + (vals[3] ? ' (' + vals[3] + ')' : ''));
    if (v.question) questions.push('• ' + clinic + ' (строка ' + row + '): ' + v.question);
    if (vals[6] === 'Send email' && !v.noDraft && !found.moved) drafts.push(row);
  });

  let msg = '✍️ Записано: ' + (ok.length + unsure.length);
  if (unsure.length) msg += ', под вопросом: ' + unsure.length;
  if (skipped.length) msg += ', не записано: ' + skipped.length;
  if (already) msg += '\n↩️ Уже были в таблице, пропустил: ' + already;
  if (ok.length) msg += '\n\n' + ok.join('\n');
  if (unsure.length) msg += '\n\n🟨 Проверь (подсвечено жёлтым):\n' + unsure.join('\n');
  if (skipped.length) msg += '\n\n⛔ Не записал — впиши руками или пришли строку заново с номером:\n' + skipped.join('\n');
  nbSend_(chat, msg);

  const owner = nbProp_('NB_OWNER_CHAT');
  if (!owner) return;
  let extra = '';
  if (callbacks.length) extra += '\n\n📞 Перезвоны:\n' + callbacks.join('\n');
  if (questions.length) extra += '\n\n❓ Вопросы тебе:\n' + questions.join('\n');
  if (owner !== String(chat)) nbSend_(owner, '📓 Из тетради колера\n\n' + msg + extra);
  else if (extra) nbSend_(owner, extra.trim());
  drafts.forEach(function (row) { mlDraftRow_(sh, row); });
}

function nbNormalize_(e, flags) {
  const v = { noDraft: false };
  const uns = e.unsure || [];
  ['email', 'decision_maker', 'answered_by', 'row', 'clinic', 'result'].forEach(function (f) { if (uns.indexOf(f) >= 0) v.noDraft = true; });
  v.call_no = e.call_no === 2 ? 2 : 1;
  v.who = NB_WHO.indexOf(e.who) >= 0 ? e.who : '';
  if (e.who && !v.who) flags.push('кто ответил «' + e.who + '»');
  v.result = String(e.result || '').toUpperCase().trim();
  if (v.result && NB_RESULTS.indexOf(v.result) < 0) { flags.push('итог «' + e.result + '»'); v.result = ''; v.noDraft = true; }
  v.dm = nbName_(e.decision_maker, 'ЛПР', flags, v);
  v.answered = nbName_(e.answered_by, 'имя ответившего', flags, v);
  v.email = String(e.email || '').toLowerCase().replace(/\s+/g, '').replace(/^[—-]+$/, '');
  if (v.email && !NB_EMAIL_RE.test(v.email)) { flags.push('email «' + v.email + '»'); v.noDraft = true; }
  v.callback = String(e.callback || '').trim();
  if (v.callback && !NB_CB_RE.test(v.callback)) flags.push('перезвон «' + v.callback + '»');
  v.note = String(e.note || '').trim();
  v.question = String(e.question || '').trim();
  let a = String(e.action || '').trim();
  if (a && nbActions_().indexOf(a) < 0) { v.note = nbJoin_(v.note, a); a = ''; }
  if (!a) {
    if (v.result === 'TRIAL YES') a = 'Yes — free week';
    else if (v.result === 'SETUP CALL BOOKED') a = 'Setup call';
    else if (v.email && ['EMAIL ONLY', 'SEND INFO', 'NOT NOW', 'FOLLOW-UP', 'CALLBACK BOOKED'].indexOf(v.result) >= 0) a = 'Send email';
    else if (v.result === 'CALLBACK BOOKED') a = 'Callback';
    else if (v.question) a = nbQuestionAction_();
  }
  v.action = a;
  return v;
}

function nbName_(s, label, flags, v) {
  s = String(s || '').trim().replace(/^[—-]+$/, '');
  if (!s) return '';
  s = s.replace(/^dr\.?\s*/i, 'Dr. ').replace(/^(Dr\. )?([a-z])/, function (m, d, c) { return (d || '') + c.toUpperCase(); });
  if (!NB_NAME_RE.test(s)) { flags.push(label + ' «' + s + '»'); v.noDraft = true; }
  return s;
}

function nbFindRow_(e, names) {
  const hint = nbKey_(e.clinic);
  const r = Number(e.row) || 0;
  const fits = function (i) { const k = nbKey_(names[i]); return !hint || !k || nbMatch_(hint, k); };
  if (r >= 2 && r <= names.length + 1 && fits(r - 2)) return { row: r };
  if (hint) {
    const hits = [];
    names.forEach(function (n, i) { if (nbKey_(n) && nbMatch_(hint, nbKey_(n))) hits.push(i + 2); });
    if (hits.length === 1) return { row: hits[0], moved: !!r };
    if (hits.length > 1) return { why: 'таких клиник несколько (строки ' + hits.join(', ') + ') — допиши номер строки' };
  }
  if (r >= 2 && r <= names.length + 1) return { why: 'в строке ' + r + ' другая клиника: ' + names[r - 2] };
  return { why: r ? 'строки ' + r + ' нет в таблице' : 'нет номера строки, и клинику по названию не нашёл' };
}

function nbKey_(s) {
  return String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\b(dental|dentistry|dentists?|family|care|the|of|and|dds|dmd|pa|llc|center|centre|group|smiles?)\b/g, ' ')
    .replace(/\s+/g, ' ').trim();
}
function nbMatch_(hint, full) {
  const fw = full.split(' ');
  return hint.split(' ').every(function (w) { return fw.some(function (f) { return f.indexOf(w) === 0 || w.indexOf(f) === 0; }); });
}
function nbJoin_(a, b) {
  a = String(a || '').trim(); b = String(b || '').trim();
  if (!b) return a; if (!a) return b;
  return a.indexOf(b) >= 0 ? a : a + ' | ' + b;
}

// ---------- Gemini ----------
function nbGemini_(image, text) {
  const today = Utilities.formatDate(new Date(), NB_TZ, 'EEEE, yyyy-MM-dd');
  const parts = [{ text: NB_PROMPT.replace('{TODAY}', today) + (text ? '\n\nNotes typed by the caller:\n' + text : '') }];
  if (image) parts.push({ inlineData: { mimeType: image.mime, data: image.data } });
  const txt = nbCallGemini_({ contents: [{ role: 'user', parts: parts }],
    generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: NB_SCHEMA } });
  return JSON.parse(txt).entries || [];
}

// Запрос к Gemini с повторами: если модель перегружена (503/429/500), ждёт и пробует ещё раз, потом другую модель
function nbCallGemini_(body) {
  const key = nbProp_('GEMINI_API_KEY');
  if (!key) throw new Error('нет GEMINI_API_KEY в свойствах скрипта');
  const models = [NB_MODEL, 'gemini-2.5-flash', 'gemini-flash-lite-latest'];
  let last = '';
  for (let m = 0; m < models.length; m++) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + models[m] + ':generateContent', {
        method: 'post', contentType: 'application/json', headers: { 'x-goog-api-key': key }, muteHttpExceptions: true,
        payload: JSON.stringify(body) });
      const code = r.getResponseCode();
      if (code === 200) {
        const c = (JSON.parse(r.getContentText()).candidates || [])[0];
        const txt = c && c.content && c.content.parts ? c.content.parts.map(function (p) { return p.text || ''; }).join('') : '';
        if (txt) return txt;
        last = models[m] + ': пустой ответ';
      } else {
        last = models[m] + ' ' + code + ': ' + r.getContentText().slice(0, 150);
        if ([429, 500, 503].indexOf(code) < 0) break;   // другая ошибка — повтор не поможет, пробуем следующую модель
      }
      Utilities.sleep(3000);
    }
  }
  throw new Error('Gemini не ответил (' + last + ')');
}

// ---------- Telegram ----------
function nbProp_(k) { return PropertiesService.getScriptProperties().getProperty(k) || ''; }

// Обязательное свойство: если его нет — понятная ошибка.
function nbNeed_(k) {
  const v = nbProp_(k);
  if (!v) throw new Error('Script Property ' + k + ' is not set (Project Settings → Script Properties).');
  return v;
}

// Таблица с листом Calls по ID из Script Properties.
function nbSs_() { return SpreadsheetApp.openById(nbNeed_('NB_SHEET_ID')); }

function nbTg_(method, payload) {
  const r = UrlFetchApp.fetch('https://api.telegram.org/bot' + nbProp_('NB_BOT_TOKEN') + '/' + method, {
    method: 'post', contentType: 'application/json', payload: JSON.stringify(payload || {}), muteHttpExceptions: true });
  const j = JSON.parse(r.getContentText());
  if (!j.ok) console.log(method + ': ' + r.getContentText());
  return j;
}

function nbSend_(chat, text, buttons) {
  let res;
  for (let i = 0; i < text.length; i += 3900) {
    const p = { chat_id: chat, text: text.slice(i, i + 3900), disable_web_page_preview: true };
    if (buttons && i + 3900 >= text.length) p.reply_markup = { inline_keyboard: buttons };
    res = nbTg_('sendMessage', p);
  }
  return res;
}

function nbFile_(fileId, mime) {
  const f = nbTg_('getFile', { file_id: fileId });
  if (!f.ok) throw new Error('не смог скачать фото из Telegram');
  const blob = UrlFetchApp.fetch('https://api.telegram.org/file/bot' + nbProp_('NB_BOT_TOKEN') + '/' + f.result.file_path).getBlob();
  return { mime: mime, data: Utilities.base64Encode(blob.getBytes()) };
}

// ---------- письма ----------
const ML_DEMO_BY_PHONE = false;  // true — если демо узнаёт любую клинику из Calls по номеру, с которого звонят
// Подпись письма из ML_SIGNATURE; строки можно разделять «\n» прямо в значении свойства.
function mlSignature_() { return nbNeed_('ML_SIGNATURE').replace(/\\n/g, '\n'); }
// Запрещённое в начале письма от Gemini; последнее правило — имя владельца (NB_OWNER_NAME).
function mlBad_() {
  const owner = nbNeed_('NB_OWNER_NAME').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [/\bbook(s|ed|ing)?\b/i, /hipaa/i, /complian/i, /two weeks/i, /!/, /ai-powered/i, /\$\s?\d/, new RegExp(owner, 'i')];
}

function mlOnEdit(e) {
  const rg = e.range, sh = rg.getSheet();
  if (sh.getName() !== NB_SHEET) return;
  if (rg.getColumn() > 10 || rg.getLastColumn() < 10) return;
  for (let row = rg.getRow(); row <= rg.getLastRow(); row++) {
    if (row > 1 && String(sh.getRange(row, 10).getValue()).trim() === 'Send email') mlDraftRow_(sh, row);
  }
}

function mlTest() {   // пишет письмо по строке и показывает в журнале, ничего не создаёт
  const sh = nbSs_().getSheetByName(NB_SHEET);
  const row = 65;     // ← номер строки с email
  const r = sh.getRange(row, 1, 1, 13).getValues()[0];
  const m = mlCompose_(r);
  console.log('Тема: ' + m.subject + '\n\n' + m.body + '\n\n' + m.flags.join('\n'));
}

function mlDraftRow_(sh, row) {
  const owner = nbProp_('NB_OWNER_CHAT');
  if (!owner) return;
  const r = sh.getRange(row, 1, 1, 13).getValues()[0];
  const clinic = String(r[1]).trim(), email = String(r[7]).trim().toLowerCase();
  const where = clinic + ' (строка ' + row + ')';
  if (!NB_EMAIL_RE.test(email)) { nbSend_(owner, '⚠️ ' + where + ': в H нет нормального email — черновик не создал.'); return; }
  const hasDraft = GmailApp.getDrafts().some(function (d) { return d.getMessage().getTo().toLowerCase().indexOf(email) >= 0; });
  if (hasDraft) { nbSend_(owner, 'ℹ️ ' + where + ': черновик на ' + email + ' уже есть в Gmail — второй не создаю.'); return; }
  const old = GmailApp.search('(to:' + email + ' OR from:' + email + ') -in:drafts', 0, 1);
  if (old.length) {
    nbSend_(owner, '⚠️ ' + where + ': с ' + email + ' уже есть переписка (' +
      Utilities.formatDate(old[0].getLastMessageDate(), Session.getScriptTimeZone(), 'dd.MM') +
      '). Новое письмо не создал — напиши мне в чат, сделаю ответ в той же ветке.');
    return;
  }
  const m = mlCompose_(r);
  if (m.fixDm) sh.getRange(row, 7).setValue(m.fixDm);
  if (m.fixAns) sh.getRange(row, 13).setValue(m.fixAns);
  const d = GmailApp.createDraft(email, m.subject, m.body);
  nbSend_(owner, '📧 Черновик · ' + where + '\nКому: ' + email + '\nТема: ' + m.subject +
    (m.flags.length ? '\n' + m.flags.join('\n') : '') + '\n\n' + m.body,
    [[{ text: '✅ Отправить', callback_data: 's|' + d.getId() + '|' + row },
      { text: '✏️ Сам поправлю', callback_data: 'e|' + d.getId() + '|' + row }]]);
}

function mlCompose_(r) {
  const clinic = String(r[1]).trim(), result = String(r[5]).trim(), cb = String(r[8]).trim();
  const strip = function (s) { return String(s || '').replace(/\s*\(.*\)\s*$/, '').trim(); };
  let dm = strip(r[6]), ans = strip(r[12]);
  const flags = [];
  let fixDm = '', fixAns = '', opening = '';

  try {
    const g = mlGemini_({ clinic: clinic, result: result, decision_maker: dm, answered_by: ans,
      caller: nbNeed_('NB_CALLER_NAME'), notes: String(r[10] || '') });
    if (g.decision_maker_fixed && g.decision_maker_fixed !== dm) {
      flags.push('⚠️ Имя ЛПР: ' + dm + ' → ' + g.decision_maker_fixed);
      fixDm = String(r[6]).replace(dm, g.decision_maker_fixed); dm = g.decision_maker_fixed;
    }
    if (g.answered_by_fixed && g.answered_by_fixed !== ans) {
      flags.push('⚠️ Имя ответившего: ' + ans + ' → ' + g.answered_by_fixed);
      fixAns = String(r[12]).replace(ans, g.answered_by_fixed); ans = g.answered_by_fixed;
    }
    const bad = mlBad_().filter(function (re) { return re.test(g.opening || ''); });
    if (!g.opening || bad.length) flags.push('⚠️ Gemini нарушил правила (' + bad.join(' ') + ') — взял стандартное начало');
    else opening = g.opening.trim();
  } catch (err) { flags.push('⚠️ ' + err.message.slice(0, 120) + ' — взял стандартное начало'); }

  if (!opening) {
    opening = 'Thanks for taking our call earlier and passing on your email.' +
      ({ 'SEND INFO': ' I know it may not be something you need right now, so I\'ll keep it short.',
         'NOT NOW': ' You mentioned the timing isn\'t right, so this is just to have on file for later.' }[result] || '') +
      ' Here\'s what we mentioned.';
  }
  const name = dm || ans;
  const phone = nbNeed_('ML_DEMO_PHONE');
  const demo = ML_DEMO_BY_PHONE
    ? 'You can hear how it sounds at ' + phone + '. It\'s a sample setup, and if you call from your office line, it will answer with your practice\'s name.'
    : 'You can hear how it sounds at ' + phone + '. It\'s set up for a sample practice.';
  const body = (name ? 'Hi ' + name + ',' : 'Hello,') + '\n\n' + opening + '\n\n' +
    'It\'s a phone assistant that answers when your front desk can\'t. It answers the usual questions, takes the patient\'s name, number and what they need, flags anything urgent, and emails your office a summary every morning.\n\n' +
    'Try it for a week at no cost: I set it up on your line, and at the end you get a list of every call it took — who called, new or existing patient, and what they needed. If it\'s worth keeping, it\'s $490 to set up and $299 a month, no contract.\n\n' +
    demo +
    (result === 'CALLBACK BOOKED' && NB_CB_RE.test(cb) ? '\n\nWe\'ll call you back on ' + mlWhen_(cb) + ' as agreed.' : '') +
    (/^Dr\. /.test(name) ? '' : '\n\nCould you pass this on to the doctor?') +
    (result === 'NOT NOW' ? '\n\nI\'ll check back in a couple of months, unless you\'d like to try it sooner.' : '') +
    '\n\n' + mlSignature_();
  return { subject: 'After-hours calls at ' + clinic, body: body, flags: flags, fixDm: fixDm, fixAns: fixAns };
}

function mlGemini_(f) {
  const prompt =
    'You write the first paragraph of a short follow-up email from the owner of a small US company to a dental practice. ' +
    'Earlier today our caller (' + f.caller + ') phoned the practice and they gave an email address.\n\n' +
    'Facts:\nPractice: ' + f.clinic + '\nCall result: ' + (f.result || 'unknown') +
    '\nDecision-maker (the email goes to them): ' + (f.decision_maker || 'unknown') +
    '\nPerson who answered the phone: ' + (f.answered_by || 'unknown') +
    '\nCaller\'s notes (Russian, context only, never quote or translate them): ' + (f.notes || 'none') + '\n\n' +
    'Task 1. Names were written down by ear, so they may be misspelled. If decision_maker or answered_by is clearly a mishearing of a common English first name ' +
    '(Briam → Brian, Jessika → Jessica, Samanta → Samantha), return the usual spelling; otherwise return the name unchanged. Keep "Dr. " prefixes. Return "" for unknown.\n\n' +
    'Task 2. opening: 1–2 short sentences, written as the owner ("I", "we"). Thank them for taking the call from ' + f.caller + ' earlier. ' +
    'If the person who answered is known and is not the decision-maker, thank them by name for passing on the email (e.g. "Kim kindly passed on your email."). ' +
    'If the result is SEND INFO, add that you know it may not be a need right now so you will keep it short. If NOT NOW, add that you understand the timing isn\'t right. ' +
    'End with a sentence that leads into a description of the product, like "Here\'s what we mentioned."\n' +
    'Rules: plain American English, no exclamation marks, no hype, no prices, no product claims, no mention of booking or appointments, no compliance words, ' +
    'do not mention the owner\'s name, do not invent anything that is not in the facts.';
  return JSON.parse(nbCallGemini_({ contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.3, responseMimeType: 'application/json', responseSchema: {
      type: 'OBJECT', required: ['decision_maker_fixed', 'answered_by_fixed', 'opening'],
      properties: { decision_maker_fixed: { type: 'STRING' }, answered_by_fixed: { type: 'STRING' }, opening: { type: 'STRING' } } } } }));
}

function mlWhen_(cb) {
  const days = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday' };
  const m = cb.match(/^(\w{3}) (\d{1,2}):(\d{2})/);
  const h = Number(m[2]), ampm = h >= 12 ? 'p.m.' : 'a.m.', h12 = h % 12 || 12;
  return days[m[1]] + ' at ' + h12 + (m[3] === '00' ? '' : ':' + m[3]) + ' ' + ampm + ' ET';
}

// рабочее время Флориды: пн–пт 8:30–16:30. Возвращает null, если можно сейчас, иначе Date следующего 8:30 ET
function mlNextSlot_() {
  const now = new Date();
  const p = Utilities.formatDate(now, NB_TZ, 'u HH mm').split(' ').map(Number);
  const mins = p[1] * 60 + p[2];
  if (p[0] <= 5 && mins >= 510 && mins < 990) return null;
  let d = new Date(now.getTime());
  if (p[0] <= 5 && mins < 510) { /* сегодня в 8:30 */ } else d = new Date(d.getTime() + 864e5);
  while (Number(Utilities.formatDate(d, NB_TZ, 'u')) > 5) d = new Date(d.getTime() + 864e5);
  const day = Utilities.formatDate(d, NB_TZ, 'yyyy-MM-dd');
  const off = Utilities.formatDate(new Date(day + 'T12:00:00Z'), NB_TZ, 'XXX');
  return new Date(day + 'T08:30:00' + off);
}

function mlSendNow_(id, row) {
  GmailApp.getDraft(id).send();
  nbSs_().getSheetByName(NB_SHEET).getRange(Number(row), 10).setValue('Done');
}

function mlOnButton_(q) {
  const chat = q.message.chat.id;
  if (String(q.from.id) !== nbProp_('NB_OWNER_CHAT')) { nbTg_('answerCallbackQuery', { callback_query_id: q.id, text: 'Только владелец' }); return; }
  const p = String(q.data).split('|');
  let note;
  try {
    GmailApp.getDraft(p[1]);
    if (p[0] === 's') {
      const slot = mlNextSlot_();
      if (!slot) { mlSendNow_(p[1], p[2]); note = '✅ Отправлено'; }
      else {
        const props = PropertiesService.getScriptProperties();
        const queue = JSON.parse(props.getProperty('ML_QUEUE') || '[]');
        queue.push({ id: p[1], row: p[2], at: slot.getTime(), chat: chat });
        props.setProperty('ML_QUEUE', JSON.stringify(queue));
        note = '🕣 Уйдёт ' + Utilities.formatDate(slot, NB_TZ, 'EEE HH:mm') + ' по Флориде (' +
          Utilities.formatDate(slot, Session.getScriptTimeZone(), 'HH:mm') + ' у тебя)';
      }
    } else note = '✏️ Черновик в Gmail — поправь и отправь оттуда';
  } catch (err) { note = '⚠️ Черновика уже нет — отправлен или удалён в Gmail'; }
  nbTg_('answerCallbackQuery', { callback_query_id: q.id, text: note.slice(0, 190) });
  nbTg_('editMessageReplyMarkup', { chat_id: chat, message_id: q.message.message_id, reply_markup: { inline_keyboard: [] } });
  nbSend_(chat, note + ' · строка ' + p[2]);
}

function mlSendDue_() {
  const props = PropertiesService.getScriptProperties();
  const queue = JSON.parse(props.getProperty('ML_QUEUE') || '[]');
  if (!queue.length) return;
  const now = Date.now(), left = [];
  queue.forEach(function (j) {
    if (j.at > now) { left.push(j); return; }
    let note;
    try { mlSendNow_(j.id, j.row); note = '✅ Отправлено по расписанию'; }
    catch (err) { note = '⚠️ Не отправил — черновика уже нет'; }
    nbSend_(j.chat, note + ' · строка ' + j.row);
  });
  props.setProperty('ML_QUEUE', JSON.stringify(left));
}
