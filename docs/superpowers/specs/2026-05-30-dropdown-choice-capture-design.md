# Capture Dropdown Choices in Save Page HTML

**Date:** 2026-05-30
**Status:** Implemented (v1.12.0)
**Scope:** `popup/popup.js`, `manifest.json` (popup-only Save Page HTML path)

## Update — as-shipped design (supersedes "Decisions" below where they differ)

Two things were learned during implementation and changed the original design:

1. **The widget never sets `aria-expanded="true"` on the cell.** Open/closed
   state is tracked entirely off the shared listbox (`ul#listbox-id`, identified
   by its `aria-labelledby`), not `aria-expanded`. (An earlier version gated on
   `aria-expanded` and captured nothing — see the regression test.)

2. **Lists are deduplicated by `dropdownid` and stored once in a keyed
   library**, not injected into every cell. A cell's `dropdownid` attribute
   identifies its option set: every cell sharing a `dropdownid` renders the same
   options (e.g. a journal-entry chart of accounts repeated across ~95 cells,
   all `dropdownid="3"`). So each distinct `dropdownid` is opened/read **once**
   into a single `#codex-captured-choices-library` section
   (`<div class="codex-captured-choices" data-dropdownid="N">…</div>` per list);
   cells keep their existing `dropdownid` attribute as the join key. This turns
   a 95-cell journal entry from 95 dropdown opens into 1.

The safety invariant (only open to read, never click an `<li>`, never alter the
student's answer) and the deterministic "hide the shared popup after capture"
cleanup are unchanged. A standalone jsdom regression test lives at
`test/dropdown-capture.test.js`.

## Problem

The "Save Page HTML" feature (`copy-html-btn` in `popup.js`) archives a fully
rendered copy of an accounting coursework page, including iframe contents and
dynamically rendered tab panels. It does **not** capture the choices inside
dropdown-list answer cells.

These cells look like:

```html
<td class="dropDownList col-row-element responseCell"
    id="0_table0_cell_c1_r0" dropdownid="4" dropdowntype="dropDown"
    aria-controls="listbox-id" aria-expanded="false" role="combobox"></td>
```

The option list does **not** exist in the DOM until the cell is clicked. On
click, options render into a single shared container:

```html
<div class="ui-widget-content listContainer" style="... display: block;">
  <ul role="listbox" id="listbox-id" aria-labelledby="0_table0_cell_c1_r0">
    <li class="clearfix ..." role="option"><a class="list_content"></a></li>
    <li class="clearfix" role="option"><a class="list_content">Landscape consultant</a></li>
    <li class="clearfix" role="option"><a class="list_content">8616</a></li>
    <li class="clearfix" role="option"><a class="list_content">Competing job</a></li>
  </ul>
  <!-- nicescroll rail divs -->
</div>
```

Verified across all reference captures (`tax-04-08`, `tax-04-09`, `gnp-05-*`,
`archive/*`): the option text (`list_content`, `listContainer`,
`dropdown_option`) appears in **none** of the saved HTML. The data is rendered
on demand and is not available in any static page structure. The only way to
capture it is to activate each dropdown on the live page during save — exactly
as `captureAccountingToolTabs` already clicks through tab panels.

## Approaches considered

1. **Activate each dropdown, read, inject (chosen).** Mirrors the existing
   tab-clicking pattern. Reliable because it reads the same DOM the user would
   see.
2. **Scrape options from page JS/JSON.** Rejected — option text is absent from
   the saved HTML entirely, so there is no accessible static source.
3. **`data-choices` attribute only.** Rejected in favor of inline listbox
   markup (see Decisions).

## Design

### New function: `captureDropdownChoices(doc, root)`

Injected alongside the other helpers inside the `func` passed to
`chrome.scripting.executeScript`.

- Select every `td.dropDownList[dropdowntype]` under `root`.
- Process cells **sequentially** (all cells share the single `#listbox-id`
  container, so only one can be open at a time):
  1. **Open** the cell: `cell.click()`. If `aria-expanded` does not flip to
     `"true"`, fall back to dispatching `mousedown` + `mouseup` + `click`.
  2. **Wait** (`waitFor`) until `ul#listbox-id` is visible, populated with
     `li` options, **and** its `aria-labelledby === cell.id`. The
     `aria-labelledby` check proves the currently open listbox belongs to this
     cell and is not a stale render from a previous one.
  3. **Read only.** Clone the live `<ul role="listbox">` node. Strip its `id`
     (prevents duplicate-`id` collisions when injected into multiple cells) and
     remove the `nicescroll` rail/cursor divs. Wrap in
     `<div class="codex-captured-choices">` and append inside the cell. This
     mirrors the live "expanded" DOM.
  4. **Close** the cell (dispatch `Escape` keydown / re-click) so the next cell
     can open into the shared container. Restore closed state.

Per the approved decisions, the capture records **only the available choices**.
It does not track or mark which option is currently selected.

### Safety constraint (hard requirement)

The pass **only opens cells to read them**. It never clicks an `<li>` option —
doing so would select that option and **overwrite the student's actual answer**.
Each dropdown is returned to its closed state after reading. This invariant must
not break.

### Integration into `serializeDocument`

`captureDropdownChoices` runs on the **live** document, before any cloning, at
two points:

- Inside `captureAccountingToolTabs`, after `clickTabAndWait` and before the
  panel is cloned into each snapshot — so each tab's dropdowns are captured in
  that tab's snapshot.
- Once more on each iframe document body (and the top-level document) as a
  catch-all for any dropdown cells not under the tab structure.

### Other changes

- Bump `manifest.json` version `1.10.0` → `1.11.0`.
- No `content.js` change — Save Page HTML lives only in `popup.js`; the
  CLAUDE.md mirror rule applies to question *extraction*, which is untouched.

## Decisions (from brainstorming)

- **Output format:** inline listbox markup injected into the cell (mirrors live
  expanded DOM), not a `data-choices` attribute.
- **Selected option:** capture choices only; do not mark the
  `aria-activedescendant` selection.

## Verification

No automated tests (project has none). Manual: load the unpacked extension,
open a live page of the `tax-04-08` type containing an unactivated dropdown,
click "Save Page HTML", and confirm the saved file contains a
`codex-captured-choices` list with the dropdown's options inside the cell — and
that the student's existing answers are unchanged.
