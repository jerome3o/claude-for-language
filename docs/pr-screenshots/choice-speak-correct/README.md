# "Which sentence is wrong?" choices speak the correction

Phone viewport 412×915 @2× (full-page). Web light, Lab dark.

## Web

**Before:** the reveal treats the wrong sentence as the model answer. It has a ▶, and the pick plus the prefetch spoke `他了去北京。`.

![Before](web-00-before.png)

**After, with a lesson `correction`:** the mistake is struck through, says "✗ This sentence has the mistake", and has no ▶. "✓ Correct:" shows `他去北京了。` with ▶, and that is the sentence spoken.

![After: correction](web-01-after-correction.png)

**After, older lesson:** the correction comes from `POST /api/lessons/choice-correction` (the E2E stand-in model).

![After: fetched](web-02-after-older-fetched.png)

**After, no connection:** "The correct version needs a connection." No ▶ and nothing spoken for the mistake.

![After: offline](web-03-after-offline.png)

## Lab app

**With the correction:** struck mistake without ▶, then "✓ Correct:" with ▶.

![Lab correction](lab-01-correction.png)

**Offline, older lesson:**

![Lab offline](lab-02-offline.png)
