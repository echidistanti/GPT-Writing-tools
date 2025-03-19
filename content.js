console.log('GPT Writing Tools loaded');

// Listen for messages from the extension
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    try {
        if (request.action === 'analyze_text') {
            const selectedText = window.getSelection().toString();
            if (!selectedText) {
                throw new Error('No text selected');
            }
            sendResponse({ success: true, text: selectedText });
        }
    } catch (error) {
        sendResponse({ success: false, error: error.message });
    }
    return true;
});

// Add context menu for selected text
document.addEventListener('mouseup', () => {
    try {
        const selectedText = window.getSelection().toString().trim();
        if (selectedText) {
            chrome.runtime.sendMessage({
                action: 'text_selected',
                text: selectedText,
                url: window.location.href
            }).catch(console.error);
        }
    } catch (error) {
        console.error('Selection error:', error);
    }
});
