window.prependToDivs = () => {
    const prependWord = "hola tommy:"; // The word to prepend

    // Function to prepend word to each div
    const divs = document.querySelectorAll('div:not(.prepended)');
    divs.forEach(div => {
        div.textContent = prependWord + " " + div.textContent;
        div.classList.add('prepended');
    });
}