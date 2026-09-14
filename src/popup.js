(function () {
  const autofillBtn = document.getElementById("autofillBtn");
  const settingsBtn = document.getElementById("settingsBtn");
  const statusEl = document.getElementById("status");

  const INJECTABLE_SCHEMES = new Set(["http:", "https:"]);

  function setStatus(text, kind) {
    statusEl.textContent = text;
    statusEl.className = "status" + (kind ? ` ${kind}` : "");
  }

  function isInjectablePage(url) {
    try {
      const parsed = new URL(url);
      return INJECTABLE_SCHEMES.has(parsed.protocol);
    } catch {
      return false;
    }
  }

  function sendAutofillMessage(tabId, onDone) {
    chrome.tabs.sendMessage(tabId, { type: "AUTOFILL" }, (response) => {
      if (chrome.runtime.lastError) {
        onDone(null, chrome.runtime.lastError);
        return;
      }
      onDone(response, null);
    });
  }

  function handleResult(response) {
    if (!response) {
      setStatus("Couldn't reach this page. Try refreshing it first.", "error");
      return;
    }
    if (!response.ok) {
      if (response.reason === "no-profile") {
        setStatus("No profile saved yet. Click \"Edit My Profile\" to add your info.", "error");
      } else {
        setStatus("Something went wrong filling this page.", "error");
      }
      return;
    }
    if (response.filledCount === 0) {
      setStatus("No matching fields found on this page.", "info");
    } else {
      setStatus(`Filled ${response.filledCount} field${response.filledCount === 1 ? "" : "s"}.`, "success");
    }
  }

  autofillBtn.addEventListener("click", () => {
    autofillBtn.disabled = true;
    setStatus("Filling…", "info");

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      if (!tab || !tab.id) {
        setStatus("No active tab found.", "error");
        autofillBtn.disabled = false;
        return;
      }
      if (!isInjectablePage(tab.url || "")) {
        setStatus("Autofill only works on regular web pages (http/https).", "error");
        autofillBtn.disabled = false;
        return;
      }

      sendAutofillMessage(tab.id, (response, err) => {
        if (!err) {
          handleResult(response);
          autofillBtn.disabled = false;
          return;
        }
        // Content script probably wasn't injected yet (page loaded before
        // install/reload) — inject it now, then retry once.
        chrome.scripting.executeScript(
          {
            target: { tabId: tab.id },
            files: ["src/profileSchema.js", "src/fieldRules.js", "src/content.js"]
          },
          () => {
            if (chrome.runtime.lastError) {
              setStatus("Couldn't access this page to autofill it.", "error");
              autofillBtn.disabled = false;
              return;
            }
            sendAutofillMessage(tab.id, (response2, err2) => {
              autofillBtn.disabled = false;
              if (err2) {
                setStatus("Couldn't reach this page. Try refreshing it first.", "error");
                return;
              }
              handleResult(response2);
            });
          }
        );
      });
    });
  });

  settingsBtn.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });
})();
