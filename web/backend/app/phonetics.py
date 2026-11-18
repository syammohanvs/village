"""Turning a transcript in one Indic script into a coarse Latin key.

Why this exists (2026-11-17): a visitor said **വിളക്കുകൾ അണയ്ക്കുക** ("turn the
lights off") and the local speech model answered in **Tamil** script —
விலக்குகள் ஆனக்குக்கா — which is the same sentence, word for word, in a sister
script.  The parser then refused it as unsupported, because its Malayalam
vocabulary is written in Malayalam.

The scripts are laid out side by side in Unicode, so the same letter is a fixed
distance apart:

    Tamil      0B80 + 0x180 -> Malayalam  0D15 (ക), 0BB5 (വ), 0BCD (്)
    Kannada    0C80 + 0x080 -> Malayalam
    Telugu     0C00 + 0x100 -> Malayalam
    Devanagari 0900 + 0x400 -> Malayalam
    Bengali    0980 + 0x380 -> Malayalam

So the job is: shift the text into Malayalam, romanise it with one table, then
fold the result hard (drop the glide `y`, collapse doubled letters) so
`anakkukka` and `anaykkuka` meet.  Only used as a fallback when the transcript
is in a script the requested language does not use, so ordinary input is
matched exactly as before.
"""

from __future__ import annotations

# script -> (first codepoint, offset to the Malayalam block)
SHIFTS: dict[str, tuple[int, int]] = {
    "ta": (0x0B80, 0x180),  # Tamil
    "kn": (0x0C80, 0x080),  # Kannada
    "te": (0x0C00, 0x100),  # Telugu
    "hi": (0x0900, 0x400),  # Devanagari
    "bn": (0x0980, 0x380),  # Bengali
}

SCRIPT_NAMES = {"ta": "Tamil", "kn": "Kannada", "te": "Telugu", "hi": "Devanagari", "bn": "Bengali"}

MALAYALAM = (0x0D00, 0x0D7F)

VOWELS = {
    0x0D05: "a", 0x0D06: "a", 0x0D07: "i", 0x0D08: "i", 0x0D09: "u", 0x0D0A: "u",
    0x0D0B: "r", 0x0D0C: "l", 0x0D0E: "e", 0x0D0F: "e", 0x0D10: "ai",
    0x0D12: "o", 0x0D13: "o", 0x0D14: "au",
}

MATRAS = {
    0x0D3E: "a", 0x0D3F: "i", 0x0D40: "i", 0x0D41: "u", 0x0D42: "u", 0x0D43: "r",
    0x0D46: "e", 0x0D47: "e", 0x0D48: "ai", 0x0D4A: "o", 0x0D4B: "o", 0x0D4C: "au",
}

# Retroflex and dental letters collapse: the exhibit's words are told apart by
# their consonants and vowels, not by which of the two the model happened to
# write, and Tamil has fewer of them than Malayalam anyway.
CONSONANTS = {
    0x0D15: "k", 0x0D16: "k", 0x0D17: "g", 0x0D18: "g", 0x0D19: "n",
    0x0D1A: "ch", 0x0D1B: "ch", 0x0D1C: "j", 0x0D1D: "j", 0x0D1E: "n",
    0x0D1F: "t", 0x0D20: "t", 0x0D21: "d", 0x0D22: "d", 0x0D23: "n",
    0x0D24: "t", 0x0D25: "t", 0x0D26: "d", 0x0D27: "d", 0x0D28: "n",
    0x0D29: "n", 0x0D2A: "p", 0x0D2B: "p", 0x0D2C: "b", 0x0D2D: "b", 0x0D2E: "m",
    0x0D2F: "y", 0x0D30: "r", 0x0D31: "r", 0x0D32: "l", 0x0D33: "l", 0x0D34: "zh",
    0x0D35: "v", 0x0D36: "s", 0x0D37: "s", 0x0D38: "s", 0x0D39: "h",
}

VIRAMA = 0x0D4D
ANUSVARA = 0x0D02
VISARGA = 0x0D03
CANDRABINDU = 0x0D01

SIGNS = {ANUSVARA: "n", VISARGA: "h", CANDRABINDU: "n"}

# An anusvara (ം) is written the same way before any consonant but *sounds*
# like the nasal of that consonant's class: "പമ്പ്" is "pamp", not "panp", and a
# speech model writes "പംഭ്" for the same word — which romanised to "pnb" and
# matched nothing (measured 2026-11-18, from the user's own recording).  The
# classes: labial → m, velar → n (ങ്ങ is separate anyway), the rest → n.
ANUSVARA_BEFORE = {
    0x0D2A: "m", 0x0D2B: "m", 0x0D2C: "m", 0x0D2D: "m", 0x0D2E: "m",  # p ph b bh m
}

# The atomic chillu letters (Malayalam writes ള് as ൾ, final -n as ൻ, …).  A
# modern text uses them, so a table without them silently drops the last letter
# of exactly the words this file exists for.
CHILLUS = {0x0D7A: "n", 0x0D7B: "n", 0x0D7C: "r", 0x0D7D: "l", 0x0D7E: "l", 0x0D7F: "k"}


def script_of(text: str) -> str | None:
    """The Indic script a string is written in, or None for Latin/none."""
    counts: dict[str, int] = {}
    for char in text:
        code = ord(char)
        for name, (start, _shift) in SHIFTS.items():
            if start <= code < start + 0x80:
                counts[name] = counts.get(name, 0) + 1
                break
        if 0x0D00 <= code < 0x0D80:
            counts["ml"] = counts.get("ml", 0) + 1
    if not counts:
        return None
    return max(counts, key=counts.get)


def to_malayalam(text: str) -> str:
    """Shift a sister script's letters into the Malayalam block.

    Only characters inside that script's own block move: an ASCII space is not
    a Tamil letter, and shifting it lands outside the block (a space + 0x180 is
    `Ơ`, which then glues two words together).
    """
    script = script_of(text)
    if script not in SHIFTS:
        return text
    start, offset = SHIFTS[script]
    return "".join(
        chr(ord(char) + offset) if start <= ord(char) < start + 0x80 else char
        for char in text
    )


def romanise(text: str) -> str:
    """Malayalam (or a shifted sister script) to coarse Latin, letter by letter."""
    source = to_malayalam(text)
    out: list[str] = []
    pending_consonant = False
    for index, char in enumerate(source):
        code = ord(char)
        if code in CONSONANTS:
            if pending_consonant:
                out.append("a")  # the previous consonant carried no vowel sign
            out.append(CONSONANTS[code])
            pending_consonant = True
        elif code in MATRAS:
            out.append(MATRAS[code])
            pending_consonant = False
        elif code in VOWELS:
            if pending_consonant:
                out.append("a")
                pending_consonant = False
            out.append(VOWELS[code])
        elif code == VIRAMA:
            pending_consonant = False
        elif code in CHILLUS:
            if pending_consonant:
                out.append("a")
            out.append(CHILLUS[code])
            pending_consonant = False
        elif code in SIGNS:
            # The consonant before a sign still carries its inherent vowel:
            # "പംമ്" is "pamm", not "pmm" — dropping that `a` made the word
            # unrecognisable after the anusvara was read as the nasal it sounds
            # like (2026-11-18).
            if pending_consonant:
                out.append("a")
                pending_consonant = False
            if code == ANUSVARA:
                after = ord(source[index + 1]) if index + 1 < len(source) else 0
                out.append(ANUSVARA_BEFORE.get(after, "n"))
            else:
                out.append(SIGNS[code])
        elif char.isascii():
            # A space ends the word, and the consonant before it keeps its
            # inherent vowel — the same rule as at end-of-string.  This used to
            # fall into the ASCII branch and drop it, so "लाइट" romanised to
            # "laita" on its own and "lait" inside a sentence, and the Hindi
            # "लाइट चालू" the model hears as "बालाइट चालू" could not be
            # matched to the word that was said (2026-11-18).
            if pending_consonant and char.isspace():
                out.append("a")
                pending_consonant = False
            out.append(char)
        else:
            # A space or any other separator ends the word.
            if pending_consonant:
                out.append("a")
                pending_consonant = False
            out.append(char)
    if pending_consonant:
        out.append("a")
    return "".join(out)


def fold(word: str) -> str:
    """One spelling for two ways of hearing the same word.

    The glide `y` is the difference between `anaykkuka` and `anakkukka`, and
    doubled letters between `kk` and `k`; neither changes which lamp the visitor
    meant.
    """
    value = (word or "").lower()
    value = "".join(char for char in value if char.isalnum())
    # `h` only ever marks aspiration or a dental letter in these scripts
    # (kathikkuka / kattikkuka are the same word), and `y` is a glide the ear
    # may or may not catch.
    value = value.replace("h", "").replace("y", "")
    # Voicing is not phonemic in Malayalam/Tamil/Hindi: k and g, t and d, p and
    # b are the same letter of the varga, and the ear (or the model) picks one.
    # Whisper wrote "Thangil" for "tankil" and "Velamundo" for "vellamunto"
    # (2026-11-18) — both are one class away from the word that was said.
    value = value.translate(str.maketrans({"g": "k", "b": "p", "d": "t",
                                           "j": "c", "z": "s", "v": "w"}))
    out: list[str] = []
    for char in value:
        if out and out[-1] == char:
            continue
        out.append(char)
    return "".join(out)


def _consonants(word: str) -> str:
    """The word with its vowels removed, for comparing two short words."""
    return "".join(char for char in word if char not in "aeiou")


def distance(a: str, b: str) -> int:
    """Levenshtein distance, for words that are close but not identical."""
    if a == b:
        return 0
    if not a or not b:
        return max(len(a), len(b))
    previous = list(range(len(b) + 1))
    for i, left in enumerate(a, start=1):
        current = [i]
        for j, right in enumerate(b, start=1):
            current.append(min(
                previous[j] + 1,
                current[j - 1] + 1,
                previous[j - 1] + (left != right),
            ))
        previous = current
    return previous[-1]


def same_word(a: str, b: str, *, allow_suffix: bool = False, allow_edit: bool = True) -> bool:
    """Are these two renderings of one spoken word?

    Exact after folding, and only that.  A tolerance of one edit was measured
    and rejected on 2026-11-17: it turned "anakkukka" (turn off) into
    "nanaykkuka" (water) by the one letter the fold cannot see, and the exhibit
    would have started the pump on a request to put a lamp out.

    `allow_suffix` is for **device names only**, and for one measured failure:
    the Hindi model heard "लाइट" ("laita") and wrote "बालाइट" ("palaita") —
    the same word with a syllable in front of it, which is two edits away and
    matched nothing, so "लाइट चालू" was refused (2026-11-18).  A device word
    with a syllable added or dropped at the *start* is still that device; a
    state word is not treated this way, because "off"/"on" differ exactly there.

    `allow_edit=False` turns the one-letter tolerances off and keeps only the
    spelling ones (fold equality and `allow_suffix`).  The **structural** device
    matcher uses it: one edit is what the *sound* path needs, and applied to
    every device word in every sentence it was too loose — "band" (Hindi for
    "off") matched the water alias "pani", because their consonants nest
    (2026-11-18).  A device is far more likely to be the same word with its case
    ending than one letter out.
    """
    left, right = fold(a), fold(b)
    if not left or not right:
        return False

    def bare(word: str) -> str:
        # Hindi drops a word-final schwa ("लाइट" is said "lait", the letter
        # carries an "a"), and the romaniser writes that "a" in one position and
        # not another.  One trailing "a" therefore never separates two
        # renderings of the same word — and the device names are mostly words of
        # exactly that shape (2026-11-18).
        return word[:-1] if len(word) > 3 and word.endswith("a") else word

    if bare(left) == bare(right):
        return True
    # A **short** word may be one letter away and still be the same word: the
    # Malayalam "ഓട്ടോ" (auto) came back as "അട്ടോ", "ഓെട്ടോ" and "ഓത്റോ" on
    # different recordings of the same phrase, and "പമ്പ്" as "പംമ്" — one
    # letter each time (2026-11-18, from the user's own voice).
    #
    # Three conditions, and each one was forced by a wrong answer when it was
    # missing: four letters at most, one edit at most, and **the consonants must
    # be the same or one must extend the other**.  Without the consonant check
    # the question word "ano" matched "auto" ("ato") and every short word became
    # a question.  With it, two-letter words are safe too ("on" and "off" have
    # different consonants), which matters because a clipped "ഓട്ടോ" comes back
    # as "ഓത്" ("ot").
    if allow_edit and 2 <= len(left) <= 4 and 2 <= len(right) <= 4 and distance(left, right) <= 1:
        a, b = _consonants(left), _consonants(right)
        if a == b or a.startswith(b) or b.startswith(a):
            return True
    # One edit is allowed **when the two words start the same**.  A speech
    # model put the vowel of "കത്തിക്കുക" (turn on) in the wrong place:
    # "കത്യകുകാ" romanises to "katyakuka" against "kathikkuka", one letter
    # apart in the middle, and the command was refused (measured 2026-11-18).
    # The start is what makes this safe: the one pair this file must never
    # confuse - "anakuka" (turn off) and "nanakuka" (water) - differ at the
    # *first* letter, which is exactly where a slip changes the word.
    if (
        allow_edit
        and min(len(left), len(right)) >= 5
        and left[:3] == right[:3]
        and distance(left, right) <= 1
    ):
        return True
    # A long word may differ by one letter and still be the same word:
    # "vilakkunkal" (heard) and "vilakkukal" (expected) are one inserted `n`.
    # A short one may not -- that is exactly how "anakuka" (turn off) was once
    # read as "nanakuka" (water).
    if allow_edit and min(len(left), len(right)) >= 9:
        return distance(left, right) <= 1
    # A device name with a syllable in front of it (or missing from it):
    # "palaita" ends with "laita".  The shorter word must be long enough to be
    # a word rather than a syllable, and the extra part short enough to be a
    # mishearing rather than a different word.
    if allow_suffix:
        shorter, longer = sorted((left, right), key=len)
        if len(shorter) >= 4 and 0 < len(longer) - len(shorter) <= 3 and longer.endswith(shorter):
            return True
        # …and a syllable *after* it, which is the same failure on the other
        # side and just as common in Malayalam, where the case ending belongs
        # to the noun: the model wrote "വിളക്കുകുള്ളെ" for "വിളക്കുകൾ" and ran
        # "മണ്ണിൽ" into "എത്ര" as "മണ്നില്ലത്രാ" (both from the user's own
        # session, 2026-11-18).  A device name at the *start* of a word is still
        # that device — but **only a name of five letters or more gets this**,
        # because on a short one it is a trap: "thanks" starts with "tank".
        # The tail may not be longer than the name itself, so a short word
        # cannot swallow a long one, and this tolerance is for devices only — a
        # state word ("on", "off") differs exactly at its ending.
        if (
            len(shorter) >= 5
            and 0 < len(longer) - len(shorter) <= len(shorter)
            and longer.startswith(shorter)
        ):
            return True
    return False
