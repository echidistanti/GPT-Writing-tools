// State variables
let prompts = [];
let originalPrompts = [];
let hasUnsavedChanges = false;
let dragSource = null;

// Utility Functions
function getMessage(key) {
  return chrome.i18n.getMessage(key) || key;
}

function initializeI18n() {
  document.querySelectorAll('[data-i18n]').forEach(element => {
    const key = element.getAttribute('data-i18n');
    element.textContent = getMessage(key);
  });
}

function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

function showTokenCounter(text) {
  let tokenCounter = document.querySelector('.token-counter');
  if (!tokenCounter) {
    tokenCounter = document.createElement('div');
    tokenCounter.className = 'token-counter';
    document.body.appendChild(tokenCounter);
  }

  const tokens = estimateTokens(text);
  const maxTokens = 4000;

  tokenCounter.className = 'token-counter';
  if (tokens > maxTokens) {
    tokenCounter.classList.add('error');
  } else if (tokens > maxTokens * 0.8) {
    tokenCounter.classList.add('warning');
  }

  tokenCounter.textContent = `Tokens: ${tokens}/${maxTokens}`;
}

function createUniqueElement(tag, id) {
  let element = document.getElementById(id);
  if (!element) {
    element = document.createElement(tag);
    element.id = id;
  }
  return element;
}

// Funzione per salvare i prompt custom
function saveCustomPrompts(prompts) {
  chrome.storage.sync.set({ customPrompts: prompts }, function() {
    if (chrome.runtime.lastError) {
      console.error('Errore nel salvataggio dei prompt custom:', chrome.runtime.lastError);
    } else {
      console.log('Prompt custom salvati nello storage sync.');
    }
  });
}

// Funzione per recuperare i prompt custom
function getCustomPrompts(callback) {
  chrome.storage.sync.get(['customPrompts'], function(result) {
    if (chrome.runtime.lastError) {
      console.error('Errore nel recupero dei prompt custom:', chrome.runtime.lastError);
    } else {
      console.log('Prompt custom recuperati dallo storage sync:', result.customPrompts);
      callback(result.customPrompts || []);
    }
  });
}

// Funzione per sincronizzare i prompt custom
function syncCustomPrompts() {
  chrome.storage.sync.set({ customPrompts: prompts }, function() {
    console.log('Prompt custom sincronizzati nello storage sync.');
    alert('Prompt custom sincronizzati con successo!');
  });
}

// Funzione per mostrare il contenuto dello storage
function backupStorage() {
  chrome.storage.sync.get(null, function(items) {
    if (chrome.runtime.lastError) {
      console.error('Errore nel recupero dello storage:', chrome.runtime.lastError);
      alert('Errore nel recupero dello storage');
    } else {
      const storageContent = JSON.stringify(items, null, 2);
      console.log('Contenuto dello storage:', storageContent);
      alert(`Contenuto dello storage:\n${storageContent}`);
    }
  });
}

// Funzione per esportare i settings in un file XML
function exportSettings() {
  chrome.storage.sync.get(null, function(items) {
    if (chrome.runtime.lastError) {
      console.error('Errore nel recupero dei settings:', chrome.runtime.lastError);
      alert('Errore nel recupero dei settings');
    } else {
      const xmlContent = jsonToXml(items);
      const blob = new Blob([xmlContent], { type: 'application/xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'settings.xml';
      a.click();
      URL.revokeObjectURL(url);
    }
  });
}

// Funzione per convertire JSON in XML
function jsonToXml(json) {
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<settings>\n';
  for (const key in json) {
    if (json.hasOwnProperty(key)) {
      xml += `  <${key}>${JSON.stringify(json[key])}</${key}>\n`;
    }
  }
  xml += '</settings>';
  return xml;
}

// Funzione per importare i settings da un file XML
async function importSettings(event) {
  const file = event.target.files[0];
  if (!file) {
    return;
  }

  const reader = new FileReader();
  reader.onload = async function(e) {
    try {
      const xmlContent = e.target.result;
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlContent, 'application/xml');
      const json = xmlToJson(xmlDoc);
      
      // Salva le impostazioni
      await chrome.storage.sync.set(json);
      
      // Ricarica le impostazioni nella pagina
      await loadSettings();
      
      // Notifica il background script di ricaricare la configurazione
      await chrome.runtime.sendMessage({ action: 'reloadConfig' });
      
      alert('Settings importati con successo!');
      
      // Reset del campo file
      event.target.value = '';
      
    } catch (error) {
      console.error('Errore nell\'importazione dei settings:', error);
      alert('Errore nell\'importazione dei settings: ' + error.message);
    }
  };
  reader.readAsText(file);
}

// Funzione per convertire XML in JSON
function xmlToJson(xml) {
  const obj = {};
  const settings = xml.getElementsByTagName('settings')[0];
  for (const node of settings.children) {
    obj[node.nodeName] = JSON.parse(node.textContent);
  }
  return obj;
}

// Esempio di utilizzo
getCustomPrompts(function(prompts) {
  console.log('Prompts recuperati:', prompts);
  // Puoi fare qualcosa con i prompt recuperati qui
});

// API Key functions
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

function addApiKeyTooltip() {
  const apiKeyLabel = document.querySelector('label[for="apiKey"]');
  const tooltip = createUniqueElement('span', 'apiKeyTooltip');
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

// Load and Save functions
async function loadSettings() {
  try {
    const result = await chrome.storage.sync.get(['apiKey', 'selectedModel', 'customPrompts']);
    console.log('Loading settings:', result);

    const apiKeyInput = document.getElementById('apiKey');
    if (apiKeyInput) {
      apiKeyInput.value = result.apiKey || '';
    }

    if (Array.isArray(result.customPrompts) && result.customPrompts.length > 0) {
      prompts = result.customPrompts;
    } else {
      prompts = [];
      await chrome.storage.sync.set({ customPrompts: prompts });
    }

    originalPrompts = JSON.parse(JSON.stringify(prompts));

    if (result.apiKey) {
      await loadModels(result.apiKey);
      if (result.selectedModel) {
        const modelSelect = document.getElementById('model');
        if (modelSelect) {
          modelSelect.value = result.selectedModel;
        }
      }
    }

    updatePromptsTable();
    updateSaveButtonState();
  } catch (error) {
    console.error('Error loading settings:', error);
    alert(getMessage('errorLoadingSettings'));
  }
}

async function loadModels(apiKey) {
  const modelSelect = document.getElementById('model');
  const loadingSpinner = document.createElement('div');
  loadingSpinner.className = 'loading-spinner';

  try {
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
    data.data
      .sort((a, b) => a.id.localeCompare(b.id))
      .forEach(model => {
        const option = document.createElement('option');
        option.value = model.id;
        option.textContent = model.id;
        modelSelect.appendChild(option);
      });

    const result = await chrome.storage.sync.get('selectedModel');
    if (result.selectedModel) {
      modelSelect.value = result.selectedModel;
    }

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

// HTML Utility
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Prompts Table Management
function updatePromptsTable() {
  const tbody = document.querySelector('#promptsTable tbody');
  if (!tbody) return;

  tbody.innerHTML = '';

  prompts.forEach((prompt, index) => {
    const tr = document.createElement('tr');
    tr.className = 'prompt-row';
    tr.draggable = true;
    tr.dataset.id = prompt.id;

    const originalPrompt = originalPrompts.find(p => p.id === prompt.id);
    const isModified = originalPrompt && (originalPrompt.name !== prompt.name || originalPrompt.prompt !== prompt.prompt);

    if (isModified) {
      tr.classList.add('modified');
    }

    tr.innerHTML = `
      <td style="display: flex; align-items: center;">
        <span class="drag-handle"></span>
        <span class="prompt-order">${index + 1}</span>
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
        <button class="button delete" data-id="${prompt.id}">${getMessage('buttonDelete')}</button>
      </td>
    `;
    tbody.appendChild(tr);

    // Add drag and drop listeners
    tr.addEventListener('dragstart', handleDragStart);
    tr.addEventListener('dragend', handleDragEnd);
    tr.addEventListener('dragover', handleDragOver);
    tr.addEventListener('drop', handleDrop);
    tr.addEventListener('dragenter', handleDragEnter);
    tr.addEventListener('dragleave', handleDragLeave);
  });

  document.querySelectorAll('.prompt-input').forEach(input => {
    input.addEventListener('input', function() {
      const id = parseInt(this.dataset.id);
      const field = this.dataset.field;
      updatePrompt(id, field, this.value);
      showTokenCounter(this.value);
    });
  });

  document.querySelectorAll('.button.delete').forEach(button => {
    button.addEventListener('click', function() {
      const id = parseInt(this.dataset.id);
      deletePrompt(id);
    });
  });
}

// Drag and Drop Handlers
function handleDragStart(e) {
  dragSource = this;
  this.classList.add('dragging');
  if (e.target.tagName.toLowerCase() === 'input') {
    e.preventDefault();
  }
  e.dataTransfer.effectAllowed = 'move';
}

function handleDragEnd(e) {
  this.classList.remove('dragging');
  document.querySelectorAll('.prompt-row').forEach(row => {
    row.classList.remove('drop-target');
  });
}

function handleDragOver(e) {
  if (e.preventDefault) {
    e.preventDefault();
  }
  e.dataTransfer.dropEffect = 'move';
  return false;
}

function handleDrop(e) {
  e.stopPropagation();
  e.preventDefault();

  if (dragSource !== this) {
    const allRows = Array.from(document.querySelectorAll('.prompt-row'));
    const sourceIndex = allRows.indexOf(dragSource);
    const targetIndex = allRows.indexOf(this);

    const [removed] = prompts.splice(sourceIndex, 1);
    prompts.splice(targetIndex, 0, removed);

    hasUnsavedChanges = true;
    updatePromptsTable();
    updateSaveButtonState();
  }

  return false;
}

function handleDragEnter(e) {
  this.classList.add('drop-target');
}

function handleDragLeave(e) {
  this.classList.remove('drop-target');
}

// Prompt Management Functions
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

function deletePrompt(id) {
  if (confirm(getMessage('confirmDelete'))) {
    prompts = prompts.filter(p => p.id !== id);
    hasUnsavedChanges = true;
    updatePromptsTable();
    updateSaveButtonState();
  }
}

// Save Functions
async function savePrompts() {
  try {
    console.log('Saving prompts:', prompts);
    await chrome.storage.sync.set({ customPrompts: prompts });
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

async function saveApiKey() {
  const apiKey = document.getElementById('apiKey').value;
  try {
    await chrome.storage.sync.set({ apiKey });
    await loadModels(apiKey);
    showSaveStatus();
  } catch (error) {
    console.error('Error saving API key:', error);
    showApiKeyStatus(false, error.message);
  }
}

async function saveModel() {
  const modelSelect = document.getElementById('model');
  try {
    await chrome.storage.sync.set({ selectedModel: modelSelect.value });
    showSaveStatus();
  } catch (error) {
    console.error('Error saving model:', error);
    alert('Error saving model selection');
  }
}

function updateSaveButtonState() {
  const saveButton = document.getElementById('savePrompts');
  if (saveButton) {
    saveButton.disabled = !hasUnsavedChanges;
    saveButton.style.opacity = hasUnsavedChanges ? '1' : '0.5';
  }
}

function showSaveStatus() {
  const status = document.getElementById('saveStatus');
  if (status) {
    status.style.display = 'inline';
    setTimeout(() => {
      status.style.display = 'none';
    }, 2000);
  }
}

// Event Listeners Setup
function setupEventListeners() {
  const apiKeyInput = document.getElementById('apiKey');
  const modelSelect = document.getElementById('model');
  const addPromptButton = document.getElementById('addPrompt');
  const savePromptsButton = document.getElementById('savePrompts');
  const saveApiKeyButton = document.getElementById('saveApiKey');
  const saveModelButton = document.getElementById('saveModel');
  const exportSettingsButton = document.getElementById('exportSettings'); // New button
  const importSettingsButton = document.getElementById('importSettings'); // New button

  if (saveApiKeyButton) {
    saveApiKeyButton.addEventListener('click', saveApiKey);
  }

  if (saveModelButton) {
    saveModelButton.addEventListener('click', saveModel);
  }

  if (addPromptButton) {
    addPromptButton.addEventListener('click', addNewPrompt);
  }

  if (savePromptsButton) {
    savePromptsButton.addEventListener('click', savePrompts);
  }

  if (exportSettingsButton) {
    exportSettingsButton.addEventListener('click', exportSettings); // New event listener
  }

  if (importSettingsButton) {
    importSettingsButton.addEventListener('change', importSettings); // New event listener
  }

  addApiKeyTooltip();
}

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  initializeI18n();
  addApiKeyTooltip();
  await loadSettings();

  // Import button handler
  const importButton = document.getElementById('importSettings');
  if (importButton) {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.xml';
    fileInput.style.display = 'none';
    document.body.appendChild(fileInput);

    importButton.addEventListener('click', () => {
      fileInput.click();
    });

    fileInput.addEventListener('change', importSettings);
  }

  setupEventListeners();
});

// Confirm before leaving with unsaved changes
window.addEventListener('beforeunload', (e) => {
  if (hasUnsavedChanges) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// Initialize translations
initializeI18n();