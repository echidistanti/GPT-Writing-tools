// Configuration
const CONFIG = {
  MAX_TOKENS: 4000,
  API_ENDPOINT: 'https://api.openai.com/v1/chat/completions',
  TOKEN_RATIO: 4, // characters per token (estimate)
};

// Extension state
let state = {
  apiKey: '',
  selectedModel: '',
  prompts: []
};

// Initialize service worker
chrome.runtime.onInstalled.addListener(async () => {
  await loadConfig();
  createContextMenus();
});

// Handle service worker activation
chrome.runtime.onStartup.addListener(async () => {
  await loadConfig();
  createContextMenus();
});

// Configuration management
async function loadConfig() {
  try {
    const result = await chrome.storage.local.get(['apiKey', 'selectedModel', 'prompts']);
    state = {
      apiKey: result.apiKey || '',
      selectedModel: result.selectedModel || '',
      prompts: Array.isArray(result.prompts) ? result.prompts : []
    };
  } catch (error) {
    console.error('Error loading configuration:', error);
  }
}

// Listen for storage changes
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local') {
    if (changes.apiKey) state.apiKey = changes.apiKey.newValue;
    if (changes.selectedModel) state.selectedModel = changes.selectedModel.newValue;
    if (changes.prompts) {
      state.prompts = changes.prompts.newValue;
      createContextMenus();
    }
  }
});

// Handle extension icon click
chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

// Context menu management
function createContextMenus() {
  chrome.contextMenus.removeAll().then(() => {
    // Main menu
    chrome.contextMenus.create({
      id: 'gpt-menu',
      title: chrome.i18n.getMessage('contextMenuTitle'),
      contexts: ['selection']
    });

    // Submenu for each prompt
    if (Array.isArray(state.prompts)) {
      state.prompts.forEach(prompt => {
        chrome.contextMenus.create({
          id: `prompt-${prompt.id}`,
          parentId: 'gpt-menu',
          title: prompt.name,
          contexts: ['selection']
        });
      });
    }
  });
}

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
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

async function showAlert(tab, message) {
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (alertMessage) => { alert(alertMessage); },
    args: [message]
  });
}

// Input validation
function validateInput(text, tab) {
  if (!text?.trim()) {
    showAlert(tab, chrome.i18n.getMessage('noTextSelected') || 'Please select some text first.');
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

// Show loading window
async function showLoadingWindow(tab) {
  try {
    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: ['styles/result.css']
    });
    
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (i18n) => {
        // Clean up existing
        document.querySelector('.gpt-helper-result')?.remove();

        // Create loading window
        const container = document.createElement('div');
        container.className = 'gpt-helper-result';
        
        container.innerHTML = `
          <div class="gpt-helper-draghandle">
            <span class="gpt-helper-title">${i18n.loadingTitle}</span>
            <button class="gpt-helper-close">✖</button>
          </div>
          <div class="gpt-helper-content" style="display: flex; justify-content: center; align-items: center; min-height: 150px;">
            <div class="gpt-helper-loading">
              <div class="gpt-helper-spinner"></div>
              <div class="gpt-helper-loading-text">
                ${i18n.loadingText}
                <div class="gpt-helper-loading-subtext">
                  ${i18n.loadingWait}
                </div>
              </div>
            </div>
          </div>
        `;

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
            container.style.transform = `translate(${currentX}px, ${currentY}px)`;
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
      },
      args: [{
        loadingTitle: chrome.i18n.getMessage('loadingTitle'),
        loadingText: chrome.i18n.getMessage('loadingText'),
        loadingWait: chrome.i18n.getMessage('loadingWait')
      }]
    });
  } catch (error) {
    console.error('Error showing loading window:', error);
  }
}

// Main process
async function processText(text, promptText, tab) {
  if (!validateInput(text, tab)) return;

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
    showAlert(tab, `${chrome.i18n.getMessage('errorProcessingText')}: ${error.message}`);
  }
}

// Show result window
async function showResult(originalText, resultText, tab) {
  try {
    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: ['styles/result.css']
    });
    
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (params) => {
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
          button.textContent = params.i18n.copiedStatus;
          
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

        container.innerHTML = `
          <div class="gpt-helper-draghandle">
            <span class="gpt-helper-title">${params.i18n.resultTitle}</span>
            <button class="gpt-helper-close">✖</button>
          </div>
          <div class="gpt-helper-content">
            <div class="gpt-helper-section">
              <h4>${params.i18n.originalTextLabel}</h4>
              <div class="gpt-helper-text">${params.originalText}</div>
            </div>
            <div class="gpt-helper-section">
              <h4>${params.i18n.resultTextLabel}</h4>
              <div class="gpt-helper-text">${params.resultText}</div>
            </div>
          </div>
          <div class="gpt-helper-actions">
            <button class="gpt-helper-button">${params.i18n.copyButton}</button>
          </div>
        `;

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
            container.style.transform = `translate(${currentX}px, ${currentY}px)`;
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
          copyToClipboard(params.resultText, e.target);
        });

        document.body.appendChild(container);
      },
      args: [{
        originalText: originalText.replace(/"/g, '&quot;'),
        resultText: resultText.replace(/"/g, '&quot;'),
        i18n: {
          resultTitle: chrome.i18n.getMessage('resultTitle'),
          originalTextLabel: chrome.i18n.getMessage('originalTextLabel'),
          resultTextLabel: chrome.i18n.getMessage('resultTextLabel'),
          copyButton: chrome.i18n.getMessage('copyButton'),
          copiedStatus: chrome.i18n.getMessage('copiedStatus')
        }
      }]
    });
  } catch (error) {
    console.error('UI error:', error);
    showAlert(tab, `${chrome.i18n.getMessage('errorShowingResult')}: ${error.message}`);
  }
}

// Keep service worker alive
chrome.runtime.onConnect.addListener(port => {
  port.onDisconnect.addListener(() => {
    // Reconnect logic if needed
  });
});