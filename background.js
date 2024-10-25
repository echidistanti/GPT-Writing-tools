let apiKey = '';
let selectedModel = '';
let prompts = [];

// Carica la configurazione all'avvio
async function loadConfig() {
  try {
    const result = await browser.storage.local.get(['apiKey', 'selectedModel', 'prompts']);
    apiKey = result.apiKey || '';
    selectedModel = result.selectedModel || '';
    prompts = Array.isArray(result.prompts) ? result.prompts : [];
    createContextMenus();
  } catch (error) {
    console.error('Error loading config:', error);
  }
}

// Ascolta i cambiamenti nello storage
browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'local') {
    if (changes.apiKey) apiKey = changes.apiKey.newValue;
    if (changes.selectedModel) selectedModel = changes.selectedModel.newValue;
    if (changes.prompts) {
      prompts = changes.prompts.newValue;
      createContextMenus();
    }
  }
});

// Crea i menu contestuali
function createContextMenus() {
  browser.contextMenus.removeAll().then(() => {
    browser.contextMenus.create({
      id: 'gpt-menu',
      title: browser.i18n.getMessage('contextMenuTitle'),
      contexts: ['selection']
    });

    if (Array.isArray(prompts)) {
      prompts.forEach(prompt => {
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

// Gestisce il click sul menu
browser.contextMenus.onClicked.addListener((info, tab) => {
  const promptId = parseInt(info.menuItemId.split('-')[1]);
  const prompt = prompts.find(p => p.id === promptId);
  
  if (prompt) {
    processText(info.selectionText, prompt.prompt, tab);
  }
});

// Processa il testo con GPT
async function processText(text, promptText, tab) {
  if (!apiKey || !selectedModel) {
    browser.tabs.executeScript(tab.id, {
      code: `alert('Please configure your API key and select a model in the extension settings.')`
    });
    return;
  }

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: selectedModel,
        messages: [
          { role: 'system', content: promptText },
          { role: 'user', content: text }
        ]
      })
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error.message);
    }
    
    await showResult(text, result.choices[0].message.content, tab);
  } catch (error) {
    console.error('Error:', error);
    browser.tabs.executeScript(tab.id, {
      code: `alert('${browser.i18n.getMessage('errorProcessingText')}: ${error.message}')`
    });
  }
}

// Mostra il risultato
async function showResult(originalText, resultText, tab) {
  try {
    // Inietta i CSS
    await browser.tabs.insertCSS(tab.id, { file: 'styles/result.css' });
    
    // Inietta il codice per mostrare il risultato
    const code = `
      (function() {
        // Funzioni di utility
        function copyToClipboard(text, statusElement, buttonElement) {
          try {
            navigator.clipboard.writeText(text).then(() => {
              showCopyFeedback(statusElement, buttonElement);
            });
          } catch (err) {
            console.error('Error copying text:', err);
          }
        }

        function showCopyFeedback(statusElement, buttonElement) {
          statusElement.style.display = 'inline';
          buttonElement.style.backgroundColor = '#45a049';
          
          setTimeout(() => {
            statusElement.style.display = 'none';
            buttonElement.style.backgroundColor = '#4CAF50';
          }, 2000);
        }

        // Rimuovi risultato esistente se presente
        const existingResult = document.querySelector('.gpt-helper-result');
        if (existingResult) {
          existingResult.remove();
        }

        // Crea il nuovo contenitore risultato
        const container = document.createElement('div');
        container.className = 'gpt-helper-result';
        
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
            <button class="gpt-helper-button">
              ${browser.i18n.getMessage('copyButton')}
            </button>
            <span class="gpt-helper-status">
              ${browser.i18n.getMessage('copiedStatus')}
            </span>
          </div>
        \`;

        // Setup drag and drop
        const dragHandle = container.querySelector('.gpt-helper-draghandle');
        let isDragging = false;
        let currentX;
        let currentY;
        let initialX;
        let initialY;
        let xOffset = 0;
        let yOffset = 0;

        dragHandle.addEventListener('mousedown', e => {
          initialX = e.clientX - xOffset;
          initialY = e.clientY - yOffset;
          if (e.target === dragHandle || dragHandle.contains(e.target)) {
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

        // Setup event listeners
        const closeButton = container.querySelector('.gpt-helper-close');
        const copyButton = container.querySelector('.gpt-helper-button');
        const copyStatus = container.querySelector('.gpt-helper-status');

        closeButton.addEventListener('click', () => {
          container.remove();
        });

        copyButton.addEventListener('click', () => {
          copyToClipboard(${JSON.stringify(resultText)}, copyStatus, copyButton);
        });

        // Aggiungi il container al documento
        document.body.appendChild(container);
      })();
    `;

    await browser.tabs.executeScript(tab.id, { code });
  } catch (error) {
    console.error('Error showing result:', error);
    browser.tabs.executeScript(tab.id, {
      code: `alert('${browser.i18n.getMessage('errorShowingResult')}: ${error.message}')`
    });
  }
}

// Gestione click sull'icona dell'estensione
browser.browserAction.onClicked.addListener(() => {
  browser.runtime.openOptionsPage();
});

// Carica la configurazione all'avvio
loadConfig();
