// background.js
let apiKey = '';
let selectedModel = '';
let prompts = [];

// Carica la configurazione all'avvio
browser.storage.local.get(['apiKey', 'selectedModel', 'prompts']).then(result => {
  apiKey = result.apiKey || '';
  selectedModel = result.selectedModel || '';
  prompts = result.prompts || [
    { id: 1, name: 'Traduci in inglese', prompt: 'Translate this text to English:' },
    { id: 2, name: 'Correggi', prompt: 'Fix any errors in this text:' }
  ];
  createContextMenus();
});

// Crea i menu contestuali
function createContextMenus() {
  browser.contextMenus.removeAll();
  browser.contextMenus.create({
    id: 'gpt-menu',
    title: 'GPT Helper',
    contexts: ['selection']
  });

  prompts.forEach(prompt => {
    browser.contextMenus.create({
      id: `prompt-${prompt.id}`,
      parentId: 'gpt-menu',
      title: prompt.name,
      contexts: ['selection']
    });
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
    showResult(text, result.choices[0].message.content, tab);
  } catch (error) {
    console.error('Error:', error);
    browser.tabs.executeScript(tab.id, {
      code: `alert('Error processing text: ${error.message}')`
    });
  }
}

// Mostra il risultato in una finestra flottante
async function showResult(originalText, resultText, tab) {
    const escapedOriginal = originalText.replace(/[`\\]/g, '\\$&').replace(/\$/g, '\\$');
    const escapedResult = resultText.replace(/[`\\]/g, '\\$&').replace(/\$/g, '\\$');
    
    const code = `
      (function() {
        // Crea il container principale
        const container = document.createElement('div');
        // Crea e attacca Shadow DOM
        const shadow = container.attachShadow({mode: 'closed'});
        
        // Stili isolati
        const styles = document.createElement('style');
        styles.textContent = \`
          .gpt-helper-result {
            all: initial;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 2147483647;
            background: white;
            border: 1px solid #ccc;
            padding: 20px;
            border-radius: 5px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            max-width: 400px;
            max-height: 80vh;
            overflow-y: auto;
            color: #333;
            font-size: 14px;
            line-height: 1.4;
          }
  
          .gpt-helper-draghandle {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            background: #f5f5f5;
            padding: 10px;
            cursor: move;
            border-radius: 5px 5px 0 0;
            border-bottom: 1px solid #ddd;
            user-select: none;
          }
  
          .gpt-helper-title {
            display: inline-block;
            margin-right: 30px;
            color: #333;
            font-weight: 500;
          }
  
          .gpt-helper-close {
            position: absolute;
            top: 8px;
            right: 10px;
            background: none;
            border: none;
            cursor: pointer;
            font-size: 16px;
            color: #666;
            padding: 4px 8px;
          }
  
          .gpt-helper-close:hover {
            color: #333;
            background: #e0e0e0;
            border-radius: 4px;
          }
  
          .gpt-helper-content {
            margin-top: 40px;
          }
  
          .gpt-helper-section {
            margin: 10px 0;
          }
  
          .gpt-helper-section h4 {
            margin: 10px 0;
            font-weight: 500;
            color: #333;
          }
  
          .gpt-helper-text {
            margin-bottom: 10px;
            padding: 10px;
            background: #f5f5f5;
            border-radius: 4px;
            border: 1px solid #e0e0e0;
          }
  
          .gpt-helper-button {
            padding: 8px 16px;
            background: #4CAF50;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
            transition: background-color 0.2s;
          }
  
          .gpt-helper-button:hover {
            background: #45a049;
          }
  
          .gpt-helper-status {
            color: #666;
            margin-left: 10px;
            display: none;
          }
        \`;
  
        // Template HTML
        shadow.innerHTML = \`
          \${styles.outerHTML}
          <div class="gpt-helper-result">
            <div class="gpt-helper-draghandle">
              <span class="gpt-helper-title">Risultato GPT</span>
              <button class="gpt-helper-close">✖</button>
            </div>
            <div class="gpt-helper-content">
              <div class="gpt-helper-section">
                <h4>Testo originale:</h4>
                <div class="gpt-helper-text">${escapedOriginal}</div>
              </div>
              <div class="gpt-helper-section">
                <h4>Risultato:</h4>
                <div class="gpt-helper-text">${escapedResult}</div>
              </div>
              <div style="display: flex; align-items: center;">
                <button class="gpt-helper-button">Copia risultato</button>
                <span class="gpt-helper-status">Copiato!</span>
              </div>
            </div>
          </div>
        \`;
  
        // Aggiungi il container al body
        document.body.appendChild(container);
  
        // Riferimenti agli elementi nel Shadow DOM
        const resultDiv = shadow.querySelector('.gpt-helper-result');
        const dragHandle = shadow.querySelector('.gpt-helper-draghandle');
        const closeButton = shadow.querySelector('.gpt-helper-close');
        const copyButton = shadow.querySelector('.gpt-helper-button');
        const copyStatus = shadow.querySelector('.gpt-helper-status');
  
        // Gestione chiusura
        closeButton.addEventListener('click', () => {
          document.body.removeChild(container);
        });
  
        // Gestione copia
        copyButton.addEventListener('click', async () => {
          try {
            const textarea = document.createElement('textarea');
            textarea.value = \`${escapedResult}\`;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
            
            copyStatus.style.display = 'inline';
            copyButton.style.backgroundColor = '#45a049';
            
            setTimeout(() => {
              copyStatus.style.display = 'none';
              copyButton.style.backgroundColor = '#4CAF50';
            }, 2000);
          } catch (err) {
            console.error('Errore durante la copia:', err);
            copyStatus.textContent = 'Errore durante la copia';
            copyStatus.style.color = '#f44336';
            copyStatus.style.display = 'inline';
          }
        });
  
        // Gestione drag and drop
        let isDragging = false;
        let currentX;
        let currentY;
        let initialX;
        let initialY;
        let xOffset = 0;
        let yOffset = 0;
  
        function dragStart(e) {
          if (e.type === "mousedown") {
            initialX = e.clientX - xOffset;
            initialY = e.clientY - yOffset;
          } else if (e.type === "touchstart") {
            initialX = e.touches[0].clientX - xOffset;
            initialY = e.touches[0].clientY - yOffset;
          }
          
          if (e.target === dragHandle || e.target.parentNode === dragHandle) {
            isDragging = true;
          }
        }
  
        function dragEnd(e) {
          initialX = currentX;
          initialY = currentY;
          isDragging = false;
        }
  
        function drag(e) {
          if (isDragging) {
            e.preventDefault();
            
            if (e.type === "mousemove") {
              currentX = e.clientX - initialX;
              currentY = e.clientY - initialY;
            } else if (e.type === "touchmove") {
              currentX = e.touches[0].clientX - initialX;
              currentY = e.touches[0].clientY - initialY;
            }
  
            xOffset = currentX;
            yOffset = currentY;
  
            const rect = resultDiv.getBoundingClientRect();
            const windowWidth = window.innerWidth;
            const windowHeight = window.innerHeight;
  
            if (currentX < -rect.width + 100) currentX = -rect.width + 100;
            if (currentX > windowWidth - 100) currentX = windowWidth - 100;
            if (currentY < 0) currentY = 0;
            if (currentY > windowHeight - 100) currentY = windowHeight - 100;
  
            setTranslate(currentX, currentY, resultDiv);
          }
        }
  
        function setTranslate(xPos, yPos, el) {
          el.style.transform = "translate3d(" + xPos + "px, " + yPos + "px, 0)";
        }
  
        dragHandle.addEventListener("mousedown", dragStart, false);
        document.addEventListener("mousemove", drag, false);
        document.addEventListener("mouseup", dragEnd, false);
  
        dragHandle.addEventListener("touchstart", dragStart, false);
        document.addEventListener("touchmove", drag, false);
        dragHandle.addEventListener("touchend", dragEnd, false);
      })();
    `;
  
    try {
      await browser.tabs.executeScript(tab.id, {
        code: code
      });
    } catch (error) {
      console.error('Error showing result:', error);
      browser.tabs.executeScript(tab.id, {
        code: `alert('Error showing result: ${error.message}')`
      });
    }
  }
  