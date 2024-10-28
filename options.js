class OptionsManager {
  constructor() {
    this.state = {
      prompts: [],
      originalPrompts: [],
      hasUnsavedChanges: false
    };
  }

  async init() {
    await this.initializeI18n();
    await this.loadSettings();
    this.setupEventListeners();
  }

  async initializeI18n() {
    document.querySelectorAll('[data-i18n]').forEach(element => {
      const key = element.getAttribute('data-i18n');
      element.textContent = browser.i18n.getMessage(key) || key;
    });
  }

  setupEventListeners() {
    // API Key
    const apiKeyInput = document.getElementById('apiKey');
    if (apiKeyInput) {
      apiKeyInput.addEventListener('blur', () => this.saveSettings());
      apiKeyInput.addEventListener('keyup', (e) => {
        if (e.key === 'Enter') this.saveSettings();
      });
    }

    // Model selector
    const modelSelect = document.getElementById('model');
    if (modelSelect) {
      modelSelect.addEventListener('change', () => this.saveSettings());
    }

    // Prompts management
    const addPromptButton = document.getElementById('addPrompt');
    if (addPromptButton) {
      addPromptButton.addEventListener('click', () => this.addNewPrompt());
    }

    const savePromptsButton = document.getElementById('savePrompts');
    if (savePromptsButton) {
      savePromptsButton.addEventListener('click', () => this.savePrompts());
    }

    // Warning for unsaved changes
    window.addEventListener('beforeunload', (e) => {
      if (this.state.hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  }

  getDefaultPrompts() {
    return [
      {
        id: 1,
        name: "🌎 Translate to English",
        prompt: "Translate the following text to English while maintaining its original meaning and tone:"
      },
      {
        id: 2,
        name: "✍️ Fix Grammar",
        prompt: "Check the following text for grammatical and spelling errors, then provide the corrected version:"
      },
      {
        id: 3,
        name: "📝 Rewrite",
        prompt: "Rewrite the following text to be more concise and well-written while preserving the original meaning:"
      }
    ];
  }

  async loadSettings() {
    try {
      const result = await browser.storage.local.get(['apiKey', 'selectedModel', 'prompts']);
      
      // Setup API Key
      const apiKeyInput = document.getElementById('apiKey');
      if (apiKeyInput) {
        apiKeyInput.value = result.apiKey || '';
      }
      
      // Setup prompts
      this.state.prompts = Array.isArray(result.prompts) && result.prompts.length > 0 
        ? result.prompts 
        : this.getDefaultPrompts();
        
      if (!result.prompts?.length) {
        await browser.storage.local.set({ prompts: this.state.prompts });
      }
      
      this.state.originalPrompts = JSON.parse(JSON.stringify(this.state.prompts));
      
      // Load models if API key exists
      if (result.apiKey) {
        await this.loadModels(result.apiKey, result.selectedModel);
      }
      
      this.updatePromptsTable();
      this.updateSaveButtonState();
    } catch (error) {
      console.error('Settings loading error:', error);
      this.showError('errorLoadingSettings');
    }
  }

  async loadModels(apiKey, selectedModel) {
    try {
      const response = await fetch('https://api.openai.com/v1/models', {
        headers: {
          'Authorization': `Bearer ${apiKey}`
        }
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      const modelSelect = document.getElementById('model');
      modelSelect.innerHTML = '';
      
      // Add default option
      const defaultOption = document.createElement('option');
      defaultOption.value = '';
      defaultOption.textContent = 'Select a model...';
      modelSelect.appendChild(defaultOption);
      
      // Add filtered and sorted models
      data.data
        .filter(model => model.id.startsWith('gpt'))
        .sort((a, b) => a.id.localeCompare(b.id))
        .forEach(model => {
          const option = document.createElement('option');
          option.value = model.id;
          option.textContent = model.id;
          modelSelect.appendChild(option);
        });
      
      // Set selected model if exists
      if (selectedModel) {
        modelSelect.value = selectedModel;
      }
    } catch (error) {
      console.error('Error loading models:', error);
      this.showError('errorLoadingModels');
    }
  }

  updatePromptsTable() {
    const tbody = document.querySelector('#promptsTable tbody');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    
    this.state.prompts.forEach(prompt => {
      const tr = document.createElement('tr');
      const originalPrompt = this.state.originalPrompts.find(p => p.id === prompt.id);
      const isModified = originalPrompt && 
        (originalPrompt.name !== prompt.name || originalPrompt.prompt !== prompt.prompt);
      
      if (isModified) {
        tr.classList.add('modified');
      }
      
      tr.innerHTML = this.createPromptRow(prompt);
      tbody.appendChild(tr);
    });

    this.setupPromptEventListeners();
  }

  createPromptRow(prompt) {
    return `
      <td>
        <input type="text" 
               value="${this.escapeHtml(prompt.name)}" 
               data-id="${prompt.id}" 
               data-field="name" 
               class="prompt-input">
      </td>
      <td>
        <input type="text" 
               value="${this.escapeHtml(prompt.prompt)}" 
               data-id="${prompt.id}" 
               data-field="prompt" 
               class="prompt-input">
      </td>
      <td>
        <button class="button delete" data-id="${prompt.id}">
          ${browser.i18n.getMessage('buttonDelete')}
        </button>
      </td>
    `;
  }

  setupPromptEventListeners() {
    // Input event listeners
    document.querySelectorAll('.prompt-input').forEach(input => {
      input.addEventListener('input', (e) => {
        const id = parseInt(e.target.dataset.id);
        const field = e.target.dataset.field;
        this.updatePrompt(id, field, e.target.value);
      });
    });

    // Delete button event listeners
    document.querySelectorAll('.button.delete').forEach(button => {
      button.addEventListener('click', (e) => {
        const id = parseInt(e.target.dataset.id);
        this.deletePrompt(id);
      });
    });
  }

  updatePrompt(id, field, value) {
    const promptIndex = this.state.prompts.findIndex(p => p.id === id);
    if (promptIndex !== -1) {
      this.state.prompts[promptIndex] = {
        ...this.state.prompts[promptIndex],
        [field]: value
      };
      this.state.hasUnsavedChanges = true;
      this.updateSaveButtonState();
    }
  }

  addNewPrompt() {
    const maxId = Math.max(0, ...this.state.prompts.map(p => p.id));
    const newPrompt = {
      id: maxId + 1,
      name: browser.i18n.getMessage('newPromptName'),
      prompt: browser.i18n.getMessage('newPromptText')
    };
    
    this.state.prompts.push(newPrompt);
    this.state.hasUnsavedChanges = true;
    this.updatePromptsTable();
    this.updateSaveButtonState();
  }

  async deletePrompt(id) {
    if (!confirm(browser.i18n.getMessage('confirmDelete'))) {
      return;
    }

    this.state.prompts = this.state.prompts.filter(p => p.id !== id);
    this.state.hasUnsavedChanges = true;
    this.updatePromptsTable();
    this.updateSaveButtonState();
  }

  async savePrompts() {
    try {
      await browser.storage.local.set({ prompts: this.state.prompts });
      this.state.originalPrompts = JSON.parse(JSON.stringify(this.state.prompts));
      this.state.hasUnsavedChanges = false;
      this.updatePromptsTable();
      this.updateSaveButtonState();
      this.showSaveStatus();
    } catch (error) {
      console.error('Error saving prompts:', error);
      this.showError('errorSavingPrompts');
    }
  }

  async saveSettings() {
    const apiKey = document.getElementById('apiKey').value;
    const selectedModel = document.getElementById('model').value;
    
    try {
      await browser.storage.local.set({
        apiKey,
        selectedModel
      });
      
      if (apiKey) {
        await this.loadModels(apiKey, selectedModel);
      }
      
      this.showSaveStatus();
    } catch (error) {
      console.error('Error saving settings:', error);
      this.showError('errorSavingSettings');
    }
  }

  updateSaveButtonState() {
    const saveButton = document.getElementById('savePrompts');
    if (saveButton) {
      saveButton.disabled = !this.state.hasUnsavedChanges;
      saveButton.style.opacity = this.state.hasUnsavedChanges ? '1' : '0.5';
    }
  }

  showSaveStatus() {
    const status = document.getElementById('saveStatus');
    if (status) {
      status.style.display = 'inline';
      setTimeout(() => {
        status.style.display = 'none';
      }, 2000);
    }
  }

  showError(messageKey) {
    alert(browser.i18n.getMessage(messageKey));
  }

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  const manager = new OptionsManager();
  manager.init();
});