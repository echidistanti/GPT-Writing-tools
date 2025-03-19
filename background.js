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
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  // Show window immediately
  await showChatWindow(tab);

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
    // Add user message and typing indicator
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (params) => {
        const container = document.querySelector('.gpt-helper-result');
        if (!container) return;
        
        const messagesContainer = container.querySelector('.gpt-helper-messages');
        
        // Add user message
        const messageDiv = document.createElement('div');
        messageDiv.className = 'gpt-helper-message user';
        Object.assign(messageDiv.style, {
          maxWidth: '85%',
          alignSelf: 'flex-end',
          display: 'flex',
          flexDirection: 'column',
          gap: '4px'
        });

        const bubble = document.createElement('div');
        bubble.className = 'gpt-helper-bubble';
        bubble.textContent = params.text;
        Object.assign(bubble.style, {
          padding: '12px 16px',
          borderRadius: '18px 18px 4px 18px',
          backgroundColor: 'var(--gpt-user-bubble-bg)',
          color: 'var(--gpt-user-bubble-text)',
          fontSize: '14px',
          lineHeight: '1.5',
          wordBreak: 'break-word',
          boxShadow: '0 1px 2px rgba(0, 0, 0, 0.2)',
          position: 'relative'
        });

        const timestamp = document.createElement('div');
        timestamp.className = 'gpt-helper-timestamp';
        timestamp.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        Object.assign(timestamp.style, {
          fontSize: '11px',
          color: '#999',
          marginLeft: 'auto',
          marginRight: '4px'
        });

        messageDiv.appendChild(bubble);
        messageDiv.appendChild(timestamp);
        messagesContainer.appendChild(messageDiv);

        // Add typing indicator
        const typingIndicator = document.createElement('div');
        typingIndicator.className = 'gpt-helper-message assistant typing';
        Object.assign(typingIndicator.style, {
          maxWidth: '80%',
          alignSelf: 'flex-start'
        });

        const typingBubble = document.createElement('div');
        typingBubble.className = 'gpt-helper-bubble';
        typingBubble.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
        Object.assign(typingBubble.style, {
          padding: '12px 16px',
          borderRadius: '18px 18px 18px 4px',
          backgroundColor: 'var(--gpt-bubble-bg)',
          display: 'inline-flex',
          gap: '4px',
          alignItems: 'center'
        });

        const dots = typingBubble.querySelectorAll('.dot');
        dots.forEach((dot, index) => {
          Object.assign(dot.style, {
            width: '6px',
            height: '6px',
            backgroundColor: 'var(--gpt-bubble-text)',
            borderRadius: '50%',
            animation: `dotPulse 1s infinite ${index * 0.2}s`
          });
        });

        typingIndicator.appendChild(typingBubble);
        messagesContainer.appendChild(typingIndicator);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
      },
      args: [{ text }]
    });

    // Make API request
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

    // Show the response
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (params) => {
        const container = document.querySelector('.gpt-helper-result');
        if (!container) return;
        
        const messagesContainer = container.querySelector('.gpt-helper-messages');
        const typingIndicator = messagesContainer.querySelector('.typing');
        if (typingIndicator) {
          typingIndicator.remove();
        }

        // Add assistant message
        const messageDiv = document.createElement('div');
        messageDiv.className = 'gpt-helper-message assistant';
        Object.assign(messageDiv.style, {
          maxWidth: '85%',
          alignSelf: 'flex-start',
          display: 'flex',
          flexDirection: 'column',
          gap: '4px'
        });

        const bubble = document.createElement('div');
        bubble.className = 'gpt-helper-bubble';
        bubble.textContent = params.response;
        Object.assign(bubble.style, {
          padding: '12px 16px',
          borderRadius: '18px 18px 18px 4px',
          backgroundColor: 'var(--gpt-bubble-bg)',
          color: 'var(--gpt-bubble-text)',
          fontSize: '14px',
          lineHeight: '1.5',
          wordBreak: 'break-word',
          boxShadow: '0 1px 2px rgba(0, 0, 0, 0.2)',
          position: 'relative'
        });

        const timestamp = document.createElement('div');
        timestamp.className = 'gpt-helper-timestamp';
        timestamp.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        Object.assign(timestamp.style, {
          fontSize: '11px',
          color: '#999',
          marginLeft: '4px'
        });

        messageDiv.appendChild(bubble);
        messageDiv.appendChild(timestamp);
        messagesContainer.appendChild(messageDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
      },
      args: [{ response: result.choices[0].message.content }]
    });
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
  // Open options page instead of chat window
  chrome.runtime.openOptionsPage();
});

// Show loading window
async function showLoadingWindow(tab) {
  // The loading state will be handled within the chat window
  return;
}

// Show result
async function showResult(originalText, resultText, tab) {
  // Non fare nulla qui, la risposta è già stata mostrata
  return;
}

// Add message listener for chat
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'chat') {
    (async () => {
      try {
        // Get existing conversation from storage
        const { chatHistory = [] } = await chrome.storage.local.get(['chatHistory']);
        
        // Build conversation history
        const messages = [
          { 
            role: 'system', 
            content: 'You are a helpful assistant. You have access to the original text and its processed result. Help the user with any questions or requests about the text.' 
          }
        ];

        // Add context messages if they exist
        if (request.context.originalText && request.context.resultText) {
          messages.push({
            role: 'user',
            content: `Original text: "${request.context.originalText}"`
          });
          messages.push({
            role: 'assistant',
            content: request.context.resultText
          });
        }

        // Add chat history
        messages.push(...chatHistory);

        // Add current message
        messages.push({
          role: 'user',
          content: request.message
        });

        const response = await fetch(CONFIG.API_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${state.apiKey}`
          },
          body: JSON.stringify({
            model: state.selectedModel,
            messages: messages
          })
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error?.message || 'API request failed');
        }

        const result = await response.json();
        const assistantMessage = result.choices[0].message.content;

        // Update chat history
        chatHistory.push(
          { role: 'user', content: request.message },
          { role: 'assistant', content: assistantMessage }
        );

        // Keep only last 10 messages to avoid token limits
        if (chatHistory.length > 20) {
          chatHistory.splice(0, 2);
        }

        // Save updated history
        await chrome.storage.local.set({ chatHistory });

        sendResponse({ message: assistantMessage });
      } catch (error) {
        sendResponse({ error: error.message });
      }
    })();
    return true;
  }
});

// Unified chat window implementation
async function showChatWindow(tab, initialMessage = '', initialResponse = '') {
  try {
    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: ['styles/result.css']
    });

    const { overlayEnabled = true } = await chrome.storage.local.get(['overlayEnabled']);

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (params) => {
        // Ensure styles are scoped to our container
        const style = document.createElement('style');
        style.textContent = `
          .gpt-helper-result, .gpt-helper-result * {
            all: initial;
            box-sizing: border-box;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          }
          
          .gpt-helper-result {
            --gpt-primary-color: #3B82F6;
            --gpt-bg-color: #1F1F23;
            --gpt-text-color: #E5E7EB;
            --gpt-border-color: rgba(255, 255, 255, 0.1);
            --gpt-bubble-bg: #2D2D35;
            --gpt-bubble-text: #E5E7EB;
            --gpt-user-bubble-bg: var(--gpt-primary-color);
            --gpt-user-bubble-text: #FFFFFF;
            --gpt-input-bg: #2D2D35;
            --gpt-input-text: #E5E7EB;
            --gpt-timestamp-color: #6B7280;
            --gpt-placeholder-color: #9CA3AF;
          }

          .gpt-helper-overlay {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            z-index: 2147483646;
          }

          .gpt-helper-container {
            opacity: 1 !important;
          }

          .gpt-helper-message {
            display: flex;
            flex-direction: column;
            gap: 4px;
          }

          .gpt-helper-bubble {
            padding: 12px 16px;
            border-radius: 18px;
            font-size: 14px;
            line-height: 1.5;
            word-break: break-word;
            box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
            max-width: 100%;
          }

          .gpt-helper-message.user {
            align-self: flex-end;
          }

          .gpt-helper-message.user .gpt-helper-bubble {
            background-color: var(--gpt-user-bubble-bg);
            color: var(--gpt-user-bubble-text);
            border-radius: 18px 18px 4px 18px;
          }

          .gpt-helper-message.assistant .gpt-helper-bubble {
            background-color: var(--gpt-bubble-bg);
            color: var(--gpt-bubble-text);
            border-radius: 18px 18px 18px 4px;
          }

          .gpt-helper-timestamp {
            font-size: 11px;
            color: var(--gpt-timestamp-color);
            padding: 0 4px;
          }

          .gpt-helper-message.user .gpt-helper-timestamp {
            align-self: flex-end;
          }

          .gpt-helper-message.assistant .gpt-helper-timestamp {
            align-self: flex-start;
          }

          @keyframes dotPulse {
            0%, 100% { transform: scale(1); opacity: 0.4; }
            50% { transform: scale(1.2); opacity: 1; }
          }

          .gpt-helper-typing .dot {
            width: 6px;
            height: 6px;
            background-color: #666;
            border-radius: 50%;
            display: inline-block;
            margin: 0 1px;
          }

          .gpt-helper-textarea {
            flex: 1;
            border: 1px solid var(--gpt-border-color);
            border-radius: 24px;
            padding: 12px 16px;
            resize: none;
            font-size: 14px;
            line-height: 1.5;
            font-family: inherit;
            background-color: var(--gpt-input-bg) !important;
            color: var(--gpt-input-text) !important;
            outline: none;
          }

          .gpt-helper-textarea::placeholder {
            color: var(--gpt-placeholder-color);
          }

          .gpt-helper-textarea:hover {
            border-color: rgba(255, 255, 255, 0.2);
          }

          .gpt-helper-textarea:focus {
            border-color: var(--gpt-primary-color);
          }
        `;
        document.head.appendChild(style);

        // Get existing window if any
        let container = document.querySelector('.gpt-helper-result');
        
        // If window exists, just focus it and optionally add new messages
        if (container) {
          container.style.display = 'flex';
          if (params.initialMessage) {
            const messagesContainer = container.querySelector('.gpt-helper-messages');
            // Add new messages to existing chat
            addMessage(params.initialMessage, true);
            if (params.initialResponse) {
              addMessage(params.initialResponse, false);
            }
            // Scroll to bottom
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
          }
          return;
        }

        // Clean up any overlay
        document.querySelectorAll('.gpt-helper-overlay').forEach(el => el.remove());

        // Create overlay if enabled
        let overlay = null;
        if (params.overlayEnabled) {
          overlay = document.createElement('div');
          overlay.className = 'gpt-helper-overlay';
          document.body.appendChild(overlay);
          overlay.offsetHeight; // Force reflow
          overlay.classList.add('active');
        }

        // Create main container
        container = document.createElement('div');
        container.className = 'gpt-helper-result';

        // Fixed dimensions and position
        const width = 400;
        const height = 600;
        const padding = 20;

        Object.assign(container.style, {
          position: 'fixed',
          top: `${padding}px`,
          right: `${padding}px`,
          width: `${width}px`,
          height: `${height}px`,
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: 'var(--gpt-bg-color)',
          borderRadius: '12px',
          boxShadow: '0 8px 24px rgba(0, 0, 0, 0.2)',
          overflow: 'hidden',
          zIndex: '2147483647',
          opacity: '1',
          transform: 'none'
        });

        // Create header
        const header = document.createElement('div');
        Object.assign(header.style, {
          padding: '16px',
          borderBottom: '1px solid var(--gpt-border-color)',
          backgroundColor: 'var(--gpt-bg-color)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        });

        // Add title
        const title = document.createElement('div');
        title.textContent = 'GPT Chat';
        Object.assign(title.style, {
          fontWeight: '600',
          fontSize: '14px',
          color: 'var(--gpt-text-color)'
        });

        // Add close button
        const closeButton = document.createElement('button');
        closeButton.innerHTML = '✕';
        Object.assign(closeButton.style, {
          border: 'none',
          background: 'none',
          color: '#999',
          fontSize: '16px',
          cursor: 'pointer',
          padding: '4px 8px'
        });

        header.appendChild(title);
        header.appendChild(closeButton);

        // Close button handler
        closeButton.addEventListener('click', () => {
          if (overlay) {
            overlay.remove();
          }
          container.remove();
        });

        // Create messages container
        const messagesContainer = document.createElement('div');
        messagesContainer.className = 'gpt-helper-messages';
        Object.assign(messagesContainer.style, {
          flex: '1',
          overflowY: 'auto',
          padding: '20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
          backgroundColor: 'var(--gpt-bg-color)'
        });

        // Function to add a message
        function addMessage(content, isUser = false) {
          const messageDiv = document.createElement('div');
          messageDiv.className = `gpt-helper-message ${isUser ? 'user' : 'assistant'}`;
          Object.assign(messageDiv.style, {
            maxWidth: '85%',
            alignSelf: isUser ? 'flex-end' : 'flex-start',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px'
          });

          const bubble = document.createElement('div');
          bubble.className = 'gpt-helper-bubble';
          bubble.innerHTML = content;
          Object.assign(bubble.style, {
            padding: '12px 16px',
            borderRadius: isUser ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
            backgroundColor: isUser ? 'var(--gpt-user-bubble-bg)' : 'var(--gpt-bubble-bg)',
            color: 'var(--gpt-bubble-text)',
            fontSize: '14px',
            lineHeight: '1.5',
            wordBreak: 'break-word',
            boxShadow: '0 1px 2px rgba(0, 0, 0, 0.2)',
            position: 'relative'
          });

          // Add time stamp
          const timestamp = document.createElement('div');
          timestamp.className = 'gpt-helper-timestamp';
          timestamp.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          Object.assign(timestamp.style, {
            fontSize: '11px',
            color: '#999',
            marginLeft: isUser ? 'auto' : '4px',
            marginRight: isUser ? '4px' : 'auto'
          });

          messageDiv.appendChild(bubble);
          messageDiv.appendChild(timestamp);
          messagesContainer.appendChild(messageDiv);
          messagesContainer.scrollTop = messagesContainer.scrollHeight;
          return messageDiv;
        }

        // Add initial messages if provided
        if (params.initialMessage) {
          addMessage(params.initialMessage, true);
          if (params.initialResponse) {
            addMessage(params.initialResponse, false);
          }
        }

        // Create input container
        const inputContainer = document.createElement('div');
        inputContainer.className = 'gpt-helper-input-container';
        Object.assign(inputContainer.style, {
          padding: '16px',
          borderTop: '1px solid var(--gpt-border-color)',
          display: 'flex',
          gap: '12px',
          backgroundColor: 'var(--gpt-bg-color)'
        });

        const textarea = document.createElement('textarea');
        textarea.className = 'gpt-helper-textarea';
        textarea.placeholder = params.i18n.chatPlaceholder;
        textarea.rows = 1;
        Object.assign(textarea.style, {
          flex: '1',
          border: '1px solid var(--gpt-border-color)',
          borderRadius: '24px',
          padding: '12px 16px',
          resize: 'none',
          fontSize: '14px',
          lineHeight: '1.5',
          fontFamily: 'inherit',
          backgroundColor: 'var(--gpt-input-bg)',
          color: 'var(--gpt-input-text)',
          outline: 'none'
        });

        // Add hover and focus styles for textarea
        textarea.addEventListener('mouseover', () => {
          textarea.style.borderColor = 'rgba(255, 255, 255, 0.2)';
        });

        textarea.addEventListener('mouseout', () => {
          if (document.activeElement !== textarea) {
            textarea.style.borderColor = 'var(--gpt-border-color)';
          }
        });

        textarea.addEventListener('focus', () => {
          textarea.style.borderColor = 'var(--gpt-primary-color)';
        });

        textarea.addEventListener('blur', () => {
          textarea.style.borderColor = 'var(--gpt-border-color)';
        });

        const copyButton = document.createElement('button');
        copyButton.className = 'gpt-helper-button copy';
        copyButton.innerHTML = '📋';
        Object.assign(copyButton.style, {
          border: 'none',
          background: 'none',
          fontSize: '20px',
          cursor: 'pointer',
          padding: '8px',
          color: '#999'
        });

        inputContainer.appendChild(textarea);
        inputContainer.appendChild(copyButton);

        // Handle message sending
        async function sendMessage() {
          const message = textarea.value.trim();
          if (!message) return;

          addMessage(message, true);
          textarea.value = '';
          textarea.style.height = 'auto';

          // Show typing indicator
          const typingIndicator = document.createElement('div');
          typingIndicator.className = 'gpt-helper-message assistant typing';
          Object.assign(typingIndicator.style, {
            maxWidth: '80%',
            alignSelf: 'flex-start'
          });

          const typingBubble = document.createElement('div');
          typingBubble.className = 'gpt-helper-bubble';
          typingBubble.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
          Object.assign(typingBubble.style, {
            padding: '12px 16px',
            borderRadius: '18px 18px 18px 4px',
            backgroundColor: 'var(--gpt-bubble-bg)',
            display: 'inline-flex',
            gap: '4px',
            alignItems: 'center'
          });

          // Add dot animation styles
          const dots = typingBubble.querySelectorAll('.dot');
          dots.forEach((dot, index) => {
            Object.assign(dot.style, {
              width: '6px',
              height: '6px',
              backgroundColor: 'var(--gpt-bubble-text)',
              borderRadius: '50%',
              animation: `dotPulse 1s infinite ${index * 0.2}s`
            });
          });

          // Add animation keyframes
          const style = document.createElement('style');
          style.textContent = `
            @keyframes dotPulse {
              0%, 100% { transform: scale(1); opacity: 0.4; }
              50% { transform: scale(1.2); opacity: 1; }
            }
          `;
          document.head.appendChild(style);

          typingIndicator.appendChild(typingBubble);
          messagesContainer.appendChild(typingIndicator);
          messagesContainer.scrollTop = messagesContainer.scrollHeight;

          try {
            const response = await chrome.runtime.sendMessage({
              action: 'chat',
              message: message,
              context: {
                originalText: params.initialMessage || '',
                resultText: params.initialResponse || ''
              }
            });

            typingIndicator.remove();
            addMessage(response.message);
          } catch (error) {
            typingIndicator.remove();
            addMessage('Error: ' + (error.message || 'Failed to process message'), false);
          }
        }

        // Setup event handlers
        textarea.addEventListener('input', function() {
          this.style.height = 'auto';
          this.style.height = Math.min(this.scrollHeight, 120) + 'px';
        });

        textarea.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
          }
        });

        copyButton.addEventListener('click', function() {
          const messages = document.querySelectorAll('.gpt-helper-message.assistant .gpt-helper-bubble');
          if (messages.length > 0) {
            const lastMessage = messages[messages.length - 1].textContent;
            navigator.clipboard.writeText(lastMessage)
              .then(() => {
                this.innerHTML = '✓';
                // Add a success message
                const successMessage = document.createElement('div');
                successMessage.style.position = 'absolute';
                successMessage.style.right = '50px';
                successMessage.style.bottom = '20px';
                successMessage.style.backgroundColor = '#4CAF50';
                successMessage.style.color = 'white';
                successMessage.style.padding = '8px 16px';
                successMessage.style.borderRadius = '4px';
                successMessage.style.fontSize = '14px';
                successMessage.textContent = 'Copiato!';
                inputContainer.appendChild(successMessage);
                
                // Close window after 500ms
                setTimeout(() => {
                  if (overlay) {
                    overlay.classList.remove('active');
                    setTimeout(() => overlay.remove(), 300);
                  }
                  container.remove();
                }, 500);
              })
              .catch(err => {
                console.error('Copy failed:', err);
                alert(params.i18n.errorCopying);
              });
          }
        });

        // Assemble and add to page
        container.appendChild(header);
        container.appendChild(messagesContainer);
        container.appendChild(inputContainer);

        // Add container to page
        document.body.appendChild(container);
        textarea.focus();
      },
      args: [{
        overlayEnabled,
        initialMessage: initialMessage,
        initialResponse: initialResponse,
        i18n: {
          chatPlaceholder: chrome.i18n.getMessage('chatPlaceholder'),
          errorCopying: chrome.i18n.getMessage('errorCopying')
        }
      }]
    });
  } catch (error) {
    console.error('Error showing chat window:', error);
    showAlert(tab, `Error showing chat window: ${error.message}`);
  }
}