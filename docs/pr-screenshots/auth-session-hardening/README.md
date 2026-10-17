# Sign-in hardening — screenshots

![Settings: Sign out + Sign out of all devices](01-web-settings-signout.png)
Web Settings: **Sign out** (now revokes this session on the server) and the new **Sign out of all devices…**.

![The in-page confirm](02-web-signout-everywhere-confirm.png)
Web: the in-page confirm before every session of the account is revoked.

![A code this browser never asked for](03-web-foreign-code-refused.png)
Web: a `?code=` link minted for someone else's sign-in signs nobody in (login CSRF) and says why.

![Lab app: the same confirm](04-lab-signout-everywhere-confirm.png)
Lab app Settings: Sign out of all devices… → confirm dialog (Roborazzi `settings-12-sign-out-everywhere`).
