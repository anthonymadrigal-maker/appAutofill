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
