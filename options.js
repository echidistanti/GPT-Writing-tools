let prompts = [];
let originalPrompts = [];
let hasUnsavedChanges = false;

// Funzione di utilità per ottenere le stringhe localizzate
function getMessage(key) {
  return browser.i18n.getMessage(key) || key;
}

// Funzione per inizializzare le traduzioni nell'HTML
function initializeI18n() {
  document.querySelectorAll('[data-i18n]').forEach(element => {
    const key = element.getAttribute('data-i18n');
    element.textContent = getMessage(key);
  });
}

// Funzione per impostare i prompt predefiniti
// Funzione per impostare i prompt predefiniti
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

// Carica le impostazioni salvate
async function loadSettings() {
  try {
    const result = await browser.storage.local.get(['apiKey', 'selectedModel', 'prompts']);
    
    // Imposta API Key
    const apiKeyInput = document.getElementById('apiKey');
    if (apiKeyInput) {
      apiKeyInput.value = result.apiKey || '';
    }
    
    // Imposta i prompt
    if (Array.isArray(result.prompts) && result.prompts.length > 0) {
      prompts = result.prompts;
    } else {
      prompts = getDefaultPrompts();
      // Salva i prompt predefiniti
      await browser.storage.local.set({ prompts });
    }
    
    // Crea una copia profonda dei prompt originali
    originalPrompts = JSON.parse(JSON.stringify(prompts));
    
    // Se c'è una API key, carica i modelli
    if (result.apiKey) {
      await loadModels(result.apiKey);
      if (result.selectedModel) {
        const modelSelect = document.getElementById('model');
        if (modelSelect) {
          modelSelect.value = result.selectedModel;
        }
      }
    }
    
    // Aggiorna la tabella e lo stato del pulsante
    updatePromptsTable();
    updateSaveButtonState();
  } catch (error) {
    console.error('Error loading settings:', error);
    alert(getMessage('errorLoadingSettings'));
  }
}

// Carica i modelli disponibili
async function loadModels(apiKey) {
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
    
    data.data
      .filter(model => model.id.startsWith('gpt'))
      .sort((a, b) => a.id.localeCompare(b.id))
      .forEach(model => {
        const option = document.createElement('option');
        option.value = model.id;
        option.textContent = model.id;
        modelSelect.appendChild(option);
      });
  } catch (error) {
    console.error('Error loading models:', error);
    alert(getMessage('errorLoadingModels'));
  }
}

// Funzione di utility per l'escape dell'HTML
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Aggiorna la tabella dei prompt
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

  // Aggiungi event listeners per gli input
  document.querySelectorAll('.prompt-input').forEach(input => {
    input.addEventListener('input', function() {
      const id = parseInt(this.dataset.id);
      const field = this.dataset.field;
      updatePrompt(id, field, this.value);
    });
  });

  // Aggiungi event listeners per i pulsanti elimina
  document.querySelectorAll('.button.delete').forEach(button => {
    button.addEventListener('click', function() {
      const id = parseInt(this.dataset.id);
      deletePrompt(id);
    });
  });
}

// Aggiorna un prompt
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

// Aggiungi nuovo prompt
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

// Elimina prompt
function deletePrompt(id) {
  if (confirm(getMessage('confirmDelete'))) {
    prompts = prompts.filter(p => p.id !== id);
    hasUnsavedChanges = true;
    updatePromptsTable();
    updateSaveButtonState();
  }
}

// Salva tutti i prompt
async function savePrompts() {
  try {
    await browser.storage.local.set({ prompts: prompts });
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

// Aggiorna lo stato del pulsante salva
function updateSaveButtonState() {
  const saveButton = document.getElementById('savePrompts');
  if (saveButton) {
    saveButton.disabled = !hasUnsavedChanges;
    saveButton.style.opacity = hasUnsavedChanges ? '1' : '0.5';
  }
}

// Mostra il messaggio di salvataggio
function showSaveStatus() {
  const status = document.getElementById('saveStatus');
  if (status) {
    status.style.display = 'inline';
    setTimeout(() => {
      status.style.display = 'none';
    }, 2000);
  }
}

// Salva le impostazioni API e modello
async function saveSettings() {
    const apiKey = document.getElementById('apiKey').value;
    const modelSelect = document.getElementById('model');
    const selectedModel = modelSelect.value;
    
    try {
      // Salva sia l'API key che il modello
      await browser.storage.local.set({
        apiKey: apiKey,
        selectedModel: selectedModel
      });
      
      // Se c'è un'API key, prova a caricare i modelli
      if (apiKey) {
        await loadModels(apiKey);
      }
      
      showSaveStatus();
    } catch (error) {
      console.error('Error saving settings:', error);
      alert(getMessage('errorSavingSettings'));
    }
  }
  
  // Carica i modelli disponibili
  async function loadModels(apiKey) {
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
      
      // Aggiungi un'opzione vuota all'inizio
      const defaultOption = document.createElement('option');
      defaultOption.value = '';
      defaultOption.textContent = 'Select a model...';
      modelSelect.appendChild(defaultOption);
      
      // Filtra e ordina i modelli
      data.data
        .filter(model => model.id.startsWith('gpt'))
        .sort((a, b) => a.id.localeCompare(b.id))
        .forEach(model => {
          const option = document.createElement('option');
          option.value = model.id;
          option.textContent = model.id;
          modelSelect.appendChild(option);
        });
        
      // Recupera il modello salvato
      const result = await browser.storage.local.get('selectedModel');
      if (result.selectedModel) {
        modelSelect.value = result.selectedModel;
      }
    } catch (error) {
      console.error('Error loading models:', error);
      alert(getMessage('errorLoadingModels'));
    }
  }
  
  // Salva tutti i prompt
  async function savePrompts() {
    try {
      // Salva i prompt nello storage locale
      await browser.storage.local.set({ prompts: prompts });
      
      // Aggiorna lo stato locale
      originalPrompts = JSON.parse(JSON.stringify(prompts));
      hasUnsavedChanges = false;
      
      // Aggiorna l'interfaccia
      updatePromptsTable();
      updateSaveButtonState();
      showSaveStatus();
    } catch (error) {
      console.error('Error saving prompts:', error);
      alert(getMessage('errorSavingPrompts'));
    }
  }
  
  // Event Listeners
  document.addEventListener('DOMContentLoaded', () => {
    const apiKeyInput = document.getElementById('apiKey');
    const modelSelect = document.getElementById('model');
    const addPromptButton = document.getElementById('addPrompt');
    const savePromptsButton = document.getElementById('savePrompts');
  
    if (apiKeyInput) {
      // Salva quando l'input perde il focus
      apiKeyInput.addEventListener('blur', saveSettings);
    }
  
    if (modelSelect) {
      // Salva quando cambia il modello selezionato
      modelSelect.addEventListener('change', saveSettings);
    }
  
    if (addPromptButton) {
      addPromptButton.addEventListener('click', addNewPrompt);
    }
  
    if (savePromptsButton) {
      savePromptsButton.addEventListener('click', savePrompts);
    }
  });
  

// Conferma prima di uscire se ci sono modifiche non salvate
window.addEventListener('beforeunload', (e) => {
  if (hasUnsavedChanges) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// Inizializzazione
initializeI18n();
loadSettings();