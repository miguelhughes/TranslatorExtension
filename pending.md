- cancel ongoing translations when navigating away from page. probar: ir a home y antes de que termine auto translation, ir a otro lado. queda traduciendo cosas que ya no hace falta.

- we need to add some heuristics skipping. numbers only should be skipped. single letters too:
image translation response: {
  "4": "4",
  "2": "2",
  "14": "14",
  "12": "12",
  "5": "5",
  "13": "13",
  "6": "6",
  "11": "11",
  "1": "1",
  "8": "8",
  "3": "3",
  "10": "10"
}
image translation response: {
  "x": "x",
  "<": "<",
  "~": "~",
  "+": "+"
}
- Tamaño mínimo para imágenes 
- Hay algunas cosas que ir no traduce bien (en el de los dados y par impar),

- it'd be nice that if there's a failure on the api side, the styles are removed. maybe even add a red fadout or smth. on errors also the green style should be removed. it looks like it¡s translating but it actually failed. for exapmle, api too many requests or incorrect key.

- en https://brilliant.org/courses/math-fundamentals/?from_llp=foundational-math, al navegar en los diferentes items, el cosito de "saltar adelante" no se traduce. parece uno de esos problemas de que se pierde el mutation.

- https://brilliant.org/courses/logic-deduction/enter-the-code/order-ch-2/?from=icp_node&from_llp=logical-reasoning looks like images are being tranlated too much. might need some research but on the robots practice ordering it fires a lot

- right now mutation observer is turned off during translation. An improvement idea would be that if there's a translation in course and due to a scroll or page activity, another mutation occurs, then those mutations will be discarded because the mutation observer is turned off. So a way to improve this would be that we somehow enqueue those mutations or hold them off and then once the translation is done, we trigger another translation with whatever was changed in the meantime. 
one implementation draft similar to this was done by AI, items where marked dirty when processing mutations. if we hold off triggering a second translation and flag them all as dirty, then we can trigger a second translation with the dirty items. as long as the text matches, we'll add it to the cache, potentially the second translation will use items from cache and potentially skip the api call.
so, to recap: keep observer on at all times. handling mutations means just flagging items as dirty. once api call comes back, if there are dirty items, the translation is triggered again with the dirty items.
we still need it to be off, at least when applying our own updates to the text as mutations.

- If later we implement translation cancelling when dom changes, we maybe able to remove scheduleAutoTranslateWhenIdle and trigger startAutoTranslateForPage on page load as it was before. 

