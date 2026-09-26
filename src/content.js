/**
 * Content script: scans the current page for application-form fields,
 * matches each one against the saved profile using FIELD_RULES, and
 * fills it in a way that plays nicely with React-controlled forms
 * (Greenhouse, Lever, Workday, and most modern ATS platforms all use
 * React or similar under the hood).
 *
 * Relies on globals from profileSchema.js and fieldRules.js, which are
 * loaded first via manifest.json's content_scripts array.
 */

(function () {
  if (window.__internshipAutofillInjected) return;
  window.__internshipAutofillInjected = true;

  const EXCLUDED_INPUT_TYPES = new Set([
    "hidden", "password", "file", "submit", "button", "reset", "image", "range", "color", "search"
  ]);

  const KEY_TO_FIELD_DEF = {};
  for (const section of PROFILE_SCHEMA) {
    for (const field of section.fields) {
      KEY_TO_FIELD_DEF[field.key] = field;
    }
  }

  // ---------- text normalization ----------

  function normalizeSignal(raw) {
    if (!raw) return "";
    return raw
      .replace(/([a-z])([A-Z])/g, "$1 $2") // camelCase -> camel Case
      .replace(/[_\-.]+/g, " ")            // snake_case / kebab-case
      .replace(/[^a-zA-Z0-9\s]/g, " ")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function textOf(el) {
    return el ? (el.innerText || el.textContent || "") : "";
  }

  // ---------- label discovery ----------

  function resolveLabelledBy(el) {
    const ids = (el.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean);
    return ids
      .map((id) => document.getElementById(id))
      .map(textOf)
      .join(" ");
  }

  function resolveDescribedBy(el) {
    const ids = (el.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean);
    return ids
      .map((id) => document.getElementById(id))
      .map(textOf)
      .join(" ");
  }

  function findAssociatedLabel(el) {
    if (el.id) {
      const byFor = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (byFor) return textOf(byFor);
    }
    const wrapping = el.closest("label");
    if (wrapping) return textOf(wrapping);
    return "";
  }

  const HEADING_TAG_RE = /^(label|legend|h1|h2|h3|h4|h5|h6|p|dt|span|div|strong|b)$/i;

  // Walks upward through *preceding siblings* (not arbitrary descendants,
  // which would just find whatever matching element happens to come first
  // in the whole ancestor's subtree) looking for a heading/label/legend
  // that visually precedes this field, for form frameworks (Workday in
  // particular) that don't wire label[for] to the input at all.
  function findNearbyQuestionText(el) {
    const legend = el.closest("fieldset")?.querySelector("legend");
    if (legend) return textOf(legend);

    let node = el;
    for (let depth = 0; depth < 4 && node; depth++) {
      let sibling = node.previousElementSibling;
      let hops = 0;
      while (sibling && hops < 2) {
        const containsControl = !!sibling.querySelector(
          'input, select, textarea, [role="radio"], [role="checkbox"], [role="option"], [role="combobox"]'
        );
        if (HEADING_TAG_RE.test(sibling.tagName) && !containsControl) {
          const t = textOf(sibling).trim();
          if (t && t.length < 200) return t;
        }
        // A fieldset, or any sibling that itself holds a form control, is
        // another field (or field group) entirely — stop looking further
        // back so we don't attribute a neighboring question's label to
        // this field.
        if (sibling.tagName === "FIELDSET" || containsControl) break;
        sibling = sibling.previousElementSibling;
        hops++;
      }
      node = node.parentElement;
    }
    return "";
  }

  function getFieldSignal(el) {
    const parts = [
      findAssociatedLabel(el),
      resolveLabelledBy(el),
      el.getAttribute("aria-label") || "",
      el.getAttribute("placeholder") || "",
      el.getAttribute("data-automation-id") || "",
      el.name || "",
      el.id || "",
      el.getAttribute("title") || "",
      findNearbyQuestionText(el),
      resolveDescribedBy(el)
    ];
    return normalizeSignal(parts.filter(Boolean).join(" "));
  }

  function getOwnOptionLabel(el) {
    // For a single radio/checkbox within a group, the text of *this*
    // specific option (e.g. "Yes" vs the group question "Are you...?").
    // aria-labelledby matters here specifically for custom ARIA radio
    // widgets (e.g. SAP Fiori's span[role="radio"]) that reference a
    // sibling <label> by id rather than wrapping it or using aria-label.
    const own = findAssociatedLabel(el) || resolveLabelledBy(el) || el.getAttribute("aria-label") || el.value || "";
    return normalizeSignal(own);
  }

  // ---------- matching ----------

  function matchKeyForSignal(signal) {
    for (const key of FIELD_MATCH_ORDER) {
      const patterns = FIELD_RULES[key];
      if (patterns && patterns.some((re) => re.test(signal))) return key;
    }
    for (const key of Object.keys(FIELD_RULES)) {
      if (FIELD_MATCH_ORDER.includes(key)) continue;
      if (FIELD_RULES[key].some((re) => re.test(signal))) return key;
    }
    return null;
  }

  // ---------- value resolution ----------

  function resolveValue(key, profile) {
    if (key === "fullName") {
      return `${profile.firstName || ""} ${profile.lastName || ""}`.trim();
    }
    if (key === "graduationDate") {
      return `${profile.graduationMonth || ""} ${profile.graduationYear || ""}`.trim();
    }
    return profile[key];
  }

  const HISPANIC_OPTION_PATTERN = /hispanic|latino|latina|latinx/i;

  // Some ATS platforms fold ethnicity into the same single-choice list as
  // race (e.g. "White", "Hispanic or Latino", "Black or African American",
  // ... as one mutually-exclusive control) instead of asking them as two
  // separate questions the way PROFILE_SCHEMA does. When that combined list
  // is what we're actually filling, and the applicant identifies as
  // Hispanic/Latino, that option is preferred over whatever plain race
  // value is stored — matches instruction, and is also the more complete/
  // correct answer on a form that only allows picking one.
  function getEffectiveValue(key, profile, optionTexts) {
    if (key === "race" && (profile.hispanicLatino || "").trim().toLowerCase() === "yes" && optionTexts) {
      const hispanicOption = optionTexts.find((t) => HISPANIC_OPTION_PATTERN.test(t));
      if (hispanicOption) return hispanicOption;
    }
    return resolveValue(key, profile);
  }

  // Whether there's anything worth attempting to fill for this key, before
  // we necessarily know the control's option list yet (used for the cheap
  // early-exit checks) — mirrors getEffectiveValue's race special case so a
  // combined race/ethnicity dropdown isn't skipped just because plain
  // profile.race happens to be blank.
  function keyHasFillableValue(key, profile) {
    if (key === "race" && (profile.hispanicLatino || "").trim().toLowerCase() === "yes") return true;
    const v = resolveValue(key, profile);
    return v !== undefined && v !== null && v !== "";
  }

  const MONTH_NUM = {
    january: "01", february: "02", march: "03", april: "04", may: "05", june: "06",
    july: "07", august: "08", september: "09", october: "10", november: "11", december: "12"
  };

  function formatForDateInput(el, key, profile) {
    if (el.type === "month") {
      const month = MONTH_NUM[(profile.graduationMonth || "").toLowerCase()];
      const year = profile.graduationYear;
      if (month && year) return `${year}-${month}`;
      return null;
    }
    if (el.type === "date") {
      const month = MONTH_NUM[(profile.graduationMonth || "").toLowerCase()];
      const year = profile.graduationYear;
      if (month && year) return `${year}-${month}-01`;
      return null;
    }
    return undefined; // not a date-type input
  }

  // ---------- DOM writing ----------

  function setNativeValue(el, value) {
    const proto = Object.getPrototypeOf(el);
    const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
    const ownDescriptor = Object.getOwnPropertyDescriptor(el, "value");
    if (descriptor && descriptor.set && descriptor.set !== (ownDescriptor && ownDescriptor.set)) {
      descriptor.set.call(el, value);
    } else {
      el.value = value;
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function markFilled(el) {
    el.classList.add("iaf-filled-field");
    setTimeout(() => el.classList.remove("iaf-filled-field"), 2500);
  }

  function fillTextLike(el, value) {
    if (el.value && el.value.trim() !== "") return false; // don't clobber existing answers
    setNativeValue(el, String(value));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
    markFilled(el);
    return true;
  }

  function scoreOptionMatch(optionText, targetText) {
    const a = normalizeSignal(optionText);
    const b = normalizeSignal(targetText);
    if (!a || !b) return 0;
    if (a === b) return 100;
    if (a.includes(b) || b.includes(a)) return 70;
    const aWords = new Set(a.split(" "));
    const bWords = new Set(b.split(" "));
    let shared = 0;
    for (const w of bWords) if (aWords.has(w)) shared++;
    return shared > 0 ? 40 + shared * 5 : 0;
  }

  function fillSelect(el, key, profile) {
    if (el.value && el.selectedIndex > 0 && el.options[el.selectedIndex]?.value !== "") return false;
    const optionTexts = Array.from(el.options).map((o) => o.textContent);
    const targetText = getEffectiveValue(key, profile, optionTexts);
    if (!targetText) return false;
    let best = null;
    let bestScore = 0;
    for (const opt of el.options) {
      const score = Math.max(
        scoreOptionMatch(opt.textContent, targetText),
        scoreOptionMatch(opt.value, targetText)
      );
      if (score > bestScore) {
        bestScore = score;
        best = opt;
      }
    }
    if (best && bestScore >= 40) {
      setNativeValue(el, best.value);
      markFilled(el);
      return true;
    }
    return false;
  }

  const YES_WORDS = /\b(yes|true|agree|i\s*am|i\s*do)\b/;
  const NO_WORDS = /\b(no|not|false|disagree|never|none)\b/;

  function fillRadioGroup(radios, key, profile) {
    const fieldDef = KEY_TO_FIELD_DEF[key];
    let filled = false;
    if (fieldDef && fieldDef.type === "yesno") {
      const profileValue = resolveValue(key, profile);
      const wantYes = /^yes$/i.test(profileValue);
      const wantNo = /^no$/i.test(profileValue);
      if (!wantYes && !wantNo) return false;
      for (const radio of radios) {
        const label = getOwnOptionLabel(radio);
        const isYes = YES_WORDS.test(label) && !NO_WORDS.test(label);
        const isNo = NO_WORDS.test(label);
        if ((wantYes && isYes) || (wantNo && isNo && !isYes)) {
          if (!radio.checked) radio.click();
          markFilled(radio);
          filled = true;
          break;
        }
      }
    } else {
      const optionTexts = radios.map((r) => getOwnOptionLabel(r) || r.value);
      const targetText = getEffectiveValue(key, profile, optionTexts);
      if (!targetText) return false;
      let best = null;
      let bestScore = 0;
      for (const radio of radios) {
        const label = getOwnOptionLabel(radio) || radio.value;
        const score = scoreOptionMatch(label, targetText);
        if (score > bestScore) {
          bestScore = score;
          best = radio;
        }
      }
      if (best && bestScore >= 40) {
        if (!best.checked) best.click();
        markFilled(best);
        filled = true;
      }
    }
    return filled;
  }

  // Same logic as fillRadioGroup, but for custom ARIA radio widgets (no
  // native <input type="radio">, so no .checked property to read/set —
  // toggled state lives in the aria-checked attribute instead, and .click()
  // is left to the widget's own JS to update it).
  function fillAriaRadioGroup(radios, key, profile) {
    const isChecked = (r) => r.getAttribute("aria-checked") === "true";
    const fieldDef = KEY_TO_FIELD_DEF[key];
    let filled = false;
    if (fieldDef && fieldDef.type === "yesno") {
      const profileValue = resolveValue(key, profile);
      const wantYes = /^yes$/i.test(profileValue);
      const wantNo = /^no$/i.test(profileValue);
      if (!wantYes && !wantNo) return false;
      for (const radio of radios) {
        const label = getOwnOptionLabel(radio);
        const isYes = YES_WORDS.test(label) && !NO_WORDS.test(label);
        const isNo = NO_WORDS.test(label);
        if ((wantYes && isYes) || (wantNo && isNo && !isYes)) {
          if (!isChecked(radio)) radio.click();
          markFilled(radio);
          filled = true;
          break;
        }
      }
    } else {
      const optionTexts = radios.map((r) => getOwnOptionLabel(r));
      const targetText = getEffectiveValue(key, profile, optionTexts);
      if (!targetText) return false;
      let best = null;
      let bestScore = 0;
      for (const radio of radios) {
        const score = scoreOptionMatch(getOwnOptionLabel(radio), targetText);
        if (score > bestScore) {
          bestScore = score;
          best = radio;
        }
      }
      if (best && bestScore >= 40) {
        if (!isChecked(best)) best.click();
        markFilled(best);
        filled = true;
      }
    }
    return filled;
  }

  function fillSingleCheckbox(el, key, profileValue) {
    const fieldDef = KEY_TO_FIELD_DEF[key];
    if (!fieldDef || fieldDef.type !== "yesno") return false;
    const wantYes = /^yes$/i.test(profileValue);
    const wantNo = /^no$/i.test(profileValue);
    if (!wantYes && !wantNo) return false;

    const signal = getFieldSignal(el);
    const negated = NEGATION_PATTERN.test(signal);
    const desiredChecked = negated ? wantNo : wantYes;

    if (el.checked !== desiredChecked) el.click();
    markFilled(el);
    return true;
  }

  // ---------- style injection for the "filled" highlight ----------

  function injectHighlightStyle() {
    if (document.getElementById("iaf-style")) return;
    const style = document.createElement("style");
    style.id = "iaf-style";
    style.textContent = `
      .iaf-filled-field {
        outline: 2px solid #4F46E5 !important;
        outline-offset: 1px !important;
        transition: outline-color 2s ease-out;
        background-color: rgba(79, 70, 229, 0.06) !important;
      }
    `;
    document.documentElement.appendChild(style);
  }

  // ---------- main scan + fill ----------

  function getFillableElements() {
    const all = Array.from(document.querySelectorAll("input, select, textarea"));
    return all.filter((el) => {
      if (el.disabled || el.readOnly) return false;
      if (el.tagName === "INPUT" && EXCLUDED_INPUT_TYPES.has((el.type || "text").toLowerCase())) return false;
      // role="combobox" inputs (e.g. a searchable school picker) are driven
      // by clicking a result out of a popup list, not by just typing text
      // into the box — handled separately by fillCustomComboboxes().
      if (el.tagName === "INPUT" && el.getAttribute("role") === "combobox") return false;
      if (el.offsetParent === null) {
        // offsetParent is null both for display:none/detached elements and
        // for position:fixed ones; getClientRects tells them apart.
        if (el.getClientRects().length === 0) return false;
      }
      return true;
    });
  }

  function groupRadiosAndCheckboxes(elements) {
    const radioGroups = new Map();
    const checkboxGroups = new Map();
    const singles = [];
    for (const el of elements) {
      if (el.tagName === "INPUT" && el.type === "radio") {
        const key = el.name || `__unnamed_${el.id}`;
        if (!radioGroups.has(key)) radioGroups.set(key, []);
        radioGroups.get(key).push(el);
      } else if (el.tagName === "INPUT" && el.type === "checkbox" && el.name) {
        if (!checkboxGroups.has(el.name)) checkboxGroups.set(el.name, []);
        checkboxGroups.get(el.name).push(el);
      } else {
        singles.push(el);
      }
    }
    // A "group" of one is really just a standalone checkbox — put it back
    // with the rest of singles instead of running group-only logic on it.
    for (const [name, boxes] of Array.from(checkboxGroups.entries())) {
      if (boxes.length < 2) {
        singles.push(...boxes);
        checkboxGroups.delete(name);
      }
    }
    return { radioGroups, checkboxGroups, singles };
  }

  function runAutofill(profile) {
    injectHighlightStyle();
    const elements = getFillableElements();
    const { radioGroups, checkboxGroups, singles } = groupRadiosAndCheckboxes(elements);
    let filledCount = 0;
    const matchedKeys = new Set();
    const pendingSelects = [];

    // Radio groups: match on the group's overall question text.
    for (const radios of radioGroups.values()) {
      if (radios.length === 0) continue;
      const already = radios.some((r) => r.checked);
      if (already) continue;
      const signal = getFieldSignal(radios[0]) + " " + normalizeSignal(findNearbyQuestionText(radios[0]));
      if (CONDITIONAL_FOLLOWUP_PATTERN.test(signal)) continue;
      const key = matchKeyForSignal(signal);
      if (!key) continue;
      if (!keyHasFillableValue(key, profile)) continue;
      if (fillRadioGroup(radios, key, profile)) {
        filledCount++;
        matchedKeys.add(key);
      }
    }

    // ARIA-role radio groups: custom widgets (no native <input
    // type="radio"> at all — e.g. SAP Fiori's span[role="radio"]) have no
    // shared `name` attribute to group by, so they're grouped instead by
    // whichever nearby question text they resolve to being right next to.
    const ariaRadios = Array.from(document.querySelectorAll('[role="radio"]')).filter(isVisible);
    if (ariaRadios.length > 0) {
      const ariaGroups = new Map();
      for (const radio of ariaRadios) {
        const groupKey = normalizeSignal(findNearbyQuestionText(radio));
        if (!groupKey) continue; // can't safely group without a distinguishing question
        if (!ariaGroups.has(groupKey)) ariaGroups.set(groupKey, []);
        ariaGroups.get(groupKey).push(radio);
      }
      for (const radios of ariaGroups.values()) {
        if (radios.length < 2) continue;
        if (radios.some((r) => r.getAttribute("aria-checked") === "true")) continue;
        const signal = getFieldSignal(radios[0]) + " " + normalizeSignal(findNearbyQuestionText(radios[0]));
        if (CONDITIONAL_FOLLOWUP_PATTERN.test(signal)) continue;
        const key = matchKeyForSignal(signal);
        if (!key) continue;
        if (!keyHasFillableValue(key, profile)) continue;
        if (fillAriaRadioGroup(radios, key, profile)) {
          filledCount++;
          matchedKeys.add(key);
        }
      }
    }

    // Checkbox groups: currently only "which term(s) are you available for"
    // style questions get special handling — check every box rather than
    // guessing a single preferred term.
    for (const boxes of checkboxGroups.values()) {
      if (boxes.length === 0) continue;
      const signal = getFieldSignal(boxes[0]) + " " + normalizeSignal(findNearbyQuestionText(boxes[0]));
      if (CONDITIONAL_FOLLOWUP_PATTERN.test(signal)) continue;
      if (!TERM_AVAILABILITY_PATTERN.test(signal) || !AVAILABILITY_CONTEXT_PATTERN.test(signal)) continue;
      let toggled = 0;
      for (const box of boxes) {
        if (!box.checked) {
          box.click();
          toggled++;
        }
        markFilled(box);
      }
      if (toggled > 0) {
        filledCount += toggled;
        matchedKeys.add("termAvailability");
      }
    }

    // Everything else: text inputs, textareas, selects, standalone checkboxes.
    for (const el of singles) {
      const signal = getFieldSignal(el);
      if (!signal) continue;
      if (CONDITIONAL_FOLLOWUP_PATTERN.test(signal)) continue;
      const key = matchKeyForSignal(signal);
      if (!key) continue;
      if (!keyHasFillableValue(key, profile)) continue;

      let didFill = false;
      if (el.tagName === "SELECT") {
        if (el.options.length > 1) {
          didFill = fillSelect(el, key, profile);
        } else {
          // Only the placeholder option exists so far — many ATS platforms
          // (Taleo in particular) populate big reference-data dropdowns
          // (school lists, EEO categories, clearance levels) via a
          // background request that finishes after the page first renders.
          // Retry this one for a few seconds instead of giving up.
          pendingSelects.push({ el, key });
        }
      } else if (el.tagName === "INPUT" && el.type === "checkbox") {
        didFill = fillSingleCheckbox(el, key, resolveValue(key, profile));
      } else if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
        const dateVal = formatForDateInput(el, key, profile);
        if (dateVal !== undefined) {
          if (dateVal !== null) didFill = fillTextLike(el, dateVal);
        } else {
          didFill = fillTextLike(el, resolveValue(key, profile));
        }
      }
      if (didFill) {
        filledCount++;
        matchedKeys.add(key);
      }
    }

    scheduleSelectRetries(pendingSelects, profile);
    fillCustomWidgets(profile);

    return { filledCount, matchedKeys: Array.from(matchedKeys) };
  }

  const SELECT_RETRY_DELAYS_MS = [800, 1800, 3500, 6000];

  // Re-attempts <select> elements that had no real options yet at scan
  // time. Runs after runAutofill has already returned its response to the
  // popup, so a field filled this way only gets the visual highlight, not
  // an updated "Filled N fields" count — that's fine, the point is just
  // getting the value in before you submit.
  function scheduleSelectRetries(pending, profile) {
    if (pending.length === 0) return;
    let attempt = 0;
    const tryNow = () => {
      const stillPending = [];
      for (const { el, key } of pending) {
        if (!document.isConnected || !document.contains(el)) continue;
        if (el.options.length > 1 && fillSelect(el, key, profile)) continue;
        stillPending.push({ el, key });
      }
      pending = stillPending;
      attempt++;
      if (pending.length > 0 && attempt < SELECT_RETRY_DELAYS_MS.length) {
        setTimeout(tryNow, SELECT_RETRY_DELAYS_MS[attempt]);
      }
    };
    setTimeout(tryNow, SELECT_RETRY_DELAYS_MS[0]);
  }

  // ---------- custom (non-native) dropdown widgets ----------
  //
  // Some ATS platforms (SAP SuccessFactors/Fiori in particular) don't use a
  // native <select> at all — the visible "dropdown" is a clickable trigger
  // (role="button", commonly classed fd-select__control) that, on click,
  // renders a popup list elsewhere in the DOM (role="listbox" of
  // role="option" items, often appended near <body> rather than nested
  // inside the control). A related "searchable" variant pairs a real
  // <input role="combobox"> with a button that opens that same kind of
  // popup, filtered by whatever you type into the input — used for things
  // like a long school list.
  //
  // These need actual simulated interaction — click to open, wait for the
  // popup to render, click the matching option — rather than a direct DOM
  // value write. This is built around ARIA roles (role="button",
  // role="listbox", role="option", role="combobox") plus the concrete
  // class name observed (fd-select__control) to generalize as far as
  // reasonably possible; exact markup and popup timing still vary by site,
  // so treat this as best-effort and expect it may need tuning per ATS.

  const CUSTOM_TRIGGER_SELECTOR = '.fd-select__control, a[role="button"][aria-haspopup], button[aria-haspopup="listbox"]';
  const OPTION_SELECTOR = '[role="option"], li';
  const LISTBOX_SELECTOR = '[role="listbox"]';
  const CUSTOM_WIDGET_OPEN_TIMEOUT_MS = 1500;

  function waitFor(predicate, timeoutMs, intervalMs = 100) {
    return new Promise((resolve) => {
      const start = Date.now();
      (function poll() {
        let result;
        try {
          result = predicate();
        } catch {
          result = null;
        }
        if (result) return resolve(result);
        if (Date.now() - start >= timeoutMs) return resolve(null);
        setTimeout(poll, intervalMs);
      })();
    });
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function isVisible(el) {
    if (!el) return false;
    if (el.hasAttribute("hidden")) return false;
    const view = el.ownerDocument.defaultView;
    const style = view && view.getComputedStyle ? view.getComputedStyle(el) : null;
    if (style && (style.display === "none" || style.visibility === "hidden")) return false;
    return el.getClientRects().length > 0;
  }

  function findVisibleListbox(knownListboxes) {
    const all = Array.from(document.querySelectorAll(LISTBOX_SELECTOR));
    const fresh = all.find((box) => !knownListboxes.has(box) && isVisible(box));
    if (fresh) return fresh;
    // Some widgets keep one listbox element in the DOM at all times and
    // just toggle its visibility, so also accept an already-known one that
    // has since become visible.
    return all.find(isVisible) || null;
  }

  function pickBestOption(options, targetText) {
    let best = null;
    let bestScore = 0;
    for (const opt of options) {
      const score = scoreOptionMatch(opt.textContent, targetText);
      if (score > bestScore) {
        bestScore = score;
        best = opt;
      }
    }
    return bestScore >= 40 ? best : null;
  }

  async function fillCustomTrigger(trigger, key, profile) {
    const knownListboxes = new Set(document.querySelectorAll(LISTBOX_SELECTOR));
    const wasOpen = trigger.getAttribute("aria-expanded") === "true";
    if (!wasOpen) trigger.click();

    const listbox = await waitFor(() => findVisibleListbox(knownListboxes), CUSTOM_WIDGET_OPEN_TIMEOUT_MS);
    if (!listbox) return false;

    const options = listbox.querySelectorAll(OPTION_SELECTOR);
    const targetText = getEffectiveValue(key, profile, Array.from(options).map((o) => o.textContent));
    const best = targetText ? pickBestOption(options, targetText) : null;
    if (best) {
      best.click();
      markFilled(trigger);
      return true;
    }
    if (!wasOpen) trigger.click(); // nothing matched — close it back up
    return false;
  }

  async function fillPaginatedCombobox(inputEl, key, profile) {
    const knownListboxes = new Set(document.querySelectorAll(LISTBOX_SELECTOR));
    // Start the search at the parent, not inputEl itself — the input's own
    // class often *also* contains "input-group" as a substring (e.g.
    // "fd-input-group__input"), which made closest() match the input
    // itself and then look for a <button> *inside* it (impossible), always
    // coming up empty.
    const container = inputEl.parentElement && inputEl.parentElement.closest('[class*="input-group" i]');
    const openButton = (container || inputEl.parentElement) && (container || inputEl.parentElement).querySelector("button");
    (openButton || inputEl).click();

    // Not every one of these widgets actually requires typing a search
    // query — a short, fixed list (Veteran Status, Race, Gender) is likely
    // to show all of its options as soon as it's opened. Try matching
    // against whatever's already visible first: typing a full stored
    // sentence like "I am not a protected veteran" into a box that expects
    // a short query term (or none at all) can return zero server-side
    // results, leaving that raw text sitting rejected in the box instead
    // of ever selecting anything. Only fall back to typing if nothing
    // matched what was already there — that's what a long searchable list
    // (e.g. a school picker) actually needs.
    let best = await tryMatchVisibleListbox(knownListboxes, key, profile);

    if (!best) {
      const queryValue = getComboboxQuery(key, profile);
      if (!queryValue) return false;
      setNativeValue(inputEl, queryValue);
      inputEl.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));

      const listbox = await waitFor(() => findVisibleListbox(knownListboxes), CUSTOM_WIDGET_OPEN_TIMEOUT_MS);
      if (listbox) {
        await sleep(400); // let the widget's own search/filter settle before reading its results
        const options = listbox.querySelectorAll(OPTION_SELECTOR);
        const targetText = getEffectiveValue(key, profile, Array.from(options).map((o) => o.textContent)) || queryValue;
        best = pickBestOption(options, targetText);
      }
      if (!best) {
        if (inputEl.value) setNativeValue(inputEl, ""); // don't leave rejected free text sitting there
        return false;
      }
    }

    best.click();
    markFilled(inputEl);
    return true;
  }

  // A short query term is far more likely to actually match a search-driven
  // widget's server-side lookup than a full stored sentence would — used
  // only as the typed fallback when nothing was already visible on open.
  function getComboboxQuery(key, profile) {
    if (key === "race" && (profile.hispanicLatino || "").trim().toLowerCase() === "yes") {
      return "Hispanic";
    }
    return resolveValue(key, profile);
  }

  async function tryMatchVisibleListbox(knownListboxes, key, profile) {
    const listbox = await waitFor(() => findVisibleListbox(knownListboxes), 700);
    if (!listbox) return null;
    const options = listbox.querySelectorAll(OPTION_SELECTOR);
    const targetText = getEffectiveValue(key, profile, Array.from(options).map((o) => o.textContent));
    return targetText ? pickBestOption(options, targetText) : null;
  }

  // Runs after the synchronous pass, one widget at a time (opening two of
  // these popups at once would be unreliable) — fire-and-forget from
  // runAutofill's point of view, same as scheduleSelectRetries.
  async function fillCustomWidgets(profile) {
    const triggers = Array.from(document.querySelectorAll(CUSTOM_TRIGGER_SELECTOR));
    for (const trigger of triggers) {
      if (!isVisible(trigger)) continue;
      const signal = getFieldSignal(trigger) + " " + normalizeSignal(findNearbyQuestionText(trigger));
      if (CONDITIONAL_FOLLOWUP_PATTERN.test(signal)) continue;
      const key = matchKeyForSignal(signal);
      if (!key) continue;
      if (!keyHasFillableValue(key, profile)) continue;
      await fillCustomTrigger(trigger, key, profile);
      await sleep(150);
    }

    const comboboxInputs = Array.from(document.querySelectorAll('input[role="combobox"]'));
    for (const inputEl of comboboxInputs) {
      if (!isVisible(inputEl) || inputEl.value) continue;
      const signal = getFieldSignal(inputEl) + " " + normalizeSignal(findNearbyQuestionText(inputEl));
      if (CONDITIONAL_FOLLOWUP_PATTERN.test(signal)) continue;
      const key = matchKeyForSignal(signal);
      if (!key) continue;
      if (!keyHasFillableValue(key, profile)) continue;
      await fillPaginatedCombobox(inputEl, key, profile);
      await sleep(150);
    }
  }

  function loadProfileAndFill(sendResponse) {
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      const profile = result[STORAGE_KEY] || buildDefaultProfile();
      const hasAnyValue = Object.values(profile).some((v) => v && String(v).trim() !== "");
      if (!hasAnyValue) {
        sendResponse({ ok: false, reason: "no-profile" });
        return;
      }
      try {
        const { filledCount, matchedKeys } = runAutofill(profile);
        sendResponse({ ok: true, filledCount, matchedKeys });
      } catch (err) {
        sendResponse({ ok: false, reason: "error", message: String(err && err.message || err) });
      }
    });
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && message.type === "AUTOFILL") {
      loadProfileAndFill(sendResponse);
      return true; // keep the message channel open for the async response
    }
  });
})();
