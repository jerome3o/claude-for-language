# New characters shimmer

银子 has been reviewed, so 银 is seen; the new word 银行 arrives and only 行 shimmers.
Phone viewport (412×915, 2×). Mid-sweep frames are frozen at a point of the animation.

## Web

![Read card, mid-sweep](web-01-read-card-mid-shimmer.png)
The read card's question: the warm band sweeping across 行, with a faint glow.

![Read card, between sweeps](web-02-read-card-at-rest.png)
Between sweeps (most of the 3.6 s cycle): 行 keeps its own colour with the faint glow.

![Answer side](web-03-answer-side.png)
The answer side: still only 行, inside its own tap target for the explorer.

![Reduced motion](web-04-reduced-motion.png)
`prefers-reduced-motion`: no movement, a static warm tint and the glow.

![Settings](web-05-settings.png)
Settings → Study → "Shimmer new characters" (on by default, per device).

The web study card has no dark theme, so there is no web dark shot; the CSS defines the paler sheen
for `data-theme="dark"`.

## Lab app

![Lab read card, mid-sweep](lab-01-front.png)
The Lab read card, mid-sweep.

![Lab dark](lab-02-front-dark.png)
Dark theme: a paler gold band.

![Lab answer side](lab-03-back.png)
The answer side.

![Lab with animations off](lab-04-static.png)
"Remove animations" (animator duration scale 0): the static tint, on the answer side (the question face too).

![Lab settings](lab-05-settings.png)
Settings → Study → "Shimmer new characters".
