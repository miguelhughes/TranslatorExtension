document.addEventListener('DOMContentLoaded', (event) => {
    // Load saved settings and initialize UI
    chrome.storage.sync.get(['liveTranslationEnabled'], (result) => {
        const toggle = document.getElementById('live-translation-toggle');
        const isEnabled = result.liveTranslationEnabled !== false; // Default to true
        
        if (isEnabled) {
            toggle.classList.add('active');
        }
    });

    // Handle toggle click
    document.getElementById('live-translation-toggle').addEventListener('click', () => {
        const toggle = document.getElementById('live-translation-toggle');
        const isActive = toggle.classList.contains('active');
        
        // Toggle the visual state
        toggle.classList.toggle('active');
        
        // Save the setting
        const newState = !isActive;
        chrome.storage.sync.set({ liveTranslationEnabled: newState }, () => {
            console.log('Live translation setting saved:', newState);
        });
    });

    document.getElementById('run-script').addEventListener('click', () => {
        // Get the current live translation setting before executing
        chrome.storage.sync.get(['liveTranslationEnabled'], (result) => {
            const liveTranslationEnabled = result.liveTranslationEnabled !== false; // Default to true
            
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            chrome.scripting.executeScript({
                target: { tabId: tabs[0].id },
                    func: async (liveTranslationEnabled) => {

                    // Cache translations for repeated strings (must be initialized before first translate call)
                    const translationCache = new Map();

                    addTranslationStyle();

                    //on start, translate the whole visible page.
                    await translateContents(document.documentElement); 
                    
                    //translation complete. 
                    const observer = new MutationObserver(handleMutationWithDebouncing);
                    
                    // Debouncing configuration and state
                    const MUTATION_DEBOUNCE_DELAY = 400; // milliseconds
                    let mutationTimeout = null;
                    let mutationCallCount = 0; // For logging purposes
                    
                    // Only start the mutation observer if live translation is enabled
                    if (liveTranslationEnabled) {
                    startMutationObserver();
                    }

                    // Functions below.
                    async function translateContents(nodeToTranslate)
                    {
                        try {
                            console.log(`🌍 Starting translation of ${nodeToTranslate === document.documentElement ? 'entire document' : 'specific node'}`);
                            const snapshotItems = [];

                            // Extract text strings with stable node references
                            traverseNode(nodeToTranslate, (node, text, index) => {
                                snapshotItems.push({ id: index, node: node, original: text });
                                if (node.parentElement && node.parentElement.nodeType === Node.ELEMENT_NODE) {
                                    node.parentElement.classList.add('translating');
                                }
                            });

                            console.log(`🧭 Snapshot collected: ${snapshotItems.length} text nodes`);

                            if (snapshotItems.length === 0) {
                                console.log("no strings to translate, translation skipped");
                                return;
                            }

                            // Build request map and prefill from cache
                            const idToTextRequest = {};
                            const prefills = {};
                            for (const item of snapshotItems) {
                                if (translationCache.has(item.original)) {
                                    prefills[item.id] = translationCache.get(item.original);
                                } else {
                                    idToTextRequest[item.id] = item.original;
                                }
                            }

                            const requestCount = Object.keys(idToTextRequest).length;
                            const prefillCount = Object.keys(prefills).length;
                            console.log(`🧪 Will request ${requestCount} new strings, ${prefillCount} from cache`);

                            console.log("starting translation...");
                            let translatedMap = {};
                            if (requestCount > 0) {
                                translatedMap = await translateTextMap(idToTextRequest);
                            }
                            const finalTranslations = { ...prefills, ...translatedMap };
                            console.log("translation finished");

                            // Replace text nodes using the snapshot with guards
                            let applied = 0;
                            for (const item of snapshotItems) {
                                const node = item.node;
                                const translatedText = finalTranslations[item.id] || item.original;

                                // Guard: node still present and unchanged
                                if (!node.isConnected) continue;
                                if (node.textContent !== item.original) continue;

                                node.textContent = translatedText;
                                applied++;
                                const parent = node.parentElement;
                                if (parent && parent.nodeType === Node.ELEMENT_NODE && !parent.hasAttribute('data-translated')) {
                                    parent.setAttribute('data-translated', 'true');
                                    parent.classList.remove('translating');
                                }

                                if (!translationCache.has(item.original)) {
                                    translationCache.set(item.original, translatedText);
                                }
                            }
                            console.log(`✍️ Applied translations to ${applied} nodes`);

                            // Handle images
                            handleImages(nodeToTranslate);
                        } catch (err) {
                            console.error('translateContents error:', err);
                        }
                    }
                    
                    function traverseNode(node, nodeAction, index = 0) {
                        if (!isNodeVisible(node)) {
                            return index;
                        }
                    
                        // If it's a text node, run the action
                        if (node.nodeType === Node.TEXT_NODE) {
                            const text = node.textContent;
                            if (text.trim() !== '' && /[A-Za-z]/.test(text)) { // Only process text nodes that are not empty and contain letters (to exclude digit only or symbol only entries.)
                                nodeAction(node, text, index);
                                index++;
                            }
                        } else if (node.nodeType === Node.ELEMENT_NODE && node.tagName !== 'SCRIPT' && node.tagName !== 'STYLE' && !node.hasAttribute('data-translated')) {
                            // Handle Shadow DOM first
                            if (node.shadowRoot) {
                                // Create a TreeWalker for the shadow DOM
                                const shadowWalker = document.createTreeWalker(
                                    node.shadowRoot,
                                    NodeFilter.SHOW_TEXT + NodeFilter.SHOW_ELEMENT,
                                    {
                                        acceptNode: function(node) {
                                            // For element nodes
                                            if (node.nodeType === Node.ELEMENT_NODE) {
                                                // Skip script and style tags entirely
                                                if (node.tagName === 'SCRIPT' || node.tagName === 'STYLE') {
                                                    return NodeFilter.FILTER_REJECT;
                                                }
                                                // Skip already translated nodes
                                                if (node.hasAttribute('data-translated')) {
                                                    return NodeFilter.FILTER_REJECT;
                                                }
                                                // Check visibility
                                                if (!isNodeVisible(node)) {
                                                    return NodeFilter.FILTER_REJECT;
                                                }
                                                // Skip elements but continue traversing their children
                                                return NodeFilter.FILTER_SKIP;
                                            }
                                            
                                            // For text nodes
                                            if (node.nodeType === Node.TEXT_NODE) {
                                                // Check if parent element is visible and not translated
                                                const parentElement = node.parentElement;
                                                if (parentElement && (!isNodeVisible(parentElement) || parentElement.hasAttribute('data-translated'))) {
                                                    return NodeFilter.FILTER_REJECT;
                                                }
                                                
                                                // Check if text node has content we want to translate
                                                return node.textContent.trim() !== '' && /[A-Za-z]/.test(node.textContent)
                                                    ? NodeFilter.FILTER_ACCEPT 
                                                    : NodeFilter.FILTER_REJECT;
                                            }
                                            
                                            return NodeFilter.FILTER_REJECT;
                                        }
                                    }
                                );
                    
                                let currentNode;
                                while (currentNode = shadowWalker.nextNode()) {
                                    if (currentNode.nodeType === Node.TEXT_NODE) {
                                        nodeAction(currentNode, currentNode.textContent, index);
                                        index++;
                                    }
                                }
                            }
                    
                            // Then handle regular DOM nodes
                            for (let i = 0; i < node.childNodes.length; i++) {
                                index = traverseNode(node.childNodes[i], nodeAction, index);
                            }
                        }
                        return index;
                    }

                    function isNodeVisible(node) {
                        if (node.nodeType !== Node.ELEMENT_NODE) {
                            return true; // we can't use the computed style function below, so we default to the safe side.
                        }
                        
                        const style = window.getComputedStyle(node);
                        return !(style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0');
                    }

                    // Translate an object map of id -> text, preserving keys
                    async function translateTextMap(idToText) {
                        const messages = [
                            {
                                role: "system",
                                content: "You will be provided with a JSON object whose keys are string IDs and values are English sentences from a website. Translate the values into Spanish and return a JSON object preserving the exact same keys and structure. Do not add, remove, or reorder keys.",
                            },
                            {
                                role: "user",
                                content: JSON.stringify(idToText),
                            }
                        ];

                        const content = await callOpenAI(messages, true);
                        console.log(`translated result: '${content}'`);
                        try {
                            return JSON.parse(content);
                        } catch (e) {
                            console.error('Failed to parse translation map, raw content:', content);
                            throw e;
                        }
                    }
                    
                    async function convertSvgToImage(svgUrl) {
                        console.log('converting SVG with url: ' + svgUrl + ' to png');
                        // Create a new Image object
                        const img = new Image();
                        img.crossOrigin = "anonymous";  // Enable CORS if the SVG is from another domain
                        
                        // Create canvas
                        const canvas = document.createElement('canvas');
                        const ctx = canvas.getContext('2d');
                        
                        // Return a promise that resolves with the base64 data URL
                        return new Promise((resolve, reject) => {
                            img.onload = () => {
                                // Set canvas dimensions to match the image
                                canvas.width = img.width;
                                canvas.height = img.height;
                                
                                // Draw the image onto the canvas
                                ctx.drawImage(img, 0, 0);
                                
                                // Convert to base64 data URL
                                try {
                                    const dataUrl = canvas.toDataURL('image/png');
                                    resolve(dataUrl);
                                } catch (error) {
                                    reject(error);
                                }
                            };
                            
                            img.onerror = (error) => {
                                reject(error);
                            };
                            
                            // Load the SVG
                            img.src = svgUrl;
                        });
                    }
                    
                    // handle image translation
                    async function handleImages(node) {
                        console.log('handling images');
                        const images = Array.from(node.querySelectorAll('img')).reverse();
                        for (let img of images) {
                            if (!img.hasAttribute('data-translated')) {
                                img.classList.add('translating');
                                let success;
                                try {
                                    let imageUrl = img.src;
                                    
                                    // Check if the image is an SVG, considering that there might be querystrings after the .svg extension
                                    if (imageUrl.toLowerCase().endsWith('.svg')|| imageUrl.toLowerCase().includes('.svg?')) {
                                    try {
                                            imageUrl = await convertSvgToImage(img.src);
                                            console.log('Successfully converted SVG to PNG');
                                        } catch (error) {
                                            console.error('Failed to convert SVG:', error);
                                            continue; // Skip this image if conversion fails
                                        }
                                    }
                                    
                                    const imageTexts = await extractAndTranslateTextFromImage(imageUrl);
                                    if (imageTexts && Object.keys(imageTexts).length > 0) {
                                        createImageTooltip(img, imageTexts);
                                    }
                                    success = true;
                                }
                                catch (error) {
                                    console.error('error translating image', error);
                                    success = false;
                                }
                                img.setAttribute('data-translated', success ? 'true' : 'false');
                                img.classList.remove('translating');
                            }
                        }
                        console.log('images handled');
                    }

                    async function extractAndTranslateTextFromImage(imageUrl) {
                        console.log('extracting and translating text from image ' + imageUrl);
                        
                        const messages = [
                            {
                                role: "user",
                                content: [
                                    {
                                        type: "text",
                                        text: "If there's any text in this image, create a reply with the texts in english and their translations in spanish. The reply must be a json array with the texts in english as keys and their translations in spanish as values. if there isn't any text, reply with an empty array. Exclude any items whose translation remains the same"
                                    },
                                    {
                                        type: "image_url",
                                        image_url: {
                                            url: imageUrl
                                        }
                                    }
                                ]
                            }
                        ];
                    
                        const content = await callOpenAI(messages, true);
                        console.log('image translation response: ' + content);
                        const responseJson = JSON.parse(content);
                        
                        console.log('image translation response items: ' + Object.keys(responseJson).length);
                        return responseJson;
                    }

                    // create tooltip for image with the translations
                    function createImageTooltip(img, translations) {
                        const tooltip = document.createElement('div');
                        tooltip.className = 'image-translation-tooltip';
                        
                        let tooltipContent = '';
                        for (let [original, translated] of Object.entries(translations)) {
                            tooltipContent += `<strong>${original}</strong>: ${translated}<br>`;
                        }
                        
                        tooltip.innerHTML = tooltipContent;
                        
                        img.parentNode.style.position = 'relative';
                        img.parentNode.appendChild(tooltip);
                        
                        img.addEventListener('mouseover', () => {
                            tooltip.style.display = 'block';
                        });
                        
                        img.addEventListener('mouseout', () => {
                            tooltip.style.display = 'none';
                        });
                    }

                    /**
                     * Helper function to describe a single node with shadow root detection
                     */
                    function describeNode(node) {
                        if (node.nodeType === Node.TEXT_NODE) {
                            return `text:"${node.textContent.substring(0, 15)}${node.textContent.length > 15 ? '...' : ''}"`;
                        } else if (node.nodeType === Node.ELEMENT_NODE) {
                            const text = node.textContent?.trim() || '';
                            const hasChildren = node.children.length > 0;
                            const hasShadowRoot = node.shadowRoot !== null;

                            let nodeDesc = `<${node.tagName.toLowerCase()}`;
                            if (node.className) nodeDesc += ` class="${node.className.substring(0, 20)}${node.className.length > 20 ? '...' : ''}"`;
                            nodeDesc += `>`;
                            
                            if (text) {
                                nodeDesc += ` "${text.substring(0, 30)}${text.length > 30 ? '...' : ''}"`;
                            } else if (hasShadowRoot) {
                                const shadowText = node.shadowRoot.textContent?.trim() || '';
                                if (shadowText) {
                                    nodeDesc += ` [shadow: "${shadowText.substring(0, 30)}${shadowText.length > 30 ? '...' : ''}"]`;
                                } else {
                                    nodeDesc += ` [shadow: ${node.shadowRoot.children.length} shadow children]`;
                                }
                            } else if (hasChildren) {
                                // Check if any children have shadow roots (common pattern with css-1sgw6i5)
                                const childWithShadow = Array.from(node.children).find(child => child.shadowRoot);
                                if (childWithShadow) {
                                    // Use TreeWalker to get only content text, skipping styles
                                    const shadowWalker = document.createTreeWalker(
                                        childWithShadow.shadowRoot,
                                        NodeFilter.SHOW_TEXT,
                                        {
                                            acceptNode: function(textNode) {
                                                // Skip text nodes inside style or script tags
                                                const parent = textNode.parentElement;
                                                if (parent && (parent.tagName === 'STYLE' || parent.tagName === 'SCRIPT')) {
                                                    return NodeFilter.FILTER_REJECT;
                                                }
                                                return textNode.textContent.trim() !== '' && /[A-Za-z]/.test(textNode.textContent)
                                                    ? NodeFilter.FILTER_ACCEPT 
                                                    : NodeFilter.FILTER_REJECT;
                                            }
                                        }
                                    );
                                    
                                    const textParts = [];
                                    let currentNode;
                                    while (currentNode = shadowWalker.nextNode()) {
                                        textParts.push(currentNode.textContent.trim());
                                    }
                                    const shadowText = textParts.join(' ');
                                    
                                    nodeDesc += ` ["${shadowText.substring(0, 30)}${shadowText.length > 30 ? '...' : ''}"]`;
                                    // nodeDesc += ` [child ${childWithShadow.tagName.toLowerCase()} has shadow: "${shadowText.substring(0, 30)}${shadowText.length > 30 ? '...' : ''}"]`;
                                } else {
                                    nodeDesc += ` [${node.children.length} child elements]`;
                                }
                            } else {
                                nodeDesc += ` [empty]`;
                            }
                            return nodeDesc;
                        }
                        return node.nodeName;
                    }

                    /**
                     * Helper function to create a descriptive summary of mutations for logging
                     */
                    function describeMutations(mutations, callId) {
                        return mutations.map((mutation, index) => {
                            const target = mutation.target;
                            let description = `[${callId}-${index}] ${mutation.type}`;
                            
                            if (target.nodeType === Node.ELEMENT_NODE) {
                                description += ` on <${target.tagName.toLowerCase()}`;
                                if (target.id) description += ` id="${target.id}"`;
                                if (target.className) description += ` class="${target.className.substring(0, 30)}${target.className.length > 30 ? '...' : ''}"`;
                                description += `>`;
                                
                                // Add text content snippet with shadow root detection
                                const textContent = target.textContent?.trim() || '';
                                const hasShadowRoot = target.shadowRoot !== null;

                                
                                if (textContent) {
                                    description += ` "${textContent.substring(0, 25)}${textContent.length > 25 ? '...' : ''}"`;
                                } else if (hasShadowRoot) {
                                    const shadowText = target.shadowRoot.textContent?.trim() || '';
                                    if (shadowText) {
                                        description += ` [shadow: "${shadowText.substring(0, 25)}${shadowText.length > 25 ? '...' : ''}"]`;
                                    } else {
                                        description += ` [shadow: ${target.shadowRoot.children.length} shadow children]`;
                                    }
                                }
                            } else if (target.nodeType === Node.TEXT_NODE) {
                                description += ` on text node`;
                                if (target.parentElement) {
                                    description += ` in <${target.parentElement.tagName.toLowerCase()}>`;
                                }
                                const textContent = target.textContent || '';
                                description += ` content: "${textContent.substring(0, 25)}${textContent.length > 25 ? '...' : ''}"`;
                            }
                            
                            if (mutation.type === 'childList') {
                                description += ` (added: ${mutation.addedNodes.length}, removed: ${mutation.removedNodes.length})`;
                                
                                // Show content of added/removed nodes
                                if (mutation.addedNodes.length > 0) {
                                    const addedContent = Array.from(mutation.addedNodes)
                                        .map(node => describeNode(node))
                                        .join(', ');
                                    description += ` [added: ${addedContent}]`;
                                }
                                
                                if (mutation.removedNodes.length > 0) {
                                    const removedContent = Array.from(mutation.removedNodes)
                                        .map(node => describeNode(node))
                                        .join(', ');
                                    description += ` [removed: ${removedContent}]`;
                                }
                            }
                            
                            return description;
                        }).join('\n    ');
                    }

                    /**
                     * Mutation observer callback that implements debouncing to prevent rapid successive translations.
                     * Each detected mutation resets the timer, ensuring translation only occurs after a quiet period.
                     */
                    async function handleMutationWithDebouncing(mutations) {
                        mutationCallCount++;
                        const currentCallId = mutationCallCount;
                        const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
                        
                        console.log(`🔍 MUTATION CALL #${currentCallId} at ${timestamp}`);
                        console.log(`📝 Received ${mutations.length} mutations:`);
                        console.log(`    ${describeMutations(mutations, currentCallId)}`);
                        
                        // Clear any existing timeout (sliding timer approach)
                        if (mutationTimeout) {
                            console.log(`⏰ Clearing previous timeout (debouncing in effect)`);
                            clearTimeout(mutationTimeout);
                        }
                        
                        console.log(`⏳ Setting ${MUTATION_DEBOUNCE_DELAY}ms timeout for call #${currentCallId}`);
                        
                        // Set a new timeout to trigger translation after the delay
                        mutationTimeout = setTimeout(async () => {
                            console.log(`🚀 TIMEOUT TRIGGERED for call #${currentCallId} at ${new Date().toISOString().split('T')[1].split('.')[0]}`);
                            console.log(`📋 Processing ${mutations.length} mutations from call #${currentCallId}:`);
                            console.log(`    ${describeMutations(mutations, currentCallId)}`);
                            await performDebouncedTranslation(mutations);
                        }, MUTATION_DEBOUNCE_DELAY);
                    }

                    /**
                     * Performs the actual translation work after the debounce period has elapsed.
                     */
                    async function performDebouncedTranslation(mutations) {
                        const processingTimestamp = new Date().toISOString().split('T')[1].split('.')[0];
                        console.log(`🔧 PROCESSING MUTATIONS at ${processingTimestamp}`);
                        console.log(`📊 Final mutation count to process: ${mutations.length}`);

                        stopMutationObserver();
                        
                        let processedCount = 0;
                        let removedTranslatedCount = 0;
                        
                        // Process the mutations (keeping original logic)
                        for (let mutation of mutations) {
                            processedCount++;
                            console.log(`  🔸 Processing mutation ${processedCount}: ${mutation.type} on ${mutation.target.nodeName}`);
                            
                            if (mutation.type === 'childList') {
                                // for (let node of mutation.addedNodes) {
                                //     await translateContents(node);
                                // }
                            } else if (mutation.type === 'characterData') {
                                const parent = mutation.target.parentElement;
                                if (parent && parent.nodeType === Node.ELEMENT_NODE && parent.hasAttribute('data-translated')) {
                                    parent.removeAttribute('data-translated');
                                    removedTranslatedCount++;
                                    console.log(`    🏷️ Removed data-translated from <${parent.tagName.toLowerCase()}>`);
                                }
                                //TODO: sometimes this mutation get's called but the text is the same, so no point in translating
                            }
                        }

                        console.log(`✅ Mutation processing complete: ${processedCount} mutations processed, ${removedTranslatedCount} elements unmarked`);
                        console.log(`🌍 Starting full page translation...`);

                        await translateContents(document.documentElement);
                        
                        console.log(`🔄 Restarting mutation observer`);
                        startMutationObserver();
                        mutationTimeout = null; // Reset timeout reference
                    }


                    function startMutationObserver(){

                        observer.observe(document.body, {
                            childList: true,
                            subtree: true,
                            characterData: true,
                            characterDataOldValue: true
                        });
                    }

                    function stopMutationObserver() {
                        console.log(`🛑 Stopping mutation observer`);
                        observer.disconnect();
                        // Clear any pending debounce timeout
                        if (mutationTimeout) {
                            console.log(`🧹 Clearing pending timeout during observer stop`);
                            clearTimeout(mutationTimeout);
                            mutationTimeout = null;
                        }
                    }

                    function addTranslationStyle() {
                        const loadingStyle = `
                            @keyframes translateWave {
                                0% {
                                    background-position: 200% 50%;
                                }
                                100% {
                                    background-position: 0% 50%;
                                }
                            }
                    
                            .translating {
                                background-image: linear-gradient(
                                    90deg,
                                    rgba(41, 204, 87, 0.1) 0%,
                                    rgba(41, 204, 87, 0.2) 25%,
                                    rgba(41, 204, 87, 0.1) 50%,
                                    rgba(41, 204, 87, 0.2) 75%,
                                    rgba(41, 204, 87, 0.1) 100%
                                );
                                background-size: 200% 100%;
                                animation: translateWave 1.5s linear infinite;
                                transition: background 0.3s ease;
                            }
                    
                            .image-translation-tooltip {
                                display: none;
                                position: absolute;
                                bottom: 100%;
                                left: 50%;
                                transform: translateX(-50%);
                                background-color: rgba(255, 255, 255, 0.95);
                                color: #333;
                                padding: 10px 15px;
                                border-radius: 8px;
                                font-size: 14px;
                                z-index: 1000;
                                white-space: nowrap;
                                border: 2px dashed #ccc;
                                box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
                                word-wrap: break-word;
                            }
                    
                            .image-translation-tooltip::after {
                                content: '';
                                position: absolute;
                                top: 100%;
                                left: 50%;
                                margin-left: -10px;
                                border-width: 10px;
                                border-style: solid;
                                border-color: #ccc transparent transparent transparent;
                            }
                        `;
                    
                        // Add style to main document if it doesn't exist
                        if (!document.querySelector('style[data-translation-style]')) {
                            const styleElement = document.createElement('style');
                            styleElement.textContent = loadingStyle;
                            styleElement.setAttribute('data-translation-style', 'true');
                            document.head.appendChild(styleElement);
                        }
                    
                        // Add style to all shadow roots
                        const addStyleToShadowRoot = (node) => {
                            if (node.nodeType === Node.ELEMENT_NODE) {
                                if (node.shadowRoot && !node.shadowRoot.querySelector('style[data-translation-style]')) {
                                    const shadowStyle = document.createElement('style');
                                    shadowStyle.textContent = loadingStyle;
                                    shadowStyle.setAttribute('data-translation-style', 'true');
                                    node.shadowRoot.insertBefore(shadowStyle, node.shadowRoot.firstChild);
                                }
                    
                                // Recursively check all child elements for shadow roots
                                node.childNodes.forEach(child => addStyleToShadowRoot(child));
                            }
                        };
                    
                        // Start checking from document root
                        addStyleToShadowRoot(document.documentElement);
                    }
                    
                    async function callOpenAI(messages, jsonResponse = false) {
                        // Get the API key from storage
                        const apiKey = await new Promise((resolve) => {
                            chrome.storage.sync.get(['openAiApiKey'], (result) => {
                                resolve(result.openAiApiKey);
                            });
                        });

                        if (!apiKey) {
                            throw new Error('OpenAI API key not configured. Please set it in the extension popup.');
                        }

                        const response = await fetch('https://api.openai.com/v1/chat/completions', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${apiKey}`,
                            },
                            body: JSON.stringify({
                                model: "gpt-4o-mini",
                                messages: messages,
                                temperature: 0,
                                top_p: 1,
                                n: 1,
                                stream: false,
                                max_tokens: 2000,
                                presence_penalty: 0,
                                frequency_penalty: 0,
                                ...(jsonResponse && { response_format: { type: "json_object" } })
                            }),
                        });
                    
                        const data = await response.json();
                        return data.choices[0].message.content;
                    }
                    
                    // Store live translation setting in page context for potential future use
                    window.liveTranslationEnabled = liveTranslationEnabled;
                },
                args: [liveTranslationEnabled]
                });
            });
        });
    });
});


// problemas anteriores:
// en https://brilliant.org/courses/logic-deduction/introduction-68/strategic-deductions-2/1/ no traduce el botón.
// en https://brilliant.org/courses/logic-deduction/introduction-68/strategic-deductions-2/2/ si se tradujo, al apretar continue se rompe todo, entra en un loop asqueroso
// en https://brilliant.org/courses/logic-deduction/introduction-68/extra-practice-25/2/, después de traducir, al cambiar, la página queda en blanco.
// https://brilliant.org/courses/logic-deduction/introduction-68/extra-practice-25/1/, los dígitos aparecen 3 veces.
// https://brilliant.org/courses/logic-deduction/introduction-68/extra-practice-25/2/ empezar de nuevo/continuar aparecen en el lugar incorrecto. también en la descripción del problema, #555 pasa a ser 55
// https://brilliant.org/courses/logic-deduction/introduction-68/extra-practice-25/3/, también problemas con el $, similar a arriba.
// https://brilliant.org/courses/logic-deduction/introduction-68/strategic-deductions-2/4/ after adding the "data translated" attribute, when navigating back & forth on the top arrows, some items retain their attributes and aren't translated again. 

// https://brilliant.org/courses/logic-deduction/introduction-68/strategic-deductions-2/5/ las ayudas del costado no se traducen; solo la visible, y cuando cambia, esta otra vez en inglés
// https://brilliant.org/courses/logic-deduction/introduction-68/strategic-deductions-2/5/ a veces se rompe, pero no si se carga directamente, solo si se viene de otr apágina traducida
// tampoco se traducen las ayudas del costado y eso.

// https://brilliant.org/courses/logic-deduction/introduction-68/extra-practice-25/3/ el orden de la traducción es incorrecto dado que se traducen los elementos html uno a uno.
//en https://brilliant.org/courses/logic-deduction/introduction-68/strategic-deductions-2/3/, no mantiene los espacios, "en el pasillo". agregar una función para reclamar los espacios. 
//en https://brilliant.org/courses/logic-deduction/introduction-68/strategic-deductions-2/3/, si se mueven los muñecos y luego de traduce; no se traducen "aisle, center, window" porque no se veían.

// TODO: if translated, hook to the navigation events (or at least changes in the url), and trigger translate automatically.
// current issues:
// https://brilliant.org/courses/logic-deduction/introduction-68/strategic-deductions-2/5/ la imagen con el juego no se traduce
// https://brilliant.org/courses/logic-deduction/introduction-68/extra-practice-25/2/ Cartel de "practice" arribe no se traduce porque es una imagen.

// ver este, lo probé con tommy no nandaba del todo bien. puede ser lo de arriba. https://brilliant.org/courses/logic-deduction/introduction-68/practice/logic_truth-seeking_practice-v1-0-set_one/
// some hidden images are being translated. see https://brilliant.org/courses/logic-deduction/introduction-68/strategic-deductions-2/2/. parent div mobile-to-desktop-transition has display none.

// parts of the image text are ignored (uses umbrella, doesn't use umbrella) https://brilliant.org/courses/logical-languages/introduction-99/knights-knaves-and-words/1/ (third challenge). probé lo mismo en postman (esta el prompt grabado) y lo traduce bien. 

// al traducir páginas que tienen mucho texto, con varias interrupciones (cuando uno recarga la página y está bastante avanzada), los indices se desfazan en la traducción y se rompe todo. ir a https://brilliant.org/courses/logical-languages/introduction-99/knights-knaves-and-words/1/, asegurarse de que el de Fiadh and Greg esté abierto (después de umbrella) y traducir toda la página.
// items no se traducen, aún siendo texto https://brilliant.org/courses/probability-fundamentals/understanding-probability/simulating-outcomes/1/?from_llp=data-analysis. muchísimos items antes y después de este no se traducen, tablas, opciones, etc.

// https://brilliant.org/courses/logic-deduction/advanced-knights-and-knaves-old-title/unknown-answers/1/?from_llp=logical-reasoning no traduce explicación
// https://brilliant.org/courses/logic-deduction/advanced-knights-and-knaves-old-title/unknown-answers/2/?from_llp=logical-reasoning la de "Marv encounters two last beings, Taj and Yuri" tampoco anda . (insufficient funds?)

// TODO: Add handling of errors & show messages: 
// missing api key
// out of money/tokens
// general error
// https://platform.openai.com/docs/guides/error-codes/api-errors
// it would also be nice to have an upper limit on the size of the request. I think there was a bug that used up most of my tokens in just one request.

// https://brilliant.org/courses/logic-deduction/introduction-68/practice/logic_truth-seeking_practice-v1-0-set_one/ imagenes no se traducen en svg, aparentemente proque esta dentro de shadow root 