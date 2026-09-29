# Picture hunt (看图找词) — screenshots

Web app at the phone viewport (412×915, 2×) unless noted. The picture is a test scene drawn with emoji
(seeded through `POST /api/test/picture-hunt` — no Gemini / Claude in these shots); half the objects
carry an outline polygon (octagons), half fall back to their box.

![List](01-list.png)
List: make a picture (scene chips, "lean toward words I'm learning"), a ready hunt, one building (progress breadcrumb), one failed with Retry.

![Upload](02-list-upload.png)
"Use a photo" mode: resized on the phone, sent without location data.

![Playing](03-play.png)
Playing: 5 found (green outlines + labels), a hint (dashed amber outline, 植＿), toneless pinyin gets "add the tones".

![Found via an alternative](04-play-found-alt.png)
一根香蕉 is accepted (measure word dropped).

![Reveal](05-reveal.png)
Give up → everything revealed (missed in orange), score and best.

![Sheet](06-reveal-sheet.png)
Tap an object: hanzi, pinyin, English, ▶, example sentence, explanation, + Add as card.

![Unfolded](07-unfolded-play.png)
1024px wide (unfolded Fold / tablet): picture beside the answer box.

![More](08-more-practice.png)
More → Practice → Picture hunt.

Lab app screenshots (Roborazzi): [lab/](lab/)
