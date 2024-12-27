document.addEventListener('DOMContentLoaded', () => {
    const apiKeyInput = document.getElementById('api-key');
    const saveButton = document.getElementById('save');
    const status = document.getElementById('status');

    // Load saved API key
    chrome.storage.sync.get(['openAiApiKey'], (result) => {
        if (result.openAiApiKey) {
            apiKeyInput.value = result.openAiApiKey;
        }
    });

    // Save API key
    saveButton.addEventListener('click', () => {
        const apiKey = apiKeyInput.value;
        chrome.storage.sync.set({ openAiApiKey: apiKey }, () => {
            status.textContent = 'Settings saved successfully!';
            status.className = 'status success';
            status.style.display = 'block';
            setTimeout(() => {
                status.style.display = 'none';
            }, 3000);
        });
    });
}); 