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
  await copyToClipboard(result);
  if (saved) {
    statusEl.textContent = `Saved & copied: ${result.type.replace(/_/g, ' ')} question`;
  } else {
    statusEl.textContent = 'Already saved — copied to clipboard.';
  }
  renderQuestion(result);
  updateCount();
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
    func: () => {
      const html = document.documentElement.cloneNode(true);
      // Inline iframe content where accessible (same-origin)
      const iframes = document.querySelectorAll('iframe');
      const clonedIframes = html.querySelectorAll('iframe');
      iframes.forEach((iframe, i) => {
        try {
          const iframeDoc = iframe.contentDocument;
          if (iframeDoc) {
            const div = document.createElement('div');
            div.setAttribute('data-iframe-src', iframe.src || '');
            div.setAttribute('data-iframe-title', iframe.title || '');
            div.className = 'captured-iframe-content';
            div.innerHTML = iframeDoc.documentElement.outerHTML;
            clonedIframes[i].replaceWith(div);
          }
        } catch (e) {
          // Cross-origin iframe, leave as-is
        }
      });
      return html.outerHTML;
    },
  });

  if (!result) {
    statusEl.textContent = 'Could not read page HTML.';
    return;
  }

  // Copy to clipboard
  await navigator.clipboard.writeText(result);

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
  statusEl.textContent = `Saved & copied page HTML (${size} KB).`;
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
  text += `Q: ${q.prompt}`;
  if (q.choices && q.choices.length > 0) {
    text += '\n' + q.choices.map((c, i) => `${letters[i]}) ${c}`).join('\n');
  }
  if (q.requirements && q.requirements.length > 0) {
    text += '\n\nRequired:\n' + q.requirements.map((r, i) => `${i + 1}. ${r}`).join('\n');
  }
  return text;
}

async function copyToClipboard(q) {
  await navigator.clipboard.writeText(formatQuestion(q));
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

  const prompt = document.createElement('p');
  prompt.className = 'question-prompt';
  prompt.textContent = q.prompt;
  card.appendChild(prompt);

  if (q.choices && q.choices.length > 0) {
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
    await copyToClipboard(q);
    copyBtn.textContent = 'Copied!';
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
  // DLC-format question (multiple choice, true/false, multiple select)
  const dlcContainer = document.querySelector('.dlc_question');
  if (dlcContainer) {
    const probeEl = dlcContainer.closest('[class*="awd-probe-type-"]') ||
                    dlcContainer.querySelector('[class*="awd-probe-type-"]');
    let type = 'unknown';
    if (probeEl) {
      const match = probeEl.className.match(/awd-probe-type-(\w+)/);
      if (match) type = match[1];
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
