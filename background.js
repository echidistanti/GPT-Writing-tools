const CONFIG = {
  MAX_TOKENS: 4000,
  API_ENDPOINT: 'https://api.openai.com/v1/chat/completions',
  TOKEN_RATIO: 4,
};

class ExtensionManager {
  constructor() {
    this.state = {
      apiKey: '',
      selectedModel: '',
      prompts: []
    };
  }

  async init() {
    await this.loadConfig();
    this.setupEventListeners();
    this.createContextMenus();
  }

  async loadConfig() {
    try {
      const result = await browser.storage.local.get(['apiKey', 'selectedModel', 'prompts']);
      this.state = {
        apiKey: result.apiKey || '',
        selectedModel: result.selectedModel || '',
        prompts: Array.isArray(result.prompts) ? result.prompts : []
      };
    } catch (error) {
      console.error('Config loading error:', error);
    }
  }

  setupEventListeners() {
    browser.storage.onChanged.addListener(this.handleStorageChange.bind(this));
    browser.browserAction.onClicked.addListener(() => browser.runtime.openOptionsPage());
    browser.contextMenus.onClicked.addListener(this.handleContextMenuClick.bind(this));
  }

  handleStorageChange(changes, area) {
    if (area !== 'local') return;
    
    Object.entries(changes).forEach(([key, { newValue }]) => {
      this.state[key] = newValue;
      if (key === 'prompts') this.createContextMenus();
    });
  }

  createContextMenus() {
    browser.contextMenus.removeAll().then(() => {
      browser.contextMenus.create({
        id: 'gpt-menu',
        title: browser.i18n.getMessage('contextMenuTitle'),
        contexts: ['selection']
      });

      this.state.prompts?.forEach(prompt => {
        browser.contextMenus.create({
          id: `prompt-${prompt.id}`,
          parentId: 'gpt-menu',
          title: prompt.name,
          contexts: ['selection']
        });
      });
    });
  }

  async handleContextMenuClick(info, tab) {
    const promptId = parseInt(info.menuItemId.split('-')[1]);
    const prompt = this.state.prompts.find(p => p.id === promptId);
    if (prompt) {
      await this.processText(info.selectionText, prompt.prompt, tab);
    }
  }

  async processText(text, promptText, tab) {
    if (!this.validateInput(text, tab)) return;

    try {
      await this.showLoadingUI(tab);
      const response = await this.callGPTAPI(text, promptText);
      await this.showResult(text, response.choices[0].message.content, tab);
    } catch (error) {
      console.error('Processing error:', error);
      this.showAlert(tab, `${browser.i18n.getMessage('errorProcessingText')}: ${error.message}`);
    }
  }

  async callGPTAPI(text, promptText) {
    const estimatedTokens = Math.ceil(text.length / CONFIG.TOKEN_RATIO);
    const response = await fetch(CONFIG.API_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.state.apiKey}`
      },
      body: JSON.stringify({
        model: this.state.selectedModel,
        messages: [
          { role: 'system', content: promptText },
          { role: 'user', content: text }
        ],
        max_tokens: Math.min(CONFIG.MAX_TOKENS, 16000 - estimatedTokens)
      })
    });

    const result = await response.json();
    if (!response.ok || result.error) {
      throw new Error(result.error?.message || 'API request failed');
    }
    return result;
  }

  validateInput(text, tab) {
    if (!text?.trim()) {
      this.showAlert(tab, browser.i18n.getMessage('noTextSelected'));
      return false;
    }

    if (!this.state.apiKey || !this.state.selectedModel) {
      this.showAlert(tab, 'Please configure your API key and select a model in the extension settings.');
      return false;
    }

    const estimatedTokens = Math.ceil(text.length / CONFIG.TOKEN_RATIO);
    if (estimatedTokens > CONFIG.MAX_TOKENS) {
      this.showAlert(tab, `Text too long (${estimatedTokens} tokens). Maximum: ${CONFIG.MAX_TOKENS} tokens.`);
      return false;
    }

    return true;
  }

  async showLoadingUI(tab) {
    await browser.tabs.insertCSS(tab.id, { file: 'styles/result.css' });
    const loadingCode = `
      (function() {
        document.querySelector('.gpt-helper-result')?.remove();
        const container = document.createElement('div');
        container.className = 'gpt-helper-result';
        container.innerHTML = \`
          <div class="gpt-helper-draghandle">
            <span class="gpt-helper-title">${browser.i18n.getMessage('loadingTitle')}</span>
            <button class="gpt-helper-close">✖</button>
          </div>
          <div class="gpt-helper-content">
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

        // Setup drag and drop
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

        container.querySelector('.gpt-helper-close').addEventListener('click', () => {
          container.remove();
        });

        document.body.appendChild(container);
      })();
    `;
    await browser.tabs.executeScript(tab.id, { code: loadingCode });
  }

  async showResult(originalText, resultText, tab) {
    await browser.tabs.insertCSS(tab.id, { file: 'styles/result.css' });
    const resultCode = `
      (function() {
        document.querySelector('.gpt-helper-result')?.remove();
        const container = document.createElement('div');
        container.className = 'gpt-helper-result';
        
        const size = JSON.parse(localStorage.getItem('gptHelperWindowSize') || '{"width":400,"height":500}');
        Object.assign(container.style, {
          width: size.width + 'px',
          height: size.height + 'px'
        });

        container.innerHTML = \`
          <div class="gpt-helper-draghandle">
            <span class="gpt-helper-title">${browser.i18n.getMessage('resultTitle')}</span>
            <button class="gpt-helper-close">✖</button>
          </div>
          <div class="gpt-helper-content">
            <div class="gpt-helper-section">
              <h4>${browser.i18n.getMessage('originalTextLabel')}</h4>
              <div class="gpt-helper-text">${this.escapeHtml(originalText)}</div>
            </div>
            <div class="gpt-helper-section">
              <h4>${browser.i18n.getMessage('resultTextLabel')}</h4>
              <div class="gpt-helper-text">${this.escapeHtml(resultText)}</div>
            </div>
          </div>
          <div class="gpt-helper-actions">
            <button class="gpt-helper-button">${browser.i18n.getMessage('copyButton')}</button>
          </div>
        \`;

        // Setup drag and drop
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

        // Setup resize observer
        const resizeObserver = new ResizeObserver(() => {
          if (!container.classList.contains('resizing')) {
            container.classList.add('resizing');
            setTimeout(() => {
              const size = {
                width: container.offsetWidth,
                height: container.offsetHeight
              };
              localStorage.setItem('gptHelperWindowSize', JSON.stringify(size));
              container.classList.remove('resizing');
            }, 100);
          }
        });

        resizeObserver.observe(container);

        // Setup copy functionality
        container.querySelector('.gpt-helper-button').addEventListener('click', function() {
          navigator.clipboard.writeText(${JSON.stringify(resultText)})
            .then(() => {
              this.textContent = '${browser.i18n.getMessage('copiedStatus')}';
              this.classList.add('copied');
              setTimeout(() => {
                this.textContent = '${browser.i18n.getMessage('copyButton')}';
                this.classList.remove('copied');
              }, 2000);
            })
            .catch(err => {
              console.error('Copy error:', err);
              this.classList.add('error');
              setTimeout(() => this.classList.remove('error'), 2000);
            });
        });

        // Setup close button
        container.querySelector('.gpt-helper-close').addEventListener('click', () => {
          resizeObserver.disconnect();
          container.remove();
        });

        document.body.appendChild(container);
      })();
    `;
    await browser.tabs.executeScript(tab.id, { code: resultCode });
  }

  escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  showAlert(tab, message) {
    return browser.tabs.executeScript(tab.id, {
      code: `alert(${JSON.stringify(message)})`
    });
  }
}

// Initialize extension
new ExtensionManager().init();