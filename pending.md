it'd be nice if there's a failure on the api side, the styles are removed. maybe even add a red fadout or smth.
we need to add some heuristics skipping. numbers only should be skipped. single letters too:
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

https://brilliant.org/courses/logic-deduction/enter-the-code/order-ch-2/?from=icp_node&from_llp=logical-reasoning looks like images are being tranlated too much. might need some research but on the robots practice ordering it fires a lot

//cancel ongoing translations when navigating away from page. probar: ir a home y antes de que termine auto translation, ir a otro lado. queda traduciendo cosas que ya no hace falta.