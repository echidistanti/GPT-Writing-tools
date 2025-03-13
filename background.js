// Configuration
const CONFIG = {
  MAX_TOKENS: 4000,
  API_ENDPOINT: 'https://api.openai.com/v1/chat/completions',
  TOKEN_RATIO: 4
};

// Extension state
let state = {
  apiKey: '',
  selectedModel: '',
  prompts: []
};

// Load configuration
async function loadConfig() {
  try {
    const result = await chrome.storage.sync.get(['apiKey', 'selectedModel', 'customPrompts']);
    console.log('Loading config from storage:', result);
    
    state = {
      apiKey: result.apiKey || '',
      selectedModel: result.selectedModel || '',
      prompts: Array.isArray(result.customPrompts) ? result.customPrompts : []
    };
    console.log('State after loading:', state);
  } catch (error) {
    console.error('Error loading configuration:', error);
  }
}

// Create context menus
function createContextMenus() {
  console.log('Creating context menus with prompts:', state.prompts);
  
  chrome.contextMenus.removeAll(() => {
    // Create main menu
    chrome.contextMenus.create({
      id: 'gpt-menu',
      title: chrome.i18n.getMessage('contextMenuTitle') || 'GPT Helper',
      contexts: ['selection']
    }, () => {
      if (chrome.runtime.lastError) {
        console.error('Error creating main menu:', chrome.runtime.lastError);
      }
    });

    // Create prompt menu items first
    if (Array.isArray(state.prompts)) {
      state.prompts.forEach(prompt => {
        chrome.contextMenus.create({
          id: `prompt-${prompt.id}`,
          parentId: 'gpt-menu',
          title: prompt.name,
          contexts: ['selection']
        }, () => {
          if (chrome.runtime.lastError) {
            console.error(`Error creating menu for prompt ${prompt.id}:`, chrome.runtime.lastError);
          }
        });
      });
    }

    // Create "Prompt on the Fly" last
    chrome.contextMenus.create({
      id: 'prompt-on-the-fly',
      parentId: 'gpt-menu',
      title: '✨ Prompt on the Fly',
      contexts: ['selection']
    });
  });
}

// Initialize extension
chrome.runtime.onInstalled.addListener(async () => {
  console.log('Extension installed/updated');
  await loadConfig();
  createContextMenus();
});

chrome.runtime.onStartup.addListener(async () => {
  console.log('Extension started');
  await loadConfig();
  createContextMenus();
});

// Handle storage changes
chrome.storage.onChanged.addListener((changes, area) => {
  console.log('Storage changed:', changes, area);
  if (area === 'sync') {
    if (changes.apiKey) state.apiKey = changes.apiKey.newValue;
    if (changes.selectedModel) state.selectedModel = changes.selectedModel.newValue;
    if (changes.customPrompts) {
      state.prompts = changes.customPrompts.newValue;
      createContextMenus();
    }
  }
});

// Handle messages from other parts of the extension
chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  if (message.action === 'reloadConfig') {
    console.log('Reloading configuration...');
    await loadConfig();
    createContextMenus();
    sendResponse({ success: true });
  }
  return true;
});

// Keep alive mechanism
setInterval(() => {
  chrome.runtime.getPlatformInfo(() => {});
}, 20000);

// Handle menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'prompt-on-the-fly') {
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (promptMessage) => {
        const promptText = prompt(promptMessage);
        return promptText;
      },
      args: [chrome.i18n.getMessage('enterCustomPrompt')]
    }, async (results) => {
      const promptText = results[0].result;
      if (promptText && promptText.trim()) {
        await processText(info.selectionText, promptText.trim(), tab);
      }
    });
  } else {
    const promptId = parseInt(info.menuItemId.split('-')[1]);
    const prompt = state.prompts.find(p => p.id === promptId);
    if (prompt) {
      processText(info.selectionText, prompt.prompt, tab);
    }
  }
});

// Process text
async function processText(text, promptText, tab) {
  if (!validateInput(text, tab)) return;

  try {
    await showLoadingWindow(tab);

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
        ]
      })
    });

    const result = await response.json();
    
    if (!response.ok) {
      throw new Error(result.error?.message || 'API request failed');
    }

    await showResult(text, result.choices[0].message.content, tab);
  } catch (error) {
    console.error('Processing error:', error);
    showAlert(tab, `${chrome.i18n.getMessage('errorProcessingText')}: ${error.message}`);
  }
}

// Utility functions
function validateInput(text, tab) {
  if (!text?.trim()) {
    showAlert(tab, chrome.i18n.getMessage('noTextSelected'));
    return false;
  }

  if (!state.apiKey || !state.selectedModel) {
    showAlert(tab, 'Please configure your API key and select a model in the extension settings.');
    return false;
  }

  return true;
}

async function showAlert(tab, message) {
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (alertMessage) => { alert(alertMessage); },
    args: [message]
  });
}

// Handle extension icon click
chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: ['styles/result.css']
    });
    
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (params) => {
        // Clean up existing
        document.querySelector('.gpt-helper-result')?.remove();

        // Create container
        const container = document.createElement('div');
        container.className = 'gpt-helper-result';
        
        container.innerHTML = `
          <div class="gpt-helper-draghandle">
            <span class="gpt-helper-title">GPT Chat</span>
            <button class="gpt-helper-close">✖</button>
          </div>
          <div class="gpt-helper-content">
            <div class="gpt-helper-chat active">
              <div class="gpt-helper-chat-input">
                <textarea class="gpt-helper-textarea" placeholder="${params.i18n.chatPlaceholder}"></textarea>
                <button class="gpt-helper-button send">${params.i18n.sendButton}</button>
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
          if (e.target === dragHandle || (dragHandle.contains(e.target) && e.target.tagName !== 'BUTTON')) {
            isDragging = true;
            initialX = e.clientX - xOffset;
            initialY = e.clientY - yOffset;
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
          isDragging = false;
        });

        // Setup close button
        container.querySelector('.gpt-helper-close').addEventListener('click', () => {
          container.remove();
        });

        // Setup send button
        container.querySelector('.gpt-helper-button.send').addEventListener('click', async () => {
          const textarea = container.querySelector('.gpt-helper-textarea');
          const userMessage = textarea.value.trim();
          
          if (!userMessage) return;

          // Create a new message section
          const messageSection = document.createElement('div');
          messageSection.className = 'gpt-helper-section';
          messageSection.innerHTML = `
            <h4>You:</h4>
            <div class="gpt-helper-text">${userMessage}</div>
          `;
          
          // Add loading indicator
          const loadingSection = document.createElement('div');
          loadingSection.className = 'gpt-helper-section';
          loadingSection.innerHTML = `
            <div class="gpt-helper-loading">
              <div class="gpt-helper-spinner"></div>
              <div class="gpt-helper-loading-text">${params.i18n.loadingText}</div>
            </div>
          `;

          // Insert messages before the chat input
          const chatSection = container.querySelector('.gpt-helper-chat');
          chatSection.insertBefore(messageSection, container.querySelector('.gpt-helper-chat-input'));
          chatSection.insertBefore(loadingSection, container.querySelector('.gpt-helper-chat-input'));

          // Clear textarea
          textarea.value = '';

          try {
            // Send message to background script
            const response = await chrome.runtime.sendMessage({
              action: 'chat',
              message: userMessage,
              context: {
                originalText: '',
                resultText: ''
              }
            });

            // Remove loading indicator
            loadingSection.remove();

            // Add AI response
            const responseSection = document.createElement('div');
            responseSection.className = 'gpt-helper-section';
            responseSection.innerHTML = `
              <h4>Assistant:</h4>
              <div class="gpt-helper-text">${response.message}</div>
            `;
            chatSection.insertBefore(responseSection, container.querySelector('.gpt-helper-chat-input'));
          } catch (error) {
            // Remove loading indicator
            loadingSection.remove();

            // Show error message
            const errorSection = document.createElement('div');
            errorSection.className = 'gpt-helper-section';
            errorSection.innerHTML = `
              <div class="gpt-helper-text" style="color: #dc3545 !important;">
                Error: ${error.message || 'Failed to process message'}
              </div>
            `;
            chatSection.insertBefore(errorSection, container.querySelector('.gpt-helper-chat-input'));
          }
        });

        document.body.appendChild(container);

        // Focus the textarea
        container.querySelector('.gpt-helper-textarea').focus();
      },
      args: [{
        i18n: {
          chatPlaceholder: chrome.i18n.getMessage('chatPlaceholder'),
          sendButton: chrome.i18n.getMessage('sendButton'),
          loadingText: chrome.i18n.getMessage('loadingText')
        }
      }]
    });
  } catch (error) {
    console.error('Error showing chat window:', error);
    showAlert(tab, `Error showing chat window: ${error.message}`);
  }
});

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
              <div class="gpt-helper-loading-text">${i18n.loadingText}</div>
              <div class="gpt-helper-loading-subtext">${i18n.loadingWait}</div>
            </div>
          </div>
        `;

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

// Show result
async function showResult(originalText, resultText, tab) {
  try {
    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: ['styles/result.css']
    });
    
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (params) => {
        // Clean up existing
        document.querySelector('.gpt-helper-result')?.remove();

        // Create container
        const container = document.createElement('div');
        container.className = 'gpt-helper-result';
        
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
            <div class="gpt-helper-chat">
              <div class="gpt-helper-chat-input">
                <textarea class="gpt-helper-textarea" placeholder="${params.i18n.chatPlaceholder}"></textarea>
                <button class="gpt-helper-button send">${params.i18n.sendButton}</button>
              </div>
            </div>
          </div>
          <div class="gpt-helper-actions">
            <button class="gpt-helper-button copy">${params.i18n.copyButton}</button>
            <button class="gpt-helper-button chat">${params.i18n.chatButton}</button>
          </div>
        `;

        // Setup drag functionality
        let isDragging = false;
        let currentX = 0, currentY = 0, initialX = 0, initialY = 0;
        let xOffset = 0, yOffset = 0;

        const dragHandle = container.querySelector('.gpt-helper-draghandle');
        
        dragHandle.addEventListener('mousedown', e => {
          if (e.target === dragHandle || (dragHandle.contains(e.target) && e.target.tagName !== 'BUTTON')) {
            isDragging = true;
            initialX = e.clientX - xOffset;
            initialY = e.clientY - yOffset;
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
          isDragging = false;
        });

        // Setup close button
        container.querySelector('.gpt-helper-close').addEventListener('click', () => {
          container.remove();
        });

        // Setup copy button
        container.querySelector('.gpt-helper-button.copy').addEventListener('click', (e) => {
          // Get all text elements, including chat responses
          const allResults = container.querySelectorAll('.gpt-helper-text');
          // Get the last result (either the initial result or the last chat response)
          const lastResult = allResults[allResults.length - 1];
          
          if (lastResult) {
            navigator.clipboard.writeText(
              new DOMParser().parseFromString(lastResult.innerHTML, 'text/html').documentElement.textContent
            )
              .then(() => {
                e.target.textContent = params.i18n.copiedStatus;
                e.target.classList.add('copied');
                // Chiudi la finestra dopo un breve delay
                setTimeout(() => {
                  container.remove();
                }, 500);
              })
              .catch(err => {
                console.error('Copy failed:', err);
                alert(params.i18n.errorCopying);
              });
          }
        });

        // Setup chat button
        container.querySelector('.gpt-helper-button.chat').addEventListener('click', () => {
          const chatSection = container.querySelector('.gpt-helper-chat');
          chatSection.classList.toggle('active');
        });

        // Setup send button
        container.querySelector('.gpt-helper-button.send').addEventListener('click', async () => {
          const textarea = container.querySelector('.gpt-helper-textarea');
          const userMessage = textarea.value.trim();
          
          if (!userMessage) return;

          // Create a new message section
          const messageSection = document.createElement('div');
          messageSection.className = 'gpt-helper-section';
          messageSection.innerHTML = `
            <h4>You:</h4>
            <div class="gpt-helper-text">${userMessage}</div>
          `;
          
          // Add loading indicator
          const loadingSection = document.createElement('div');
          loadingSection.className = 'gpt-helper-section';
          loadingSection.innerHTML = `
            <div class="gpt-helper-loading">
              <div class="gpt-helper-spinner"></div>
              <div class="gpt-helper-loading-text">${params.i18n.loadingText}</div>
            </div>
          `;

          // Insert messages before the chat input
          const chatSection = container.querySelector('.gpt-helper-chat');
          chatSection.insertBefore(messageSection, container.querySelector('.gpt-helper-chat-input'));
          chatSection.insertBefore(loadingSection, container.querySelector('.gpt-helper-chat-input'));

          // Clear textarea
          textarea.value = '';

          try {
            // Send message to background script
            const response = await chrome.runtime.sendMessage({
              action: 'chat',
              message: userMessage,
              context: {
                originalText: params.originalText,
                resultText: params.resultText
              }
            });

            // Remove loading indicator
            loadingSection.remove();

            // Add AI response
            const responseSection = document.createElement('div');
            responseSection.className = 'gpt-helper-section';
            responseSection.innerHTML = `
              <h4>Assistant:</h4>
              <div class="gpt-helper-text">${response.message}</div>
            `;
            chatSection.insertBefore(responseSection, container.querySelector('.gpt-helper-chat-input'));
          } catch (error) {
            // Remove loading indicator
            loadingSection.remove();

            // Show error message
            const errorSection = document.createElement('div');
            errorSection.className = 'gpt-helper-section';
            errorSection.innerHTML = `
              <div class="gpt-helper-text" style="color: #dc3545 !important;">
                Error: ${error.message || 'Failed to process message'}
              </div>
            `;
            chatSection.insertBefore(errorSection, container.querySelector('.gpt-helper-chat-input'));
          }
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
          copiedStatus: chrome.i18n.getMessage('copiedStatus'),
          chatButton: chrome.i18n.getMessage('chatButton'),
          chatPlaceholder: chrome.i18n.getMessage('chatPlaceholder'),
          sendButton: chrome.i18n.getMessage('sendButton'),
          loadingText: chrome.i18n.getMessage('loadingText')
        }
      }]
    });
  } catch (error) {
    console.error('UI error:', error);
    showAlert(tab, `${chrome.i18n.getMessage('errorShowingResult')}: ${error.message}`);
  }
}

// Add message listener for chat
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'chat') {
    (async () => {
      try {
        const response = await fetch(CONFIG.API_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${state.apiKey}`
          },
          body: JSON.stringify({
            model: state.selectedModel,
            messages: [
              { 
                role: 'system', 
                content: 'You are a helpful assistant. You have access to the original text and its processed result. Help the user with any questions or requests about the text.' 
              },
              { 
                role: 'user', 
                content: `Original text: "${request.context.originalText}"\n\nProcessed result: "${request.context.resultText}"\n\nUser message: ${request.message}` 
              }
            ]
          })
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error?.message || 'API request failed');
        }

        const result = await response.json();
        sendResponse({ message: result.choices[0].message.content });
      } catch (error) {
        sendResponse({ error: error.message });
      }
    })();
    return true; // Will respond asynchronously
  }
});