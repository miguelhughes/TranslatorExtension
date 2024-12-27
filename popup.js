document.addEventListener('DOMContentLoaded', (event) => {
    document.getElementById('run-script').addEventListener('click', () => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            chrome.scripting.executeScript({
                target: { tabId: tabs[0].id },
                func: async () => {

                    const apiKey = '[redacted]';
                    addTranslationStyle();

                    //on start, translate the whole visible page.
                    await translateContents(document.documentElement); 
                    
                    //translation complete. 
                    // Set up observer for new content
                    //const observer = new MutationObserver(translateNewContent);
                    //startMutationObserver();

                    // Functions below.
                    async function translateContents(nodeToTranslate)
                    {
                        const textStrings = [];
                            
                        // Extract text strings
                        traverseNode(nodeToTranslate, (node, text, index) => {
                            textStrings[index] = text;
                            if (node.parentElement && node.parentElement.nodeType === Node.ELEMENT_NODE) {
                                node.parentElement.classList.add('translating');
                            }
                        });

                        if (textStrings.length === 0) {
                            console.log("no strings to translate, translation skipped");
                            return;
                        }

                        console.log("starting translation...");
                        const translatedTexts = await translateText(textStrings);
                        console.log("translation finished");
                        
                        const translatedObject = parseTranslationResponse(textStrings, translatedTexts);
                        
                        // Replace text nodes
                        traverseNode(nodeToTranslate, (node, text, index) => {
                            const translatedText = translatedObject[index] || text;
                            node.textContent = translatedText;
                            const parent = node.parentElement;
                            if (parent && parent.nodeType === Node.ELEMENT_NODE && !parent.hasAttribute('data-translated')) {
                                parent.setAttribute('data-translated', 'true');
                                parent.classList.remove('translating');
                            }
                        });

                        // Handle images
                        handleImages(nodeToTranslate);
                    }

                    async function translateNewContent(mutations) {

                        stopMutationObserver();
                        for (let mutation of mutations) {
                            if (mutation.type === 'childList') {
                                // for (let node of mutation.addedNodes) {
                                //     await translateContents(node);
                                // }
                            } else if (mutation.type === 'characterData') {
                                const parent = mutation.target.parentElement;
                                if (parent.nodeType === Node.ELEMENT_NODE && parent.hasAttribute('data-translated')) {
                                    parent.removeAttribute('data-translated');
                                }
                                // if (mutation.oldValue != mutation.target.textContent){ //apparently sometimes this mutation get's called but the text is the same, so no point in translating
                                    // await translateContents(mutation.target);
                                // }
                            }
                        }

                        // await translateContents(document.documentElement);
                        startMutationObserver();

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
                            // If it's an element node, recursively traverse its child nodes
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


                    function toIndexedObject(array) {
                        const indexedObject = array.reduce((obj, text, index) => {
                            obj[index] = text;
                            return obj;
                        }, {});
                        return indexedObject;
                    }
                    
                    // Function to translate text using OpenAI API.
                    async function translateText(texts) {
                        const indexedObject = toIndexedObject(texts);
                        console.log(`indexedObject: '${indexedObject}'`);
                        var stringArray = JSON.stringify(indexedObject);
                        console.log(`stringArray: '${stringArray}'`);

                        const response = await fetch('https://api.openai.com/v1/chat/completions', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${apiKey}`,
                            },
                            body: JSON.stringify({
                                model: "gpt-4o-mini",
                                messages: [
                                    {
                                        role: "system",
                                        content: "You will be provided with a list of sentences, belonging to a website, and your task is to translate them into spanish, considering the whole text as context",
                                    },
                                    {
                                        role: "user",
                                        content: stringArray,
                                    }
                                ],
                                temperature: 0,
                                top_p: 1,
                                n: 1,
                                stream: false,
                                max_tokens: 2000,
                                presence_penalty: 0,
                                frequency_penalty: 0
                            }),
                        });
                        const data = await response.json();
                        const content = data.choices[0].message.content;
                        console.log(`translated result: '${content}'`);

                        return content;
                    };
                    
                    // handle image translation
                    async function handleImages(node) {
                        console.log('handling images');
                        const images = Array.from(node.querySelectorAll('img')).reverse();
                        for (let img of images) {
                            if (!img.hasAttribute('data-translated')) {
                                img.classList.add('translating');
                                let success;
                                try {
                                    const imageTexts = await extractAndTranslateTextFromImage(img.src);
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
                        const response = await fetch('https://api.openai.com/v1/chat/completions', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${apiKey}`,
                            },
                            body: JSON.stringify({
                                model: "gpt-4o-mini",
                                messages: [
                                    {
                                        role: "user",
                                        content: [
                                            {
                                                type: "text",
                                                text: "If there's any text in this image, create a reply with the texts in english and their translations in spanish. The reply must be a json array with the texts in english as keys and their translations in spanish as values. if there isn't any text, reply with an empty array. Exclude any items whose translation remains the same (symbols, acronyms, names, etc.)"
                                            },
                                            {
                                                type: "image_url",
                                                image_url: {
                                                    url: imageUrl
                                                }
                                            }
                                        ]
                                    }
                                ],
                                max_tokens: 300,
                                response_format: { 
                                    type: "json_object"
                                }
                            }),
                        });

                        try {
                            throw new Error('error');
                        } catch (error) {
                            
                        }

                        const data = await response.json();
                        const content = data.choices[0].message.content;
                        console.log('image translation response: ' + content);
                        const responseJson = JSON.parse(content);
                        
                        //log the amount of items the json response has, considering that it's akey value object, not an array
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


                    function startMutationObserver(){

                        observer.observe(document.body, {
                            childList: true,
                            subtree: true,
                            characterData: true,
                            characterDataOldValue: true
                        });
                    }

                    function stopMutationObserver() {
                        observer.disconnect();
                    }

                    function parseTranslationResponse(originalTexts, translatedTexts) {
                        var translatedObject;
                        try {
                            translatedObject = JSON.parse(translatedTexts)
                        } catch (ex) {
                            // sometimes if the request has just one entity, it doesn't return an array, but a string. In that case, we need to convert it to an array.
                            if (originalTexts.length == 1) {
                                translatedObject = [translatedTexts];
                            }
                            else
                            {
                                throw ex;
                            }
                        }
                        return translatedObject;
                    }

                    function addTranslationStyle() {
                        if (document.querySelector('style[data-translation-style]'))
                            return;

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


                            // Tooltip arrow
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

                        const styleElement = document.createElement('style');
                        styleElement.textContent = loadingStyle;
                        styleElement.setAttribute('data-translation-style', 'true');
                        document.head.appendChild(styleElement);
                    }

                }
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
// some SVGs aren't supported. https://brilliant.org/courses/logic-deduction/introduction-68/strategic-deductions-2/2/ and also the one with the knights and knaves.
