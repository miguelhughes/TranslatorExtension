document.addEventListener('DOMContentLoaded', (event) => {
    document.getElementById('run-script').addEventListener('click', () => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            chrome.scripting.executeScript({
                target: { tabId: tabs[0].id },
                func: async () => {

                    var htmlString = document.documentElement.innerHTML;

                    const textStrings = extractTextStrings(htmlString);
                    console.log(textStrings);

                    function extractTextStrings(htmlString) {
                        // Create a temporary container element to parse the HTML
                        const container = document.createElement('div');
                        container.innerHTML = htmlString;

                        // Define a recursive function to traverse the DOM tree
                        //TODO: exclude elements that are not visible
                        function traverseNode(node, textStrings) {
                            if (node.nodeType === Node.TEXT_NODE) {
                            // If it's a text node, add the text content to the array
                            const text = node.textContent;
                            if (text.trim() !== '') {
                                textStrings.push(text);
                            }
                            } else if (node.nodeType === Node.ELEMENT_NODE && node.tagName !== 'SCRIPT' && node.tagName !== 'STYLE') {
                            // If it's an element node, recursively traverse its child nodes
                            for (let i = 0; i < node.childNodes.length; i++) {
                                traverseNode(node.childNodes[i], textStrings);
                            }
                            }
                        }

                        // Initialize an empty array to store text strings
                        const textStrings = [];

                        // Traverse the DOM tree starting from the container element
                        traverseNode(container, textStrings);

                        return textStrings;
                    }

                    const apiKey = '[redacted]'; 
                    // anterior problemas:
                    // en https://brilliant.org/courses/logic-deduction/introduction-68/strategic-deductions-2/1/ no traduce el botón.
                    // en https://brilliant.org/courses/logic-deduction/introduction-68/strategic-deductions-2/2/ si se tradujo, al apretar continue se rompe todo, entra en un loop asqueroso
                    // en https://brilliant.org/courses/logic-deduction/introduction-68/extra-practice-25/2/, después de traducir, al cambiar, la página queda en blanco.
                    // https://brilliant.org/courses/logic-deduction/introduction-68/extra-practice-25/1/, los dígitos aparecen 3 veces.

                    // problemas actuales: continuar acá. ver si hacer mas rápido o solucionar los problemas de abajo.
                    // https://brilliant.org/courses/logic-deduction/introduction-68/strategic-deductions-2/5/ las ayudas del costado no se traducen; solo la visible, y cuando cambia, esta otra vez en inglés
                    // https://brilliant.org/courses/logic-deduction/introduction-68/strategic-deductions-2/5/ la imagen con el juego no se traduce
                    // https://brilliant.org/courses/logic-deduction/introduction-68/strategic-deductions-2/5/ a veces se rompe, pero no si se carga directamente, solo si se viene de otr apágina traducida
                    // https://brilliant.org/courses/logic-deduction/introduction-68/extra-practice-25/2/ indices cruzados, traduce en orden distinto. también en la descripción del problema, #555 pasa a ser 55
                    // https://brilliant.org/courses/logic-deduction/introduction-68/extra-practice-25/3/, también problemas con el $, similar a arriba.
                    // tampoco se traducen las ayudas del costado y eso.
                    // Function to translate text using OpenAI API.

                    function toIndexedObject(array) {
                        const indexedObject = array.reduce((obj, text, index) => {
                        obj[index] = text;
                        return obj;
                        }, {});
                        return indexedObject;
                    }

                    const translateText = async (texts) => {
                        const indexedObject = toIndexedObject(texts);
                        console.log(`indexedObject: '${indexedObject}'`);
                        var stringArray = JSON.stringify(indexedObject);
                        console.log(`stringArray: '${stringArray}'`);
                        //cont here. we're working on the prompt. 

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

                    function replaceTextNodesInPlace(translatedJSON) {
                        let index = 0;

                        // Define a recursive function to traverse the DOM tree
                        function traverseNode(node) {
                            if (node.nodeType === Node.TEXT_NODE) {
                            // If it's a text node, replace its text content
                            const text = node.textContent;
                            if (text.trim() !== '') {
                                const translatedText = translatedJSON[index] || text;
                                node.textContent = translatedText;
                                index++;
                            }
                            } else if (node.nodeType === Node.ELEMENT_NODE && node.tagName !== 'SCRIPT' && node.tagName !== 'STYLE') {
                            // If it's an element node, recursively traverse its child nodes
                            for (let i = 0; i < node.childNodes.length; i++) {
                                traverseNode(node.childNodes[i]);
                            }
                            }
                        }

                        // Traverse the DOM tree starting from the document element
                        traverseNode(document.documentElement);
                    }

                    console.log("starting translation...");
                    const translatedTexts = await translateText(textStrings);
                    console.log("translation finished");
                    replaceTextNodesInPlace(JSON.parse(translatedTexts));
                }
            });
        });
    });
});

