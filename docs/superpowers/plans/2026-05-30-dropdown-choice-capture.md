# Capture Dropdown Choices in Save Page HTML — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "Save Page HTML" capture the option list of every accounting-tool dropdown cell by activating each one on the live page before serialization.

**Architecture:** Add an injected helper `captureDropdownChoices(doc, root)` to the function passed to `chrome.scripting.executeScript` in `popup/popup.js`. It opens each `td.dropDownList[dropdowntype]` cell, waits for the shared `ul#listbox-id` to render, clones the options into the cell as `<div class="codex-captured-choices">`, then closes the cell — never clicking an option (which would overwrite the student's answer). It is wired into `captureAccountingToolTabs` (per tab panel), each iframe doc, and the top-level doc.

**Tech Stack:** Vanilla JS, Chrome Manifest V3 (`chrome.scripting.executeScript`). No build step, no test framework. Syntax checked with `node --check`; behavior verified manually by loading the unpacked extension.

---

## Testing reality

This project has no automated tests and the modified code is a string-injected
page function, so there is no unit-test seam. Verification per task is:

1. `node --check popup/popup.js` — parser-level guard that the injected function
   is still syntactically valid.
2. Manual: load the unpacked extension (`chrome://extensions`, Developer Mode,
   Reload), open a live page of the `tax-04-08` type that contains an
   unactivated dropdown, click **Save Page HTML**, and inspect the saved file.

The saved reference HTML files cannot be used as `file://` fixtures here: their
dropdown options are not in the static markup (they render only when the live
widget JS runs), so only a live LMS page exercises this path.

---

## File Structure

- **Modify:** `popup/popup.js` — add `captureDropdownChoices` helper inside the
  injected `func`; call it from `captureAccountingToolTabs`, from the iframe
  loop in `serializeDocument`, and on the top-level document before return.
- **Modify:** `manifest.json` — bump `version` `1.10.0` → `1.11.0`.

No `content.js` change (Save Page HTML lives only in `popup.js`).

---

### Task 1: Add the `captureDropdownChoices` helper

**Files:**
- Modify: `popup/popup.js` (insert after `findRenderedAnswerArea`, currently ending at line 109, before `clickTabAndWait` at line 111)

- [ ] **Step 1: Insert the helper function**

Insert the following function immediately after the closing brace of
`findRenderedAnswerArea` and before `async function clickTabAndWait`. It uses the
already-defined `sleep` and `waitFor` helpers from the same injected scope.

```javascript
      async function captureDropdownChoices(doc, root) {
        if (!root) return;
        const cells = Array.from(root.querySelectorAll('td.dropDownList[dropdowntype]'));
        if (!cells.length) return;

        for (const cell of cells) {
          // Panels can be revisited; don't capture the same cell twice.
          if (cell.querySelector(':scope > .codex-captured-choices')) continue;

          const cellId = cell.id || '';

          // Open the dropdown so its options render into the shared listbox.
          cell.click();
          if (cell.getAttribute('aria-expanded') !== 'true') {
            for (const type of ['mousedown', 'mouseup', 'click']) {
              cell.dispatchEvent(new MouseEvent(type, {
                bubbles: true,
                cancelable: true,
                view: doc.defaultView,
              }));
            }
          }

          // Wait for THIS cell's listbox to render and populate.
          const listbox = await waitFor(() => {
            const ul = doc.querySelector('ul#listbox-id[role="listbox"]');
            if (!ul) return null;
            if (cellId && ul.getAttribute('aria-labelledby') !== cellId) return null;
            const container = ul.closest('.listContainer');
            if (container && container.style.display === 'none') return null;
            if (!ul.querySelector('li')) return null;
            return ul;
          }, 4000);

          if (listbox) {
            // Read only — clone the rendered options. NEVER click an <li>:
            // clicking selects that option and overwrites the student's answer.
            const capturedList = listbox.cloneNode(true);
            capturedList.removeAttribute('id');
            capturedList.removeAttribute('tabindex');
            capturedList
              .querySelectorAll('.nicescroll-rails, .nicescroll-cursors')
              .forEach(el => el.remove());

            const wrapper = doc.createElement('div');
            wrapper.className = 'codex-captured-choices';
            wrapper.appendChild(capturedList);
            cell.appendChild(wrapper);
          }

          // Close the dropdown so the next cell can open into the shared listbox.
          cell.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Escape',
            keyCode: 27,
            bubbles: true,
          }));
          if (cell.getAttribute('aria-expanded') === 'true') {
            cell.click();
          }
          await sleep(150);
        }
      }
```

- [ ] **Step 2: Syntax check**

Run: `node --check popup/popup.js`
Expected: no output, exit code 0.

- [ ] **Step 3: Commit**

```bash
git add popup/popup.js
git commit -m "feat: add captureDropdownChoices helper for Save Page HTML"
```

---

### Task 2: Capture dropdowns inside each tab panel

**Files:**
- Modify: `popup/popup.js` — `captureAccountingToolTabs`, the loop body after `await clickTabAndWait(doc, tab, panel);` (currently line 163)

- [ ] **Step 1: Add the call after the tab is rendered, before the panel is cloned**

Find this block inside the `for (const tab of tabs)` loop:

```javascript
        for (const tab of tabs) {
          await clickTabAndWait(doc, tab, panel);

          const snapshot = doc.createElement('section');
```

Change it to:

```javascript
        for (const tab of tabs) {
          await clickTabAndWait(doc, tab, panel);
          await captureDropdownChoices(doc, panel);

          const snapshot = doc.createElement('section');
```

- [ ] **Step 2: Syntax check**

Run: `node --check popup/popup.js`
Expected: no output, exit code 0.

- [ ] **Step 3: Commit**

```bash
git add popup/popup.js
git commit -m "feat: capture dropdown choices per requirement tab panel"
```

---

### Task 3: Capture dropdowns in iframe and top-level documents

**Files:**
- Modify: `popup/popup.js` — `serializeDocument` iframe loop (after `await captureAccountingToolTabs(iframeDoc);`, currently line 197) and the entry call (currently line 214)

- [ ] **Step 1: Add the catch-all call inside the iframe loop**

Find:

```javascript
            await captureAccountingToolTabs(iframeDoc);

            const iframeHtml = await serializeDocument(iframeDoc);
```

Change to:

```javascript
            await captureAccountingToolTabs(iframeDoc);
            await captureDropdownChoices(iframeDoc, iframeDoc.body);

            const iframeHtml = await serializeDocument(iframeDoc);
```

- [ ] **Step 2: Add the top-level call before returning the serialized document**

Find the final return inside the injected `func`:

```javascript
      return serializeDocument(document);
```

Change to:

```javascript
      await captureDropdownChoices(document, document.body);
      return serializeDocument(document);
```

- [ ] **Step 3: Syntax check**

Run: `node --check popup/popup.js`
Expected: no output, exit code 0.

- [ ] **Step 4: Commit**

```bash
git add popup/popup.js
git commit -m "feat: capture dropdown choices in iframe and top-level documents"
```

---

### Task 4: Bump the extension version

**Files:**
- Modify: `manifest.json:4`

- [ ] **Step 1: Update the version**

Change:

```json
  "version": "1.10.0",
```

to:

```json
  "version": "1.11.0",
```

- [ ] **Step 2: Commit**

```bash
git add manifest.json
git commit -m "chore: bump version to 1.11.0"
```

---

### Task 5: Manual verification

**Files:** none (verification only)

- [ ] **Step 1: Load and reload the extension**

In Chrome: `chrome://extensions` → Developer Mode → Reload the Question
Extractor extension so it picks up the new `popup.js` and version 1.11.0.

- [ ] **Step 2: Save a page with a dropdown**

Open a live coursework page of the `tax-04-08` type that contains an
unactivated dropdown cell (e.g. the "Required b2" section with
"Which job should she take?"). Click the extension, then **Save Page HTML**.

- [ ] **Step 3: Inspect the saved file**

Open the downloaded `page-<timestamp>.html`. Confirm:
- The dropdown `<td class="dropDownList ...">` now contains a
  `<div class="codex-captured-choices">` with a `<ul role="listbox">` listing
  the options (e.g. `Landscape consultant`, `8616`, `Competing job`).
- Multiple dropdowns on the page each got their own captured list.

- [ ] **Step 4: Confirm answers were not disturbed**

Back on the live page, confirm any previously-entered dropdown answers are
unchanged (the capture must only open/read, never select an option).

---

## Self-Review

- **Spec coverage:** New helper (Task 1) ✓; inline listbox markup output ✓
  (`codex-captured-choices` wrapping cloned `<ul role="listbox">`); choices-only,
  no selected-state tracking ✓; safety/no-answer-overwrite invariant ✓ (read
  only, never click `<li>`, restore closed state); integration at tab loop +
  iframe + top-level (Tasks 2–3) ✓; version bump (Task 4) ✓; manual verification
  per spec (Task 5) ✓; no `content.js` change ✓.
- **Placeholder scan:** No TBD/TODO/"handle edge cases" — all steps show exact
  code and exact commands.
- **Type/name consistency:** `captureDropdownChoices(doc, root)` signature is
  defined in Task 1 and called with matching arguments in Tasks 2 (`doc, panel`)
  and 3 (`iframeDoc, iframeDoc.body` and `document, document.body`). The injected
  helpers `sleep` and `waitFor` it depends on already exist in the same scope
  (`popup.js` lines 71 and 73). Output class `codex-captured-choices` is used
  consistently in the helper and the verification step.
