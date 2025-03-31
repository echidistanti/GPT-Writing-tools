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

// Funzione per esportare i settings
function exportSettings() {
  chrome.storage.sync.get(['apiKey', 'customPrompts'], function(items) {
    if (chrome.runtime.lastError) {
      console.error('Errore nel recupero dei settings:', chrome.runtime.lastError);
      alert('Errore nel recupero dei settings');
      return;
    }
    
    const exportData = {
      customPrompts: items.customPrompts || [],
      apiKey: items.apiKey || ''
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'gpt-helper-settings.json';
    a.click();
    URL.revokeObjectURL(url);
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

// Funzione per importare i settings
async function importSettings(event) {
  const file = event.target.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    const importedData = JSON.parse(text);
    
    // Validazione dei dati importati
    if (!importedData || typeof importedData !== 'object') {
      throw new Error('File di configurazione non valido');
    }

    // Verifica e salva solo i campi conosciuti
    const settingsToSave = {};
    
    if (Array.isArray(importedData.customPrompts)) {
      settingsToSave.customPrompts = importedData.customPrompts;
    }
    
    if (typeof importedData.apiKey === 'string') {
      settingsToSave.apiKey = importedData.apiKey;
    }

    // Salva le impostazioni
    await chrome.storage.sync.set(settingsToSave);
    
    // Ricarica le impostazioni
    await loadSettings();
    
    // Notifica il background script
    await chrome.runtime.sendMessage({ action: 'reloadConfig' });
    
    alert('Impostazioni importate con successo!');
    
    // Reset del campo file
    event.target.value = '';
    
  } catch (error) {
    console.error('Errore nell\'importazione delle impostazioni:', error);
    alert('Errore nell\'importazione delle impostazioni: ' + error.message);
  }
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
function showApiKeyStatus() {
  const apiKeyInput = document.getElementById('apiKey');
  let statusElement = document.querySelector('.api-key-status');
  if (!statusElement) {
    statusElement = document.createElement('span');
    statusElement.className = 'api-key-status';
    apiKeyInput.parentNode.appendChild(statusElement);
  }
  statusElement.className = 'api-key-status valid';
  statusElement.textContent = 'API key saved';
}

// Load and Save functions
async function loadSettings() {
  try {
    const result = await chrome.storage.sync.get(['apiKey', 'customPrompts']);
    console.log('Loading settings:', result);

    const apiKeyInput = document.getElementById('apiKey');
    if (apiKeyInput && result.apiKey) {
      apiKeyInput.value = result.apiKey;
    }

    // Inizializzazione più robusta dell'array prompts
    prompts = Array.isArray(result.customPrompts) ? result.customPrompts : [];
    
    // Se non ci sono prompt, inizializziamo con un array vuoto
    if (!Array.isArray(result.customPrompts)) {
      await chrome.storage.sync.set({ customPrompts: [] });
    }

    originalPrompts = JSON.parse(JSON.stringify(prompts));
    updatePromptsTable();
    updateSaveButtonState();
  } catch (error) {
    console.error('Error loading settings:', error);
    alert(getMessage('errorLoadingSettings'));
  }
}

async function saveApiKey() {
  const apiKey = document.getElementById('apiKey').value;
  try {
    await chrome.storage.sync.set({ apiKey });
    await chrome.runtime.sendMessage({ action: 'updateApiKey', apiKey });
    showApiKeyStatus();
    showSaveStatus();
  } catch (error) {
    console.error('Error saving API key:', error);
    alert('Error saving API key');
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
  // Assicuriamoci che prompts sia un array
  if (!Array.isArray(prompts)) {
    prompts = [];
  }

  // Gestione sicura dell'ID quando non ci sono prompt
  const maxId = prompts.length > 0 
    ? prompts.reduce((max, p) => Math.max(max, p.id || 0), 0) 
    : 0;

  const newPrompt = {
    id: maxId + 1,
    name: getMessage('newPromptName'),
    prompt: getMessage('newPromptText')
  };

  prompts.push(newPrompt); // Usiamo push invece dello spread operator
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
    // Validazione dei dati prima del salvataggio
    if (!Array.isArray(prompts)) {
      throw new Error('Prompts must be an array');
    }

    // Verifica che ogni prompt abbia i campi richiesti
    const validPrompts = prompts.every(p => 
      p && typeof p.id === 'number' && 
      typeof p.name === 'string' && 
      typeof p.prompt === 'string'
    );

    if (!validPrompts) {
      throw new Error('Invalid prompt format');
    }

    console.log('Saving prompts:', prompts);
    await chrome.storage.sync.set({ customPrompts: prompts });
    originalPrompts = JSON.parse(JSON.stringify(prompts));
    hasUnsavedChanges = false;
    updatePromptsTable();
    updateSaveButtonState();
    showSaveStatus();
  } catch (error) {
    console.error('Error saving prompts:', error);
    alert(getMessage('errorSavingPrompts') + ': ' + error.message);
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
  const addPromptButton = document.getElementById('addPrompt');
  const savePromptsButton = document.getElementById('savePrompts');
  const saveApiKeyButton = document.getElementById('saveApiKey');
  const exportSettingsButton = document.getElementById('exportSettings');
  const importSettingsButton = document.getElementById('importSettings');

  if (saveApiKeyButton) {
    saveApiKeyButton.addEventListener('click', saveApiKey);
  }

  if (apiKeyInput) {
    apiKeyInput.addEventListener('change', () => saveApiKey());
  }

  if (addPromptButton) {
    addPromptButton.addEventListener('click', addNewPrompt);
  }

  if (savePromptsButton) {
    savePromptsButton.addEventListener('click', savePrompts);
  }

  if (exportSettingsButton) {
    exportSettingsButton.addEventListener('click', exportSettings);
  }

  if (importSettingsButton) {
    importSettingsButton.addEventListener('change', importSettings);
  }
}

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  initializeI18n();
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