const extractBtn = document.getElementById('extract-btn');
const copyHtmlBtn = document.getElementById('copy-html-btn');
const exportBtn = document.getElementById('export-btn');
const clearBtn = document.getElementById('clear-btn');
const statusEl = document.getElementById('status');
const resultsEl = document.getElementById('results');
const countEl = document.getElementById('count');

// Load saved count on popup open
updateCount();

extractBtn.addEventListener('click', async () => {
  try {
    statusEl.textContent = 'Extracting...';
    resultsEl.innerHTML = '';

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab?.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
      statusEl.textContent = 'Cannot extract from this page.';
      return;
    }

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractQuestion,
    });

    if (!result) {
      statusEl.textContent = 'No question found on this page.';
      return;
    }

    const saved = await saveQuestion(result);
    let copied = true;
    try {
      await copyToClipboard(result);
    } catch (error) {
      copied = false;
    }

    if (saved) {
      statusEl.textContent = copied
        ? `Saved & copied: ${result.type.replace(/_/g, ' ')} question`
        : `Saved: ${result.type.replace(/_/g, ' ')} question. Clipboard copy failed.`;
    } else {
      statusEl.textContent = copied
        ? 'Already saved - copied to clipboard.'
        : 'Already saved. Clipboard copy failed.';
    }
    renderQuestion(result);
    updateCount();
  } catch (error) {
    statusEl.textContent = error?.message || 'Extraction failed.';
  }
});

copyHtmlBtn.addEventListener('click', async () => {
  statusEl.textContent = 'Saving page HTML...';

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab?.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
    statusEl.textContent = 'Cannot extract from this page.';
    return;
  }

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: async () => {
      const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

      async function waitFor(check, timeoutMs = 5000, intervalMs = 100) {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          try {
            const value = check();
            if (value) return value;
          } catch (error) {
            // Ignore transient DOM errors while the iframe rerenders.
          }
          await sleep(intervalMs);
        }
        return null;
      }

      function normalizeText(value) {
        return (value || '').replace(/\s+/g, ' ').trim();
      }

      function getTabLabel(tab) {
        return normalizeText(tab.getAttribute('title') || tab.textContent);
      }

      function getActiveTab(doc) {
        return doc.querySelector('#tabs li.tab.active, #tabs li.tab[aria-selected="true"]');
      }

      function getPanelSignature(panel) {
        if (!panel) return '';
        return normalizeText(panel.textContent).slice(0, 500);
      }

      function findRenderedAnswerArea(panel) {
        if (!panel) return null;
        return panel.querySelector(
          '.jSheet, .tableControl, .responseCell, table, input, textarea, select'
        );
      }

      async function clickTabAndWait(doc, tab, panel) {
        const previousSignature = getPanelSignature(panel);
        const previousActiveId = getActiveTab(doc)?.id || '';
        const alreadyActive = previousActiveId && previousActiveId === (tab.id || '');

        if (alreadyActive && findRenderedAnswerArea(panel)) {
          await sleep(150);
          return;
        }

        tab.click();

        await waitFor(() => {
          const activeTab = getActiveTab(doc);
          return activeTab && getTabLabel(activeTab) === getTabLabel(tab);
        }, 4000);

        await waitFor(() => {
          const activeTab = getActiveTab(doc);
          const signature = getPanelSignature(panel);
          const hasAnswers = Boolean(findRenderedAnswerArea(panel));
          return Boolean(
            activeTab &&
            getTabLabel(activeTab) === getTabLabel(tab) &&
            hasAnswers &&
            (signature !== previousSignature || activeTab.id !== previousActiveId)
          );
        }, 5000);

        await sleep(350);
      }

      async function captureAccountingToolTabs(doc) {
        const tabs = Array.from(doc.querySelectorAll('#tabs li.tab'));
        const panel = doc.querySelector('#tabpanel-requirement');
        if (!tabs.length || !panel) return;

        await waitFor(() => findRenderedAnswerArea(panel), 5000);

        const existing = doc.getElementById('codex-captured-tab-panels');
        if (existing) existing.remove();

        const snapshotsHost = doc.createElement('div');
        snapshotsHost.id = 'codex-captured-tab-panels';
        snapshotsHost.setAttribute('data-captured-tab-count', String(tabs.length));
        snapshotsHost.style.marginTop = '24px';

        const heading = doc.createElement('h2');
        heading.textContent = 'Captured Requirement Panels';
        snapshotsHost.appendChild(heading);

        for (const tab of tabs) {
          await clickTabAndWait(doc, tab, panel);

          const snapshot = doc.createElement('section');
          snapshot.className = 'captured-tab-panel';
          snapshot.setAttribute('data-tab-id', tab.id || '');
          snapshot.setAttribute('data-tab-label', getTabLabel(tab));

          const label = doc.createElement('h3');
          label.textContent = getTabLabel(tab) || 'Untitled Tab';
          snapshot.appendChild(label);

          const activePanel = panel.cloneNode(true);
          activePanel.setAttribute('data-captured-from-tab', getTabLabel(tab));
          snapshot.appendChild(activePanel);
          snapshotsHost.appendChild(snapshot);
        }

        doc.body.appendChild(snapshotsHost);
      }

      async function serializeDocument(sourceDoc) {
        const liveIframes = Array.from(sourceDoc.querySelectorAll('iframe'));
        const rootClone = sourceDoc.documentElement.cloneNode(true);
        const clonedIframes = Array.from(rootClone.querySelectorAll('iframe'));

        for (let i = 0; i < liveIframes.length; i += 1) {
          const iframe = liveIframes[i];
          const clonedIframe = clonedIframes[i];
          if (!clonedIframe) continue;

          try {
            const iframeDoc = iframe.contentDocument;
            if (!iframeDoc?.documentElement) continue;

            await captureAccountingToolTabs(iframeDoc);

            const iframeHtml = await serializeDocument(iframeDoc);
            const replacement = rootClone.ownerDocument.createElement('div');
            replacement.setAttribute('data-iframe-src', iframe.src || '');
            replacement.setAttribute('data-iframe-title', iframe.title || '');
            replacement.className = 'captured-iframe-content';
            replacement.innerHTML = iframeHtml;
            clonedIframe.replaceWith(replacement);
          } catch (error) {
            // Cross-origin iframe, leave as-is.
          }
        }

        return rootClone.outerHTML;
      }

      return serializeDocument(document);
    },
  });

  if (!result) {
    statusEl.textContent = 'Could not read page HTML.';
    return;
  }

  let copied = true;
  try {
    await copyTextToClipboard(result);
  } catch (error) {
    copied = false;
  }

  // Download as HTML file
  const blob = new Blob([result], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  a.download = `page-${timestamp}.html`;
  a.click();
  URL.revokeObjectURL(url);

  const size = (result.length / 1024).toFixed(0);
  statusEl.textContent = copied
    ? `Saved & copied page HTML (${size} KB).`
    : `Saved page HTML (${size} KB). Clipboard copy failed.`;
});

exportBtn.addEventListener('click', async () => {
  const { questions = [] } = await chrome.storage.local.get('questions');
  const blob = new Blob([JSON.stringify(questions, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'questions.json';
  a.click();
  URL.revokeObjectURL(url);
  statusEl.textContent = `Exported ${questions.length} question(s).`;
});

clearBtn.addEventListener('click', async () => {
  await chrome.storage.local.set({ questions: [] });
  updateCount();
  resultsEl.innerHTML = '';
  statusEl.textContent = 'All questions cleared.';
});

async function saveQuestion(question) {
  const { questions = [] } = await chrome.storage.local.get('questions');
  const isDuplicate = questions.some(q =>
    q.prompt === question.prompt && (q.title || null) === (question.title || null)
  );
  if (isDuplicate) return false;
  questions.push(question);
  await chrome.storage.local.set({ questions });
  return true;
}

async function updateCount() {
  const { questions = [] } = await chrome.storage.local.get('questions');
  countEl.textContent = `${questions.length} question${questions.length !== 1 ? 's' : ''} saved`;
}

function formatQuestion(q) {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let text = '';
  if (q.title) {
    text += `${q.title}\n\n`;
  }
  const instruction = getQuestionInstruction(q);
  if (instruction) {
    text += `${instruction}\n`;
  }
  text += `Q: ${q.prompt}`;
  if (q.terms && q.terms.length > 0) {
    text += '\n\nTerms:\n' + q.terms.map((t, i) => `${i + 1}. ${t}`).join('\n');
    if (q.choices && q.choices.length > 0) {
      text += '\n\nDefinitions:\n' + q.choices.map((c, i) => `${letters[i]}) ${c}`).join('\n');
    }
  } else if (q.choices && q.choices.length > 0) {
    text += '\n' + q.choices.map((c, i) => `${letters[i]}) ${c}`).join('\n');
  }
  if (q.requirements && q.requirements.length > 0) {
    text += '\n\nRequired:\n' + q.requirements.map((r, i) => `${i + 1}. ${r}`).join('\n');
  }
  return text;
}

function getQuestionInstruction(q) {
  switch (q.type) {
    case 'multiple_select':
      return 'Select all that apply.';
    case 'multiple_choice':
      return 'Select one answer.';
    case 'true_false':
      return 'Select true or false.';
    case 'matching':
      return 'Match each term to its definition.';
    case 'fill_in_the_blank':
      return 'Fill in each blank.';
    default:
      return '';
  }
}

async function copyToClipboard(q) {
  await copyTextToClipboard(formatQuestion(q));
}

async function copyTextToClipboard(text) {
  try {
    if (!document.hasFocus()) {
      window.focus();
    }
    await navigator.clipboard.writeText(text);
    return;
  } catch (error) {
    if (legacyCopyText(text)) {
      return;
    }
    throw error;
  }
}

function legacyCopyText(text) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.top = '-1000px';
  textarea.style.left = '-1000px';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch (error) {
    copied = false;
  }

  textarea.remove();
  return copied;
}

function renderQuestion(q) {
  const card = document.createElement('div');
  card.className = 'question-card';

  if (q.title) {
    const titleEl = document.createElement('p');
    titleEl.className = 'question-title';
    titleEl.textContent = q.title;
    card.appendChild(titleEl);
  }

  const instruction = getQuestionInstruction(q);
  if (instruction) {
    const instructionEl = document.createElement('p');
    instructionEl.className = 'question-instruction';
    instructionEl.textContent = instruction;
    card.appendChild(instructionEl);
  }

  const prompt = document.createElement('p');
  prompt.className = 'question-prompt';
  prompt.textContent = q.prompt;
  card.appendChild(prompt);

  if (q.terms && q.terms.length > 0) {
    const termsHeading = document.createElement('p');
    termsHeading.className = 'list-heading';
    termsHeading.textContent = 'Terms:';
    card.appendChild(termsHeading);

    const termsList = document.createElement('ol');
    termsList.className = 'terms-list';
    for (const term of q.terms) {
      const li = document.createElement('li');
      li.textContent = term;
      termsList.appendChild(li);
    }
    card.appendChild(termsList);
  }

  if (q.choices && q.choices.length > 0) {
    if (q.terms && q.terms.length > 0) {
      const defsHeading = document.createElement('p');
      defsHeading.className = 'list-heading';
      defsHeading.textContent = 'Definitions:';
      card.appendChild(defsHeading);
    }
    const list = document.createElement('ol');
    list.className = 'choices-list';
    list.setAttribute('type', 'A');
    for (const choice of q.choices) {
      const li = document.createElement('li');
      li.textContent = choice;
      list.appendChild(li);
    }
    card.appendChild(list);
  }

  if (q.requirements && q.requirements.length > 0) {
    const reqHeading = document.createElement('p');
    reqHeading.className = 'requirements-heading';
    reqHeading.textContent = 'Required:';
    card.appendChild(reqHeading);

    const list = document.createElement('ol');
    list.className = 'requirements-list';
    for (const req of q.requirements) {
      const li = document.createElement('li');
      li.textContent = req;
      list.appendChild(li);
    }
    card.appendChild(list);
  }

  const copyBtn = document.createElement('button');
  copyBtn.className = 'btn-copy';
  copyBtn.textContent = 'Copy';
  copyBtn.addEventListener('click', async () => {
    try {
      await copyToClipboard(q);
      copyBtn.textContent = 'Copied!';
    } catch (error) {
      copyBtn.textContent = 'Copy failed';
    }
    setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
  });
  card.appendChild(copyBtn);

  resultsEl.appendChild(card);
}

/**
 * Runs in the context of the active tab.
 * Extracts the currently-visible question and its answer choices.
 */
function extractQuestion() {
  function detectDlcQuestionType(container) {
    const probeEl = container.closest('[class*="awd-probe-type-"]') ||
                    container.querySelector('[class*="awd-probe-type-"]');
    if (probeEl) {
      const match = probeEl.className.match(/awd-probe-type-([a-z_]+)/);
      if (match) {
        return match[1];
      }
    }

    const legendText = container.querySelector('legend')?.innerText?.trim().toLowerCase() || '';
    if (legendText.includes('multiple select')) {
      return 'multiple_select';
    }
    if (legendText.includes('multiple choice')) {
      return 'multiple_choice';
    }
    if (legendText.includes('true false') || legendText.includes('true/false')) {
      return 'true_false';
    }

    const promptText = container.innerText.toLowerCase();
    if (promptText.includes('select all that apply')) {
      return 'multiple_select';
    }

    const inputTypes = Array.from(container.querySelectorAll('input'))
      .map(input => input.type)
      .filter(Boolean);
    if (inputTypes.includes('checkbox')) {
      return 'multiple_select';
    }
    if (inputTypes.includes('radio')) {
      return 'multiple_choice';
    }

    return 'unknown';
  }

  // DLC-format question (multiple choice, true/false, multiple select, matching)
  const dlcContainer = document.querySelector('.dlc_question');
  if (dlcContainer) {
    const type = detectDlcQuestionType(dlcContainer);

    if (type === 'matching') {
      const matchingEl = dlcContainer.querySelector('.matching-component');
      const promptEl = (matchingEl || dlcContainer).querySelector('.prompt');
      const prompt = promptEl ? promptEl.innerText.trim() : '';

      const termEls = (matchingEl || dlcContainer).querySelectorAll(
        '.match-row .match-prompt-label .content'
      );
      const terms = Array.from(termEls)
        .map(el => el.innerText.trim())
        .filter(Boolean);

      const defEls = (matchingEl || dlcContainer).querySelectorAll(
        '.choices-container .choice-item-wrapper .choice-item .content'
      );
      const choices = Array.from(defEls)
        .map(el => el.innerText.trim())
        .filter(Boolean);

      return { type, title: null, prompt, choices, terms, requirements: [] };
    }

    if (type === 'fill_in_the_blank') {
      const promptEl = dlcContainer.querySelector('.prompt');
      let prompt = '';
      if (promptEl) {
        const clone = promptEl.cloneNode(true);
        const inputs = Array.from(clone.querySelectorAll('.fitb-input'));
        inputs.forEach((input, i) => {
          const target = input.closest('.input-container') || input;
          target.replaceWith(clone.ownerDocument.createTextNode(`[BLANK ${i + 1}]`));
        });
        prompt = clone.innerText.trim();
      }
      return { type, title: null, prompt, choices: [], requirements: [] };
    }

    const promptEl = dlcContainer.querySelector('.prompt');
    const prompt = promptEl ? promptEl.innerText.trim() : '';

    const choiceEls = dlcContainer.querySelectorAll('.choiceText');
    const choices = Array.from(choiceEls).map(el => el.innerText.trim());

    return { type, title: null, prompt, choices, requirements: [] };
  }

  // Worksheet/exercise-format question
  const wsContainer = document.querySelector('.worksheet-wrap');
  if (wsContainer) {
    const titleEl = wsContainer.querySelector('.question__title');
    const title = titleEl ? titleEl.innerText.trim() : null;

    const main = wsContainer.querySelector('.worksheet__main');
    let prompt = '';
    const requirements = [];

    if (main) {
      const paragraphs = [];
      let hitRequired = false;

      for (const child of main.children) {
        if (child.tagName === 'H3') {
          hitRequired = true;
          continue;
        }
        if (!hitRequired) {
          const text = child.innerText.trim();
          if (text) paragraphs.push(text);
        }
        if (hitRequired && child.tagName === 'OL') {
          const items = child.querySelectorAll('li');
          for (const li of items) {
            const text = li.innerText.trim();
            if (text) requirements.push(text);
          }
        }
      }

      prompt = paragraphs.join('\n\n');
    }

    return { type: 'exercise', title, prompt, choices: [], requirements };
  }

  return null;
}
