/*
 * Regression test for captureDropdownChoices (Save Page HTML dropdown capture).
 *
 * Standalone Node + jsdom script — the project has no test framework, so run it
 * directly:
 *
 *   NODE_PATH="C:/Users/weldo/.cache/dd-jsdom/node_modules" \
 *     node test/dropdown-capture.test.js
 *
 * It extracts the live helpers straight out of popup/popup.js (so it tests the
 * real code, not a copy) and runs captureDropdownChoices against a jsdom DOM
 * that models the LMS dropdown widget's OBSERVED contract:
 *
 *   - The cell (td.dropDownList[dropdowntype]) keeps aria-expanded="false" even
 *     while its options are showing — the widget does NOT toggle that attribute.
 *   - Clicking a cell renders/repopulates a single SHARED container
 *     (ul#listbox-id) whose aria-labelledby identifies the owning cell.
 *   - A cell's option list is identified by its `dropdownid` attribute: cells
 *     with the same dropdownid render the SAME options (e.g. a journal-entry
 *     chart of accounts repeated on dozens of cells, all dropdownid="3").
 *   - Escape on the cell hides the shared container (display:none).
 *
 * Asserts the two things that matter:
 *   1. Each distinct dropdownid is opened/captured exactly ONCE (so a 95-cell
 *      journal entry costs one open, not 95).
 *   2. Captured lists land in a single #codex-captured-choices-library keyed by
 *      data-dropdownid, with the correct options and no leftover shared id.
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const POPUP = path.join(__dirname, '..', 'popup', 'popup.js');
const src = fs.readFileSync(POPUP, 'utf8');

// --- Extract function sources from popup.js -------------------------------

function extractBraceFn(text, signatureRegex) {
  const m = signatureRegex.exec(text);
  if (!m) throw new Error('Could not find ' + signatureRegex);
  const start = m.index;
  let i = text.indexOf('{', start);
  let depth = 0;
  for (; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  throw new Error('Unbalanced braces for ' + signatureRegex);
}

function extractLine(text, regex) {
  const m = regex.exec(text);
  if (!m) throw new Error('Could not find ' + regex);
  return m[0];
}

const sleepSrc = extractLine(src, /const sleep = ms => new Promise\(resolve => setTimeout\(resolve, ms\)\);/);
const waitForSrc = extractBraceFn(src, /async function waitFor\(/);
const libVarSrc = extractLine(src, /const codexChoiceLibraries = new WeakMap\(\);/);
const getLibSrc = extractBraceFn(src, /function getChoiceLibrary\(/);
const captureSrc = extractBraceFn(src, /async function captureDropdownChoices\(/);

const factory = new Function(
  'MouseEvent',
  'KeyboardEvent',
  // timeLog is temporary instrumentation in popup.js; stub it for the test.
  `const timeLog = () => {};\n${sleepSrc}\n${waitForSrc}\n${libVarSrc}\n${getLibSrc}\n${captureSrc}\nreturn captureDropdownChoices;`
);

// --- Build a jsdom DOM that models the widget contract --------------------

// Option lists keyed by dropdownid (first entry is the blank placeholder).
const OPTIONS_BY_DROPDOWN = {
  '3': ['', 'Cash', 'Accounts Receivable', 'Service Revenue'],
  '4': ['', 'Yes', 'No'],
};

function buildDom() {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>
    <table><tbody>
      <tr><td class="dropDownList ddPolicy responseCell" id="cellA"
              dropdownid="3" dropdowntype="dropDown" role="combobox" aria-expanded="false"></td></tr>
      <tr><td class="dropDownList ddPolicy responseCell" id="cellB"
              dropdownid="3" dropdowntype="dropDown" role="combobox" aria-expanded="false"></td></tr>
      <tr><td class="dropDownList ddPolicy responseCell" id="cellC"
              dropdownid="4" dropdowntype="dropDown" role="combobox" aria-expanded="false"></td></tr>
    </tbody></table>
  </body></html>`);

  const { document } = dom.window;
  const opens = []; // records each cellId we were asked to open

  function showListboxFor(cell) {
    opens.push(cell.id);
    const dropdownId = cell.getAttribute('dropdownid');
    let container = document.querySelector('.listContainer');
    if (!container) {
      container = document.createElement('div');
      container.className = 'ui-widget-content listContainer';
      document.body.appendChild(container);
    }
    container.style.display = 'block';
    container.innerHTML = '';
    const ul = document.createElement('ul');
    ul.setAttribute('role', 'listbox');
    ul.id = 'listbox-id';
    ul.setAttribute('aria-labelledby', cell.id);
    OPTIONS_BY_DROPDOWN[dropdownId].forEach((text, idx) => {
      const li = document.createElement('li');
      li.className = 'clearfix';
      li.id = `dropdown_option_${cell.id}_${idx}`;
      li.setAttribute('role', 'option');
      const a = document.createElement('a');
      a.className = 'list_content';
      a.textContent = text;
      li.appendChild(a);
      ul.appendChild(li);
    });
    container.appendChild(ul);
  }

  function hideListbox() {
    const container = document.querySelector('.listContainer');
    if (container) container.style.display = 'none';
  }

  document.querySelectorAll('td.dropDownList[dropdowntype]').forEach(cell => {
    cell.addEventListener('click', () => showListboxFor(cell));
    cell.addEventListener('keydown', ev => {
      if (ev.key === 'Escape') hideListbox();
    });
  });

  return { dom, opens };
}

// --- Run -------------------------------------------------------------------

async function main() {
  const { dom, opens } = buildDom();
  const { window } = dom;
  const { document } = window;

  const captureDropdownChoices = factory(window.MouseEvent, window.KeyboardEvent);
  await captureDropdownChoices(document, document.body);

  const failures = [];

  // 1. Opened exactly once per distinct dropdownid (2), not once per cell (3).
  if (opens.length !== 2) {
    failures.push(`expected 2 opens (one per distinct dropdownid), got ${opens.length}: ${JSON.stringify(opens)}`);
  }

  // 2. A single keyed library holds one block per distinct dropdownid.
  const lib = document.getElementById('codex-captured-choices-library');
  if (!lib) {
    failures.push('no #codex-captured-choices-library created');
  } else {
    const blocks = Array.from(lib.querySelectorAll('.codex-captured-choices'));
    if (blocks.length !== 2) {
      failures.push(`expected 2 captured-choices blocks, got ${blocks.length}`);
    }
    const expectedByDropdown = {
      '3': ['Cash', 'Accounts Receivable', 'Service Revenue'],
      '4': ['Yes', 'No'],
    };
    for (const [dropdownId, expected] of Object.entries(expectedByDropdown)) {
      const block = lib.querySelector(`.codex-captured-choices[data-dropdownid="${dropdownId}"]`);
      if (!block) {
        failures.push(`no captured-choices block for dropdownid ${dropdownId}`);
        continue;
      }
      const captured = Array.from(block.querySelectorAll('li .list_content'))
        .map(el => el.textContent)
        .filter(Boolean);
      for (const opt of expected) {
        if (!captured.includes(opt)) {
          failures.push(`dropdownid ${dropdownId}: missing "${opt}" (got ${JSON.stringify(captured)})`);
        }
      }
      if (block.querySelector('#listbox-id')) {
        failures.push(`dropdownid ${dropdownId}: cloned list still has id="listbox-id"`);
      }
    }
  }

  // 3. Shared popup hidden so it can't leak into the saved HTML.
  const container = document.querySelector('.listContainer');
  if (container && container.style.display !== 'none') {
    failures.push(`shared listContainer left visible (display="${container.style.display}")`);
  }

  if (failures.length) {
    console.error('FAIL: captureDropdownChoices regression test');
    failures.forEach(f => console.error('  - ' + f));
    process.exit(1);
  }
  console.log('PASS: captured each distinct dropdownid once into the keyed library and cleaned up');
}

main().catch(err => {
  console.error('ERROR running test:', err);
  process.exit(1);
});
