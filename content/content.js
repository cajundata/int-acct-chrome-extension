// Content script — runs on every page.
// Listens for extraction requests from the popup.

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'extract') {
    sendResponse(extractQuestion());
  }
});

function extractQuestion() {
  return extractDLCQuestion() || extractExercise();
}

function extractDLCQuestion() {
  const container = document.querySelector('.dlc_question');
  if (!container) return null;

  const type = detectDlcQuestionType(container);

  if (type === 'matching') {
    const matchingEl = container.querySelector('.matching-component');
    const promptEl = (matchingEl || container).querySelector('.prompt');
    const prompt = promptEl ? promptEl.innerText.trim() : '';

    const termEls = (matchingEl || container).querySelectorAll(
      '.match-row .match-prompt-label .content'
    );
    const terms = Array.from(termEls)
      .map(el => el.innerText.trim())
      .filter(Boolean);

    const defEls = (matchingEl || container).querySelectorAll(
      '.choices-container .choice-item-wrapper .choice-item .content'
    );
    const choices = Array.from(defEls)
      .map(el => el.innerText.trim())
      .filter(Boolean);

    return { type, title: null, prompt, choices, terms, requirements: [] };
  }

  if (type === 'fill_in_the_blank') {
    const promptEl = container.querySelector('.prompt');
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

  if (type === 'sortable') {
    const sortableEl = container.querySelector('.sortable-component');
    const promptEl = (sortableEl || container).querySelector('.prompt');
    const prompt = promptEl ? promptEl.innerText.trim() : '';

    // Items appear in scrambled presentation order (the correct sequence is
    // not exposed in the DOM). Target `.content` to skip the sibling
    // `_visuallyHidden` "Choice N of M … toggle button" text.
    const itemEls = (sortableEl || container).querySelectorAll('.choice-item .content');
    const choices = Array.from(itemEls)
      .map(el => el.innerText.trim())
      .filter(Boolean);

    return { type, title: null, prompt, choices, requirements: [] };
  }

  const promptEl = container.querySelector('.prompt');
  const prompt = promptEl ? promptEl.innerText.trim() : '';

  const choiceEls = container.querySelectorAll('.choiceText');
  const choices = Array.from(choiceEls).map(el => el.innerText.trim());

  return { type, title: null, prompt, choices, requirements: [] };
}

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

function extractExercise() {
  const container = document.querySelector('.worksheet-wrap');
  if (!container) return null;

  const titleEl = container.querySelector('.question__title');
  const title = titleEl ? titleEl.innerText.trim() : null;

  // Collect scenario paragraphs from worksheet__main, stopping at the Required heading
  const main = container.querySelector('.worksheet__main');
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
