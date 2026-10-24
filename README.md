# after-hours-automation

AI phone assistant and sales automation for US dental clinics.

This repo holds the Google Apps Script code that runs behind the scenes of the
business. The scripts work with a Google Sheet of clinics and calls, and send
short reports to the owner in Telegram.

## What Team.gs does

`apps-script/Team.gs` helps the calling team (the "callers") work through the
list of clinics in the **Calls** sheet.

- **Assigns clinics to callers.** Every clinic row gets a caller name in
  column R. New rows go to the caller who has fewer clinics left to call.
- **Keeps a call history.** Every 10 minutes it checks the Calls sheet for
  changes and writes each new call result to the **Log** sheet (time, clinic,
  phone, caller, result, notes and so on).
- **Merges duplicate rows.** If the same phone number appears more than once,
  it joins the rows into one (every night at 3:00 Riga time). A backup copy of
  the sheet is saved first.
- **Sends a daily report.** Every morning at 8:00 Riga time it sends a summary
  of yesterday's calls per caller to the owner in Telegram.

Main functions:

| Function | When to run it |
| --- | --- |
| `teamSetup()` | Once. Creates the Log sheet, assigns clinics and sets the 10-minute and 8:00 timers. |
| `teamDedupeSetup()` | Once. Merges duplicates now and sets the nightly 3:00 timer. |
| `teamFixLog()` | Only if needed. Cleans repeated rows from Log and lists duplicate phone numbers. |
| `teamWatch()`, `teamDaily()`, `teamDedupe()` | Run by timers automatically. |

`Team.gs` uses the helper functions `nbProp_`, `nbSend_` and `nbJoin_` from
`Notebook.gs`, so both files must be in the same Apps Script project.

## What Notebook.gs does

`apps-script/Notebook.gs` is the Telegram bot that turns the callers' paper
notebooks into rows in the **Calls** sheet, and then helps send follow-up
emails.

- **Reads notebook pages.** A caller sends the bot a photo of a notebook page
  (or plain text). Gemini reads every entry: row number, clinic, who answered,
  result, decision-maker, email, callback time, notes.
- **Fills the Calls sheet.** Each entry goes into columns D–M of the matching
  row. It finds the row by number or by clinic name. Anything it is not sure
  about is highlighted yellow. A page sent twice is not written twice.
- **Reports in Telegram.** The caller gets a short report (written, unsure,
  skipped). The owner also gets callbacks and questions marked for them.
- **Drafts follow-up emails.** When a row's action (column J) is
  **Send email**, it writes a Gmail draft (Gemini writes the opening, the rest
  is a fixed template) and sends it to the owner in Telegram with
  **✅ Отправить** (send) and **✏️ Сам поправлю** (edit it myself in
  Gmail) buttons.
- **Sends at the right time.** If the owner presses Send outside Florida
  business hours (Mon–Fri 8:30–16:30 ET), the email waits and goes out at the
  next 8:30 ET.

Main functions:

| Function | When to run it |
| --- | --- |
| `nbSetup()` | Once. Turns off the Telegram webhook, sets the 1-minute `nbPoll` timer and the `mlOnEdit` trigger on the sheet. |
| `nbTest()` | Optional. Sends sample notebook lines to Gemini and logs what it read. Writes nothing. |
| `mlTest()` | Optional. Writes the email for one row (set `row` in the code) and logs it. Creates nothing. |
| `nbPoll()`, `mlOnEdit()` | Run by triggers automatically. |

## Script Properties you must set

Private values are **not** stored in the code. Set them in the Apps Script
editor: **Project Settings → Script Properties → Add script property**.

| Property | What it is | Used by |
| --- | --- | --- |
| `TM_SHEET_ID` | ID of the Google Sheet with the Calls and Log sheets. It is the long code in the sheet link: `docs.google.com/spreadsheets/d/<THIS PART>/edit` | Team.gs |
| `TM_CALLERS` | Names of the callers, separated by commas, for example `Anna, Ben`. Write them exactly as they appear in column R of the Calls sheet. | Team.gs |
| `NB_OWNER_CHAT` | Telegram chat ID of the owner. Reports, callbacks, questions and email drafts go here, and only this person can press the Send buttons. | Team.gs, Notebook.gs |
| `NB_BOT_TOKEN` | Telegram bot token from @BotFather. If it is empty, the bot does nothing. | Notebook.gs |
| `NB_ALLOWED_CHATS` | Telegram chat IDs of the callers who may use the bot, separated by commas. The owner is always allowed. A new caller can send `/start` to the bot to see their chat ID. | Notebook.gs |
| `GEMINI_API_KEY` | Google Gemini API key, used to read the notebook photos and write email openings. | Notebook.gs |
| `NB_SHEET_ID` | ID of the Google Sheet with the Calls sheet (the same kind of ID as `TM_SHEET_ID`; today it is the same sheet). | Notebook.gs |
| `NB_OWNER_NAME` | The owner's first name, for example `Alex`. Used for the column J action `Question for <name>` (must match the sheet's dropdown exactly), and to stop Gemini from putting the owner's name in the email opening. | Notebook.gs |
| `NB_CALLER_NAME` | First name of the caller the email mentions ("thanks for taking the call from …"). | Notebook.gs |
| `ML_DEMO_PHONE` | Demo phone number shown in emails, for example `(555) 123-4567`. | Notebook.gs |
| `ML_SIGNATURE` | Email signature. Separate lines with `\n`, for example `Alex Smith\nAfter Hours Dental\nexample.com`. | Notebook.gs |

The bot also stores its own working values in Script Properties: `NB_OFFSET`
(last Telegram message read) and `ML_QUEUE` (emails waiting to be sent). Do not
edit or delete them.

Never paste private values into the code.

If a required property is missing, the scripts stop with a clear error message
that names it. If this happens while the bot handles a Telegram message, the
bot sends the error to that chat; otherwise it is in the Apps Script
executions log. The only exception:
if `NB_CALLER_NAME`, `NB_OWNER_NAME` or `GEMINI_API_KEY` is missing while
writing an email, the draft is still made with the standard opening, and the
owner sees the error as a ⚠️ line above it.

## Voiceflow greeting

`voiceflow/greeting.js` runs in a JavaScript step at the very start of a call
to the Voiceflow phone agent (Maya). It sets the variables the agent uses for
its first line.

- **Recognises the caller's number.** It takes `caller_phone`, keeps only the
  digits and uses the last 10. It looks that number up in the `CLINICS` list
  and saves the clinic name in `demo_clinic` (or `none` if the number is not
  in the list). It saves the 10 digits in `caller_phone10` (or `none`).
- **Picks a greeting by clinic and language.** If the caller is a known
  clinic, Maya greets them with that clinic's name. If not, she uses the
  default practice name, and the line depends on `office_open`: `yes` means
  the front desk is busy with patients, anything else means the office is
  closed. The text goes into `greeting_text`.
- **Speaks the number digit by digit.** It writes the number in words, in
  three groups, in `caller_phone_spoken`, for example
  `five five five, zero one zero, zero zero zero one` (or
  `cinco cinco cinco, ...` in Spanish), so Maya can read it back clearly.

**English and Spanish.** The same file is used for both the English and the
Spanish version of the agent. The only difference is the `LANG` variable on
the first line: `'en'` for English, `'es'` for Spanish. It sets both the
greeting text and the words for the digits. Do not change anything else.

**The clinic list in this repo is a sample.** `CLINICS` here holds 3 made-up
clinics with fake 555-01xx numbers. The real list is private and is loaded
separately; never commit it. The format is a 10-digit phone number (digits
only) mapped to the clinic name:

```js
const CLINICS = {
  "5550100001": "Sample Family Dental",
};
```

## Tests

The `tests/` folder holds scripts that test the Voiceflow phone agent (Maya)
without making real phone calls.

- **`tests/run.py`** plays scripted test calls against the Voiceflow agent
  through the Voiceflow Dialog API. Each scenario in the scenarios file is one
  caller: it starts with the scripted lines, and when those run out, a simple
  rule-based caller answers Maya's questions (name, phone, new patient, day and
  so on). Spanish scenarios (`"es": true`) get Spanish answers. It prints every
  call and saves the full log to a JSON file.
- **`tests/ana.py`** checks that log automatically, for every call:
  - the **saved phone number**: exactly one `save_lead` call, and the phone in
    it matches the expected number digit by digit (or nothing is saved when the
    caller gives no number);
  - the **read-back**: when Maya reads the number aloud, the digits are right;
  - **banned phrases**: Maya never says things like "you're booked" or "is
    urgent";
  - she says "One moment" before saving, and the call ends.

  Each call gets `OK` or `ISS` with a list of the problems found.
- **`tests/scenarios_sample.json`** is a sample set of scenarios. All phone
  numbers in it are fake (555-01xx).

How to run them (Python 3, no extra packages needed):

```bash
export VOICEFLOW_API_KEY=...   # your Voiceflow Dialog API key; never commit it
python tests/run.py tests/scenarios_sample.json out.json
python tests/ana.py out.json tests/scenarios_sample.json
```

The calls run against the **production** version of the Voiceflow agent.
