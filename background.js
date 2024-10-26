// Configurazione
const CONFIG = {
  MAX_TOKENS: 4000,
  API_ENDPOINT: 'https://api.openai.com/v1/chat/completions',
  TOKEN_RATIO: 4, // caratteri per token (stima)
};

// Stato dell'estensione
let state = {
  apiKey: '',
  selectedModel: '',
  prompts: []
};

// Inizializzazione
async function init() {
  await loadConfig();
  setupEventListeners();
  createContextMenus();
}

// Gestione della configurazione
async function loadConfig() {
  try {
    const result = await browser.storage.local.get(['apiKey', 'selectedModel', 'prompts']);
    state = {
      apiKey: result.apiKey || '',
      selectedModel: result.selectedModel || '',
      prompts: Array.isArray(result.prompts) ? result.prompts : []
    };
  } catch (error) {
    console.error('Error loading configuration:', error);
  }
}

async function showLoadingWindow(tab) {
  try {
    await browser.tabs.insertCSS(tab.id, { file: 'styles/result.css' });
    
    const code = `
    (function() {
      // Clean up existing
      document.querySelector('.gpt-helper-result')?.remove();

      // Create loading window
      const container = document.createElement('div');
      container.className = 'gpt-helper-result';
      
      container.innerHTML = \`
        <div class="gpt-helper-draghandle">
          <span class="gpt-helper-title">${browser.i18n.getMessage('loadingTitle')}</span>
          <button class="gpt-helper-close">✖</button>
        </div>
        <div class="gpt-helper-content" style="display: flex; justify-content: center; align-items: center; min-height: 150px;">
          <div class="gpt-helper-loading">
            <div class="gpt-helper-spinner"></div>
            <div class="gpt-helper-loading-text">
              ${browser.i18n.getMessage('loadingText')}
              <div class="gpt-helper-loading-subtext">
                ${browser.i18n.getMessage('loadingWait')}
              </div>
            </div>
          </div>
        </div>
      \`;

      // Setup drag functionality
      let isDragging = false;
      let currentX = 0, currentY = 0, initialX = 0, initialY = 0;
      let xOffset = 0, yOffset = 0;

      const dragHandle = container.querySelector('.gpt-helper-draghandle');
      
      dragHandle.addEventListener('mousedown', e => {
        if (e.target === dragHandle || dragHandle.contains(e.target)) {
          initialX = e.clientX - xOffset;
          initialY = e.clientY - yOffset;
          isDragging = true;
        }
      });

      document.addEventListener('mousemove', e => {
        if (isDragging) {
          e.preventDefault();
          currentX = e.clientX - initialX;
          currentY = e.clientY - initialY;
          xOffset = currentX;
          yOffset = currentY;
          container.style.transform = \`translate(\${currentX}px, \${currentY}px)\`;
        }
      });

      document.addEventListener('mouseup', () => {
        initialX = currentX;
        initialY = currentY;
        isDragging = false;
      });

      // Setup close button
      container.querySelector('.gpt-helper-close').addEventListener('click', () => {
        container.remove();
      });

      document.body.appendChild(container);
    })();
    `;

    await browser.tabs.executeScript(tab.id, { code });
  } catch (error) {
    console.error('Error showing loading window:', error);
  }
}

function setupEventListeners() {
  // Ascolta i cambiamenti nello storage
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
      if (changes.apiKey) state.apiKey = changes.apiKey.newValue;
      if (changes.selectedModel) state.selectedModel = changes.selectedModel.newValue;
      if (changes.prompts) {
        state.prompts = changes.prompts.newValue;
        createContextMenus();
      }
    }
  });

  // Gestione click sull'icona dell'estensione
  browser.browserAction.onClicked.addListener(() => {
    browser.runtime.openOptionsPage();
  });
}

// Gestione menu contestuale
function createContextMenus() {
  browser.contextMenus.removeAll().then(() => {
    // Menu principale
    browser.contextMenus.create({
      id: 'gpt-menu',
      title: browser.i18n.getMessage('contextMenuTitle'),
      contexts: ['selection']
    });

    // Sottomenu per ogni prompt
    if (Array.isArray(state.prompts)) {
      state.prompts.forEach(prompt => {
        browser.contextMenus.create({
          id: `prompt-${prompt.id}`,
          parentId: 'gpt-menu',
          title: prompt.name,
          contexts: ['selection']
        });
      });
    }
  });
}

// Gestione click sul menu
browser.contextMenus.onClicked.addListener((info, tab) => {
  const promptId = parseInt(info.menuItemId.split('-')[1]);
  const prompt = state.prompts.find(p => p.id === promptId);
  
  if (prompt) {
    processText(info.selectionText, prompt.prompt, tab);
  }
});

// Utilities
function estimateTokenCount(text) {
  return Math.ceil(text.length / CONFIG.TOKEN_RATIO);
}

function showAlert(tab, message) {
  return browser.tabs.executeScript(tab.id, {
    code: `alert(${JSON.stringify(message)})`
  });
}

// Validazione input
function validateInput(text, tab) {
  if (!text?.trim()) {
    showAlert(tab, browser.i18n.getMessage('noTextSelected') || 'Please select some text first.');
    return false;
  }

  if (!state.apiKey || !state.selectedModel) {
    showAlert(tab, 'Please configure your API key and select a model in the extension settings.');
    return false;
  }

  const estimatedTokens = estimateTokenCount(text);
  if (estimatedTokens > CONFIG.MAX_TOKENS) {
    const message = `Selected text is too long (approximately ${estimatedTokens} tokens).
    Please select shorter text (maximum ${CONFIG.MAX_TOKENS} tokens).
    
    Tip: Try splitting the text into smaller sections.`;
    showAlert(tab, message);
    return false;
  }

  return true;
}

// Processo principale
async function processText(text, promptText, tab) {
  if (!validateInput(text, tab)) return;

  // Mostra subito la finestra di loading
  try {
    await showLoadingWindow(tab);

    const estimatedTokens = estimateTokenCount(text);
    const response = await fetch(CONFIG.API_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.apiKey}`
      },
      body: JSON.stringify({
        model: state.selectedModel,
        messages: [
          { role: 'system', content: promptText },
          { role: 'user', content: text }
        ],
        max_tokens: Math.min(CONFIG.MAX_TOKENS, 16000 - estimatedTokens)
      })
    });

    const result = await response.json();
    
    if (!response.ok) {
      throw new Error(result.error?.message || 'API request failed');
    }
    
    if (result.error) {
      throw new Error(result.error.message);
    }

    await showResult(text, result.choices[0].message.content, tab);
  } catch (error) {
    console.error('Processing error:', error);
    showAlert(tab, `${browser.i18n.getMessage('errorProcessingText')}: ${error.message}`);
  }
}


// UI Component
async function showResult(originalText, resultText, tab) {
  try {
    // Get extension URL for the CSS file
    const cssUrl = browser.runtime.getURL('styles/result.css');
    
    // Inject CSS using the full URL
    await browser.tabs.insertCSS(tab.id, { 
      file: 'styles/result.css'
    });
    
    const code = `
    (function() {
      // Utility Functions
      function copyToClipboard(text, button) {
        navigator.clipboard.writeText(text)
          .then(() => showCopyFeedback(button))
          .catch(err => {
            console.error('Copy error:', err);
            button.classList.add('error');
            setTimeout(() => button.classList.remove('error'), 2000);
          });
      }

      function showCopyFeedback(button) {
        const originalText = button.textContent;
        button.classList.add('copied');
        button.textContent = '${browser.i18n.getMessage('copiedStatus')}';
        
        setTimeout(() => {
          button.classList.remove('copied');
          button.textContent = originalText;
        }, 2000);
      }

      function saveWindowSize(container) {
        const size = {
          width: container.offsetWidth,
          height: container.offsetHeight
        };
        localStorage.setItem('gptHelperWindowSize', JSON.stringify(size));
      }

      function loadWindowSize() {
        try {
          return JSON.parse(localStorage.getItem('gptHelperWindowSize')) || { width: 400, height: 500 };
        } catch {
          return { width: 400, height: 500 };
        }
      }

      // Clean up existing
      document.querySelector('.gpt-helper-result')?.remove();

      // Create new result window
      const container = document.createElement('div');
      container.className = 'gpt-helper-result';
      
      const savedSize = loadWindowSize();
      Object.assign(container.style, {
        width: savedSize.width + 'px',
        height: savedSize.height + 'px'
      });

      container.innerHTML = \`
        <div class="gpt-helper-draghandle">
          <span class="gpt-helper-title">${browser.i18n.getMessage('resultTitle')}</span>
          <button class="gpt-helper-close">✖</button>
        </div>
        <div class="gpt-helper-content">
          <div class="gpt-helper-section">
            <h4>${browser.i18n.getMessage('originalTextLabel')}</h4>
            <div class="gpt-helper-text">${originalText.replace(/"/g, '&quot;')}</div>
          </div>
          <div class="gpt-helper-section">
            <h4>${browser.i18n.getMessage('resultTextLabel')}</h4>
            <div class="gpt-helper-text">${resultText.replace(/"/g, '&quot;')}</div>
          </div>
        </div>
        <div class="gpt-helper-actions">
          <button class="gpt-helper-button">${browser.i18n.getMessage('copyButton')}</button>
        </div>
      \`;

      // Setup dragging
      let isDragging = false;
      let currentX = 0, currentY = 0, initialX = 0, initialY = 0;
      let xOffset = 0, yOffset = 0;

      const dragHandle = container.querySelector('.gpt-helper-draghandle');
      
      dragHandle.addEventListener('mousedown', e => {
        if (e.target === dragHandle || dragHandle.contains(e.target)) {
          initialX = e.clientX - xOffset;
          initialY = e.clientY - yOffset;
          isDragging = true;
        }
      });

      document.addEventListener('mousemove', e => {
        if (isDragging) {
          e.preventDefault();
          currentX = e.clientX - initialX;
          currentY = e.clientY - initialY;
          xOffset = currentX;
          yOffset = currentY;
          container.style.transform = \`translate(\${currentX}px, \${currentY}px)\`;
        }
      });

      document.addEventListener('mouseup', () => {
        initialX = currentX;
        initialY = currentY;
        isDragging = false;
      });

      // Setup resizing
      const resizeObserver = new ResizeObserver(() => {
        if (!container.classList.contains('resizing')) {
          container.classList.add('resizing');
          setTimeout(() => {
            saveWindowSize(container);
            container.classList.remove('resizing');
          }, 100);
        }
      });

      resizeObserver.observe(container);

      // Setup event handlers
      container.querySelector('.gpt-helper-close').addEventListener('click', () => {
        resizeObserver.disconnect();
        container.remove();
      });

      container.querySelector('.gpt-helper-button').addEventListener('click', (e) => {
        copyToClipboard(${JSON.stringify(resultText)}, e.target);
      });

      document.body.appendChild(container);
    })();
    `;

    await browser.tabs.executeScript(tab.id, { code });
  } catch (error) {
    console.error('UI error:', error);
    showAlert(tab, `${browser.i18n.getMessage('errorShowingResult')}: ${error.message}`);
  }
}

// Inizializza l'estensione
init();