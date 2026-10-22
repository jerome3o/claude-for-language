# The retry progress bar in the homework pass (docs/HOMEWORK.md §3c)

Blue = answers given (every Got it and every Not yet), hatched orange with "↺ N" = Not yet words still owed, at the right end. Phone viewport 412×915.

## Web

![Start](web-01-start.png)
Start: 8 words, nothing answered.

![After Not yet](web-02-after-not-yet.png)
2 Got it + 3 Not yet: the blue moved 5 of 11 slots, the orange holds the 3 owed words ("↺ 3", "3 to try again").

![On retries](web-03-on-retries.png)
Every word shown once: the blue has reached the orange — "Trying again · 3 left".

![Not yet on a retry](web-04-not-yet-on-a-retry.png)
A Got it on a retry ate one orange slot; another Not yet adds a slot and keeps the orange.

![After undo](web-05-after-undo.png)
↺ undo of that Not yet: the bar goes back exactly.

![Dark colour scheme](web-06-on-retries-dark-scheme.png)
The web app has no dark theme yet (light under a dark system scheme); the bar has `[data-theme='dark']` tones ready.

## Lab app (Roborazzi)

![Lab start](lab-01-start.png)
Start.

![Lab after Not yet](lab-02-after-not-yet.png)
After 3 × Not yet.

![Lab on retries](lab-03-on-retries.png)
Blue meets orange: on retries.

![Lab on retries, dark](lab-04-on-retries-dark.png)
The same, dark.

![Lab states](lab-05-states.png)
Every state of the bar: start, after Not yet, on retries, last retry, done (full blue).

![Lab states, dark](lab-06-states-dark.png)
The same, dark.
