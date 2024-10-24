// options.js
let prompts = [];
let originalPrompts = [];
let hasUnsavedChanges = false;

// Carica le impostazioni salvate
async function loadSettings() {
  try {
    const result = await browser.storage.local.get(['apiKey', 'selectedModel', 'prompts']);
    document.getElementById('apiKey').value = result.apiKey || '';
    
    // Assicuriamoci che prompts sia sempre un array
    if (Array.isArray(result.prompts) && result.prompts.length > 0) {
      prompts = result.prompts;
    } else {
      prompts = [
        { id: 1, name: 'Traduci in inglese', prompt: 'Translate this text to English:' },
        { id: 2, name: 'Correggi', prompt: 'Fix any errors in this text:' }
      ];
      // Salva i prompt predefiniti se non ce ne sono
      await browser.storage.local.set({ prompts });
    }
    
    // Crea una copia profonda dei prompt originali
    originalPrompts = JSON.parse(JSON.stringify(prompts));
    
    if (result.apiKey) {
      await loadModels(result.apiKey);
      if (result.selectedModel) {
        document.getElementById('model').value = result.selectedModel;
      }
    }
    
    updatePromptsTable();
    updateSaveButtonState();
  } catch (error) {
    console.error('Error loading settings:', error);
    alert('Errore nel caricamento delle impostazioni');
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
    alert('Errore nel caricamento dei modelli. Verifica la tua API key.');
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
        <button class="button delete" data-id="${prompt.id}">Elimina</button>
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
    // Aggiorna solo l'array in memoria
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
    name: 'Nuovo Prompt',
    prompt: 'Inserisci il testo del prompt'
  };
  
  prompts = [...prompts, newPrompt];
  hasUnsavedChanges = true;
  updatePromptsTable();
  updateSaveButtonState();
}

// Elimina prompt
function deletePrompt(id) {
  if (confirm('Sei sicuro di voler eliminare questo prompt?')) {
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
    alert('Errore durante il salvataggio dei prompt');
  }
}

// Aggiorna lo stato del pulsante salva
function updateSaveButtonState() {
  const saveButton = document.getElementById('savePrompts');
  saveButton.disabled = !hasUnsavedChanges;
  saveButton.style.opacity = hasUnsavedChanges ? '1' : '0.5';
}

// Mostra il messaggio di salvataggio
function showSaveStatus() {
  const status = document.getElementById('saveStatus');
  status.style.display = 'inline';
  setTimeout(() => {
    status.style.display = 'none';
  }, 2000);
}

// Salva le impostazioni API e modello
async function saveSettings() {
  const apiKey = document.getElementById('apiKey').value;
  const selectedModel = document.getElementById('model').value;
  
  try {
    await browser.storage.local.set({
      apiKey,
      selectedModel
    });
    showSaveStatus();
  } catch (error) {
    console.error('Error saving settings:', error);
    alert('Errore durante il salvataggio delle impostazioni');
  }
}

// Event Listeners
document.getElementById('apiKey').addEventListener('change', saveSettings);
document.getElementById('model').addEventListener('change', saveSettings);
document.getElementById('addPrompt').addEventListener('click', addNewPrompt);
document.getElementById('savePrompts').addEventListener('click', savePrompts);

// Conferma prima di uscire se ci sono modifiche non salvate
window.addEventListener('beforeunload', (e) => {
  if (hasUnsavedChanges) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// Inizializzazione
loadSettings();