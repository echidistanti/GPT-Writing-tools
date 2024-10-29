let prompts = [];
let originalPrompts = [];
let hasUnsavedChanges = false;

// Utility function for localized strings
function getMessage(key) {
  return chrome.i18n.getMessage(key) || key;
}

// Initialize translations in HTML
function initializeI18n() {
  document.querySelectorAll('[data-i18n]').forEach(element => {
    const key = element.getAttribute('data-i18n');
    element.textContent = getMessage(key);
  });
}

// Function to estimate token count
function estimateTokens(text) {
  // GPT uses approximately 4 characters per token
  return Math.ceil(text.length / 4);
}

// Show token counter
function showTokenCounter(text) {
  let tokenCounter = document.querySelector('.token-counter');
  if (!tokenCounter) {
    tokenCounter = document.createElement('div');
    tokenCounter.className = 'token-counter';
    document.body.appendChild(tokenCounter);
  }

  const tokens = estimateTokens(text);
  const maxTokens = 4000; // Standard limit for many GPT models

  tokenCounter.className = 'token-counter';
  if (tokens > maxTokens) {
    tokenCounter.classList.add('error');
  } else if (tokens > maxTokens * 0.8) {
    tokenCounter.classList.add('warning');
  }

  tokenCounter.textContent = `Tokens: ${tokens}/${maxTokens}`;
}

// Default prompts setup
function getDefaultPrompts() {
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
      prompt: "Rewrite the following text to be more concise and well-written while preserving the original meaning. Provide only the rewritten text as your output, without any quotes or tags. Respond in the same language as the original text:"
    }
  ];
}

// Show API key status
function showApiKeyStatus(isValid, errorMessage = '') {
  const apiKeyInput = document.getElementById('apiKey');
  let statusElement = document.querySelector('.api-key-status');
  
  if (!statusElement) {
    statusElement = document.createElement('span');
    statusElement.className = 'api-key-status';
    apiKeyInput.parentNode.appendChild(statusElement);
  }

  if (isValid) {
    statusElement.className = 'api-key-status valid';
    statusElement.textContent = '✓ Valid API key';
  } else {
    statusElement.className = 'api-key-status invalid';
    statusElement.textContent = '✗ Invalid API key' + (errorMessage ? `: ${errorMessage}` : '');
  }
}

// Add API key tooltip
function addApiKeyTooltip() {
  const apiKeyLabel = document.querySelector('label[for="apiKey"]');
  const tooltip = document.createElement('span');
  tooltip.className = 'info-tooltip';
  tooltip.innerHTML = `
    <span class="icon">ⓘ</span>
    <span class="tooltip-text">
      To get your OpenAI API key:
      1. Go to platform.openai.com
      2. Sign in or create an account
      3. Go to the API section
      4. Create a new API key
      Note: Keep your API key secure and never share it.
    </span>
  `;
  apiKeyLabel.appendChild(tooltip);
}

// Load saved settings
async function loadSettings() {
  try {
    const result = await chrome.storage.local.get(['apiKey', 'selectedModel', 'prompts']);
    
    // Set API Key
    const apiKeyInput = document.getElementById('apiKey');
    if (apiKeyInput) {
      apiKeyInput.value = result.apiKey || '';
    }
    
    // Set prompts
    if (Array.isArray(result.prompts) && result.prompts.length > 0) {
      prompts = result.prompts;
    } else {
      prompts = getDefaultPrompts();
      // Save default prompts
      await chrome.storage.local.set({ prompts });
    }
    
    // Create deep copy of original prompts
    originalPrompts = JSON.parse(JSON.stringify(prompts));
    
    // If there's an API key, load models
    if (result.apiKey) {
      await loadModels(result.apiKey);
      if (result.selectedModel) {
        const modelSelect = document.getElementById('model');
        if (modelSelect) {
          modelSelect.value = result.selectedModel;
        }
      }
    }
    
    // Update UI
    updatePromptsTable();
    updateSaveButtonState();
  } catch (error) {
    console.error('Error loading settings:', error);
    alert(getMessage('errorLoadingSettings'));
  }
}

// Load available models
async function loadModels(apiKey) {
  const modelSelect = document.getElementById('model');
  const loadingSpinner = document.createElement('div');
  loadingSpinner.className = 'loading-spinner';
  
  try {
    // Show loading spinner
    modelSelect.parentNode.appendChild(loadingSpinner);
    modelSelect.disabled = true;
    modelSelect.innerHTML = '<option>Loading models...</option>';

    const response = await fetch('https://api.openai.com/v1/models', {
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    });
    
    if (!response.ok) {
      throw new Error(response.statusText);
    }
    
    const data = await response.json();
    
    modelSelect.innerHTML = '<option value="">Select a model...</option>';
    
    // Filter and sort models
    data.data
      .filter(model => model.id.startsWith('gpt'))
      .sort((a, b) => a.id.localeCompare(b.id))
      .forEach(model => {
        const option = document.createElement('option');
        option.value = model.id;
        option.textContent = model.id;
        modelSelect.appendChild(option);
      });

    // Restore saved model
    const result = await chrome.storage.local.get('selectedModel');
    if (result.selectedModel) {
      modelSelect.value = result.selectedModel;
    }

    // Update API key status
    showApiKeyStatus(true);
  } catch (error) {
    console.error('Error loading models:', error);
    modelSelect.innerHTML = '<option value="">Error loading models</option>';
    showApiKeyStatus(false, error.message);
  } finally {
    modelSelect.disabled = false;
    loadingSpinner.remove();
  }
}

// HTML escape utility
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Update prompts table
function updatePromptsTable() {
  const tbody = document.querySelector('#promptsTable tbody');
  if (!tbody) return;
  
  tbody.innerHTML = '';
  
  prompts.forEach(prompt => {
    const tr = document.createElement('tr');
    const originalPrompt = originalPrompts.find(p => p.id === prompt.id);
    const isModified = originalPrompt && 
      (originalPrompt.name !== prompt.name || originalPrompt.prompt !== prompt.prompt);
    
    if (isModified) {
      tr.classList.add('modified');
    }
    
    tr.innerHTML = `
      <td>
        <input type="text" value="${escapeHtml(prompt.name)}" 
               data-id="${prompt.id}" 
               data-field="name" 
               class="prompt-input">
      </td>
      <td>
        <input type="text" value="${escapeHtml(prompt.prompt)}" 
               data-id="${prompt.id}" 
               data-field="prompt" 
               class="prompt-input">
      </td>
      <td>
        <button class="button delete" data-id="${prompt.id}">
          ${getMessage('buttonDelete')}
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // Add input event listeners
  document.querySelectorAll('.prompt-input').forEach(input => {
    input.addEventListener('input', function() {
      const id = parseInt(this.dataset.id);
      const field = this.dataset.field;
      updatePrompt(id, field, this.value);
      showTokenCounter(this.value);
    });
  });

  // Add delete button listeners
  document.querySelectorAll('.button.delete').forEach(button => {
    button.addEventListener('click', function() {
      const id = parseInt(this.dataset.id);
      deletePrompt(id);
    });
  });
}

// Update a prompt
function updatePrompt(id, field, value) {
  const promptIndex = prompts.findIndex(p => p.id === id);
  if (promptIndex !== -1) {
    prompts[promptIndex] = {
      ...prompts[promptIndex],
      [field]: value
    };
    hasUnsavedChanges = true;
    updateSaveButtonState();
  }
}

// Add new prompt
function addNewPrompt() {
  const maxId = prompts.reduce((max, p) => Math.max(max, p.id), 0);
  const newPrompt = {
    id: maxId + 1,
    name: getMessage('newPromptName'),
    prompt: getMessage('newPromptText')
  };
  
  prompts = [...prompts, newPrompt];
  hasUnsavedChanges = true;
  updatePromptsTable();
  updateSaveButtonState();
}

// Delete prompt
function deletePrompt(id) {
  if (confirm(getMessage('confirmDelete'))) {
    prompts = prompts.filter(p => p.id !== id);
    hasUnsavedChanges = true;
    updatePromptsTable();
    updateSaveButtonState();
  }
}

// Save all prompts
async function savePrompts() {
  try {
    await chrome.storage.local.set({ prompts });
    originalPrompts = JSON.parse(JSON.stringify(prompts));
    hasUnsavedChanges = false;
    updatePromptsTable();
    updateSaveButtonState();
    showSaveStatus();
  } catch (error) {
    console.error('Error saving prompts:', error);
    alert(getMessage('errorSavingPrompts'));
  }
}

// Update save button state
function updateSaveButtonState() {
  const saveButton = document.getElementById('savePrompts');
  if (saveButton) {
    saveButton.disabled = !hasUnsavedChanges;
    saveButton.style.opacity = hasUnsavedChanges ? '1' : '0.5';
  }
}

// Show save status message
function showSaveStatus() {
  const status = document.getElementById('saveStatus');
  if (status) {
    status.style.display = 'inline';
    setTimeout(() => {
      status.style.display = 'none';
    }, 2000);
  }
}

// Save API and model settings
async function saveSettings() {
  const apiKey = document.getElementById('apiKey').value;
  const modelSelect = document.getElementById('model');
  
  try {
    // Try to load models to validate API key
    if (apiKey) {
      await loadModels(apiKey);
    }

    // If we get here, API key is valid or empty
    await chrome.storage.local.set({
      apiKey: apiKey,
      selectedModel: modelSelect.value
    });
    
    showSaveStatus();
  } catch (error) {
    console.error('Error saving settings:', error);
    showApiKeyStatus(false, error.message);
  }
}

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
  // Connect to service worker to keep it alive
  chrome.runtime.connect({ name: 'keepAlive' });

  const apiKeyInput = document.getElementById('apiKey');
  const modelSelect = document.getElementById('model');
  const addPromptButton = document.getElementById('addPrompt');
  const savePromptsButton = document.getElementById('savePrompts');

  if (apiKeyInput) {
    apiKeyInput.addEventListener('blur', saveSettings);
  }

  if (modelSelect) {
    modelSelect.addEventListener('change', saveSettings);
  }

  if (addPromptButton) {
    addPromptButton.addEventListener('click', addNewPrompt);
  }

  if (savePromptsButton) {
    savePromptsButton.addEventListener('click', savePrompts);
  }

  // Add API key tooltip
  addApiKeyTooltip();

  // Initialize API key status if key exists
  const apiKey = apiKeyInput?.value;
  if (apiKey) {
    loadModels(apiKey).catch(console.error);
  }
});

// Confirm before leaving with unsaved changes
window.addEventListener('beforeunload', (e) => {
  if (hasUnsavedChanges) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// Initialize
initializeI18n();
loadSettings();