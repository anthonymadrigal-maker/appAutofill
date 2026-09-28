(function () {
  const form = document.getElementById("profileForm");
  const saveBtn = document.getElementById("saveBtn");
  const saveStatus = document.getElementById("saveStatus");
  const exportBtn = document.getElementById("exportBtn");
  const importBtn = document.getElementById("importBtn");
  const importFile = document.getElementById("importFile");
  const clearBtn = document.getElementById("clearBtn");

  function inputIdFor(key) {
    return `field-${key}`;
  }

  // ---------- repeatable Work History section ----------
  // Not part of PROFILE_SCHEMA's flat field grid above: each entry needs
  // its own set of inputs. `workHistoryEntries` only supplies the initial
  // values and the count of cards to render — once rendered, each card's
  // live values are read directly from its own DOM inputs (via
  // collectWorkHistoryFromDOM), the same way the rest of this page treats
  // the DOM as the source of truth between loads.
  let workHistoryEntries = [];

  function inputIdForWorkHistory(index, key) {
    return `work-history-${index}-${key}`;
  }

  function renderWorkHistoryEntry(entry, index) {
    const card = document.createElement("div");
    card.className = "work-history-entry";

    const header = document.createElement("div");
    header.className = "work-history-entry-header";
    const h3 = document.createElement("h3");
    h3.textContent = `Job ${index + 1}`;
    header.appendChild(h3);
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "btn btn-ghost btn-danger";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", () => {
      const current = collectWorkHistoryFromDOM();
      current.splice(index, 1);
      workHistoryEntries = current;
      reRenderWorkHistorySection();
    });
    header.appendChild(removeBtn);
    card.appendChild(header);

    const grid = document.createElement("div");
    grid.className = "field-grid";

    for (const field of WORK_HISTORY_ENTRY_FIELDS) {
      if (field.type === "checkbox") {
        const wrapper = document.createElement("div");
        wrapper.className = "work-history-checkbox";
        const control = document.createElement("input");
        control.type = "checkbox";
        control.id = inputIdForWorkHistory(index, field.key);
        control.dataset.field = field.key;
        control.checked = !!entry[field.key];
        const label = document.createElement("label");
        label.setAttribute("for", control.id);
        label.textContent = field.label;
        wrapper.appendChild(control);
        wrapper.appendChild(label);
        grid.appendChild(wrapper);
        continue;
      }

      const wrapper = document.createElement("div");
      wrapper.className = "field";
      if (field.type === "textarea") wrapper.classList.add("full");

      const label = document.createElement("label");
      label.setAttribute("for", inputIdForWorkHistory(index, field.key));
      label.textContent = field.label;
      wrapper.appendChild(label);

      const control = field.type === "textarea" ? document.createElement("textarea") : document.createElement("input");
      if (control.tagName === "INPUT") control.type = "text";
      if (field.placeholder) control.placeholder = field.placeholder;
      control.id = inputIdForWorkHistory(index, field.key);
      control.dataset.field = field.key;
      control.value = entry[field.key] || "";
      control.autocomplete = "off";
      wrapper.appendChild(control);
      grid.appendChild(wrapper);
    }

    card.appendChild(grid);
    return card;
  }

  function renderWorkHistorySection() {
    const sectionEl = document.createElement("section");
    sectionEl.className = "section";
    sectionEl.id = "workHistorySection";

    const heading = document.createElement("h2");
    heading.textContent = "Work History (Multiple Entries)";
    sectionEl.appendChild(heading);

    const desc = document.createElement("p");
    desc.className = "section-desc";
    desc.textContent =
      "For application systems that ask you to add each job separately, one at a time (Workday's “Add Another” button, for example). List every job here in the SAME order you'll add the blocks on the form — the first entry fills the first block, the second fills the second, and so on. Leave this empty to use the single “Most Recent Work Experience” section above instead.";
    sectionEl.appendChild(desc);

    if (workHistoryEntries.length === 0) {
      const empty = document.createElement("p");
      empty.className = "work-history-empty";
      empty.textContent = "No entries yet.";
      sectionEl.appendChild(empty);
    }

    workHistoryEntries.forEach((entry, index) => {
      sectionEl.appendChild(renderWorkHistoryEntry(entry, index));
    });

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "btn";
    addBtn.textContent = "+ Add Work Experience";
    addBtn.addEventListener("click", () => {
      const current = collectWorkHistoryFromDOM();
      current.push(buildEmptyWorkHistoryEntry());
      workHistoryEntries = current;
      reRenderWorkHistorySection();
    });
    sectionEl.appendChild(addBtn);

    return sectionEl;
  }

  function reRenderWorkHistorySection() {
    const existing = document.getElementById("workHistorySection");
    const fresh = renderWorkHistorySection();
    if (existing) existing.replaceWith(fresh);
    else form.appendChild(fresh);
  }

  function collectWorkHistoryFromDOM() {
    const cards = Array.from(document.querySelectorAll(".work-history-entry"));
    return cards.map((card) => {
      const entry = {};
      for (const field of WORK_HISTORY_ENTRY_FIELDS) {
        const el = card.querySelector(`[data-field="${field.key}"]`);
        if (!el) {
          entry[field.key] = field.type === "checkbox" ? false : "";
          continue;
        }
        entry[field.key] = field.type === "checkbox" ? el.checked : el.value.trim();
      }
      return entry;
    });
  }

  function renderForm() {
    form.innerHTML = "";
    for (const section of PROFILE_SCHEMA) {
      const sectionEl = document.createElement("section");
      sectionEl.className = "section";

      const heading = document.createElement("h2");
      heading.textContent = section.title;
      sectionEl.appendChild(heading);

      if (section.description) {
        const desc = document.createElement("p");
        desc.className = "section-desc";
        desc.textContent = section.description;
        sectionEl.appendChild(desc);
      }

      const grid = document.createElement("div");
      grid.className = "field-grid";

      for (const field of section.fields) {
        const wrapper = document.createElement("div");
        wrapper.className = "field";
        if (field.type === "textarea") wrapper.classList.add("full");

        const label = document.createElement("label");
        label.setAttribute("for", inputIdFor(field.key));
        label.textContent = field.label;
        wrapper.appendChild(label);

        let control;
        if (field.type === "textarea") {
          control = document.createElement("textarea");
        } else if (field.type === "select") {
          control = document.createElement("select");
          const blank = document.createElement("option");
          blank.value = "";
          blank.textContent = "— Select —";
          control.appendChild(blank);
          for (const opt of field.options) {
            const o = document.createElement("option");
            o.value = opt;
            o.textContent = opt;
            control.appendChild(o);
          }
        } else if (field.type === "yesno") {
          control = document.createElement("select");
          for (const [value, text] of [["", "— Select —"], ["Yes", "Yes"], ["No", "No"]]) {
            const o = document.createElement("option");
            o.value = value;
            o.textContent = text;
            control.appendChild(o);
          }
        } else {
          control = document.createElement("input");
          control.type = field.type === "email" ? "email" : field.type === "tel" ? "tel" : field.type === "url" ? "url" : "text";
          if (field.placeholder) control.placeholder = field.placeholder;
        }

        control.id = inputIdFor(field.key);
        control.name = field.key;
        control.autocomplete = "off";
        wrapper.appendChild(control);
        grid.appendChild(wrapper);
      }

      sectionEl.appendChild(grid);
      form.appendChild(sectionEl);
    }

    form.appendChild(renderWorkHistorySection());
  }

  function populateForm(profile) {
    for (const section of PROFILE_SCHEMA) {
      for (const field of section.fields) {
        const el = document.getElementById(inputIdFor(field.key));
        if (el) el.value = profile[field.key] || "";
      }
    }
  }

  function collectFormValues() {
    const profile = {};
    for (const section of PROFILE_SCHEMA) {
      for (const field of section.fields) {
        const el = document.getElementById(inputIdFor(field.key));
        profile[field.key] = el ? el.value.trim() : "";
      }
    }
    profile.workHistoryEntries = collectWorkHistoryFromDOM();
    return profile;
  }

  function showSaveStatus(text, success) {
    saveStatus.textContent = text;
    saveStatus.classList.toggle("success", !!success);
    if (text) setTimeout(() => { saveStatus.textContent = ""; }, 2500);
  }

  function loadProfile() {
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      const profile = Object.assign(buildDefaultProfile(), result[STORAGE_KEY] || {});
      populateForm(profile);
      workHistoryEntries = Array.isArray(profile.workHistoryEntries) ? profile.workHistoryEntries : [];
      reRenderWorkHistorySection();
    });
  }

  function saveProfile() {
    const profile = collectFormValues();
    chrome.storage.local.set({ [STORAGE_KEY]: profile }, () => {
      showSaveStatus("Saved ✓", true);
    });
  }

  function exportProfile() {
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      const profile = result[STORAGE_KEY] || buildDefaultProfile();
      const blob = new Blob([JSON.stringify(profile, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "internship-autofill-profile.json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });
  }

  function importProfile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = JSON.parse(reader.result);
        const profile = Object.assign(buildDefaultProfile(), imported);
        chrome.storage.local.set({ [STORAGE_KEY]: profile }, () => {
          populateForm(profile);
          workHistoryEntries = Array.isArray(profile.workHistoryEntries) ? profile.workHistoryEntries : [];
          reRenderWorkHistorySection();
          showSaveStatus("Imported ✓", true);
        });
      } catch (e) {
        showSaveStatus("Import failed: invalid file", false);
      }
    };
    reader.readAsText(file);
  }

  function clearAll() {
    if (!confirm("This will permanently delete your saved profile from this browser. Continue?")) return;
    chrome.storage.local.remove([STORAGE_KEY], () => {
      populateForm(buildDefaultProfile());
      workHistoryEntries = [];
      reRenderWorkHistorySection();
      showSaveStatus("Cleared", true);
    });
  }

  renderForm();
  loadProfile();

  saveBtn.addEventListener("click", saveProfile);
  exportBtn.addEventListener("click", exportProfile);
  clearBtn.addEventListener("click", clearAll);
  importBtn.addEventListener("click", () => importFile.click());
  importFile.addEventListener("change", () => {
    if (importFile.files && importFile.files[0]) importProfile(importFile.files[0]);
    importFile.value = "";
  });

  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "s") {
      e.preventDefault();
      saveProfile();
    }
  });
})();
