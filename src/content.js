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
        // [class*="__control"]/[class*="__menu"] catch react-select-style
        // custom dropdowns the same way the ARIA roles catch native-ish
        // ones — without this, two such dropdowns sitting side by side
        // (e.g. a phone number's "Country" code selector next to "Phone")
        // can have one mistaken for the other's label, the same bug
        // already fixed once for neighboring ARIA radio buttons.
        const controlSelector =
          'input, select, textarea, [role="radio"], [role="checkbox"], [role="option"], [role="combobox"], [class*="__control"], [class*="__menu"]';
        const containsControl = sibling.matches(controlSelector) || !!sibling.querySelector(controlSelector);
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

  // Repeatable "Work Experience" blocks (Workday's "My Experience" page,
  // and any similarly-structured ATS): profile.workHistoryEntries is an
  // ordered array the applicant fills in once, in the same order they'll
  // click "Add Another" on the real form. Rather than track a separate
  // occurrence counter per field key (which drifts out of sync the moment
  // a field is conditionally absent — Workday drops the "To" date entirely
  // once "I currently work here" is checked), a single shared cursor marks
  // "which block are we in," advanced only when a Job Title field is
  // matched — it's the one field every block is guaranteed to have, always
  // first. Every other repeatable-key field in that same block just reads
  // the cursor's current position without moving it.
  const WORK_HISTORY_KEY_TO_FIELD = {
    jobTitle: "jobTitle",
    employer: "company",
    workLocation: "location",
    workStartDate: "startDate",
    workEndDate: "endDate",
    workDescription: "description"
  };
  const WORK_HISTORY_REPEATABLE_KEYS = new Set([...Object.keys(WORK_HISTORY_KEY_TO_FIELD), "currentlyWorking"]);
  let workHistoryBlockIndex = -1;

  function peekWorkHistoryValue(key, profile) {
    if (!WORK_HISTORY_REPEATABLE_KEYS.has(key)) return undefined;
    const entries = profile.workHistoryEntries;
    if (!Array.isArray(entries) || entries.length === 0) return undefined; // feature unused -> fall back to the flat single-job fields
    const entry = workHistoryBlockIndex >= 0 ? entries[workHistoryBlockIndex] : undefined;
    if (!entry) return ""; // past the last entry, or not inside a tracked block yet
    if (key === "currentlyWorking") return entry.currentlyWorkHere ? "Yes" : "No";
    return entry[WORK_HISTORY_KEY_TO_FIELD[key]] || "";
  }

  function resolveValue(key, profile) {
    const workHistoryValue = peekWorkHistoryValue(key, profile);
    if (workHistoryValue !== undefined) return workHistoryValue;
    if (key === "fullName") {
      return `${profile.firstName || ""} ${profile.lastName || ""}`.trim();
    }
    if (key === "graduationDate") {
      return `${profile.graduationMonth || ""} ${profile.graduationYear || ""}`.trim();
    }
    return profile[key];
  }

  const HISPANIC_OPTION_PATTERN = /hispanic|latino|latina|latinx/i;

  // Some sites split "degree level" into separate options per type — e.g.
  // "Bachelor of Arts" and "Bachelor of Science" as two distinct choices
  // rather than one generic "Bachelor's Degree". Plain word-overlap
  // scoring can't tell those apart (neither contains the stored
  // "Bachelor's Degree", and both share only the word "bachelor" with it,
  // so it's a coin-flip which one wins the tie) — confirmed on a real
  // site: "Bachelor of Arts" got picked over "Bachelor of Science" this
  // way. Only applied when the applicant has actually set a degree type;
  // left blank, this never engages and generic "Bachelor's Degree"-only
  // sites are unaffected.
  const DEGREE_TYPE_PATTERNS = {
    "Science (BS/MS)": /\bscience\b|\bb\.?\s*sc\.?\b|\bm\.?\s*sc\.?\b|\bbs\b|\bms\b/i,
    "Arts (BA/MA)": /\barts\b|\bb\.?\s*a\.?\b|\bm\.?\s*a\.?\b/i,
    "Business Administration (BBA/MBA)": /\bbusiness\s*administration\b|\bbba\b|\bmba\b/i,
    "Fine Arts (BFA/MFA)": /\bfine\s*arts\b|\bbfa\b|\bmfa\b/i,
    "Engineering (BEng/MEng)": /\bengineering\b|\bb\.?\s*eng\.?\b|\bm\.?\s*eng\.?\b|\bbse\b/i
  };

  function degreeLevelWord(degreeValue) {
    const v = (degreeValue || "").toLowerCase();
    if (/associate/.test(v)) return "associate";
    if (/bachelor/.test(v)) return "bachelor";
    if (/master/.test(v)) return "master";
    if (/doctor|phd/.test(v)) return "doctor";
    return null;
  }

  // Some ATS platforms fold ethnicity into the same single-choice list as
  // race (e.g. "White", "Hispanic or Latino", "Black or African American",
  // ... as one mutually-exclusive control) instead of asking them as two
  // separate questions the way PROFILE_SCHEMA does. When that combined list
  // is what we're actually filling, and the applicant identifies as
  // Hispanic/Latino, that option is preferred over whatever plain race
  // value is stored — matches instruction, and is also the more complete/
  // correct answer on a form that only allows picking one.
  // US academic-term convention: a December graduation is normally
  // completing the Fall semester, not literally "Winter" — matches how
  // schools actually label these terms, not a calendar-season reading.
  const SEASON_BY_MONTH = {
    january: "Winter", february: "Winter",
    march: "Spring", april: "Spring", may: "Spring",
    june: "Summer", july: "Summer", august: "Summer",
    september: "Fall", october: "Fall", november: "Fall", december: "Fall"
  };
  const SEASON_WORD_PATTERN = /\b(spring|summer|fall|winter)\b/i;
  // Cyclic order used to find "the next term after you actually graduate"
  // when your exact term isn't offered (e.g. a program that only runs
  // Winter/Spring cohorts, for a December/Fall grad) — Winter follows Fall.
  const SEASON_CYCLE = ["Winter", "Spring", "Summer", "Fall"];

  function findClosestSeasonOption(targetSeason, optionTexts) {
    const startIdx = SEASON_CYCLE.indexOf(targetSeason);
    if (startIdx === -1) return null;
    for (let step = 0; step < SEASON_CYCLE.length; step++) {
      const season = SEASON_CYCLE[(startIdx + step) % SEASON_CYCLE.length];
      const match = optionTexts.find((t) => new RegExp(`\\b${season}\\b`, "i").test(t));
      if (match) return match; // the real rendered option text — guarantees an exact-match pick
    }
    return null;
  }

  function getEffectiveValue(key, profile, optionTexts) {
    if (key === "race" && (profile.hispanicLatino || "").trim().toLowerCase() === "yes" && optionTexts) {
      const hispanicOption = optionTexts.find((t) => HISPANIC_OPTION_PATTERN.test(t));
      if (hispanicOption) return hispanicOption;
    }
    if (key === "graduationDate" && optionTexts && optionTexts.some((t) => SEASON_WORD_PATTERN.test(t))) {
      // The dropdown offers term names (Spring/Summer/Fall/Winter), not
      // literal months — a stored month like "December" shares no words
      // with any of those options, so plain fuzzy matching just picks
      // whichever season happens to score/tie-break first. Translate the
      // stored month to its term instead, falling forward to the next
      // available term if the exact one isn't offered at all.
      const season = SEASON_BY_MONTH[(profile.graduationMonth || "").trim().toLowerCase()];
      if (season) {
        const closest = findClosestSeasonOption(season, optionTexts);
        if (closest) return closest;
      }
    }
    if (key === "degree" && optionTexts && profile.degreeType && DEGREE_TYPE_PATTERNS[profile.degreeType]) {
      const level = degreeLevelWord(profile.degree);
      const typePattern = DEGREE_TYPE_PATTERNS[profile.degreeType];
      const preferred = optionTexts.find(
        (t) => typePattern.test(t) && (!level || new RegExp(`\\b${level}`, "i").test(t))
      );
      if (preferred) return preferred;
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

  // Sensitive identity/voluntary-disclosure fields (race/ethnicity, gender,
  // hispanicLatino) must never be filled from a merely-plausible
  // word-overlap match. These keys require containment-level confidence
  // (70+ — the option and the stored answer actually contain one another)
  // or the field is left blank rather than risk a wrong disclosure.
  const STRICT_MATCH_KEYS = new Set(["race", "hispanicLatino", "gender"]);
  function matchThreshold(key) {
    return STRICT_MATCH_KEYS.has(key) ? 70 : 40;
  }

  // veteranStatus / disabilityStatus render as a small set of options whose
  // wording varies a lot between sites (our own canonical "I am not a
  // protected veteran" vs. a site's "Not Protected Veteran (OFCCP)" —
  // legitimately correct, but too little word overlap to hit 70). Raising
  // the bar to containment would leave those blank too. But plain
  // word-overlap can't tell "differently worded, same meaning" apart from
  // "differently worded, opposite meaning" — confirmed on a real site: "I
  // am not a protected veteran" scored higher, by shared words alone,
  // against the wrong option "I identify as a veteran, just not a
  // protected veteran" than the shared-word count alone would suggest,
  // despite that option asserting the applicant DOES identify as a
  // veteran. So these two keys get a cheap polarity check first — does the
  // option affirm or deny the underlying condition — and any option whose
  // polarity contradicts the stored answer's is rejected outright, before
  // word-overlap scoring ever runs.
  const POLARITY_GATED_KEYS = new Set(["veteranStatus", "disabilityStatus"]);

  // Both sensitive-field safeguards above (containment-only matching and
  // polarity gating) can be defeated the same way: an option's raw HTML
  // `value` attribute is often a short code ("a", "1", "true") that's a
  // trivial substring of practically any long targetText sentence, scoring
  // a meaningless 70 with no determinable polarity to gate on either. So
  // no sensitive key is ever matched against opt.value — only its visible
  // text — regardless of which of the two safeguards applies to it.
  const NO_VALUE_MATCH_KEYS = new Set([...STRICT_MATCH_KEYS, ...POLARITY_GATED_KEYS]);

  const DECLINE_POLARITY_PATTERN = /\bdon.?t\s+wish\b|\bdecline\b|\bprefer\s+not\s+to\s+answer\b/;
  const AFFIRMATIVE_POLARITY_PATTERN = /\bidentify\s+as\b|\bhave\s+a\s+disability\b|^yes\b/;
  const NEGATIVE_POLARITY_PATTERN = /\bnot\s+a\b|\bnot\s+protected\b|^no\b|\bdo\s+not\s+have\b|\bdo\s+not\s+identify\b/;

  function identityPolarity(text) {
    const t = normalizeSignal(text);
    if (!t) return null;
    if (DECLINE_POLARITY_PATTERN.test(t)) return "decline";
    // Checked before "negative": an affirmative self-identification
    // ("I identify as a veteran, just not a protected veteran") should
    // read as affirmative even though it also contains a later "not"
    // qualifier — the leading claim is the one that matters.
    if (AFFIRMATIVE_POLARITY_PATTERN.test(t)) return "affirmative";
    if (NEGATIVE_POLARITY_PATTERN.test(t)) return "negative";
    return null;
  }

  function scoreOptionMatchForKey(optionText, targetText, key) {
    if (POLARITY_GATED_KEYS.has(key)) {
      const targetPolarity = identityPolarity(targetText);
      const optionPolarity = identityPolarity(optionText);
      if (targetPolarity && optionPolarity && targetPolarity !== optionPolarity) return 0;
    }
    return scoreOptionMatch(optionText, targetText);
  }

  function fillSelect(el, key, profile) {
    if (el.value && el.selectedIndex > 0 && el.options[el.selectedIndex]?.value !== "") return false;
    const optionTexts = Array.from(el.options).map((o) => o.textContent);
    const targetText = getEffectiveValue(key, profile, optionTexts);
    if (!targetText) return false;
    let best = null;
    let bestScore = 0;
    // Sensitive keys skip opt.value: a short HTML value attribute (e.g.
    // "a", "1") is trivially a substring of any long targetText sentence,
    // scoring a meaningless containment match with no real polarity to
    // gate on, which would silently defeat both safeguards above.
    const skipValueMatch = NO_VALUE_MATCH_KEYS.has(key);
    for (const opt of el.options) {
      const score = skipValueMatch
        ? scoreOptionMatchForKey(opt.textContent, targetText, key)
        : Math.max(
            scoreOptionMatchForKey(opt.textContent, targetText, key),
            scoreOptionMatchForKey(opt.value, targetText, key)
          );
      if (score > bestScore) {
        bestScore = score;
        best = opt;
      }
    }
    if (best && bestScore >= matchThreshold(key)) {
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
        const score = scoreOptionMatchForKey(label, targetText, key);
        if (score > bestScore) {
          bestScore = score;
          best = radio;
        }
      }
      if (best && bestScore >= matchThreshold(key)) {
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
    workHistoryBlockIndex = -1; // reset the repeatable-work-block cursor for this pass
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
        try {
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
        } catch (err) {
          // One malformed/unexpected ARIA radio group must never abort
          // every field that would otherwise be processed after it.
          console.error("[Internship Autofill] ARIA radio group failed:", err);
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
      // A Job Title field always marks the start of a new repeatable work
      // block (see peekWorkHistoryValue above) — advance the shared cursor
      // here, once per element, before anything in this block resolves a
      // value from it.
      if (key === "jobTitle" && Array.isArray(profile.workHistoryEntries) && profile.workHistoryEntries.length > 0) {
        workHistoryBlockIndex++;
      }
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
  // Some ATS platforms don't use a native <select> at all — the visible
  // "dropdown" is a clickable trigger that, on click, renders a popup list
  // elsewhere in the DOM. Two families confirmed on real sites so far:
  //   - SAP SuccessFactors/Fiori: role="button", classed fd-select__control,
  //     opens a role="listbox" of role="option" items.
  //   - react-select (very common on modern React-built career sites,
  //     confirmed on a Greenhouse job-boards.greenhouse.io posting): a
  //     clickable control div whose class follows react-select's own BEM
  //     convention regardless of the site's chosen prefix — always
  //     "{prefix}__control", opening a "{prefix}__menu" of
  //     "{prefix}__option" items. Matching on the "__control"/"__menu"/
  //     "__option" suffix (rather than a hardcoded prefix like
  //     "select__") generalizes across any site's prefix choice.
  // A related "searchable" variant pairs a real <input role="combobox">
  // with a button that opens that same kind of popup, filtered by whatever
  // you type into the input — used for things like a long school list.
  //
  // These need actual simulated interaction — click to open, wait for the
  // popup to render, click the matching option — rather than a direct DOM
  // value write. Exact markup and popup timing still vary by site, so
  // treat this as best-effort and expect it may need tuning per ATS.

  const CUSTOM_TRIGGER_SELECTOR =
    '.fd-select__control, a[role="button"][aria-haspopup], button[aria-haspopup="listbox"], [class*="__control"]';
  const OPTION_SELECTOR = '[role="option"], li, [class*="__option"]';
  const LISTBOX_SELECTOR = '[role="listbox"], [class*="__menu"]';
  const CUSTOM_WIDGET_OPEN_TIMEOUT_MS = 1500;

  // Some custom dropdowns show their label only as a placeholder that
  // disappears once a default value is already selected (confirmed on a
  // real site: a phone country-code picker's "Country" placeholder was
  // gone by the time the page was scanned, since it already had a default
  // value, so the nearby-text walk fell back to the next real label it
  // could find — "Phone" — and typed a raw phone number into a country
  // selector). Rather than chase every such case, these keys represent
  // inherently free-form data that no legitimate dropdown/select would
  // ever represent, so they're never eligible for the click-a-widget
  // filling path regardless of what key the matcher lands on.
  const NEVER_DROPDOWN_KEYS = new Set([
    "phone", "email", "linkedin", "github", "portfolio",
    "workDescription", "addressStreet", "firstName", "lastName", "preferredName"
  ]);

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
    // has since become visible. Search from the end: a portal-style widget
    // appends its listbox at the end of <body>, so when an earlier field's
    // dropdown never got a confident match (and so was never clicked/
    // closed), its now-stale listbox is still visible but sits earlier in
    // document order — scanning in reverse prefers the current field's
    // own listbox over that leftover one.
    for (let i = all.length - 1; i >= 0; i--) {
      if (isVisible(all[i])) return all[i];
    }
    return null;
  }

  function pickBestOption(options, targetText, key) {
    let best = null;
    let bestScore = 0;
    for (const opt of options) {
      const score = scoreOptionMatchForKey(opt.textContent, targetText, key);
      if (score > bestScore) {
        bestScore = score;
        best = opt;
      }
    }
    return bestScore >= matchThreshold(key) ? best : null;
  }

  // A plain el.click() only ever fires a "click" event — some widget
  // libraries (react-select among them, in several versions) open their
  // menu on mousedown instead, specifically to support click-and-drag
  // selection, so a click-only simulation can silently do nothing. Firing
  // the full mousedown/mouseup/click sequence covers both styles without
  // being any riskier for widgets that only listen for click.
  function simulateClick(el) {
    const opts = { bubbles: true, cancelable: true, view: window };
    el.dispatchEvent(new MouseEvent("mousedown", opts));
    el.dispatchEvent(new MouseEvent("mouseup", opts));
    el.click();
  }

  async function fillCustomTrigger(trigger, key, profile) {
    const knownListboxes = new Set(document.querySelectorAll(LISTBOX_SELECTOR));
    const wasOpen = trigger.getAttribute("aria-expanded") === "true";
    if (!wasOpen) simulateClick(trigger);

    const listbox = await waitFor(() => findVisibleListbox(knownListboxes), CUSTOM_WIDGET_OPEN_TIMEOUT_MS);
    if (!listbox) return false;

    let options = listbox.querySelectorAll(OPTION_SELECTOR);
    let targetText = getEffectiveValue(key, profile, Array.from(options).map((o) => o.textContent));
    let best = targetText ? pickBestOption(options, targetText, key) : null;

    // A long option list (e.g. ~200 countries for a phone code picker) is
    // often virtualized — only a handful of entries near the top actually
    // exist in the DOM until you type to filter. If nothing matched what
    // was already rendered, look for this control's own internal search
    // input (react-select always renders one, even when the dropdown
    // doesn't look obviously searchable) and type into it.
    if (!best) {
      const searchInput = trigger.querySelector("input");
      if (searchInput) {
        for (const queryValue of comboboxQueryVariants(key, profile)) {
          setNativeValue(searchInput, queryValue);
          searchInput.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
          await sleep(400); // let the widget's own filtering settle
          options = listbox.querySelectorAll(OPTION_SELECTOR);
          targetText = getEffectiveValue(key, profile, Array.from(options).map((o) => o.textContent)) || queryValue;
          best = pickBestOption(options, targetText, key);
          if (best) break;
        }
      }
    }

    if (best) {
      simulateClick(best);
      markFilled(trigger);
      return true;
    }
    if (!wasOpen) simulateClick(trigger); // nothing matched — close it back up
    return false;
  }

  async function fillPaginatedCombobox(inputEl, key, profile) {
    const knownListboxes = new Set(document.querySelectorAll(LISTBOX_SELECTOR));
    // Click the input itself, not a separate "open" button. An earlier
    // version tried to find and click a dedicated button instead (plus an
    // extra wait-and-check step before typing anything), and a real-site
    // test confirmed that combination is what broke selections from
    // sticking — clicking the input directly, immediately followed by
    // typing, is the interaction this widget actually expects.
    inputEl.click();

    // A full stored sentence like "I am not a protected veteran" is a poor
    // query for a live server-side search (confirmed on a real site: it
    // came back "There were no results", leaving the field blank). Try
    // progressively shorter, more distinctive query terms instead, using
    // the FULL stored value only to pick the right option out of whatever
    // candidates each query actually returns.
    let best = null;
    for (const queryValue of comboboxQueryVariants(key, profile)) {
      setNativeValue(inputEl, queryValue);
      inputEl.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));

      const listbox = await waitFor(() => findVisibleListbox(knownListboxes), CUSTOM_WIDGET_OPEN_TIMEOUT_MS);
      if (listbox) {
        await sleep(400); // let the widget's own search/filter settle before reading its results
        const options = listbox.querySelectorAll(OPTION_SELECTOR);
        const targetText = getEffectiveValue(key, profile, Array.from(options).map((o) => o.textContent)) || queryValue;
        best = pickBestOption(options, targetText, key);
      }
      if (best) break;
    }
    if (!best) {
      if (inputEl.value) setNativeValue(inputEl, ""); // don't leave rejected free text sitting there
      return false;
    }

    simulateClick(best);
    markFilled(inputEl);
    return true;
  }

  const QUERY_STOPWORDS = new Set([
    "i", "am", "is", "are", "a", "an", "the", "to", "of", "or", "and", "not",
    "my", "me", "you", "your", "will", "would", "have", "has", "do", "does",
    // Generic category nouns that are often the *longest* word in a name
    // but the least distinctive (e.g. "University" in "University of
    // Southern California" — searching for just that returns almost any
    // school, "Academy of Art University" included).
    "university", "college", "institute", "institution", "school",
    "corporation", "company", "incorporated"
  ]);

  // Query terms to try, in order, when a search is actually required: the
  // resolved value as-is first (works fine on some sites), then its single
  // most distinctive word (longest non-stopword — e.g. "veteran" out of "I
  // am not a protected veteran"), since a full sentence can fail a live
  // search that a short term would have matched.
  function comboboxQueryVariants(key, profile) {
    const value =
      key === "race" && (profile.hispanicLatino || "").trim().toLowerCase() === "yes"
        ? "Hispanic"
        : resolveValue(key, profile);
    if (!value) return [];

    const variants = [value];
    const words = normalizeSignal(value)
      .split(" ")
      .filter((w) => w.length > 2 && !QUERY_STOPWORDS.has(w));
    if (words.length > 0) {
      const longest = words.reduce((a, b) => (b.length > a.length ? b : a));
      if (longest.toLowerCase() !== value.trim().toLowerCase()) variants.push(longest);
    }
    return variants;
  }

  // Runs after the synchronous pass, one widget at a time (opening two of
  // these popups at once would be unreliable) — fire-and-forget from
  // runAutofill's point of view, same as scheduleSelectRetries.
  async function fillCustomWidgets(profile) {
    const triggers = Array.from(document.querySelectorAll(CUSTOM_TRIGGER_SELECTOR));
    for (const trigger of triggers) {
      try {
        if (!isVisible(trigger)) continue;
        const signal = getFieldSignal(trigger) + " " + normalizeSignal(findNearbyQuestionText(trigger));
        if (CONDITIONAL_FOLLOWUP_PATTERN.test(signal)) continue;
        const key = matchKeyForSignal(signal);
        if (!key || NEVER_DROPDOWN_KEYS.has(key)) continue;
        if (!keyHasFillableValue(key, profile)) continue;
        await fillCustomTrigger(trigger, key, profile);
        await sleep(150);
      } catch (err) {
        // One widget behaving unexpectedly (a popup that never closes, an
        // option list with a structure we didn't anticipate, etc.) must
        // never take down every dropdown after it in the loop.
        console.error("[Internship Autofill] custom dropdown trigger failed:", err);
      }
    }

    const comboboxInputs = Array.from(document.querySelectorAll('input[role="combobox"]'));
    for (const inputEl of comboboxInputs) {
      try {
        if (!isVisible(inputEl) || inputEl.value) continue;
        const signal = getFieldSignal(inputEl) + " " + normalizeSignal(findNearbyQuestionText(inputEl));
        if (CONDITIONAL_FOLLOWUP_PATTERN.test(signal)) continue;
        const key = matchKeyForSignal(signal);
        if (!key || NEVER_DROPDOWN_KEYS.has(key)) continue;
        if (!keyHasFillableValue(key, profile)) continue;
        await fillPaginatedCombobox(inputEl, key, profile);
        await sleep(150);
      } catch (err) {
        console.error("[Internship Autofill] combobox field failed:", err);
      }
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
