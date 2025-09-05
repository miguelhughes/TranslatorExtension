document.addEventListener('DOMContentLoaded', () => {
    const apiKeyInput = document.getElementById('api-key');
    const saveButton = document.getElementById('save');
    const status = document.getElementById('status');
    const excludedSelectorsInput = document.getElementById('excluded-selectors');
    const excludedTextRegexesInput = document.getElementById('excluded-text-regexes');

    // Load saved API key
    chrome.storage.sync.get(['openAiApiKey', 'excludedSelectors', 'excludedTextRegexes'], (result) => {
        if (result.openAiApiKey) {
            apiKeyInput.value = result.openAiApiKey;
        }
        if (Array.isArray(result.excludedSelectors)) {
            excludedSelectorsInput.value = result.excludedSelectors.join('\n');
        }
        if (Array.isArray(result.excludedTextRegexes)) {
            excludedTextRegexesInput.value = result.excludedTextRegexes.join('\n');
        }
    });

    // Save API key
    saveButton.addEventListener('click', () => {
        const apiKey = apiKeyInput.value;
        const rawSelectors = excludedSelectorsInput.value || '';
        const listSelectors = rawSelectors
            .split(/[\n,]/)
            .map(s => s.trim())
            .filter(s => s.length > 0);
        const rawRegexes = excludedTextRegexesInput.value || '';
        const listRegexes = rawRegexes
            .split(/[\n,]/)
            .map(s => s.trim())
            .filter(s => s.length > 0);

        // Validate regexes and warn about invalid ones; keep only valid ones
        const validRegexes = [];
        for (const raw of listRegexes) {
            const trimmed = raw.trim();
            if (!trimmed) continue;
            try {
                if (trimmed.startsWith('/') && trimmed.lastIndexOf('/') > 0) {
                    const lastSlash = trimmed.lastIndexOf('/');
                    const pattern = trimmed.slice(1, lastSlash);
                    const flags = trimmed.slice(lastSlash + 1);
                    // test compile
                    new RegExp(pattern, flags);
                } else {
                    new RegExp(trimmed);
                }
                validRegexes.push(trimmed);
            } catch (e) {
                console.warn(`[Options] Invalid regex ignored: ${trimmed}. Error: ${e?.message}`);
            }
        }

        chrome.storage.sync.set({ openAiApiKey: apiKey, excludedSelectors: listSelectors, excludedTextRegexes: validRegexes }, () => {
            status.textContent = 'Settings saved successfully!';
            status.className = 'status success';
            status.style.display = 'block';
            setTimeout(() => {
                status.style.display = 'none';
            }, 3000);
        });
    });
}); 