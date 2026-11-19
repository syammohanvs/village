from __future__ import annotations

import pytest

from app.intents import IntentMatcher


@pytest.fixture(scope="module")
def matcher() -> IntentMatcher:
    from app.config import Settings as AppSettings

    return IntentMatcher(AppSettings.load().intents_path)


def kind(result: dict) -> str:
    return result["kind"]


# ---------------------------------------------------------------------------
# The exact commands that already existed must keep working, unchanged.
# ---------------------------------------------------------------------------
def test_existing_exact_commands(matcher: IntentMatcher) -> None:
    assert matcher.match("lights on", "en")["command"] == "LIGHTS_ON"
    assert matcher.match("lights off", "en")["command"] == "LIGHTS_OFF"
    assert matcher.match("start irrigation", "en")["intent"] == "IRRIGATION_START"
    assert matcher.match("stop the pump", "en")["intent"] == "IRRIGATION_STOP"
    assert matcher.match("village status", "en")["intent"] == "VILLAGE_STATUS"
    assert matcher.match("is the soil dry", "en")["intent"] == "SOIL_STATUS"
    assert matcher.match("water availability", "en")["intent"] == "WATER_STATUS"
    assert matcher.match("help", "en")["intent"] == "HELP"


# ---------------------------------------------------------------------------
# Natural language: the same act, said many ways.
# ---------------------------------------------------------------------------
def test_polite_and_natural_requests_are_the_same_action(matcher: IntentMatcher) -> None:
    for text in (
        "Lights off",
        "Please switch the lights off",
        "Can you turn off the streetlights?",
        "Switch the lights off, please",
        "I want the lights turned off",
        "Could you please turn off the lights",
        "Kindly switch off the lamps",
        "Please turn off the lights now",
        "turn the lights off",
        "streetlights off",
    ):
        result = matcher.match(text, "en")
        assert result["kind"] == "command", text
        assert result["command"] == "LIGHTS_OFF", text
        assert result["actuation"] is True, text

    for text in (
        "turn on the lights",
        "please put the lights on",
        "switch the lamps on",
        "can you turn on the street lights?",
        "I would like the lights turned on",
    ):
        assert matcher.match(text, "en")["command"] == "LIGHTS_ON", text


def test_device_aliases_are_recognised(matcher: IntentMatcher) -> None:
    for alias in ("light", "lights", "lamps", "lamp", "street lights", "streetlights", "bulbs"):
        result = matcher.match(f"turn off the {alias}", "en")
        assert result["command"] == "LIGHTS_OFF", alias


def test_automatic_mode(matcher: IntentMatcher) -> None:
    for text in ("lights automatic", "set the lights to automatic", "auto mode for the lights"):
        assert matcher.match(text, "en")["command"] == "LIGHTS_AUTO", text


def test_watering_variations(matcher: IntentMatcher) -> None:
    for text in ("start watering", "water the plants", "start the pump", "turn on the pump",
                 "begin irrigation"):
        assert matcher.match(text, "en")["command"] == "IRRIGATION_REQUEST", text
    for text in ("stop watering", "stop the pump", "turn off the pump", "end irrigation"):
        assert matcher.match(text, "en")["command"] == "IRRIGATION_STOP", text


# ---------------------------------------------------------------------------
# Meaning, not word removal.
# ---------------------------------------------------------------------------
def test_negated_requests_do_nothing(matcher: IntentMatcher) -> None:
    for text in (
        "Don't switch off the lights",
        "do not turn off the lights",
        "never stop irrigation",
        "not water the plants",
        "don't water the plants",
        "please don't turn the lights off",
    ):
        result = matcher.match(text, "en")
        assert result["kind"] == "negated", text
        assert result["command"] is None, text
        assert result["actuation"] is False, text


def test_status_questions_do_not_act(matcher: IntentMatcher) -> None:
    for text, intent in (
        ("Are the lights off?", "LIGHTS_STATUS"),
        ("are the lights on?", "LIGHTS_STATUS"),
        ("is the light on?", "LIGHTS_STATUS"),
        ("what are the lights doing?", "LIGHTS_STATUS"),
        ("Are the lights on or off?", "LIGHTS_STATUS"),
        ("is the pump running?", "PUMP_STATUS"),
        ("is watering on?", "PUMP_STATUS"),
        ("what is the soil moisture?", "SOIL_STATUS"),
        ("how much water is in the tank?", "WATER_STATUS"),
    ):
        result = matcher.match(text, "en")
        assert result["kind"] == "status", text
        assert result["intent"] == intent, text
        assert result["command"] is None, text
        assert result["actuation"] is False, text


def test_statements_do_not_act(matcher: IntentMatcher) -> None:
    for text in ("The lights are off", "the lights are on", "the pump is running",
                 "the soil is dry"):
        result = matcher.match(text, "en")
        assert result["kind"] == "statement", text
        assert result["command"] is None, text


def test_hypothetical_questions_do_not_act(matcher: IntentMatcher) -> None:
    for text in (
        "What happens if I switch off the lights?",
        "what if I turn on the pump",
        "should I water the plants",
        "can I switch off the lights",
        "how do I turn on the lights",
        "what happens if the tank is empty",
    ):
        result = matcher.match(text, "en")
        assert result["kind"] == "hypothetical", text
        assert result["command"] is None, text


def test_conflicts_and_multiple_commands_are_refused(matcher: IntentMatcher) -> None:
    for text in (
        "Turn the lights on… no, off",
        "lights on and lights off",
        "turn off the lights and start watering",
        "switch off the lights and turn on the fan",
    ):
        result = matcher.match(text, "en")
        assert result["kind"] == "ambiguous", text
        assert result["command"] is None, text

    correction = matcher.match("Turn the lights on… no, off", "en")
    assert correction["clarify"] == "correction" or "on or off" in correction["message"]


def test_an_unclear_device_asks_which_one(matcher: IntentMatcher) -> None:
    for text in ("turn it off", "switch that on", "do the same"):
        result = matcher.match(text, "en")
        assert result["kind"] == "ambiguous", text
        assert "Which device" in result["message"], text
        assert result["command"] is None, text

    bare = matcher.match("lights", "en")
    assert bare["kind"] == "ambiguous"
    assert bare["command"] is None


def test_unsupported_requests_do_nothing(matcher: IntentMatcher) -> None:
    for text in ("make me a sandwich", "open the gate", "play music"):
        result = matcher.match(text, "en")
        assert result["kind"] == "unsupported", text
        assert result["command"] is None, text
        assert "Gram Sahayak" in result["message"], text
        assert result["confidence"] == 0.0


def test_a_state_word_with_no_device_asks_which_device(matcher: IntentMatcher) -> None:
    """`Thanks on!` / `Bounce on!` — "pump on", after a speech model.

    Three recordings from this exhibit's own log (2026-11-18, two children
    speaking English) came back as "Thanks on!", "Bounce on!" and "Dumb on!",
    and each was answered "please ask me to control a supported device" — a
    sentence that names nothing and leaves the visitor nowhere to go.  A state
    word with no device is *half* a command, so the panel now asks for the other
    half and sends nothing.  A device asked for and not offered ("turn on the
    fan") gets the same answer, which is the honest one: it names what can be
    switched.
    """
    for text in ("Thanks on!", "Bounce on!", "turn on the fan", "on"):
        result = matcher.match(text, "en")
        assert result["kind"] == "ambiguous", text
        assert "Which device" in result["message"], text
        assert result["command"] is None, text

    # …one of the three now reads, and not by a rule written for it: the fold
    # that makes voiced and unvoiced consonants the same letter (d→t, for the
    # Indic languages) makes "led" — a lights alias — and "let" the same word,
    # so "Let off!" is the lights' off.  Which is exactly what the child said.
    assert matcher.match("Let off!", "en")["command"] == "LIGHTS_OFF"

    # …and the question it asks can be answered: a device with no state asks
    # for the state instead of repeating "say one clear command".
    for text in ("pump", "lights", "the streetlights"):
        result = matcher.match(text, "en")
        assert "On, off, or automatic" in (result["message"] or ""), text
        assert result["command"] is None, text
    # A device that only answers questions is never offered a switch it has not
    # got — soil and water have no on/off.
    for text in ("water", "soil", "moisture"):
        result = matcher.match(text, "en")
        assert "On, off, or automatic" not in (result["message"] or ""), text
        assert result["command"] is None, text


def test_the_word_pump_is_what_a_speech_model_gets_wrong(matcher: IntentMatcher) -> None:
    """"Pump on" heard as "Bum on!" — the voice, not the child.

    Measured on 2026-11-18 with the exhibit's own voices read back through the
    running Whisper server: the **Indian English voice** saying "Pump on!" is
    transcribed `Bum on!` by whisper-base *and* by whisper-small, and the two
    children in the room that evening produced `Dumb on!` and `Bounce on!` for
    the same two words.  So the model is not the fault — the word "pump" is
    short, and every mishearing of it is one syllable ending in the same
    consonant.  The spellings this exhibit has actually produced are listed on
    the pump, and each is pinned here.
    """
    for text in ("Bum on!", "Bum on.", "Dumb on!", "Bump on!", "Thumb on!", "Pomp on!"):
        result = matcher.match(text, "en")
        assert result["command"] == "IRRIGATION_REQUEST", text
    # The same spellings with "off" are a stop, and "pump off" stays a stop.
    assert matcher.match("Dumb off!", "en")["command"] == "IRRIGATION_STOP"
    # "don't" is still a refusal — a misheard device word does not outrank it.
    assert matcher.match("Don't hold the bump.", "en")["kind"] == "negated"
    # A sentence with words this build does not know is still refused whole,
    # even when one of them sounded like the pump.
    assert matcher.match("Get on the phone, the thumb.", "en")["command"] is None


def test_no_speech_is_reported(matcher: IntentMatcher) -> None:
    for text in ("", "   ", "[BLANK_AUDIO]", "(silence)"):
        result = matcher.match(text, "en")
        assert result["kind"] == "no_speech"
        assert result["command"] is None
        assert "No speech" in result["message"]


# ---------------------------------------------------------------------------
# The same rules in the other supported languages.
# ---------------------------------------------------------------------------
def test_malayalam(matcher: IntentMatcher) -> None:
    assert matcher.match("വിളക്കുകൾ അണയ്ക്കുക", "ml")["command"] == "LIGHTS_OFF"
    assert matcher.match("വിളക്കുകൾ കത്തിക്കുക", "ml")["command"] == "LIGHTS_ON"
    assert matcher.match("പമ്പ് ഓഫ് ചെയ്യുക", "ml")["command"] == "IRRIGATION_STOP"
    assert matcher.match("പമ്പ് ഓൺ ചെയ്യുക", "ml")["command"] == "IRRIGATION_REQUEST"
    assert matcher.match("നനയ്ക്കാൻ തുടങ്ങുക", "ml")["command"] == "IRRIGATION_REQUEST"
    assert matcher.match("വിളക്കുകൾ കത്തുന്നുണ്ടോ", "ml")["intent"] == "LIGHTS_STATUS"
    neg = matcher.match("നനയ്ക്കാൻ തുടങ്ങുക വേണ്ട", "ml")
    assert neg["kind"] == "negated" and neg["command"] is None


def test_hindi(matcher: IntentMatcher) -> None:
    assert matcher.match("लाइट बंद करो", "hi")["command"] == "LIGHTS_OFF"
    assert matcher.match("लाइट चालू करो", "hi")["command"] == "LIGHTS_ON"
    assert matcher.match("पंप बंद करो", "hi")["command"] == "IRRIGATION_STOP"
    assert matcher.match("सिंचाई शुरू करो", "hi")["command"] == "IRRIGATION_REQUEST"
    assert matcher.match("पानी देना बंद करो", "hi")["command"] == "IRRIGATION_STOP"
    assert matcher.match("लाइटें जल रही हैं क्या?", "hi")["intent"] == "LIGHTS_STATUS"
    hypo = matcher.match("क्या मैं लाइट बंद करूँ", "hi")
    assert hypo["kind"] == "hypothetical" and hypo["command"] is None


def test_code_mixed_phrases(matcher: IntentMatcher) -> None:
    assert matcher.match("light off", "ml")["command"] == "LIGHTS_OFF"
    assert matcher.match("light band karo", "hi")["command"] == "LIGHTS_OFF"
    assert matcher.match("pump on cheyyuka", "ml")["command"] == "IRRIGATION_REQUEST"


# ---------------------------------------------------------------------------
# Result shape and catalogue.
# ---------------------------------------------------------------------------
def test_result_shape_is_structured(matcher: IntentMatcher) -> None:
    result = matcher.match("Please switch the lights off", "en")
    assert result["kind"] == "command"
    assert result["device"] == "lights"
    assert result["action"] == "off"
    assert result["intent"] == "LIGHTS_OFF"
    assert result["pending_text"]
    assert result["done_text"]
    assert result["already_text"] == "The lights are already off."
    assert result["language"] == "en"
    # Deterministic allowlist: a match is 1.0, not a model probability.
    assert result["confidence"] in (0.0, 1.0)


def test_help_lists_every_supported_command(matcher: IntentMatcher) -> None:
    for language in ("en", "ml", "hi"):
        help_list = matcher.help_list(language)
        # BIN_STATUS was removed on 2026-11-18 — the three bins are LEDs lit by
        # the classifier and nothing measures them — and PUMP_AUTO was added,
        # so the count is unchanged.
        assert len(help_list) == 12
        assert all(item["label"] for item in help_list)
        assert any(item["id"] == "IRRIGATION_START" for item in help_list)
        assert any(item["id"] == "LIGHTS_STATUS" for item in help_list)
        assert any(item["id"] == "PUMP_AUTO" for item in help_list)
        assert all(item["id"] != "BIN_STATUS" for item in help_list)


# ---------------------------------------------------------------------------
# The HTTP route a typed request uses, against the real router.
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_typed_request_uses_the_same_parser(tmp_path) -> None:
    from tests.conftest import client_for, make_settings

    settings = make_settings(tmp_path)
    async with client_for(settings) as (client, _gateway, _app):
        natural = await client.post(
            "/api/v1/voice/interpret",
            json={"text": "Could you please switch the lights off?", "language": "en"},
        )
        assert natural.status_code == 200
        body = natural.json()
        assert body["command"] == "LIGHTS_OFF"
        assert body["kind"] == "command"
        assert body["transcript"].startswith("Could you")

        question = await client.post(
            "/api/v1/voice/interpret",
            json={"text": "Are the lights off?", "language": "en"},
        )
        assert question.status_code == 200
        assert question.json()["command"] is None
        assert question.json()["kind"] == "status"

        bad = await client.post(
            "/api/v1/voice/interpret", json={"text": "", "language": "en"}
        )
        assert bad.status_code == 422


# ---------------------------------------------------------------------------
# Review points: bins are not a device, polite requests vs advice, and the
# exact Malayalam/Hindi sentences that fail when only sentence endings are
# inspected.
# ---------------------------------------------------------------------------
def test_bins_are_not_a_status_this_app_can_report(matcher: IntentMatcher) -> None:
    """The three bins are LEDs lit by the classifier — nothing measures them.

    There used to be a BIN_STATUS command that only ever said "our model does
    not measure bin fullness".  It was removed on 2026-11-18: a catalogue entry
    is a promise that asking about it does something, and this one could only
    answer that it cannot answer.
    """
    assert all(item["id"] != "BIN_STATUS" for item in matcher.help_list("en"))
    # It is no longer recognised as a device, so the sentence is answered like
    # any other unsupported request — not with a status it does not have.
    for text in ("bin status", "are the bins full", "is the bin full"):
        result = matcher.match(text, "en")
        assert result["kind"] == "unsupported", text
        assert result["intent"] == "UNKNOWN", text
        assert result["command"] is None, text
    # The help sentence must not list it either.
    for language in ("en", "ml", "hi"):
        assert "bin" not in matcher.match("help", language)["response_text"].lower()


def test_polite_requests_are_commands_but_advice_is_not(matcher: IntentMatcher) -> None:
    for text in (
        "Can you turn off the streetlights?",
        "Could you please switch the lights off?",
        "Would you please turn the lights off?",
        "Will you switch the lights off?",
    ):
        result = matcher.match(text, "en")
        assert result["kind"] == "command", text
        assert result["command"] == "LIGHTS_OFF", text

    for text in ("Can I turn off the lights?", "May I switch the lights off?",
                 "Should I turn off the lights?"):
        assert matcher.match(text, "en")["kind"] == "hypothetical", text

    # the polite form sits at the end in Malayalam and Hindi
    assert matcher.match("ലൈറ്റ് ഓഫ് ചെയ്യാമോ?", "ml")["command"] == "LIGHTS_OFF"
    assert matcher.match("क्या आप लाइट बंद कर सकते हैं?", "hi")["command"] == "LIGHTS_OFF"


def test_malayalam_negation_question_and_request(matcher: IntentMatcher) -> None:
    neg = matcher.match("ലൈറ്റ് ഓഫ് ചെയ്യരുത്", "ml")
    assert neg["kind"] == "negated" and neg["command"] is None

    question = matcher.match("ലൈറ്റ് ഓഫ് ആണോ?", "ml")
    assert question["kind"] == "status"
    assert question["intent"] == "LIGHTS_STATUS"
    assert question["command"] is None

    request = matcher.match("ലൈറ്റ് ഓഫ് ചെയ്യാമോ?", "ml")
    assert request["kind"] == "command"
    assert request["command"] == "LIGHTS_OFF"


def test_hindi_negation_question_and_polite_request(matcher: IntentMatcher) -> None:
    neg = matcher.match("लाइट बंद मत करो", "hi")
    assert neg["kind"] == "negated" and neg["command"] is None

    question = matcher.match("क्या लाइट बंद है?", "hi")
    assert question["kind"] == "status"
    assert question["intent"] == "LIGHTS_STATUS"
    assert question["command"] is None

    request = matcher.match("क्या आप लाइट बंद कर सकते हैं?", "hi")
    assert request["kind"] == "command"
    assert request["command"] == "LIGHTS_OFF"


def test_a_supported_command_plus_an_unsupported_action_refuses_in_every_language(
    matcher: IntentMatcher,
) -> None:
    for text, language in (
        ("turn off the lights and open the gate", "en"),
        ("വിളക്കുകൾ അണയ്ക്കുക ഗേറ്റ് തുറക്കുക", "ml"),
        ("लाइट बंद करो और गेट खोलो", "hi"),
    ):
        result = matcher.match(text, language)
        assert result["kind"] == "ambiguous", text
        assert result["command"] is None, text
        assert result["actuation"] is False, text


# ---------------------------------------------------------------------------
# A transcript in a sister script is still the same sentence (2026-11-17).
# ---------------------------------------------------------------------------
def test_a_tamil_transcript_of_a_malayalam_command_is_understood(matcher: IntentMatcher) -> None:
    """The measured failure: whisper answered Malayalam in Tamil script.

    "വിളക്കുകൾ അണയ്ക്കുക" came back as "விலக்குகள் ஆனக்குக்கா" — the same words,
    letter for letter, in the script next door.  The parser answered
    "unsupported" because its vocabulary is written in Malayalam, which is what
    the visitor heard as "it does not understand Malayalam".
    """
    for said in ("விலக்குகள் ஆனக்குக்கா", "விலக்குகள் அனக்குக்கா", "விலக்குகள் ஆனக்குக்கா."):
        result = matcher.match(said, "ml")
        assert result["command"] == "LIGHTS_OFF", said
        assert result["status"] == "ok"


def test_the_same_fallback_reads_a_lamps_on_request(matcher: IntentMatcher) -> None:
    assert matcher.match("വിളക്കുകൾ കത്തിക്കുക", "ml")["command"] == "LIGHTS_ON"
    # The Tamil form of the same two words.
    assert matcher.match("விலக்குகள் கத்திக்குக்கா", "ml")["command"] == "LIGHTS_ON"


def test_english_words_are_read_while_malayalam_is_chosen(matcher: IntentMatcher) -> None:
    assert matcher.match("light off", "ml")["command"] == "LIGHTS_OFF"
    assert matcher.match("lights on", "ml")["command"] == "LIGHTS_ON"


def test_an_unreadable_pump_state_never_starts_the_pump(matcher: IntentMatcher) -> None:
    """A pump word with a state the reader could not match is not "start".

    "பம்ப் ஆஃப்" (pump off, in Tamil letters) once came back as
    IRRIGATION_REQUEST through the sound-alike path — one wrong answer away from
    opening the valve on a request to close it.  Both halves must match.
    """
    # The same sentence is now read correctly (Tamil letters, Malayalam
    # chosen): "stop" is in the catalogue as the phrase it is.  What must never
    # change is the direction - a request to close the valve is not a request
    # to open it.
    result = matcher.match("பம்ப் ஆஃப்", "ml")
    assert result.get("command") == "IRRIGATION_STOP"
    assert result.get("command") != "IRRIGATION_REQUEST"


def test_sound_alike_matching_does_not_invent_commands(matcher: IntentMatcher) -> None:
    for said in ("अजगर कुर्सी", "இன்று வானிலை எப்படி", "quantum flux capacitor"):
        result = matcher.match(said, "ml")
        assert result["status"] == "unknown", said
        assert result.get("command") in (None, "")


def test_phonetics_put_both_scripts_on_one_key() -> None:
    from app.phonetics import fold, romanise, same_word, script_of, to_malayalam

    assert script_of("വിളക്കുകൾ") == "ml"
    assert script_of("விலக்குகள்") == "ta"
    assert script_of("lights") is None

    # Tamil shifted into the Malayalam block, then one romanisation table.
    # (Compared by what they sound like, not by codepoint: Tamil writes the
    # final ള് as an explicit virama where Malayalam uses the atomic ൾ.)
    assert romanise(to_malayalam("விலக்குகள்")) == romanise("വിളക്കുകൾ")
    assert romanise("വിളക്കുകൾ അണയ്ക്കുക") == "vilakkukal anaykkuka"
    assert romanise("விலக்குகள் ஆனக்குக்கா") == "vilakkukal anakkukka"
    assert fold("anaykkuka") == fold("anakkukka") == "anakuka"
    assert same_word("vilakkukal", romanise("விலக்குகள்"))

    # The atomic chillu letters carry the last letter of the word.
    assert romanise("വിളക്കുകൾ").endswith("l")

    # Measured and rejected: one edit of tolerance turned "turn off" into
    # "water".  Only an exact folded match (or a long word one letter apart)
    # counts.
    assert not same_word("anakkukka", "nanaykkuka")
    assert same_word("kattikkuka", "kathikkuka")


def test_a_long_word_one_letter_apart_is_still_the_same_word(matcher: IntentMatcher) -> None:
    """The label does not have to be spelled exactly as the book says.

    "விலக்குங்கள் காத்திக்குக்கா" (what the log recorded on 2026-11-17) folds to
    "vilakunkal katikuka": one inserted `n` away from vilakkukal + kathikkuka.
    A long word may absorb that; a short one may not (see the pump guard).
    """
    from app.phonetics import same_word

    assert same_word("vilakkunkal", "vilakkukal")
    # Short words stay exact — this pair is one inserted letter too, and it is
    # the difference between "turn off" and "water".
    assert not same_word("anakkukka", "nanaykkuka")

    assert matcher.match("விலக்குங்கள் காத்திக்குக்கா", "ml")["command"] == "LIGHTS_ON"


# ---------------------------------------------------------------------------
# Auto for both devices (2026-11-18).  The lights had it; the pump did not, so
# "put the pump on automatic" fell through to "start watering" — the pump cue
# names the pump and `_watering` read that as a watering request.
# ---------------------------------------------------------------------------
def test_auto_is_a_command_for_the_lights_and_the_pump(matcher: IntentMatcher) -> None:
    for text in (
        "lights auto",
        "auto lights",
        "put the lights on automatic",
        "lights in automatic mode",
    ):
        assert matcher.match(text, "en")["intent"] == "LIGHTS_AUTO", text

    for text in (
        "pump auto",
        "auto pump",
        "put the pump on automatic",
        "put the pump in automatic mode",
    ):
        assert matcher.match(text, "en")["intent"] == "PUMP_AUTO", text
        # …and it is the *mode*, not a watering request.
        assert matcher.match(text, "en")["command"] == "PUMP_AUTO", text


def test_auto_is_understood_in_hindi_and_malayalam(matcher: IntentMatcher) -> None:
    for text in ("लाइट ऑटो करें", "लाइट ऑटो", "ऑटोमैटिक लाइट"):
        assert matcher.match(text, "hi")["intent"] == "LIGHTS_AUTO", text
    for text in ("पंप ऑटो करें", "पंप ऑटो", "पंप को ऑटो मोड में करें"):
        assert matcher.match(text, "hi")["intent"] == "PUMP_AUTO", text

    for text in ("വിളക്കുകൾ ഓട്ടോ ചെയ്യുക", "വിളക്കുകൾ ഓട്ടോ", "വിളക്കുകൾ ഓട്ടോ ആക്കുക"):
        assert matcher.match(text, "ml")["intent"] == "LIGHTS_AUTO", text
    for text in ("പമ്പ് ഓട്ടോ ചെയ്യുക", "പമ്പ് ഓട്ടോ", "പമ്പ് ഓട്ടോ ആക്കുക"):
        assert matcher.match(text, "ml")["intent"] == "PUMP_AUTO", text


def test_an_explicit_mode_outranks_the_preposition_and_the_pump_cue(
    matcher: IntentMatcher,
) -> None:
    # "on automatic" holds the preposition "on"; reading it as a state would make
    # the sentence two states (on + auto) and the answer "ambiguous".
    assert matcher.match("put the pump on automatic", "en")["intent"] == "PUMP_AUTO"
    # The pump cue alone still means a watering request when there is no mode.
    assert matcher.match("pump", "en")["intent"] in {"IRRIGATION_START", "AMBIGUOUS"}
    # And a real stop still stops.
    assert matcher.match("stop the pump", "en")["intent"] == "IRRIGATION_STOP"
    assert matcher.match("പമ്പ് നിർത്തുക", "ml")["intent"] == "IRRIGATION_STOP"
    assert matcher.match("पंप बंद करो", "hi")["intent"] == "IRRIGATION_STOP"


# ---------------------------------------------------------------------------
# The natural Malayalam/Hindi status questions (2026-11-18).  They are catalogue
# phrases, but the phrase fallback was skipped exactly where these land: one
# device, no state, no question mark — so a listed phrase came back AMBIGUOUS.
# Malayalam also glues the verb to the noun ("വെള്ളമുണ്ടോ"), which `_find` (whole
# words) could not see.
# ---------------------------------------------------------------------------
def test_natural_status_questions_in_malayalam_and_hindi(matcher: IntentMatcher) -> None:
    for text in (
        "മണ്ണിലെ ഈർപ്പം",
        "മണ്ണിൽ എത്ര ഈർപ്പമുണ്ട്?",
        "മണ്ണിന്റെ ഈർപ്പം എത്രയാണ്?",
        "മണ്ണ് നനവുണ്ടോ?",
    ):
        assert matcher.match(text, "ml")["intent"] == "SOIL_STATUS", text

    for text in ("മണ്ണിലെ ഈർപ്പം", "ടാങ്കിൽ വെള്ളമുണ്ടോ?", "വെള്ളം ഉണ്ടോ?"):
        want = "WATER_STATUS" if "വെള്ള" in text else "SOIL_STATUS"
        assert matcher.match(text, "ml")["intent"] == want, text

    for text in ("मिट्टी की नमी", "मिट्टी में कितनी नमी है?", "मिट्टी कितनी गीली है?"):
        assert matcher.match(text, "hi")["intent"] == "SOIL_STATUS", text
    for text in ("टंकी में पानी है?", "क्या पानी है?"):
        assert matcher.match(text, "hi")["intent"] == "WATER_STATUS", text


# ---------------------------------------------------------------------------
# What the speech model actually returns (2026-11-18).  These are the literal
# transcripts `ggml-base` produced for Malayalam audio synthesised with Sara's
# own voice: it writes Malayalam in **Tamil** script, and the question word is
# mangled while the device noun survives.  The parser must still act.
# ---------------------------------------------------------------------------
def test_whisper_style_malayalam_transcripts_are_understood(matcher: IntentMatcher) -> None:
    cases = (
        # "turn the lights on" — a command, read by sound
        ("விலகுகள் காட்டிக்குக்கா.", "LIGHTS_ON"),
        # "is there water in the tank?" — the question word is lost
        ("தாங்கில வெள்ளம்ணு", "WATER_STATUS"),
        ("Thangil Velamundo.", "WATER_STATUS"),
        # "how much moisture is in the soil?" — only the device survives
        ("மண்ணில் எத்தாக இருப்போமும் இரு.", "SOIL_STATUS"),
    )
    for text, want in cases:
        result = matcher.match(text, "ml")
        assert result["intent"] == want, text
        if want.endswith("_STATUS"):
            # A status answer moves nothing.
            assert result["command"] is None, text
            assert result["kind"] == "status", text


def test_an_unreadable_pump_command_is_never_answered_as_a_status(
    matcher: IntentMatcher,
) -> None:
    # The status-only fallback is for soil and water, whose only command *is*
    # status.  The pump has commands, so a mangled "pump off" must be refused —
    # answering it with a reading would look like the command worked.
    for text in ("பம்ப் ஆஃப்", "பம்ப் ஆன்"):
        result = matcher.match(text, "ml")
        assert result["command"] != "IRRIGATION_REQUEST", text
        assert result["intent"] != "PUMP_STATUS", text


# ---------------------------------------------------------------------------
# What the Malayalam speech model actually returns (2026-11-18).
#
# `kavyamanohar/whisper-small-malayalam` writes Malayalam script, but a spoken
# word still comes back spelled the way the model heard it: "വിളക്കുകൾ" as
# "വിലക്കുകൾ", "ഓട്ടോ" as "ഓത്ടോ", "പമ്പ്" as "പമ്പു".  The parser has to reach
# the command anyway, which is why a Malayalam sentence gets a second pass **by
# sound** once the exact-word pass has found nothing.
# ---------------------------------------------------------------------------
def test_transcripts_from_the_malayalam_speech_model_are_understood(
    matcher: IntentMatcher,
) -> None:
    cases = (
        ("തയവായി വിളക്കുകൾ കത്തിക്കുക.", "LIGHTS_ON"),
        ("വിലക്കുകൾ അനയ്കുക.", "LIGHTS_OFF"),
        ("മാന്നിൽ എത്താ ഈപ്പമുണ്ട്.", "SOIL_STATUS"),
        ("റാവ്യില് വേളമുണ്ടോ", "WATER_STATUS"),
        ("വിളക്കുകൾ ഓത്ടോ ചെയുക.", "LIGHTS_AUTO"),
        ("പമ്പു ഒപ്ര് ചെയുക.", "IRRIGATION_STOP"),
    )
    for text, want in cases:
        assert matcher.match(text, "ml")["intent"] == want, text


def test_a_hindi_sentence_heard_with_a_syllable_in_front_is_still_the_lights(
    matcher: IntentMatcher,
) -> None:
    """`बालाइट चालू` — the model's own rendering of "लाइट चालू", verbatim.

    Two faults met (2026-11-18, from the user): the word was heard with a
    syllable in front of it ("palaita" for "laita"), which the device match now
    tolerates; and `चालू` — the word for ON — is also half of the guard phrase
    "चालू मत" ("do not turn on"), so splitting that phrase made every sentence
    containing it look like a correction and the sound path refused before the
    device was read.
    """
    assert matcher.match("बालाइट चालू.", "hi")["intent"] == "LIGHTS_ON"
    assert matcher.match("लाइट चालू", "hi")["intent"] == "LIGHTS_ON"
    assert matcher.match("लाइट चालू करो", "hi")["intent"] == "LIGHTS_ON"
    # The guard it came from still works, as the phrase it is.
    assert matcher.match("लाइट मत चालू करो", "hi")["intent"] == "NEGATED"
    # A device may carry a leading syllable; a *state* may not, and "अट चालू"
    # (the model losing most of "लाइट") is still refused rather than guessed —
    # it is answered with "which device?", because the state word was read and
    # the device was not (2026-11-18).
    assert matcher.match("अट चालू.", "hi")["kind"] == "ambiguous"
    assert matcher.match("अट चालू.", "hi")["command"] is None


def test_a_water_phrase_with_no_state_word_is_the_watering_it_names(
    matcher: IntentMatcher,
) -> None:
    """`വെള്ളം നിർത്തുക` is a catalogue phrase, and it names the water.

    The structural path reads the device (water) and the state (stop), and then
    finds that water has no stop command — so a phrase the catalogue *lists*
    for stopping the watering was refused (measured 2026-11-18).  The listed
    phrase now answers before the structural guess refuses.
    """
    assert matcher.match("വെള്ളം നിർത്തുക", "ml")["intent"] == "IRRIGATION_STOP"
    assert matcher.match("വെള്ളം ഒഴിക്കുക", "ml")["intent"] == "IRRIGATION_START"
    # …and a bare pump word is still not "start": a sentence whose state the
    # chosen language cannot read must never open the valve.  It is not read as
    # *watering* — the device is recognised (a Devanagari "पंप" is the same
    # pump), so the answer is the question "on, off, or automatic?" and nothing
    # is sent (2026-11-18: the device matcher now reads spellings, so this is
    # no longer "unsupported" — the guarantee that matters is unchanged).
    refused = matcher.match("पंप बंद", "ml")
    assert refused["command"] is None
    assert refused["intent"] != "IRRIGATION_REQUEST"
    # …asked in the language the page is set to.
    assert "ഓണാക്കണോ" in (refused["message"] or "")


def test_the_doing_word_is_not_a_state(matcher: IntentMatcher) -> None:
    """`ചെയ്യുക` ("to do") is in half the sentences.

    It is listed inside the on/off aliases as part of the phrases "ഓൺ ചെയ്യുക" /
    "ഓഫ് ചെയ്യുക", and the by-sound pass splits aliases into their words — so it
    matched *both* states and made "വിളക്കുകൾ ഓത്ടോ ചെയുക" three states at once.
    Verb spellings are now dropped from the by-sound path.
    """
    assert matcher.match("വിളക്കുകൾ ഓത്ടോ ചെയുക.", "ml")["intent"] == "LIGHTS_AUTO"
    # The same sentence with the model's other spelling of "auto": the doing
    # word must not turn it into two states.
    assert matcher.match("വിലക്കുകള്‍ ഓെട്ടു ചെയുക.", "ml")["intent"] == "LIGHTS_AUTO"
    assert matcher.match("പമ്പ് ഒട്ടോ ചെയുക.", "ml")["intent"] == "PUMP_AUTO"
    # …and the phrases it belongs to still mean what they say.
    assert matcher.match("പമ്പ് ഓൺ ചെയ്യുക", "ml")["intent"] == "IRRIGATION_START"
    assert matcher.match("പമ്പ് ഓഫ് ചെയ്യുക", "ml")["intent"] == "IRRIGATION_STOP"


# ---------------------------------------------------------------------------
# The user's own Malayalam recordings (2026-11-18, taken from the app's event
# log — these are the literal transcripts `whisper-small-malayalam` produced).
#
# "Pump auto" was the phrase that would not work.  The model spells the two
# words differently on every recording: the pump as "പംമ്" / "പംഭ്" (the
# anusvara before a labial sounds like `m`) and auto as "അട്ടോ" / "ഓെട്ടോ" /
# "ഓത്ടു".  Both had to be reachable by sound.
# ---------------------------------------------------------------------------
def test_pump_auto_from_the_users_own_recordings(matcher: IntentMatcher) -> None:
    for text in ("പംമ് അട്ടോ", "പംഭ് അട്ടോ", "പമ് ഓത്.", "പമ്പ് ഓട്ടോ ചെയ്യുക"):
        assert matcher.match(text, "ml")["intent"] == "PUMP_AUTO", text


def test_automatic_is_one_mode_however_the_model_splits_it(
    matcher: IntentMatcher,
) -> None:
    """Every one of these is a recording of "pump auto" from this exhibit.

    "Automatic" arrives as two words ("ഓട്ടോ മാടിക്"), as one
    ("ഓട്ടുമാറ്റിക്", "ഓെട്ടുമാട്ടിക്"), with the pump's own consonant inside it
    ("പോട്ടു"), and with the pump's name misspelt ("പമ്വ്").  All four were
    refused before 2026-11-18: the unknown half of "automatic" made the whole
    sentence unaccounted, and "പോട്ടു" matched nothing at all.
    """
    for text in (
        "പമ്പ് ഓട്ടോ മാടിക്.",
        "പമ്പ് ഓട്ടുമാറ്റിക്.",
        "പമ്പു ഓെട്ടുമാട്ടിക്.",
        "പമ്വ് ഓട്ടോ ചെയുക.",
        "പമ്പ് പോട്ടു.",
        "പമ്പ് ഓട്ടോ മാട്ടിക്.",
    ):
        assert matcher.match(text, "ml")["intent"] == "PUMP_AUTO", text

    # The merged word is read as the mode **only after a pump word**.  On its
    # own it could be anything, and nothing may be guessed from a stray sound.
    assert matcher.match("പോട്ടു.", "ml")["kind"] != "command"
    assert matcher.match("അത് പോട്ടു.", "ml")["kind"] != "command"


def test_pump_off_is_not_swallowed_by_the_pump_cue(matcher: IntentMatcher) -> None:
    """Pump off, said with the model's own spelling of "off" — `പമ്പ് അഫ്`.

    Two faults met here (measured 2026-11-18).  The sound path dropped every
    verb, and `ഓഫ്` is listed as one ("ഓഫ് ചെയ്യുക"), so the only `off` it could
    reach was in a script the word was not written in.  And once a state *was*
    read, the pump cue — the word "pump" also means "start watering" —
    overwrote it, so "pump off" started the pump.
    """
    for text in ("പമ്പ് അഫ്.", "പമ്പ് അഫ് ചെയ്യുക", "പമ്പ് ഓഫ്", "പമ്പ് ഓഫ് ചെയ്യുക"):
        assert matcher.match(text, "ml")["intent"] == "IRRIGATION_STOP", text
    # The same spelling on the lights is the lights' off.
    assert matcher.match("വിളക്കുകൾ അഫ്", "ml")["intent"] == "LIGHTS_OFF"
    # …and the cue still starts a watering request when no state is named.
    assert matcher.match("പമ്പ് വെള്ളം ഒഴിക്കുക", "ml")["intent"] == "IRRIGATION_START"
    assert matcher.match("വെള്ളം ഒഴിക്കുക", "ml")["intent"] == "IRRIGATION_START"
    # "On" is still "on", not "off".
    assert matcher.match("പമ്പ് ഓൺ", "ml")["intent"] == "IRRIGATION_START"


def test_the_latest_unrecognised_recordings_are_understood(
    matcher: IntentMatcher,
) -> None:
    """The three sentences that came back UNKNOWN on 2026-11-18, verbatim.

    Each was in the app's own event log, which is why they are worth a test:
    the model writes a case ending on the pump ("പംമ്പേ"), the genitive of
    "soil" plus its own spelling of "moisture" ("മണ്നിന്റെ ഏർപ്പം"), and the
    verb of "turn off" with the vowel in the wrong place
    ("അനയ്ക്കുകാന്‍").
    """
    assert matcher.match("വിലക്കുകള്‍ അനയ്ക്കുകാന്‍", "ml")["intent"] == "LIGHTS_OFF"
    assert matcher.match("വിളക്കുകള്‍ കത്യകുകാ", "ml")["intent"] == "LIGHTS_ON"
    assert matcher.match("മണ്നിന്റെ ഏര്‍പ്പം?", "ml")["intent"] == "SOIL_STATUS"
    assert matcher.match("പംമ്പേ അട്ടോ?", "ml")["intent"] == "PUMP_STATUS"
    # "make it on" is said as one word, and it is still a request to water.
    assert matcher.match("പമ്പ് ഹോണാക്കുകാ.", "ml")["intent"] == "IRRIGATION_START"
    # The verb's ending was in the verb list but not this spelling of it.
    assert matcher.match("പംപ്പു ഒപ്ര് ചെയുകാ", "ml")["intent"] == "IRRIGATION_STOP"


def test_one_wrong_vowel_is_read_only_where_the_word_starts_the_same() -> None:
    from app.phonetics import same_word

    # "katyakuka" (heard) and "kathikkuka" (turn on) differ in one vowel in the
    # middle; the word is still the same one.
    assert same_word("katyakuka", "kathikkuka")
    # "anakukan" (turn off) and "anakuka" (turn off) differ by one letter too.
    assert same_word("anakukan", "anakuka")
    # The pair this must never join: "anakuka" (turn off) and "nanakuka"
    # (water) differ at the first letter, which is where a slip changes the
    # word - the same trap that once turned "switch off" into "start watering".
    assert not same_word("anakuka", "nanakuka")


def test_two_words_run_together_are_still_the_sentence(
    matcher: IntentMatcher,
) -> None:
    """"Lights off" said in one breath — four recordings, verbatim.

    These are the literal transcripts of ``whisper-small-malayalam`` on
    2026-11-18 (from the app's event log, evening session): the visitor said
    "വിളക്കുകൾ അണയ്ക്കുക" and the model returned the whole sentence as one
    word, losing the glide `യ` of "അണയ്ക്കുക" at the same time.  The exhibit
    answered "please ask me to control a supported device" to every one.

    The split is not a guess: both halves have to be words this vocabulary
    knows, and the sentence still has to come out with exactly one device and
    one state.
    """
    for text in (
        "വിളക്കുകളാണക്കുകാം.",
        "വിളക്കുകളാണക്കുകാ.",
        "വിളക്കുകളാന്ക്കുകാം.",
        "വിലക്കുകളാണക്കുകാം.",
    ):
        result = matcher.match(text, "ml")
        assert result["intent"] == "LIGHTS_OFF", text
        assert result["command"] == "LIGHTS_OFF", text

    # The same for a status sentence: "in the tank, water" as one word.
    assert matcher.match("താങ്കില്വല്ലം", "ml")["intent"] == "WATER_STATUS"
    # …and it does not invent a sentence out of a word it cannot divide.
    assert matcher.match("ഡ്രയാവ്.", "ml")["kind"] == "unsupported"
    assert matcher.match("ക്കാൽ ക്ക്കുകാം.", "ml")["kind"] == "unsupported"


def test_a_bracketed_sound_is_not_a_sentence(matcher: IntentMatcher) -> None:
    """`[Coughing]` in the room is not a request for a device.

    whisper writes a bracketed marker when it is handed a cough, laughter or
    music, and the exhibit answered each one "please ask me to control a
    supported device" (2026-11-18).
    """
    for text in ("[Coughing]", "(coughing)", "[Laughter]", "[Music]", "[BLANK_AUDIO]"):
        for language in ("en", "ml", "hi"):
            result = matcher.match(text, language)
            assert result["kind"] == "no_speech", (text, language)
            assert result["command"] is None, (text, language)
    # A marker *inside* a sentence is not silence — but it is also an
    # unaccounted word, so the sentence is still refused rather than half-read
    # (the rule that keeps "…and open the gate" from switching the lights).
    inside = matcher.match("[Music] lights on", "en")
    assert inside["kind"] != "no_speech"
    assert inside["command"] is None


def test_a_device_may_carry_its_case_ending_but_a_short_word_may_not() -> None:
    """The device tolerance, and the two traps that forced its limits.

    Malayalam writes the case ending onto the noun and the model writes the
    whole thing as one word: "വിളക്കുകുള്ളെ" for "വിളക്കുകൾ", and "മണ്ണിൽ" run
    into "എത്ര" as "മണ്നില്ലത്രാ" (the user's own session, 2026-11-18).
    """
    from app.phonetics import same_word

    assert same_word("vilakkukulle", "vilakku", allow_suffix=True, allow_edit=False)
    assert same_word("mannillatra", "mannil", allow_suffix=True, allow_edit=False)
    # …but only for a name of five letters or more.  On a short one the same
    # tolerance is a trap: "thanks" starts with "tank", and "Thanks on!" would
    # have been answered about the water instead of asking which device.
    assert not same_word("thanks", "tank", allow_suffix=True, allow_edit=False)
    # The structural device matcher also refuses the *one-letter* tolerance that
    # the sound path needs: "band" (Hindi for "off") and "pani" (water) nest
    # consonant for consonant, so "light band karo" came back ambiguous the
    # moment devices were matched with it.
    assert same_word("band", "pani")
    assert not same_word("band", "pani", allow_edit=False)
    # The sound path keeps what it needs: "പമ്പ്" heard as "പംമ്", and a device
    # with a syllable in front of it.
    assert same_word("pam", "pamp")
    assert same_word("palaita", "laita", allow_suffix=True)


def test_the_evening_sessions_malayalam_commands_are_understood(
    matcher: IntentMatcher,
) -> None:
    """The literal transcripts from the user's own session, verbatim.

    Nine of ten were refused on 2026-11-18 (18:04–18:07Z) and the reporter said
    "some worked, some didn't".  Each failure is a different spelling of a word
    this vocabulary already had: the case ending on the noun
    ("വിളക്കുകുള്ളെ", "പംഭിന്റെ"), the model's "auto" as "ഓട്ടവു", the emphatic
    "അവസ്ഥാ", and two words run together ("മണ്നില്ലത്രാ" is "മണ്ണിൽ"+"എത്ര").
    """
    cases = (
        ("മണ്നില്ലത്രാ യരപ്പമുണ്ട്.", "SOIL_STATUS"),
        ("മണ്നില് എത്രാ യർപ്പമുണ്ട്", "SOIL_STATUS"),
        ("ഡാങ്കില് വേള്ളമുണ്ടോ", "WATER_STATUS"),
        ("വിളക്കുകള് ഓട്ടവു.", "LIGHTS_AUTO"),
        ("വിലക്കുകള് അനക്കുകാ.", "LIGHTS_OFF"),
        ("വിളക്കുകുള്ളെ അവസ്ഥാ.", "LIGHTS_STATUS"),
        ("പംഭിന്റെ അവസ്ഥാ.", "PUMP_STATUS"),
        ("പമ്പൾ ഓട്ടോ", "PUMP_AUTO"),
        ("ഗ്രാമത്തിന്റെ അവസ്ഥാ.", "VILLAGE_STATUS"),
    )
    for text, want in cases:
        result = matcher.match(text, "ml")
        assert result["intent"] == want, text
        if want.endswith("_STATUS"):
            assert result["command"] is None, text
    # The one with nothing of this vocabulary in it is still refused.
    assert matcher.match("ഗ്ഗാസാവ്യായ്യ്.", "ml")["kind"] == "unsupported"


def test_the_anusvara_sounds_like_the_letter_after_it() -> None:
    from app.phonetics import romanise

    # Both spellings are the same spoken word "pamp"; the anusvara before a
    # labial is an `m`, and the consonant before a sign keeps its inherent
    # vowel (a first version romanised "പംമ്" as "pmm" and matched nothing).
    assert romanise("പംഭ്") == "pamb"
    assert romanise("പംമ്") == "pamm"
    assert romanise("പമ്പ്") == "pamp"


def test_a_short_word_tolerates_one_letter_but_never_a_different_consonant() -> None:
    from app.phonetics import same_word

    # What a speech model actually produces for "ഓട്ടോ":
    assert same_word("ato", "oto")
    assert same_word("otu", "oto")
    assert same_word("pam", "pamp")
    # …and what must never be confused with it:
    assert not same_word("ato", "ano")   # "ano" is the question word
    assert not same_word("ato", "nto")   # "nto" is the question suffix
    assert not same_word("on", "off")    # two letters, never tolerated
    assert not same_word("eta", "oto")   # "how much" is not "auto"



def test_english_fillers_and_the_models_own_spelling_of_led(matcher: IntentMatcher) -> None:
    """What the room actually said, 2026-11-19, and what Whisper wrote.

    The panel keeps every clip's transcript, and these are from one English
    session: "Lead status." (the lights), "Automatic um…" (a mode with no
    device), "Um, lights on.", "Sara, pump auto.".  A filler word used to make
    the whole sentence unaccounted, so a perfectly clear command was refused.
    """
    assert matcher.match("Lead status.", "en")["intent"] == "LIGHTS_STATUS"
    # The same session's worst clip: with the decoder prompt Whisper still wrote
    # "Relate status." for "lights status".
    assert matcher.match("Relate status.", "en")["intent"] == "LIGHTS_STATUS"
    assert matcher.match("LED status.", "en")["intent"] == "LIGHTS_STATUS"
    assert matcher.match("Um, lights on.", "en")["intent"] == "LIGHTS_ON"
    assert matcher.match("Sara, pump auto.", "en")["intent"] == "PUMP_AUTO"
    # A mode with no device asks which one, instead of naming the lights.
    answer = matcher.match("Automatic um…", "en")
    assert answer["intent"] == "AMBIGUOUS"
    assert "Which device" in answer["message"]


def test_a_word_the_model_misheard_still_refuses_the_command(matcher: IntentMatcher) -> None:
    """`Top irrigation.` is "start" or "stop" — and the page must not guess.

    Both spellings are one letter from the other (stop → top is Whisper dropping
    the leading s), so the sentence reads as the pump with an unreadable word.
    Nothing may be sent, and the reply asks for one clear command.
    """
    answer = matcher.match("Top irrigation.", "en")
    assert answer["command"] is None
    assert answer["intent"] == "AMBIGUOUS"
