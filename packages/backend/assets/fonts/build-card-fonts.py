"""
Build the two card fonts: Noto Sans (Latin, digits, punctuation) merged with
Noto Sans Armenian, into one family "Matyan Card".

Why: resvg drops whole lines when a line switches font families mid-way, and
Noto Sans Armenian has no digits, «%» or «,». One font covering both scripts
means no line ever switches. Re-run after replacing a source font:

    python build-card-fonts.py
"""
from fontTools import subset
from fontTools.merge import Merger
from fontTools.ttLib import TTFont

LATIN = (
    "U+0020-007E,U+00A0-00FF,U+2010-2027,U+2030,U+2039-203A,U+20AC,U+2116,U+2122,U+2190-2193,U+2212"
)

for weight in ("Regular", "Bold"):
    latin = TTFont(f"NotoSans-{weight}.ttf")
    opts = subset.Options()
    opts.layout_features = ["*"]
    opts.name_IDs = ["*"]
    opts.notdef_outline = True
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=subset.parse_unicodes(LATIN))
    sub.subset(latin)
    latin.save(f"_latin-{weight}.ttf")

    merged = Merger().merge([f"_latin-{weight}.ttf", f"NotoSansArmenian-{weight}.ttf"])
    for rec in merged["name"].names:
        if rec.nameID in (1, 16):
            rec.string = "Matyan Card"
        elif rec.nameID in (4,):
            rec.string = f"Matyan Card {weight}"
        elif rec.nameID in (6,):
            rec.string = f"MatyanCard-{weight}"
    merged.save(f"MatyanCard-{weight}.ttf")
    print("built", f"MatyanCard-{weight}.ttf")
