document.addEventListener('DOMContentLoaded', () => {
    const apiKeyInput = document.getElementById('api-key');
    const saveButton = document.getElementById('save');
    const status = document.getElementById('status');
    const excludedSelectorsInput = document.getElementById('excluded-selectors');

    // Load saved API key
    chrome.storage.sync.get(['openAiApiKey', 'excludedSelectors'], (result) => {
        if (result.openAiApiKey) {
            apiKeyInput.value = result.openAiApiKey;
        }
        if (Array.isArray(result.excludedSelectors)) {
            excludedSelectorsInput.value = result.excludedSelectors.join('\n');
        }
    });

    // Save API key
    saveButton.addEventListener('click', () => {
        const apiKey = apiKeyInput.value;
        const raw = excludedSelectorsInput.value || '';
        const list = raw
            .split(/[\n,]/)
            .map(s => s.trim())
            .filter(s => s.length > 0);
        chrome.storage.sync.set({ openAiApiKey: apiKey, excludedSelectors: list }, () => {
            status.textContent = 'Settings saved successfully!';
            status.className = 'status success';
            status.style.display = 'block';
            setTimeout(() => {
                status.style.display = 'none';
            }, 3000);
        });
    });
}); 