---
title: Practice set
byline: postdraft
status: Open
---

One question of each kind. Answers save as you type and again when you press Check or Save.

## Free text

```question
{"id":"name","kind":"short","prompt":"Which course is this for?"}
```

```question
{"id":"bigo","kind":"long","prompt":"Why is merge sort $O(n \\log n)$?",
 "answer":"Each of the $\\log n$ levels does $O(n)$ merge work.",
 "explain":"Count the work per level of the recursion tree, then the levels."}
```

## Numbers

```question
{"id":"frac","kind":"number","prompt":"What fraction of $\\{1,2,3\\}$ is odd? A decimal or a fraction like `2/3`.",
 "answer":"2/3","tolerance":0.005}
```

## Choices

```question
{"id":"cap","kind":"choice","prompt":"Which one is a **stable** sort?",
 "options":["Quicksort","Merge sort","Heapsort"],"answer":"Merge sort",
 "explain":"Merge takes from the left run on ties, so equal keys keep their order."}
```

```question
{"id":"primes","kind":"multi","prompt":"Pick every prime.","options":["2","9","11","15"],"answer":["2","11"]}
```
