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
        const containsControl = !!sibling.querySelector("input, select, textarea");
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
    const own = findAssociatedLabel(el) || el.getAttribute("aria-label") || el.value || "";
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

  function fillSelect(el, targetText) {
    if (el.value && el.selectedIndex > 0 && el.options[el.selectedIndex]?.value !== "") return false;
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

  function fillRadioGroup(radios, key, profileValue) {
    const fieldDef = KEY_TO_FIELD_DEF[key];
    let filled = false;
    if (fieldDef && fieldDef.type === "yesno") {
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
      let best = null;
      let bestScore = 0;
      for (const radio of radios) {
        const label = getOwnOptionLabel(radio) || radio.value;
        const score = scoreOptionMatch(label, profileValue);
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
      if (el.offsetParent === null) {
        // offsetParent is null both for display:none/detached elements and
        // for position:fixed ones; getClientRects tells them apart.
        if (el.getClientRects().length === 0) return false;
      }
      return true;
    });
  }

  function groupRadiosAndCheckboxes(elements) {
    const groups = new Map();
    const singles = [];
    for (const el of elements) {
      if (el.tagName === "INPUT" && (el.type === "radio")) {
        const key = el.name || `__unnamed_${el.id}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(el);
      } else {
        singles.push(el);
      }
    }
    return { groups, singles };
  }

  function runAutofill(profile) {
    injectHighlightStyle();
    const elements = getFillableElements();
    const { groups, singles } = groupRadiosAndCheckboxes(elements);
    let filledCount = 0;
    const matchedKeys = new Set();

    // Radio groups: match on the group's overall question text.
    for (const radios of groups.values()) {
      if (radios.length === 0) continue;
      const already = radios.some((r) => r.checked);
      if (already) continue;
      const signal = getFieldSignal(radios[0]) + " " + normalizeSignal(findNearbyQuestionText(radios[0]));
      if (CONDITIONAL_FOLLOWUP_PATTERN.test(signal)) continue;
      const key = matchKeyForSignal(signal);
      if (!key) continue;
      const value = resolveValue(key, profile);
      if (value === undefined || value === null || value === "") continue;
      if (fillRadioGroup(radios, key, value)) {
        filledCount++;
        matchedKeys.add(key);
      }
    }

    // Everything else: text inputs, textareas, selects, standalone checkboxes.
    for (const el of singles) {
      const signal = getFieldSignal(el);
      if (!signal) continue;
      if (CONDITIONAL_FOLLOWUP_PATTERN.test(signal)) continue;
      const key = matchKeyForSignal(signal);
      if (!key) continue;
      const value = resolveValue(key, profile);
      if (value === undefined || value === null || value === "") continue;

      let didFill = false;
      if (el.tagName === "SELECT") {
        didFill = fillSelect(el, value);
      } else if (el.tagName === "INPUT" && el.type === "checkbox") {
        didFill = fillSingleCheckbox(el, key, value);
      } else if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
        const dateVal = formatForDateInput(el, key, profile);
        if (dateVal !== undefined) {
          if (dateVal !== null) didFill = fillTextLike(el, dateVal);
        } else {
          didFill = fillTextLike(el, value);
        }
      }
      if (didFill) {
        filledCount++;
        matchedKeys.add(key);
      }
    }

    return { filledCount, matchedKeys: Array.from(matchedKeys) };
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
