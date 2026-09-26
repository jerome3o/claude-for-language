# Sentence Coach reliability — screenshots

Phone, 412×915 @2×. The coach's AI reply is stubbed at the network level for 02/03.

![Before](01-before.png)
Before (Jerome's screenshot): every failure read "Couldn't reach the coach", and the cause was a truncated reply, not the connection.

![After — error](02-after-error-with-reason.png)
After: when a failure outlasts the server's retries and the app's automatic retry, the real reason plus **Try again**; the typed sentence is kept.

![After — answer](03-after-retry-answer.png)
Try again → the answer.
