// Content script: core translator with persistent auto-translate and full/delta modes
(() => {
	// Prevent duplicate initialization if re-injected
	if (window.__translatorContentInitialized) return;
	window.__translatorContentInitialized = true;
	const MUTATION_DEBOUNCE_DELAY = 400; // ms
	const LOOP_GUARD_WINDOW_MS = 15000; // 15s
	const LOOP_GUARD_MAX_RUNS = 8;
	const MAX_CHARS_PER_BATCH = 500;
	const MAX_ITEMS_PER_BATCH = 20;

	let translationCache = new Map();
	let mutationObserver = null;
	let mutationDebounceTimeout = null;
	let mutationCallCount = 0;
	let translationRunTimestamps = [];
	let loopGuardTripped = false;
	let liveTranslationEnabled = true;
	let initialized = false;
	let translatorRunning = false;

	// Idle start tracking
	let idleCheckTimeout = null;
	let networkRequestsInFlight = 0;
	let lastNetworkActivityMs = Date.now();
	let lastDomActivityMs = Date.now();
	let domActivityObserver = null;
	let idleMonitorsInstalled = false;

	function initializeTranslator() {
		if (initialized) return;
		initialized = true;

		console.log('Initializing content script');

		addTranslationStyle();
		createOrReuseMutationObserver();
		wireUrlChangeDetection();
		wireMessageHandlers();
		wireStorageHandlers();

		chrome.storage.sync.get(['liveTranslationEnabled'], (result) => {
			liveTranslationEnabled = result.liveTranslationEnabled !== false; // default true
			console.log(`Live translation setting loaded: ${liveTranslationEnabled}`);
			if (liveTranslationEnabled) {
				scheduleAutoTranslateWhenIdle();
			}
		});
	}

	function startAutoTranslateForPage() {
		console.log('Auto-translate kickoff');
		translateDelta().then(() => {
			if (liveTranslationEnabled) {
				startMutationObserver();
			}
		});
	}

	function createOrReuseMutationObserver() {
		if (!mutationObserver) {
			mutationObserver = new MutationObserver(handleMutationWithDebouncing);
		}
	}

	function wireMessageHandlers() {
		chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
			if (!message || !message.type) return;
			switch (message.type) {
				case 'TRANSLATE_DELTA':
					translateDelta().then(() => sendResponse({ ok: true })).catch(err => sendResponse({ ok: false, error: err?.message }));
					return true;
				case 'TRANSLATE_FULL':
					clearAllTranslatedMarkers(document.documentElement);
					clearTranslationCache();
					translateDelta().then(() => sendResponse({ ok: true })).catch(err => sendResponse({ ok: false, error: err?.message }));
					return true;
				case 'START_LIVE':
					resetLoopGuard();
					liveTranslationEnabled = true;
					chrome.storage.sync.set({ liveTranslationEnabled: true });
					scheduleAutoTranslateWhenIdle();
					sendResponse({ ok: true });
					return false;
				case 'STOP_LIVE':
					liveTranslationEnabled = false;
					chrome.storage.sync.set({ liveTranslationEnabled: false });
					stopMutationObserver();
					sendResponse({ ok: true });
					return false;
				case 'PING':
					sendResponse({ ok: true, liveTranslationEnabled });
					return false;
			}
		});
	}

	function wireStorageHandlers() {
		chrome.storage.onChanged.addListener((changes, area) => {
			if (area !== 'sync') return;
			if (Object.prototype.hasOwnProperty.call(changes, 'liveTranslationEnabled')) {
				liveTranslationEnabled = changes.liveTranslationEnabled.newValue !== false;
				if (liveTranslationEnabled) {
					scheduleAutoTranslateWhenIdle();
				} else {
					stopMutationObserver();
				}
			}
		});
	}

	function wireUrlChangeDetection() {
		const dispatchLocationChange = () => window.dispatchEvent(new Event('locationchange'));
		const originalPushState = history.pushState;
		history.pushState = function () {
			originalPushState.apply(this, arguments);
			dispatchLocationChange();
		};
		const originalReplaceState = history.replaceState;
		history.replaceState = function () {
			originalReplaceState.apply(this, arguments);
			dispatchLocationChange();
		};
		window.addEventListener('popstate', dispatchLocationChange);
		window.addEventListener('hashchange', dispatchLocationChange);
		window.addEventListener('locationchange', () => {
			resetLoopGuard();
			stopMutationObserver();
			clearAllTranslatedMarkers(document.documentElement);
			if (liveTranslationEnabled) {
				scheduleAutoTranslateWhenIdle();
			}
		});
		window.addEventListener('pageshow', () => {
			if (liveTranslationEnabled) {
				scheduleAutoTranslateWhenIdle();
			}
		});
	}

	function startMutationObserver() {
		try {
			console.log('Starting mutation observer');
			mutationObserver.observe(document.body, {
				childList: true,
				subtree: true,
				characterData: true,
				characterDataOldValue: true
			});
		} catch (e) {}
	}

	function stopMutationObserver() {
		try {
			console.log('Stopping mutation observer');
			mutationObserver.disconnect();
		} catch (e) {}
		if (mutationDebounceTimeout) {
			clearTimeout(mutationDebounceTimeout);
			mutationDebounceTimeout = null;
		}
	}

	function resetLoopGuard() {
		translationRunTimestamps = [];
		loopGuardTripped = false;
	}

	function clearTranslationCache() {
		translationCache.clear();
		console.log('Translation cache cleared');
	}

	async function translateDelta() {
		if (translatorRunning) {
			console.log('Call to translateDelta skipped, translator already running.');
			return;
		}
		translatorRunning = true;
		try {
			await translateContents(document.documentElement);
		} finally {
			translatorRunning = false;
		}
	}

	async function translateContents(nodeToTranslate) {
		try {
			const snapshotItems = [];
			traverseNode(nodeToTranslate, (node, text, index) => {
				snapshotItems.push({ id: index, node: node, original: text });
				if (node.parentElement && node.parentElement.nodeType === Node.ELEMENT_NODE) {
					node.parentElement.classList.add('translating');
				}
			});

			console.log(`Translating ${snapshotItems.length} text nodes`);

			if (snapshotItems.length === 0) {
				console.log('No strings to translate, skipping');
				return;
			}

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
			if (prefillCount > 0) {
				const preview = Object.values(prefills).map(text => text.length > 20 ? text.substring(0, 20) + '...' : text).join(' | ').substring(0, 50);
				console.log(`Using ${prefillCount} cached translations: ${preview}`);
			}

			let translatedMap = {};
			if (Object.keys(idToTextRequest).length > 0) {
				translatedMap = await translateTextMap(idToTextRequest);
			}
			else {
				console.log('No strings to translate, skipping');
			}

			const finalTranslations = { ...prefills, ...translatedMap };

			for (const item of snapshotItems) {
				const node = item.node;
				const translatedText = finalTranslations[item.id] || item.original;
				if (!node.isConnected) continue;
				if (node.textContent !== item.original) continue;
				node.textContent = translatedText;
				const parent = node.parentElement;
				if (parent && parent.nodeType === Node.ELEMENT_NODE && !parent.hasAttribute('data-translated')) {
					parent.setAttribute('data-translated', 'true');
					parent.classList.remove('translating');
				}
				if (!translationCache.has(item.original)) {
					translationCache.set(item.original, translatedText);
				}
			}

			handleImages(nodeToTranslate);
		} catch (err) {
			console.error('translateContents error:', err);
		}
	}

	function traverseNode(node, nodeAction, index = 0) {
		if (!isNodeVisible(node)) {
			return index;
		}
		if (node.nodeType === Node.TEXT_NODE) {
			const text = node.textContent;
			if (text.trim() !== '' && /[A-Za-z]/.test(text)) {
				nodeAction(node, text, index);
				index++;
			}
		} else if (node.nodeType === Node.ELEMENT_NODE && node.tagName !== 'SCRIPT' && node.tagName !== 'STYLE' && !node.hasAttribute('data-translated')) {
			if (node.shadowRoot) {
				const shadowWalker = document.createTreeWalker(
					node.shadowRoot,
					NodeFilter.SHOW_TEXT + NodeFilter.SHOW_ELEMENT,
					{
						acceptNode: function (node) {
							if (node.nodeType === Node.ELEMENT_NODE) {
								if (node.tagName === 'SCRIPT' || node.tagName === 'STYLE') {
									return NodeFilter.FILTER_REJECT;
								}
								if (node.hasAttribute('data-translated')) {
									return NodeFilter.FILTER_REJECT;
								}
								if (!isNodeVisible(node)) {
									return NodeFilter.FILTER_REJECT;
								}
								return NodeFilter.FILTER_SKIP;
							}
							if (node.nodeType === Node.TEXT_NODE) {
								const parentElement = node.parentElement;
								if (parentElement && (!isNodeVisible(parentElement) || parentElement.hasAttribute('data-translated'))) {
									return NodeFilter.FILTER_REJECT;
								}
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
			for (let i = 0; i < node.childNodes.length; i++) {
				index = traverseNode(node.childNodes[i], nodeAction, index);
			}
		}
		return index;
	}

	function isNodeVisible(node) {
		if (node.nodeType !== Node.ELEMENT_NODE) {
			return true;
		}
		const style = window.getComputedStyle(node);
		return !(style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0');
	}

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
		const img = new Image();
		img.crossOrigin = "anonymous";
		const canvas = document.createElement('canvas');
		const ctx = canvas.getContext('2d');
		return new Promise((resolve, reject) => {
			img.onload = () => {
				canvas.width = img.width;
				canvas.height = img.height;
				ctx.drawImage(img, 0, 0);
				try {
					const dataUrl = canvas.toDataURL('image/png');
					resolve(dataUrl);
				} catch (error) {
					reject(error);
				}
			};
			img.onerror = (error) => reject(error);
			img.src = svgUrl;
		});
	}

	async function handleImages(node) {
		console.log('Handling images');
		const images = Array.from(node.querySelectorAll('img')).reverse();
		for (let img of images) {
			if (!img.hasAttribute('data-translated')) {
				img.classList.add('translating');
				let success;
				try {
					let imageUrl = img.src;
					if (imageUrl.toLowerCase().endsWith('.svg') || imageUrl.toLowerCase().includes('.svg?')) {
						try {
							imageUrl = await convertSvgToImage(img.src);
						} catch (error) {
							continue;
						}
					}
					const imageTexts = await extractAndTranslateTextFromImage(imageUrl);
					if (imageTexts && Object.keys(imageTexts).length > 0) {
						createImageTooltip(img, imageTexts);
					}
					success = true;
				} catch (error) {
					success = false;
				}
				img.setAttribute('data-translated', success ? 'true' : 'false');
				img.classList.remove('translating');
			}
		}
		console.log('Images handled');
	}

	async function extractAndTranslateTextFromImage(imageUrl) {
	//TODO: on https://brilliant.org/home/ , image translation fires too much due to having too many images, ends up triggering "too many requests" error on api side. we should add a size detection to the image and if it's too big, we should not translate it. Other heuristics based purely on the normal content of brilliant itself could also be added, such as skipping badges. 
	//TODO: add caches for images too, based on the url.

		console.log('extracting and translating text from image ' + imageUrl);
		const messages = [
			{
				role: "user",
				content: [
					{ type: "text", text: "If there's any text in this image, create a reply with the texts in english and their translations in spanish. The reply must be a json array with the texts in english as keys and their translations in spanish as values. if there isn't any text, reply with an empty array. Exclude any items whose translation remains the same" },
					{ type: "image_url", image_url: { url: imageUrl } }
				]
			}
		];
		const content = await callOpenAI(messages, true);
		console.log('image translation response: ' + content);
		const responseJson = JSON.parse(content);
		return responseJson;
	}

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
		img.addEventListener('mouseover', () => { tooltip.style.display = 'block'; });
		img.addEventListener('mouseout', () => { tooltip.style.display = 'none'; });
	}

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
				const childWithShadow = Array.from(node.children).find(child => child.shadowRoot);
				if (childWithShadow) {
					const shadowWalker = document.createTreeWalker(
						childWithShadow.shadowRoot,
						NodeFilter.SHOW_TEXT,
						{
							acceptNode: function (textNode) {
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

	function describeMutations(mutations, callId) {
		try {
			return mutations.map((mutation, index) => {
				const target = mutation.target;
				let description = `[${callId}-${index}] ${mutation.type}`;
				if (target.nodeType === Node.ELEMENT_NODE) {
					description += ` on <${target.tagName.toLowerCase()}`;
					if (target.id) description += ` id="${target.id}"`;
					if (target.className) description += ` class="${target.className.substring(0, 30)}${target.className.length > 30 ? '...' : ''}"`;
					description += `>`;
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
					if (mutation.addedNodes.length > 0) {
						const addedContent = Array.from(mutation.addedNodes).map(node => describeNode(node)).join(', ');
						description += ` [added: ${addedContent}]`;
					}
					if (mutation.removedNodes.length > 0) {
						const removedContent = Array.from(mutation.removedNodes).map(node => describeNode(node)).join(', ');
						description += ` [removed: ${removedContent}]`;
					}
				}
				return description;
			}).join('\n    ');
		} catch (e) {
			return 'Error describing mutations';
		}
	}

	async function handleMutationWithDebouncing(mutations) {
		mutationCallCount++;
		const currentCallId = mutationCallCount;
		const timestamp = new Date().toISOString().split('T')[1]?.split('.')[0];
		console.log(`🔍 [Translator] MUTATION CALL #${currentCallId} at ${timestamp}`);
		// console.log(`📝 [Translator] Received ${mutations.length} mutations:`);
		// console.log(`    ${describeMutations(mutations, currentCallId)}`);
		if (mutationDebounceTimeout) {
			clearTimeout(mutationDebounceTimeout);
			mutationDebounceTimeout = null;
		}
		mutationDebounceTimeout = setTimeout(async () => {
			await performDebouncedTranslation(mutations);
			mutationDebounceTimeout = null;
		}, MUTATION_DEBOUNCE_DELAY);
	}

	async function performDebouncedTranslation(mutations) {
		stopMutationObserver();
		const nowMs = Date.now();
		translationRunTimestamps.push(nowMs);
		translationRunTimestamps = translationRunTimestamps.filter(ts => ts > nowMs - LOOP_GUARD_WINDOW_MS); //container of the past timestamps. by filtering, we know which items are inside the allowed window; then it's just a matter of counting. 
		if (translationRunTimestamps.length > LOOP_GUARD_MAX_RUNS) {
			console.warn('[Translator] Loop safeguard triggered; stopping live translation');
			loopGuardTripped = true;
			//turn off auto translation, to reflect the state in the UI. And also it can be turned back on. otherwise it's off but user can't see why unless the page is reloaded.
			liveTranslationEnabled = false;
			chrome.storage.sync.set({ liveTranslationEnabled: false });
			stopMutationObserver();
			return;
		}
		for (let mutation of mutations) {
			if (mutation.type === 'characterData') {
				const parent = mutation.target.parentElement;
				if (parent && parent.nodeType === Node.ELEMENT_NODE && parent.hasAttribute('data-translated')) {
					parent.removeAttribute('data-translated');
				}
			}
		}
		await translateContents(document.documentElement);
		if (!loopGuardTripped) {
			startMutationObserver();
		}
	}

	function clearAllTranslatedMarkers(root) {
		try {
			const translatedEls = root.querySelectorAll('[data-translated]');
			const translatingEls = root.querySelectorAll('.translating');
			const tooltips = root.querySelectorAll('.image-translation-tooltip');
			translatedEls.forEach(el => el.removeAttribute('data-translated'));
			translatingEls.forEach(el => el.classList.remove('translating'));
			tooltips.forEach(el => el.remove());
			console.log(`Cleared markers: data-translated=${translatedEls.length}, translating=${translatingEls.length}, tooltips=${tooltips.length}`);
		} catch (e) {}
	}

	function addTranslationStyle() {
		const loadingStyle = `
			@keyframes translateWave {
				0% { background-position: 200% 50%; }
				100% { background-position: 0% 50%; }
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
		if (!document.querySelector('style[data-translation-style]')) {
			const styleElement = document.createElement('style');
			styleElement.textContent = loadingStyle;
			styleElement.setAttribute('data-translation-style', 'true');
			document.head.appendChild(styleElement);
		}
		const addStyleToShadowRoot = (node) => {
			if (node.nodeType === Node.ELEMENT_NODE) {
				if (node.shadowRoot && !node.shadowRoot.querySelector('style[data-translation-style]')) {
					const shadowStyle = document.createElement('style');
					shadowStyle.textContent = loadingStyle;
					shadowStyle.setAttribute('data-translation-style', 'true');
					node.shadowRoot.insertBefore(shadowStyle, node.shadowRoot.firstChild);
				}
				node.childNodes.forEach(child => addStyleToShadowRoot(child));
			}
		};
		addStyleToShadowRoot(document.documentElement);
	}

	async function callOpenAI(messages, jsonResponse = false) {
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

	function installIdleMonitors() {
		if (idleMonitorsInstalled) return;
		idleMonitorsInstalled = true;
		try {
			// Track DOM activity
			domActivityObserver = new MutationObserver(() => {
				lastDomActivityMs = Date.now();
			});
			try {
				domActivityObserver.observe(document.documentElement, {
					childList: true,
					subtree: true,
					characterData: true
				});
			} catch (e) {}

			// Track fetch activity
			const originalFetch = window.fetch;
			if (typeof originalFetch === 'function') {
				window.fetch = function () {
					networkRequestsInFlight++;
					lastNetworkActivityMs = Date.now();
					try {
						const p = originalFetch.apply(this, arguments);
						return p.finally(() => {
							networkRequestsInFlight = Math.max(0, networkRequestsInFlight - 1);
							lastNetworkActivityMs = Date.now();
						});
					} catch (e) {
						networkRequestsInFlight = Math.max(0, networkRequestsInFlight - 1);
						lastNetworkActivityMs = Date.now();
						throw e;
					}
				};
			}

			// Track XHR activity
			const OriginalXHR = window.XMLHttpRequest;
			if (OriginalXHR && OriginalXHR.prototype) {
				const originalSend = OriginalXHR.prototype.send;
				OriginalXHR.prototype.send = function () {
					networkRequestsInFlight++;
					lastNetworkActivityMs = Date.now();
					this.addEventListener('loadend', () => {
						networkRequestsInFlight = Math.max(0, networkRequestsInFlight - 1);
						lastNetworkActivityMs = Date.now();
					});
					return originalSend.apply(this, arguments);
				};
			}
		} catch (e) {}
	}

	//These functions and the above is to ensure that the page is idle before auto translation starts on load. They track when the last activity was, somewhat heuristics based. 
	function scheduleAutoTranslateWhenIdle() {
		installIdleMonitors();
		if (idleCheckTimeout) {
			clearTimeout(idleCheckTimeout);
			idleCheckTimeout = null;
		}
		const checkIdleAndStart = () => {
			if (!liveTranslationEnabled || loopGuardTripped) return;
			if (translatorRunning) return;
			if (document.readyState !== 'complete') {
				window.addEventListener('load', () => {
					scheduleAutoTranslateWhenIdle();
				}, { once: true });
				return;
			}
			const now = Date.now();
			const networkIdle = networkRequestsInFlight === 0 && (now - lastNetworkActivityMs) >= 1000;
			const domIdle = (now - lastDomActivityMs) >= 800;
			if (networkIdle && domIdle) {
				startAutoTranslateForPage();
				idleCheckTimeout = null;
			} else {
				idleCheckTimeout = setTimeout(checkIdleAndStart, 250);
			}
		};
		idleCheckTimeout = setTimeout(checkIdleAndStart, 0);
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', initializeTranslator);
	} else {
		initializeTranslator();
	}
})();