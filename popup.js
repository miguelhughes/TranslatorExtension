document.addEventListener('DOMContentLoaded', () => {
    const toggle = document.getElementById('live-translation-toggle');
    const btnDelta = document.getElementById('translate-delta');
    const btnFull = document.getElementById('translate-full');

    chrome.storage.sync.get(['liveTranslationEnabled'], (result) => {
        const isEnabled = result.liveTranslationEnabled !== false; // default true
        if (isEnabled) toggle.classList.add('active');
    });

    toggle.addEventListener('click', () => {
        const isActive = toggle.classList.contains('active');
        toggle.classList.toggle('active');
        const newState = !isActive;
        chrome.storage.sync.set({ liveTranslationEnabled: newState }, () => {
            const type = newState ? 'START_LIVE' : 'STOP_LIVE';
            withActiveTab(async (tabId) => {
                await ensureContentInjected(tabId);
                chrome.tabs.sendMessage(tabId, { type });
            });
        });
    });

    btnDelta.addEventListener('click', () => {
        withActiveTab(async (tabId) => {
            await ensureContentInjected(tabId);
            chrome.tabs.sendMessage(tabId, { type: 'TRANSLATE_DELTA' });
        });
    });

    btnFull.addEventListener('click', () => {
        withActiveTab(async (tabId) => {
            await ensureContentInjected(tabId);
            chrome.tabs.sendMessage(tabId, { type: 'TRANSLATE_FULL' });
        });
    });

    function withActiveTab(fn) {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (!tabs || tabs.length === 0) return;
            fn(tabs[0].id);
        });
    }

    async function ensureContentInjected(tabId) {
        return new Promise((resolve) => {
            chrome.tabs.sendMessage(tabId, { type: 'PING' }, async (resp) => {
                if (chrome.runtime.lastError || !resp || !resp.ok) {
                    try {
                        await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
                    } catch (e) {
                        // ignored
                    }
                }
                resolve();
            });
        });
    }
});


