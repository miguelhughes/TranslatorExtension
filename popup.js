document.addEventListener('DOMContentLoaded', (event) => {
    document.getElementById('run-script').addEventListener('click', () => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            chrome.scripting.executeScript({
                target: { tabId: tabs[0].id },
                func: async () => {


                    //on start, translate the whole visible page.
                    await translateContents(document.documentElement); 
                    
                    //translation complete. 
                    // Set up observer for new content
                    const observer = new MutationObserver(translateNewContent);
                    startMutationObserver();

                    // Functions below.
                    async function translateContents(nodeToTranslate)
                    {
                        const textStrings = [];
                            
                        // Extract text strings
                        traverseNode(nodeToTranslate, (node, text, index) => {
                            textStrings[index] = text;
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
                            }
                        });
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
                        const apiKey = '[redacted]';
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

// problemas actuales: 
// https://brilliant.org/courses/logic-deduction/introduction-68/strategic-deductions-2/5/ las ayudas del costado no se traducen; solo la visible, y cuando cambia, esta otra vez en inglés
// https://brilliant.org/courses/logic-deduction/introduction-68/strategic-deductions-2/5/ la imagen con el juego no se traduce
// https://brilliant.org/courses/logic-deduction/introduction-68/extra-practice-25/2/ Cartel de "practice" arribe no se traduce porque es una imagen.
// https://brilliant.org/courses/logic-deduction/introduction-68/strategic-deductions-2/5/ a veces se rompe, pero no si se carga directamente, solo si se viene de otr apágina traducida
// tampoco se traducen las ayudas del costado y eso.

// https://brilliant.org/courses/logic-deduction/introduction-68/extra-practice-25/3/ el orden de la traducción es incorrecto dado que se traducen los elementos html uno a uno.
//en https://brilliant.org/courses/logic-deduction/introduction-68/strategic-deductions-2/3/, no mantiene los espacios, "en el pasillo". agregar una función para reclamar los espacios. 
//en https://brilliant.org/courses/logic-deduction/introduction-68/strategic-deductions-2/3/, si se mueven los muñecos y luego de traduce; no se traducen "aisle, center, window" porque no se veían.
