Fonts for the social-media cards drawn by `src/social/card.ts`.

`MatyanCard-{Regular,Bold}.ttf` are Noto Sans (Latin, digits, punctuation)
merged into Noto Sans Armenian by `build-card-fonts.py`, so one family covers
both scripts — see the comment in card.ts for why two families failed.

To rebuild: put `NotoSans-{Regular,Bold}.ttf` here (from
https://github.com/notofonts/notofonts.github.io, fonts/NotoSans/hinted/ttf),
then `python build-card-fonts.py` (needs `pip install fonttools`).

All Noto fonts are licensed under the SIL Open Font License 1.1
(https://openfontlicense.org), which permits bundling and modifying them.
