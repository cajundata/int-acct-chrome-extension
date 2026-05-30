/*
 * Regression test for captureDropdownChoices (Save Page HTML dropdown capture).
 *
 * Standalone Node + jsdom script — the project has no test framework, so run it
 * directly:
 *
 *   NODE_PATH="C:/Users/weldo/.cache/dd-jsdom/node_modules" \
 *     node test/dropdown-capture.test.js
 *
 * It extracts the live sleep / waitFor / captureDropdownChoices source straight
 * out of popup/popup.js (so it tests the real code, not a copy) and runs it
 * against a jsdom DOM that models the LMS dropdown widget's OBSERVED contract:
 *
 *   - The cell (td.dropDownList[dropdowntype]) keeps aria-expanded="false" even
 *     while its options are showing — the widget does NOT toggle that attribute.
 *   - Clicking a cell renders/repopulates a single SHARED container
 *     (ul#listbox-id) whose aria-labelledby identifies the owning cell.
 *   - Escape on the cell hides the shared container (display:none).
 *
 * This is the exact contract that broke the first implementation: gating capture
 * on aria-expanded meant nothing was ever captured.
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

const sleepSrc = /const sleep = ms => new Promise\(resolve => setTimeout\(resolve, ms\)\);/.exec(src)[0];
const waitForSrc = extractBraceFn(src, /async function waitFor\(/);
const captureSrc = extractBraceFn(src, /async function captureDropdownChoices\(/);

const factory = new Function(
  'MouseEvent',
  'KeyboardEvent',
  `${sleepSrc}\n${waitForSrc}\n${captureSrc}\nreturn captureDropdownChoices;`
);

// --- Build a jsdom DOM that models the widget contract --------------------

function buildDom() {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>
    <table><tbody><tr>
      <td class="dropDownList col-row-element responseCell" id="0_table0_cell_c1_r0"
          dropdownid="4" dropdowntype="dropDown" role="combobox"
          aria-expanded="false" aria-haspopup="listbox" aria-controls="listbox-id"></td>
      <td class="dropDownList col-row-element responseCell" id="0_table0_cell_c2_r0"
          dropdownid="5" dropdowntype="dropDown" role="combobox"
          aria-expanded="false" aria-haspopup="listbox" aria-controls="listbox-id"></td>
    </tr></tbody></table>
  </body></html>`);

  const { document } = dom.window;

  // Options each cell should expose (first option is the empty/placeholder one,
  // mirroring the real widget's blank first <li>).
  const OPTIONS = {
    '0_table0_cell_c1_r0': ['', 'Landscape consultant', '8616', 'Competing job'],
    '0_table0_cell_c2_r0': ['', 'Accept offer', 'Decline offer'],
  };

  function showListboxFor(cellId) {
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
    ul.setAttribute('aria-labelledby', cellId);
    OPTIONS[cellId].forEach((text, idx) => {
      const li = document.createElement('li');
      li.className = 'clearfix';
      li.id = `dropdown_option_${cellId}_${idx}`;
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

  // Wire up the OBSERVED contract: click shows the shared listbox (aria-expanded
  // intentionally left "false"); Escape hides it.
  document.querySelectorAll('td.dropDownList[dropdowntype]').forEach(cell => {
    cell.addEventListener('click', () => showListboxFor(cell.id));
    cell.addEventListener('keydown', ev => {
      if (ev.key === 'Escape') hideListbox();
    });
  });

  return dom;
}

// --- Run -------------------------------------------------------------------

async function main() {
  const dom = buildDom();
  const { window } = dom;
  const { document } = window;

  const captureDropdownChoices = factory(window.MouseEvent, window.KeyboardEvent);

  await captureDropdownChoices(document, document.body);

  const failures = [];

  const expectations = {
    '0_table0_cell_c1_r0': ['Landscape consultant', '8616', 'Competing job'],
    '0_table0_cell_c2_r0': ['Accept offer', 'Decline offer'],
  };

  for (const [cellId, expected] of Object.entries(expectations)) {
    const cell = document.getElementById(cellId);
    const wrapper = cell.querySelector(':scope > .codex-captured-choices');
    if (!wrapper) {
      failures.push(`cell ${cellId}: no .codex-captured-choices wrapper injected`);
      continue;
    }
    const captured = Array.from(wrapper.querySelectorAll('li .list_content'))
      .map(el => el.textContent)
      .filter(Boolean);
    for (const opt of expected) {
      if (!captured.includes(opt)) {
        failures.push(`cell ${cellId}: captured choices missing "${opt}" (got: ${JSON.stringify(captured)})`);
      }
    }
    // The cloned listbox must not keep the shared id (avoids duplicate ids).
    if (wrapper.querySelector('#listbox-id')) {
      failures.push(`cell ${cellId}: cloned listbox still has id="listbox-id"`);
    }
  }

  // The shared popup must not be left visible to leak into the snapshot.
  const container = document.querySelector('.listContainer');
  if (container && container.style.display !== 'none') {
    failures.push(`shared listContainer left visible (display="${container.style.display}") — would leak into saved HTML`);
  }

  if (failures.length) {
    console.error('FAIL: captureDropdownChoices regression test');
    failures.forEach(f => console.error('  - ' + f));
    process.exit(1);
  }
  console.log('PASS: captureDropdownChoices captured all dropdown choices and cleaned up the shared popup');
}

main().catch(err => {
  console.error('ERROR running test:', err);
  process.exit(1);
});
