document.addEventListener('DOMContentLoaded', (event) => {
    document.getElementById('run-script').addEventListener('click', () => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            chrome.scripting.executeScript({
                target: { tabId: tabs[0].id },
                func: async () => {

                    const textStrings = [];

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

                    // Extract text strings
                    traverseNode(document.documentElement, (node, text, index) => {
                        textStrings[index] = text;
                    });

                    const apiKey = '[redacted]';
                    // anterior problemas:
                    // en https://brilliant.org/courses/logic-deduction/introduction-68/strategic-deductions-2/1/ no traduce el botón.
                    // en https://brilliant.org/courses/logic-deduction/introduction-68/strategic-deductions-2/2/ si se tradujo, al apretar continue se rompe todo, entra en un loop asqueroso
                    // en https://brilliant.org/courses/logic-deduction/introduction-68/extra-practice-25/2/, después de traducir, al cambiar, la página queda en blanco.
                    // https://brilliant.org/courses/logic-deduction/introduction-68/extra-practice-25/1/, los dígitos aparecen 3 veces.
                    // https://brilliant.org/courses/logic-deduction/introduction-68/extra-practice-25/2/ empezar de nuevo/continuar aparecen en el lugar incorrecto. también en la descripción del problema, #555 pasa a ser 55
                    // https://brilliant.org/courses/logic-deduction/introduction-68/extra-practice-25/3/, también problemas con el $, similar a arriba.

                    // problemas actuales: 
                    // https://brilliant.org/courses/logic-deduction/introduction-68/strategic-deductions-2/5/ las ayudas del costado no se traducen; solo la visible, y cuando cambia, esta otra vez en inglés
                    // https://brilliant.org/courses/logic-deduction/introduction-68/strategic-deductions-2/5/ la imagen con el juego no se traduce
                    // https://brilliant.org/courses/logic-deduction/introduction-68/extra-practice-25/2/ Cartel de "practice" arribe no se traduce porque es una imagen.
                    // https://brilliant.org/courses/logic-deduction/introduction-68/strategic-deductions-2/5/ a veces se rompe, pero no si se carga directamente, solo si se viene de otr apágina traducida
                    // tampoco se traducen las ayudas del costado y eso.

                    // https://brilliant.org/courses/logic-deduction/introduction-68/extra-practice-25/3/ el orden de la traducción es incorrecto dado que se traducen los elementos html uno a uno.
                    //en https://brilliant.org/courses/logic-deduction/introduction-68/strategic-deductions-2/3/, no mantiene los espacios, "en el pasillo". agregar una función para reclamar los espacios. 
                    //en https://brilliant.org/courses/logic-deduction/introduction-68/strategic-deductions-2/3/, si se mueven los muñecos y luego de traduce; no se traducen "aisle, center, window" porque no se veían.

                    function toIndexedObject(array) {
                        const indexedObject = array.reduce((obj, text, index) => {
                            obj[index] = text;
                            return obj;
                        }, {});
                        return indexedObject;
                    }
                    
                    // Function to translate text using OpenAI API.
                    const translateText = async (texts) => {
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
                                model: "gpt-4o",
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

                    console.log("starting translation...");
                    const translatedTexts = await translateText(textStrings);
                    console.log("translation finished");

                    const translatedObject = JSON.parse(translatedTexts)
                    // Replace text nodes
                    traverseNode(document.documentElement, (node, text, index) => {
                        const translatedText = translatedObject[index] || text;
                        node.textContent = translatedText;
                        const parent = node.parentElement;
                        if (parent && parent.nodeType === Node.ELEMENT_NODE && !parent.hasAttribute('data-translated')) {
                            parent.setAttribute('data-translated', 'true');
                        }
                    });
                }
            });
        });
    });
});
