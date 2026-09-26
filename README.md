# Internship Autofill

A Chrome extension that autofills internship / job application forms using a
profile you fill in once: contact info, education (including class
standing/GPA/graduation date), work history, work authorization, security
clearance and background-check questions, referral info, travel/driver's
license/regional preference, voluntary EEO questions, and general
preferences. Checkbox groups asking which term(s)/semester(s) you're
available for get every box checked, rather than guessing one.

## Install (unpacked, for development)

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this project's folder (the one
   containing `manifest.json`).
4. The extension icon appears in your toolbar, and your profile editor opens
   automatically the first time you install it.

## Usage

1. Click the extension icon → **Edit My Profile**, and fill in whatever you're
   comfortable storing. Leave anything blank that you'd rather answer by hand
   on each application — blank fields are never filled in.
2. On any application page, click the extension icon → **Autofill This Page**.
3. Matched fields get a brief purple outline so you can see what was filled,
   then review everything before you submit.

Your data is saved with `chrome.storage.local`, so it stays on this device
only — it is never sent anywhere except into the form fields on the page you
choose to autofill. Use **Export** on the profile page to back it up to a
JSON file, or **Import** to restore/move it to another machine.

## How matching works

`src/content.js` scans every visible, enabled `input` / `select` / `textarea`
on the page. For each one it builds a "signal" string from whatever the page
gives it: the associated `<label>`, `aria-label`/`aria-labelledby`,
`placeholder`, `name`, `id`, `data-automation-id` (common on Workday), and any
heading/legend text that looks like it introduces the field. That signal is
normalized (camelCase/snake_case/kebab-case split apart, lowercased) and
tested against the keyword rules in `src/fieldRules.js`.

This generic, label-driven approach is what makes it work across
hand-written forms as well as Greenhouse, Lever, and Workday — rather than
hardcoding selectors tied to one company's specific Workday tenant, which
would break the moment that tenant's field IDs changed.

Radio-button groups (e.g. "Are you a U.S. citizen? ○ Yes ○ No") are grouped
by their shared `name` attribute, matched against the group's question text,
and then the individual option whose own label matches your saved Yes/No or
multiple-choice answer gets clicked.

To improve a match or add a new field: add the field to `PROFILE_SCHEMA` in
`src/profileSchema.js`, then add its matching keywords to `FIELD_RULES` (and
`FIELD_MATCH_ORDER`, near the top if it's specific) in `src/fieldRules.js`.

## Known limitations

- **Resume/cover letter uploads aren't autofilled.** Browsers don't allow a
  webpage or extension to programmatically attach a real file to a file
  input for security reasons — you'll still need to attach your resume
  yourself.
- **Single-page apps that build the form after the page loads** (common on
  Workday) may need a second click of **Autofill This Page** if you open the
  form before it's finished rendering.
- Matching is heuristic, not perfect. Always review filled fields before
  submitting an application — especially anything under Work Authorization
  or the voluntary EEO section.
- Cross-origin iframes (rare, but used by a few embedded application widgets)
  can't be scanned; the extension only sees same-origin content.

## Project structure

```
manifest.json          Manifest V3 config
icons/                 Toolbar/extension icons
src/
  profileSchema.js     Shared field definitions (used by options, content script)
  fieldRules.js         Keyword matching rules + match precedence
  content.js            Injected into pages; scans + fills forms
  background.js          Minimal service worker (opens settings on install)
  popup.html/css/js      Toolbar popup ("Autofill This Page")
  options.html/css/js    Full profile editor page
```
