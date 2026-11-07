from __future__ import annotations

import pytest

from app.intents import IntentMatcher


@pytest.fixture(scope="module")
def matcher() -> IntentMatcher:
    from app.config import Settings as AppSettings

    return IntentMatcher(AppSettings.load().intents_path)


def test_english_commands_and_status(matcher: IntentMatcher) -> None:
    assert matcher.match("start irrigation", "en")["intent"] == "IRRIGATION_START"
    assert matcher.match("please turn on the lights", "en")["intent"] == "LIGHTS_ON"
    assert matcher.match("stop the pump", "en")["intent"] == "IRRIGATION_STOP"
    assert matcher.match("village status", "en")["intent"] == "VILLAGE_STATUS"
    assert matcher.match("is the soil dry", "en")["intent"] == "SOIL_STATUS"
    assert matcher.match("water availability", "en")["intent"] == "WATER_STATUS"
    assert matcher.match("bin status", "en")["intent"] == "BIN_STATUS"
    assert matcher.match("help", "en")["intent"] == "HELP"


def test_negated_commands_are_refused(matcher: IntentMatcher) -> None:
    for text in (
        "do not start irrigation",
        "don't turn off the lights",
        "never stop irrigation",
        "not water the plants",
    ):
        result = matcher.match(text, "en")
        assert result["intent"] == "NEGATED"
        assert result["command"] is None
        assert result["actuation"] is False
        assert "supported commands" in result["message"]


def test_unsupported_and_ambiguous_requests_do_nothing(matcher: IntentMatcher) -> None:
    result = matcher.match("make me a sandwich", "en")
    assert result["intent"] == "UNKNOWN"
    assert result["command"] is None
    assert result["message"] == "Please use one of the supported commands or contact local support."

    result = matcher.match("lights", "en")
    assert result["intent"] == "UNKNOWN"

    result = matcher.match("lights on and lights off", "en")
    assert result["intent"] == "AMBIGUOUS"
    assert result["command"] is None


def test_no_speech_is_reported(matcher: IntentMatcher) -> None:
    for text in ("", "   ", "[BLANK_AUDIO]", "(silence)"):
        result = matcher.match(text, "en")
        assert result["intent"] == "NO_SPEECH"
        assert "No speech" in result["message"]


def test_malayalam_and_hindi_phrases(matcher: IntentMatcher) -> None:
    ml = matcher.match("വിളക്കുകൾ കത്തിക്കുക", "ml")
    assert ml["intent"] == "LIGHTS_ON"
    assert ml["language"] == "ml"
    assert "വിളക്കുകൾ" in ml["label"]

    hi = matcher.match("पानी देना बंद करो", "hi")
    assert hi["intent"] == "IRRIGATION_STOP"

    neg = matcher.match("നനയ്ക്കാൻ തുടങ്ങുക വേണ്ട", "ml")
    assert neg["intent"] == "NEGATED"


def test_help_lists_every_supported_command(matcher: IntentMatcher) -> None:
    for language in ("en", "ml", "hi"):
        help_list = matcher.help_list(language)
        assert len(help_list) == 10
        assert all(item["label"] for item in help_list)
        assert any(item["id"] == "IRRIGATION_START" for item in help_list)
