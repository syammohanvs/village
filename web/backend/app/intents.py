from __future__ import annotations

from .phonetics import fold, romanise, same_word, script_of

import json
import re
import unicodedata
from pathlib import Path
from typing import Any


SILENT_MARKERS = {"[blank_audio]", "[silence]", "(silence)", "[music]", "[no speech]"}

# A whole transcript that is one bracketed sound is not a sentence: whisper
# writes "[Coughing]", "(coughing)", "[Laughter]" and "[Music]" when it is handed
# a room rather than a request.  The visitor was told "please ask me to control
# a supported device" for every cough in the room (measured 2026-11-18); the
# honest answer to a sound is "I did not hear a command", which is what
# `no_speech` says.  Only a *whole* transcript counts — a marker inside a
# sentence ("[Music] lights on") leaves the words alone.
NON_SPEECH = re.compile(r"^[\[\(][^\[\]\(\)]{1,40}[\]\)]$")

# Words that carry no instruction and may be ignored when checking that every
# content word was understood.  Only English uses that check (see _unaccounted).
EN_FILLERS = {
    "the", "a", "an", "my", "our", "your", "all", "some", "of", "at", "to", "for",
    "me", "i", "you", "it", "that", "this", "them", "those", "and", "then", "also",
    "plus", "please", "kindly", "now", "then", "just", "here", "there", "again",
    "too", "ok", "okay", "right", "away", "quickly", "immediately", "already",
    "want", "wanted", "would", "like", "need", "will", "can", "could", "may",
    "should", "let", "let's", "us", "is", "are", "was", "were", "be", "been",
    "do", "does", "did", "have", "has", "had", "if", "what", "how", "which",
    "where", "when", "why", "who", "happens", "happen", "will", "it's", "please.",
}

# An English verb may arrive inflected; only these regular forms are folded, and
# only into a verb the grammar already knows.
EN_SUFFIXES = ("ing", "ed", "es", "s")


class IntentMatcher:
    """Deterministic, rule-based intent parsing for the three supported languages.

    This is deliberately not a language model and not a substring search.  It
    reads a sentence as a small grammar — sentence type (request, question,
    statement, hypothetical), device aliases, state words (on/off/auto),
    negation and correction — and only actuates when exactly one device and one
    state were understood.  Anything uncertain returns no command at all.

    The same parser serves speech (after Whisper transcribes) and typed input,
    so both paths cannot disagree about what a sentence means.
    """

    def __init__(self, path: Path):
        self.path = path
        self.data = json.loads(path.read_text(encoding="utf-8"))
        self.languages = [item["code"] for item in self.data["languages"]]
        self.by_id = {item["id"]: item for item in self.data["intents"]}
        self.grammar = self.data.get("grammar", {})
        self.devices = self.data.get("devices", {})
        self.states = self.data.get("states", {})
        self.device_commands = self.data.get("device_commands", {})
        self.messages = self.data.get("messages", {})
        self.watering = self.data.get("watering", {})
        # device sounds per language, built once (see `_device_sounds`)
        self._sounds: dict[str, dict[str, list[str]]] = {}

    # ------------------------------------------------------------------ text
    def normalize(self, text: str) -> str:
        text = unicodedata.normalize("NFKC", (text or "").strip().lower())
        text = text.replace("\u200b", "").replace("\u200c", "").replace("\u200d", "")
        out = []
        for ch in text:
            if ch.isalnum() or ch.isspace() or "\u0900" <= ch <= "\u0d7f":
                out.append(ch)
            else:
                out.append(" ")
        return " ".join("".join(out).split())

    def _tokens(self, text: str) -> list[str]:
        return self.normalize(text).split()

    def detect_language(self, text: str, fallback: str = "en") -> str:
        if any("\u0d00" <= ch <= "\u0d7f" for ch in text):
            return "ml"
        if any("\u0900" <= ch <= "\u097f" for ch in text):
            return "hi"
        return fallback

    # --------------------------------------------------------------- matching
    def _find(self, tokens: list[str], terms: list[str] | None) -> list[tuple[int, int, str]]:
        """Every occurrence of a known term, longest term first.

        A term matches only as whole words (token sequences), never as a
        substring inside a word, so "not" does not match "nothing" and "on"
        does not match "once".  Overlapping hits are discarded.
        """
        if not terms:
            return []
        hits: list[tuple[int, int, str]] = []
        used: set[int] = set()
        ordered = sorted({t for t in terms if t}, key=lambda t: -len(t.split()))
        for term in ordered:
            parts = self._tokens(term) or term.split()
            n = len(parts)
            for i in range(0, len(tokens) - n + 1):
                span = range(i, i + n)
                if any(index in used for index in span):
                    continue
                if tokens[i:i + n] == parts:
                    hits.append((i, n, term))
                    used.update(span)
        return sorted(hits)

    def _has(self, tokens: list[str], terms: list[str] | None) -> bool:
        return bool(self._find(tokens, terms))

    def _starts(self, tokens: list[str], terms: list[str] | None) -> bool:
        if not terms:
            return False
        for term in terms:
            parts = term.split()
            if tokens[:len(parts)] == parts:
                return True
        return False

    def _en_verb_hit(self, tokens: list[str], verbs: list[str]) -> list[tuple[int, int, str]]:
        hits = self._find(tokens, verbs)
        taken = {i for start, n, _ in hits for i in range(start, start + n)}
        known = set(verbs)
        for index, token in enumerate(tokens):
            if index in taken:
                continue
            base = self._en_base(token, known)
            if base:
                hits.append((index, 1, token))
                taken.add(index)
        return sorted(hits)

    @staticmethod
    def _en_base(token: str, known: set[str]) -> str | None:
        for suffix in EN_SUFFIXES:
            if token.endswith(suffix) and len(token) > len(suffix) + 2:
                stem = token[: -len(suffix)]
                if stem in known:
                    return stem
                if len(stem) > 2 and stem[-1] == stem[-2] and stem[:-1] in known:
                    return stem[:-1]
        return None

    # ------------------------------------------------------------- sentences
    def is_negated(self, text: str, language: str) -> bool:
        tokens = self._tokens(text)
        g = self.grammar.get(language, {})
        negators = self._find(tokens, g.get("negations"))
        if not negators:
            return False
        state_or_device = (
            self._find(tokens, [t for values in self.states.values() for t in values.get(language, [])])
            + self._find(tokens, [t for values in self.devices.values() for t in values.get(language, [])])
        )
        if not state_or_device:
            return True
        return min(start for start, _, _ in negators) < min(start for start, _, _ in state_or_device)

    def _question(self, text: str, tokens: list[str], language: str) -> bool:
        if text.rstrip().endswith("?"):
            return True
        g = self.grammar.get(language, {})
        if self._starts(tokens, g.get("question_starts")):
            return True
        # Malayalam and Hindi mark a question with a suffix on the verb rather
        # than by moving a question word to the front ("…ഉണ്ടോ", "…क्या").
        for suffix in g.get("question_suffixes", []):
            if any(token.endswith(suffix) and len(token) > len(suffix) for token in tokens):
                return True
        return False

    def _request(self, tokens: list[str], language: str) -> bool:
        g = self.grammar.get(language, {})
        # "can you / could you / would you" is a request; "can I / may I / should
        # I" is advice and is handled as a hypothetical before this is consulted.
        modals = [m for m in g.get("request_modals", [])
                  if not m.startswith(("can i", "may i", "could i", "should i"))]
        polite = self._has(tokens, ["please", "kindly", "ദയവായി", "कृपया"])
        if language == "en":
            return self._starts(tokens, modals) or polite
        # Malayalam "…ചെയ്യാമോ" and Hindi "…कर सकते हैं" end the sentence, so the
        # polite form is looked for anywhere rather than only at the start.
        return self._has(tokens, modals) or polite

    # ----------------------------------------------------------------- parse
    def match(self, text: str, language: str) -> dict[str, Any]:
        language = language if language in self.languages else "en"
        g = self.grammar.get(language, {})
        transcript = (text or "").strip()
        if not transcript or transcript.lower() in SILENT_MARKERS or NON_SPEECH.match(transcript):
            return self._result("no_speech", language, "no_speech")

        tokens = self._tokens(transcript)
        if not tokens:
            return self._result("no_speech", language, "no_speech")

        # A transcript in another script is still the same sentence.  Whisper
        # answered Malayalam audio in Tamil script on this machine (2026-11-17),
        # and the visitor was told the command was unsupported although they had
        # said exactly the right words.  Before the grammar runs, try the
        # romanised key of the words against the same vocabulary; if that finds
        # one device and one state, use it.
        script = script_of(transcript)
        sounds_first = language in {"ml", "hi"} and script != language
        if sounds_first:
            roman = self._romanised_intent(tokens, language)
            if roman is not None:
                return roman

        # --- sentence type, in the order that keeps a question from acting ---
        if self._has(tokens, g.get("hypothetical")) or self._starts(tokens, ["if"]):
            return self._result("hypothetical", language, "hypothetical")

        # "no" / "नहीं" is both a negator and a correction.  It only counts as a
        # correction when a second, different state follows it ("on… no, off"),
        # which is caught below as two states.
        if self._has(tokens, g.get("corrections")):
            return self._result("ambiguous", language, "ambiguous_generic", clarify="correction")

        device_hits = self._device_hits(tokens, language)
        state_hits = self._state_hits(tokens, language)
        verb_hits = self._verb_hits(tokens, language)
        status_hits = self._find(tokens, g.get("status_words"))
        negators = self._find(tokens, g.get("negations"))
        watering = self._watering(tokens, language)

        # --- pronouns that need a device named -----------------------------
        pronouns = self._find(tokens, g.get("pronouns"))
        if pronouns and not device_hits and not watering:
            return self._result("ambiguous", language, "clarify_device")

        # --- negation, before any state is turned into an action ------------
        anchors = [start for start, _, _ in state_hits + verb_hits + device_hits]
        if negators:
            # English puts the negator before the verb ("don't turn it off"),
            # so position matters and "no, off" stays a correction.  Malayalam
            # and Hindi negate after the verb ("…തുടങ്ങുക വേണ്ട"), where a
            # position test would miss every real refusal.
            if language != "en" or not anchors or min(start for start, _, _ in negators) < min(anchors):
                return self._result("negated", language, "negated")

        is_question = self._question(transcript, tokens, language)
        is_request = self._request(tokens, language)

        # A **misspelled state word** is tried by sound before anything else can
        # claim the sentence.  This has to happen here, not at the end: the word
        # "പമ്പ്" is also the watering cue, so "പമ്പ് ഓത്ടു" (pump auto, heard as
        # "pump ottu") was being read as *start watering* before the sound pass
        # ever ran — the "auto outranks the pump cue" rule needs an `auto` the
        # word matcher can see, and a speech model spells it four ways
        # (2026-11-18).  `_romanised_intent` needs exactly one device and one
        # state, and refuses a question or a negation, so this cannot guess.
        if (
            language in {"ml", "hi"}
            and not sounds_first
            and not state_hits
            and not negators
            and not is_question
        ):
            roman = self._romanised_intent(tokens, language)
            if roman is not None:
                return roman

        # --- two states in one sentence are never a guess --------------------
        unique_states = {name for _, _, name in state_hits}
        # An explicit mode wins over a preposition and over the pump cue: "put
        # the pump on automatic" says *on* and *automatic* in one breath, and
        # "പമ്പ് ഓട്ടോ" / "पंप ऑटो" names the pump only to change its mode — the
        # pump cue would otherwise read "pump" as "start watering".  Both were
        # answered with the wrong command until 2026-11-18.
        if "auto" in unique_states:
            unique_states = {"auto"}
            watering = None
        if len(unique_states) > 1:
            # "Are the lights on or off?" is a status question, not a command
            # with two actions.
            device = device_hits[0][2] if device_hits else None
            if is_question and not is_request and device:
                status_command = self.device_commands.get(device, {}).get("status")
                if status_command:
                    return self._intent_result(status_command, language, device=device, action="status")
            # Two different states is never a guess; with watering in the same
            # sentence it is two requests ("…and start watering"), so the answer
            # must not pretend the question is only about the lights.
            if watering:
                return self._result("ambiguous", language, "ambiguous_generic")
            return self._result(
                "ambiguous", language,
                "ambiguous_lights" if device == "lights" else "ambiguous_generic",
                device=device,
            )

        # --- exactly one device ---------------------------------------------
        devices = sorted({name for _, _, name in device_hits})
        if watering:
            # "watering / irrigation / water the plants" names the pump without
            # saying "pump".  Any *other* device in the same sentence is a second
            # request ("…and switch off the lights"), never a guess.
            others = [d for d in devices if d not in ("pump", "water")]
            if others:
                return self._result("ambiguous", language, "ambiguous_generic")
            devices = ["pump"]
            # The cue means *start* only when the sentence names no state.  It
            # used to overwrite the state it found, so "പമ്പ് അഫ്" ("pump off",
            # heard with the model's own spelling of "off") started watering
            # instead of stopping it (measured 2026-11-18).
            if not unique_states:
                unique_states = {watering}
        elif len(devices) > 1:
            return self._result("ambiguous", language, "ambiguous_generic")
        device = devices[0] if devices else None

        if device is None:
            # A bare status word ("status", "what is happening") asks about the
            # whole village; "help" asks for the catalogue.
            if self._has(tokens, ["help", "commands", "what can you do"]):
                return self._intent_result("HELP", language, device=None, action=None)
            # …but only when every word is one it knows.  A bare status word is
            # a whole-village question; "bin status" is not, because "bin" is a
            # thing this build has no reading for — answering it with the
            # village's own status would be answering a different question
            # (the bin command itself was removed on 2026-11-18: the three bins
            # are LEDs lit by the classifier and nothing measures them).
            if status_hits and not state_hits and not self._unaccounted(tokens, language):
                return self._intent_result("VILLAGE_STATUS", language, device="village", action="status")
            fallback = self._phrase_fallback(tokens, language, allow=not (is_question or negators))
            if fallback:
                return fallback
            # A word that looks like an action but names no known device is a
            # question about which device, not an instruction.
            if device_hits or pronouns:
                return self._result("ambiguous", language, "clarify_device")
            # Last chance, and only for a language whose spelling this build
            # cannot keep up with: a Malayalam sentence the *script* matcher
            # missed is tried again by sound.  A speech model trained on English
            # hears "വിളക്കുകൾ" and writes "വിലക്കുകൾ" — one letter apart, and
            # the whole command is lost (measured 2026-11-18).  This runs only
            # after the grammar has already found nothing, so ordinary input is
            # untouched, and `same_word` keeps its own guards (a short word may
            # not differ by a letter — that is what once turned "switch off"
            # into "water").
            if language in {"ml", "hi"} and not sounds_first:
                roman = self._romanised_intent(tokens, language)
                if roman is not None:
                    return roman
            # A state word with no device named is a question about *which*
            # device, not an instruction.  Three recordings from this exhibit's
            # own log are exactly this shape — "Thanks on!", "Bounce on!" and
            # "Dumb on!" are what a child's "Pump on!" looks like after a
            # speech model has been through it (2026-11-18) — and "please ask
            # me to control a supported device" gave the visitor nowhere to go.
            # Nothing is sent, and the reply names the two devices that can be
            # switched.
            if unique_states and not is_question and not negators:
                return self._result("ambiguous", language, "clarify_device")
            return self._result("unsupported", language, "unknown")

        command_for_device = self.device_commands.get(device, {})

        # --- a statement or a question is never an action -------------------
        copula = bool(self._find(tokens, g.get("copulas")))
        if not unique_states:
            if status_hits or is_question:
                status_command = command_for_device.get("status")
                if status_command:
                    return self._intent_result(status_command, language, device=device, action="status")
            # The device was read, the *state* word was not: a Malayalam speech
            # model writes "ഓട്ടോ" as "ഓത്ടോ" and the action is lost.  Try the
            # words by sound before answering "which state?" — `_romanised_intent`
            # still needs exactly one device and one state, and refuses a
            # question or a negation, so this cannot guess.
            if language in {"ml", "hi"} and not sounds_first:
                roman = self._romanised_intent(tokens, language)
                if roman is not None:
                    return roman
            if copula and not verb_hits:
                return self._result("statement", language, "statement", device=device)
            if verb_hits:
                return self._result("ambiguous", language, "ambiguous_generic", device=device)
            if is_request:
                return self._result("ambiguous", language, "ambiguous_generic", device=device)
            # A whole catalogue phrase, exactly as written.  It used to be
            # excluded here, which is why a natural noun-phrase question
            # ("മണ്ണിലെ ഈർപ്പം", "मिट्टी की नमी") came back AMBIGUOUS even though
            # it is a listed phrase for that status (2026-11-18).  A question or a
            # refusal is still never allowed through this way.
            fallback = self._phrase_fallback(tokens, language, allow=not (is_question or negators))
            if fallback:
                return fallback
            # A device was named and the state word was not.  "Which device?"
            # would be answering the half of the sentence the visitor *did* say,
            # so this asks the half that is missing — and only for a device that
            # has a state to give: soil and water answer questions, they do not
            # switch, and offering them "on, off or automatic" would invent a
            # control.
            if {"on", "off", "auto"} & set(command_for_device):
                return self._result(
                    "ambiguous", language, "clarify_state", device=device
                )
            return self._result("ambiguous", language, "ambiguous_generic", device=device)

        if is_question and not is_request:
            status_command = command_for_device.get("status")
            if status_command:
                return self._intent_result(status_command, language, device=device, action="status")
            return self._result("unsupported", language, "unknown", device=device)

        # "the lights are off" / "the pump is running" state a fact.  A
        # participle ("running", "switched") is not an imperative, so it does
        # not turn the sentence into an instruction.
        base_verbs = set(g.get("verbs") or [])
        imperative = [hit for hit in verb_hits if tokens[hit[0]] in base_verbs]
        if copula and not is_question and not imperative:
            return self._result("statement", language, "statement", device=device)

        action = sorted(unique_states)[0]
        command = command_for_device.get(action)
        if not command:
            # The device was read and the state was read, but that device has no
            # such action — "വെള്ളം നിർത്തുക" ("stop the water") names the water
            # as the device and stopping as the state, while the thing to stop
            # is the watering.  A phrase the catalogue lists is the better
            # answer; otherwise the refusal stands.
            fallback = self._phrase_fallback(
                tokens, language, allow=not (is_question or negators)
            )
            if fallback:
                return fallback
            return self._result("unsupported", language, "unknown", device=device, action=action)

        if self._unaccounted(tokens, language):
            # An unknown word after a conjunction is the shape of a second
            # request ("…and open the gate", "…ഗേറ്റ് തുറക്കുക").  Never execute
            # half of it, in any language.
            return self._result("ambiguous", language, "ambiguous_generic", device=device)
        return self._intent_result(command, language, device=device, action=action)

    # ------------------------------------------------- foreign-script words
    def _romanised_intent(self, tokens: list[str], language: str) -> dict[str, Any] | None:
        """One device and one state, found by sound rather than by script.

        Deliberately narrow: it needs exactly one device and exactly one state,
        and it refuses anything that matches a negation or a question marker, so
        it can only ever confirm a plain instruction.  Everything else falls
        through to the grammar, whose answer for a sentence it cannot read is
        the honest "please name a device".
        """
        roman = [word for word in romanise(" ".join(tokens)).split() if word]
        if not roman:
            return None
        g = self.grammar.get(language, {})

        def hits(aliases: list[str], *, suffix: bool = False) -> bool:
            return any(
                same_word(word, alias, allow_suffix=suffix)
                for word in roman
                for alias in aliases
                if alias
            )

        # A verb is not a state.  `roman_aliases` splits multi-word aliases so
        # that "ഓൺ ചെയ്യുക" can be found by sound through either half, but
        # "ചെയ്യുക" on its own is *the word for doing* and appears in half the
        # sentences — matching it as "on" made "വിളക്കുകൾ ഓത്ടോ ചെയുക" three
        # states at once (measured 2026-11-18).  Verb spellings are dropped
        # from the sound path; the whole alias is kept, and a one-word state
        # word ("ഓൺ") still matches on its own.
        #
        # …except a verb that is *also* a state word: Malayalam says "on" and
        # "off" as verbs ("ഓൺ ചെയ്യുക"), so both appear in the verb list, and
        # dropping them made the sound path unable to hear "off" at all — the
        # recording "പമ്പ് അഫ്" answered AMBIGUOUS because the only `off` it
        # could reach was in the script it was not written in (2026-11-18).
        # Only a **single-word** state alias rescues a verb: "ഓൺ" and "ഓഫ്" are
        # states a visitor says on their own.  The verb half of a two-word alias
        # ("ഓൺ ചെയ്യുക") must stay dropped, or "ചെയ്യുക" - the word for doing -
        # becomes both "on" and "off" and every sentence carrying it is
        # ambiguous (the bug this guard was written for, 2026-11-18).
        state_sounds = {
            fold(part)
            for aliases in self.states.values()
            for alias in (aliases.get(language) or [])
            if len(alias.split()) == 1
            for part in romanise(alias).split()
            if part
        }
        device_sounds = {
            fold(part)
            for aliases in self.devices.values()
            for alias in (aliases.get(language) or [])
            if len(alias.split()) == 1
            for part in romanise(alias).split()
            if part
        }
        verb_sounds = {
            fold(word)
            for word in romanise(" ".join(g.get("verbs") or [])).split()
            if fold(word) not in state_sounds
        }

        def phrase_hit(aliases: list[str] | None) -> bool:
            """A **multi-word** alias whose own words appear in order.

            "വെള്ളം ഒഴിക്കുക" (pour water) is a phrase, and its verb half is
            dropped from the word-by-word match because it is a verb.  Reading
            it as a request needs its two words together, not the bare cue word
            — otherwise a sentence whose *state* could not be read (a Hindi
            "पंप बंद" heard while Malayalam is chosen) would be taken as
            "start watering" (2026-11-18).
            """
            for alias in aliases or []:
                parts = [part for part in romanise(alias).split() if part]
                if len(parts) < 2:
                    continue
                for start in range(0, len(roman) - len(parts) + 1):
                    window = roman[start:start + len(parts)]
                    if all(same_word(a, b) for a, b in zip(window, parts)):
                        return True
            return False

        def roman_aliases(aliases: list[str] | None) -> list[str]:
            out: list[str] = []
            for alias in aliases or []:
                out.append(alias)
                for part in romanise(alias).split():
                    if part and fold(part) not in verb_sounds:
                        out.append(part)
            return out

        # A refusal or a question must never be turned into an action.  A
        # **multi-word** guard is matched as the phrase it is, never by its
        # parts: "चालू मत" ("do not turn on") split into characters made
        # "चालू" — the word for ON — read as a correction marker, so every
        # Hindi sentence containing it was refused before a device was read
        # ("बालाइट चालू" measured 2026-11-18).
        def guard_aliases(aliases: list[str] | None) -> list[str]:
            out: list[str] = []
            for alias in aliases or []:
                out.append(alias)
                parts = [part for part in romanise(alias).split() if part]
                if len(parts) > 1:
                    continue
                for part in parts:
                    sound = fold(part)
                    if sound not in state_sounds and sound not in device_sounds:
                        out.append(part)
            return out

        for group in ("negations", "question_starts", "question_suffixes", "hypothetical",
                      "corrections"):
            if hits(guard_aliases(g.get(group))):
                return None

        # ------------------------------------------------------ merged words
        # A visitor speaking quickly, or a speech model writing what it heard,
        # can run two words together — and the words around them are gone.
        # Every one of these came from this exhibit's own event log on
        # 2026-11-18, and every one was answered "please ask me to control a
        # supported device":
        #
        #   "വിളക്കുകളാണക്കുകാം"  = വിളക്കുകൾ (lights) + അണക്കുക (switch off)
        #   "വിളക്കുകളാന്ക്കുകാം" = the same, with the glide `യ` dropped twice
        #   "താങ്കില്വല്ലം"        = ടാങ്കിൽ (in the tank) + വല്ലം (water)
        #
        # So a token that nothing reads whole is split at every point into two
        # halves, and the split is kept only when *this* vocabulary reads both
        # halves: a device with a state (a command), or two device names (a
        # status sentence).  Nothing else is invented, and the sentence still
        # has to end up with exactly one device and one state.
        device_aliases = {
            name: [alias for alias in roman_aliases(aliases.get(language)) if alias]
            for name, aliases in self.devices.items()
        }
        state_aliases = {
            name: [alias for alias in roman_aliases(aliases.get(language)) if alias]
            for name, aliases in self.states.items()
        }
        seen: dict[str, tuple[list[str], list[str]]] = {}

        def names_for(word: str) -> tuple[list[str], list[str]]:
            """Which device names and which states this one word could be.

            `allow_suffix=True` is for device names only: a device may be heard
            with a syllable in front of it ("बालाइट" for "लाइट").  States never
            get that tolerance — "on" and "off" differ exactly there.
            """
            if word in seen:
                return seen[word]
            found_devices = [
                name
                for name, aliases in device_aliases.items()
                if any(same_word(word, alias, allow_suffix=True) for alias in aliases)
            ]
            found_states = [
                name
                for name, aliases in state_aliases.items()
                if any(same_word(word, alias) for alias in aliases)
            ]
            seen[word] = (found_devices, found_states)
            return seen[word]

        def split_in_two(word: str) -> list[str] | None:
            if len(word) < 8:
                return None
            two_devices: list[str] | None = None
            for cut in range(4, len(word) - 3):
                left, right = word[:cut], word[cut:]
                left_devices, left_states = names_for(left)
                right_devices, right_states = names_for(right)
                if not (left_devices or left_states) or not (right_devices or right_states):
                    continue
                if (left_devices and right_states) or (left_states and right_devices):
                    return [left, right]
                two_devices = two_devices or [left, right]
            return two_devices

        merged: list[str] = []
        for word in roman:
            found_devices, found_states = names_for(word)
            pieces = None if (found_devices or found_states) else split_in_two(word)
            merged.extend(pieces or [word])
        roman = merged

        devices: set[str] = set()
        states: set[str] = set()
        for word in roman:
            found_devices, found_states = names_for(word)
            devices.update(found_devices)
            states.update(found_states)

        # Watering is its own vocabulary ("water the plants" / "stop watering").
        # Both halves are required here: a pump word whose state could not be
        # read must not be taken as "start", or a request to put a lamp out
        # could open the valve.
        watering = self.watering.get(language) or {}
        if "auto" in states:
            # An explicit mode outranks the pump cue here too: "പമ്പ്" is the
            # watering cue as well as the pump's name, so without this
            # "പംഭ് അട്ടോ" (pump auto, heard with a wrong consonant) became
            # *two* states — auto and "start watering" — and was refused
            # (2026-11-18).
            pass
        elif hits(roman_aliases(watering.get("cue"))):
            # A hurried "പമ്പ് ഓട്ടോ" can come back as one word that has
            # swallowed the pump's last letter: "പോട്ടു" (measured 2026-11-18).
            # After a pump word, a word that *ends* with the sound of "auto" is
            # the mode, not a request to water — and only there, so nothing
            # else can be read as a mode.
            if any(
                fold(word).endswith(("otu", "oto")) and len(fold(word)) >= 4
                for word in roman
            ):
                states.add("auto")
            elif hits(roman_aliases(watering.get("stop"))):
                states.add("off")
                devices.add("pump")
            elif not states and (
                hits(roman_aliases(watering.get("start")))
                or phrase_hit(watering.get("cue"))
            ):
                # A request to water is either a start word ("തുടങ്ങുക") or the
                # cue phrase itself ("വെള്ളം ഒഴിക്കുക").  Requiring a start alias
                # alone stopped working when the verb list and the alias began
                # romanising their final vowel the same way, because the start
                # aliases are verbs and verbs are dropped here (2026-11-18).
                # A **bare** pump word is not enough: "പമ്പ്" is also the device
                # name, and a sentence whose state could not be read must be
                # refused rather than taken as "start" (the pump-off trap).
                states.add("on")
                devices.add("pump")

        # A status question has no state in it: "tankil vellamundo" names one
        # device and asks.  Refusing it left the exhibit answering "not
        # understood" to the very question its buttons ask, because the model
        # mangles the question word and only the device survives.
        #
        # **Only for a device that has nothing BUT a status** — soil and water.
        # The pump and the lights have commands, and a mangled command ("pump
        # off" heard as something the state list does not hold) must be refused,
        # never quietly answered with a reading.  That is the trap the existing
        # `an unreadable pump state never starts the pump` test guards.
        if len(devices) == 1 and not states:
            only = next(iter(devices))
            commands = self.device_commands.get(only, {})
            if set(commands) == {"status"}:
                return self._intent_result(
                    commands["status"], language, device=only,
                    action="status", matched_phrase="romanised",
                )

        if len(devices) != 1 or len(states) != 1:
            return None
        device = next(iter(devices))
        action = next(iter(states))
        command = self.device_commands.get(device, {}).get(action)
        if not command:
            return None
        return self._intent_result(
            command, language, device=device, action=action, matched_phrase="romanised"
        )

    # ------------------------------------------------------------- providers
    def _device_sounds(self, language: str) -> dict[str, list[str]]:
        """Every device name as sounds: the alias as written, and romanised.

        Built once per language and kept, because the device matcher asks for it
        on every token of every sentence.
        """
        cached = self._sounds.get(language)
        if cached is not None:
            return cached
        sounds: dict[str, list[str]] = {}
        for name, aliases in self.devices.items():
            out: list[str] = []
            for alias in aliases.get(language) or []:
                if not alias:
                    continue
                out.append(alias)
                out.extend(part for part in romanise(alias).split() if part)
            sounds[name] = out
        self._sounds[language] = sounds
        return sounds

    def _device_hits(self, tokens: list[str], language: str) -> list[tuple[int, int, str]]:
        hits: list[tuple[int, int, str]] = []
        for name, aliases in self.devices.items():
            for start, n, _ in self._find(tokens, aliases.get(language)):
                hits.append((start, n, name))
        # A device is also read the way the sound pass reads it.  Malayalam puts
        # the case ending on the noun — "വിളക്കുകളുടെ അവസ്ഥ" (the lights' state),
        # "പംഭിന്റെ അവസ്ഥ" (the pump's), the model's own "പമ്പൾ" and the fused
        # "മണ്നില്ലത്രാ" — and an exact-token match loses the whole command,
        # which is what the user reported on 2026-11-18.  Only tokens no device
        # has already claimed are looked at, and only the *spelling* tolerance of
        # `same_word` applies (`allow_edit=False`): one edit on every device word
        # of every sentence was too loose — "band" (Hindi for "off") matched the
        # water alias "pani" through nesting consonants, and "light band karo"
        # came back ambiguous.  A state word gets neither tolerance: "on" and
        # "off" differ exactly at their endings.
        claimed = {index for start, n, _ in hits for index in range(start, start + n)}
        sounds = self._device_sounds(language)
        for index, token in enumerate(tokens):
            if index in claimed:
                continue
            roman = romanise(token)
            for name, aliases in sounds.items():
                if any(
                    same_word(roman, alias, allow_suffix=True, allow_edit=False)
                    for alias in aliases
                ):
                    hits.append((index, 1, name))
                    break
        return sorted(hits)

    def _state_hits(self, tokens: list[str], language: str) -> list[tuple[int, int, str]]:
        hits: list[tuple[int, int, str]] = []
        for name, aliases in self.states.items():
            for start, n, _ in self._find(tokens, aliases.get(language)):
                hits.append((start, n, name))
        return sorted(hits)

    def _verb_hits(self, tokens: list[str], language: str) -> list[tuple[int, int, str]]:
        g = self.grammar.get(language, {})
        verbs = g.get("verbs") or []
        if language == "en":
            return self._en_verb_hit(tokens, verbs)
        return self._find(tokens, verbs)

    def _watering(self, tokens: list[str], language: str) -> str | None:
        spec = self.watering.get(language)
        if not spec:
            return None
        if not self._find(tokens, spec.get("cue")):
            return None
        if self._find(tokens, spec.get("stop")):
            return "off"
        if self._find(tokens, spec.get("start")):
            return "on"
        return "on"

    def _unaccounted(self, tokens: list[str], language: str) -> list[str]:
        """English words no rule consumed.  A leftover noun means the sentence
        asked for something this build cannot do, so nothing is actuated."""
        g = self.grammar.get(language, {})
        known: list[str] = list(EN_FILLERS) if language == "en" else []
        for group in ("polite", "request_modals", "question_starts", "question_suffixes",
                      "hypothetical", "corrections", "negations", "pronouns", "copulas",
                      "verbs", "status_words", "fillers"):
            known.extend(g.get(group, []))
        known.extend(["help", "commands", "what can you do"])
        for aliases in self.devices.values():
            known.extend(aliases.get(language, []))
        for aliases in self.states.values():
            known.extend(aliases.get(language, []))
        for spec in self.watering.values():
            for key in ("cue", "start", "stop"):
                known.extend(spec.get(key, []))
        covered: set[int] = set()
        for start, n, _ in self._find(tokens, known):
            covered.update(range(start, start + n))
        # A device name counts as understood however it was read.  The device
        # matcher already tolerates the case ending Malayalam puts on the noun
        # and the model's own spellings ("വിളക്കുകള്" with ് rather than ൾ,
        # "പമ്പൾ", "മണ്നില്ലത്രാ"), so asking the visitor to repeat a sentence
        # whose device was read perfectly is the refusal reported on 2026-11-18.
        # One definition: the same hits the command path uses.
        for index, _n, _name in self._device_hits(tokens, language):
            covered.add(index)
        # inflected English verbs count as understood
        for index, token in enumerate(tokens):
            if index in covered:
                continue
            if self._en_base(token, set(g.get("verbs") or [])):
                covered.add(index)
        return [token for index, token in enumerate(tokens) if index not in covered]

    # -------------------------------------------------------------- fallback
    def _phrase_fallback(self, tokens: list[str], language: str, allow: bool) -> dict[str, Any] | None:
        """Exact catalogue phrases, used only where structure found nothing.

        This is what keeps the hand-written Malayalam/Hindi phrases (and a few
        English ones) working when their word order or inflection is outside the
        structural rules.  It is whole-phrase coverage, not a substring search,
        and a question or a negated sentence is never allowed through.
        """
        if not allow:
            return None
        token_set = set(tokens)
        # A catalogue phrase is the *whole* sentence, so it must also cover the
        # words no rule knows.  Without this, the one-word phrase "status" made
        # "bin status" a village-status question (2026-11-18) — the extra noun
        # was simply ignored, and the visitor was answered about something else.
        unaccounted = set(self._unaccounted(tokens, language))
        scored: list[tuple[float, str, str]] = []
        for intent in self.data["intents"]:
            for phrase in intent["phrases"].get(language, []):
                phrase_tokens = self._tokens(phrase)
                if not phrase_tokens:
                    continue
                if any(token not in token_set for token in phrase_tokens):
                    continue
                phrase_set = set(phrase_tokens)
                if any(token not in phrase_set for token in unaccounted):
                    continue
                unmatched = sum(1 for token in tokens if token not in phrase_set)
                score = 1.0 + min(len(phrase_tokens), 8) * 0.001 - 0.03 * unmatched
                scored.append((score, intent["id"], phrase))
        if not scored:
            return None
        scored.sort(reverse=True)
        best_score, best_id, best_phrase = scored[0]
        second = next((row for row in scored[1:] if row[1] != best_id), None)
        if second is not None and abs(best_score - second[0]) < 0.02:
            return self._result("ambiguous", language, "ambiguous_generic")
        intent = self.by_id[best_id]
        command = intent.get("command")
        return self._intent_result(
            best_id, language,
            device=None,
            action=None,
            matched_phrase=best_phrase,
            command_override=command,
        )

    # --------------------------------------------------------------- results
    def _intent_result(
        self,
        intent_id: str,
        language: str,
        device: str | None,
        action: str | None,
        matched_phrase: str | None = None,
        command_override: str | None = None,
    ) -> dict[str, Any]:
        intent = self.by_id.get(intent_id)
        if intent is None:
            return self._result("unsupported", language, "unknown")
        command = command_override if command_override is not None else intent.get("command")
        kind = "status" if command is None else "command"
        response = intent.get("response", {}).get(language)
        pending = intent.get("response_pending", {}).get(language)
        done = intent.get("response_done", {}).get(language)
        already = intent.get("already_text", {}).get(language)
        return {
            "kind": kind,
            "status": "ok",
            "intent": intent_id,
            "reason": "matched",
            # Deliberately not a probability: this is a deterministic allowlist
            # with no model behind it, and showing "93%" would invent one.
            "confidence": 1.0,
            "matched_phrase": matched_phrase,
            "matched_rule": f"device:{device}" if device else "phrase",
            "message": None,
            "language": language,
            "device": device,
            "action": action,
            "command": command,
            "actuation": bool(intent.get("actuation", False)) and command is not None,
            "label": intent.get("label", {}).get(language, intent_id),
            "response_text": pending or response or "",
            "pending_text": pending or response or "",
            "done_text": done or response or "",
            "already_text": already or "",
            "clarify": None,
            "candidates": [],
            "supported": self.help_list(language),
            "unknown_message": self.unknown_message(language),
        }

    def _result(
        self,
        kind: str,
        language: str,
        message_key: str,
        device: str | None = None,
        action: str | None = None,
        clarify: str | None = None,
    ) -> dict[str, Any]:
        if message_key == "unknown":
            message = self.unknown_message(language)
            kind, status = "unsupported", "unknown"
        elif message_key == "no_speech":
            message = self.data["no_speech"].get(language, self.data["no_speech"]["en"])
            kind, status = "no_speech", "no_speech"
        else:
            table = {
                "ambiguous_lights": "ambiguous",
                "ambiguous_generic": "ambiguous_generic",
                "clarify_device": "clarify_device",
                "statement": "statement",
                "hypothetical": "hypothetical",
                "negated": "negated",
            }
            message = self.messages.get(table.get(message_key, message_key), {}).get(language, "")
            status = kind
        return {
            "kind": kind,
            "status": status,
            "intent": {
                "negated": "NEGATED",
                "ambiguous": "AMBIGUOUS",
                "statement": "STATEMENT",
                "hypothetical": "HYPOTHETICAL",
                "unsupported": "UNKNOWN",
                "no_speech": "NO_SPEECH",
            }.get(kind, "UNKNOWN"),
            "reason": kind,
            # Deliberately not a probability.  This parser is a deterministic
            # allowlist; a percentage would invent a model that is not here.
            "confidence": 0.0,
            "matched_phrase": None,
            "matched_rule": None,
            "message": message,
            "language": language,
            "device": device,
            "action": action,
            "command": None,
            "actuation": False,
            "label": None,
            "response_text": message,
            "pending_text": "",
            "done_text": "",
            "already_text": "",
            "clarify": clarify,
            "candidates": [],
            "supported": self.help_list(language),
            "unknown_message": message,
        }

    # ------------------------------------------------------------------ help
    def help_list(self, language: str) -> list[dict[str, Any]]:
        language = language if language in self.languages else "en"
        result = []
        for intent_id in self.data["help_order"]:
            intent = self.by_id.get(intent_id)
            if intent is None:
                continue
            result.append(
                {
                    "id": intent_id,
                    "label": intent["label"].get(language, intent_id),
                    "actuation": bool(intent.get("actuation", False)),
                    "command": intent.get("command"),
                    "phrases": intent.get("phrases", {}).get(language, []),
                }
            )
        return result

    def languages_meta(self) -> list[dict[str, str]]:
        return self.data["languages"]

    def unknown_message(self, language: str) -> str:
        return self.data["unknown"].get(language, self.data["unknown"]["en"])

    def response(self, intent_id: str, language: str, kind: str = "response") -> str:
        intent = self.by_id.get(intent_id)
        if intent is None:
            return ""
        return intent.get(kind, {}).get(language, "")

    def command_for(self, intent_id: str) -> str | None:
        intent = self.by_id.get(intent_id)
        return intent.get("command") if intent else None
