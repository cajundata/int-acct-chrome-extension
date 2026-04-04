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

  const probeEl = container.closest('[class*="awd-probe-type-"]') ||
                  container.querySelector('[class*="awd-probe-type-"]');
  let type = 'unknown';
  if (probeEl) {
    const match = probeEl.className.match(/awd-probe-type-(\w+)/);
    if (match) type = match[1];
  }

  const promptEl = container.querySelector('.prompt');
  const prompt = promptEl ? promptEl.innerText.trim() : '';

  const choiceEls = container.querySelectorAll('.choiceText');
  const choices = Array.from(choiceEls).map(el => el.innerText.trim());

  return { type, title: null, prompt, choices, requirements: [] };
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
