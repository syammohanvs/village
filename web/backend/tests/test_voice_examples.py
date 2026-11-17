"""The voice panel's examples must be sentences the parser really understands.

The panel shows three examples on its opening screen.  They are written in
TypeScript (`web/frontend/src/lib/voiceExamples.ts`), so nothing in the Python
suite would notice if one stopped parsing — and an example that does nothing is
worse than none: a visitor repeats it, is told "not understood", and concludes
that voice does not work.

This test reads that file, sends every phrase through the **real** parser in the
language it is offered in, and insists it reaches the intent the file says it
does (2026-11-17).
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from app.intents import IntentMatcher

EXAMPLES = (
    Path(__file__).resolve().parents[2] / "frontend" / "src" / "lib" / "voiceExamples.ts"
)

LANGUAGES = ("en", "ml", "hi")


@pytest.fixture(scope="module")
def matcher() -> IntentMatcher:
    from app.config import Settings as AppSettings

    return IntentMatcher(AppSettings.load().intents_path)


def _examples() -> list[tuple[str, str, str]]:
    """(language, phrase, intent) for every example, read from the TS file."""
    text = EXAMPLES.read_text(encoding="utf-8")
    found: list[tuple[str, str, str]] = []
    for language in LANGUAGES:
        block = re.search(rf"^  {language}: \[(.*?)^  \],", text, re.S | re.M)
        assert block, f"no `{language}: [` block in voiceExamples.ts"
        phrases = re.findall(r"phrase: '([^']*)'", block.group(1))
        intents = re.findall(r"intent: '([A-Z_]+)'", block.group(1))
        explanations = re.findall(r"explanation: '([^']*)'", block.group(1))
        assert len(phrases) == len(intents) == len(explanations), (
            f"{language}: {len(phrases)} phrases, {len(intents)} intents, "
            f"{len(explanations)} explanations"
        )
        found.extend(zip([language] * len(phrases), phrases, intents))
    return found


def test_every_language_offers_three_examples() -> None:
    for language in LANGUAGES:
        count = sum(1 for row in _examples() if row[0] == language)
        assert count == 3, f"{language} offers {count} examples, not three"


def test_every_example_reaches_the_intent_it_promises(matcher: IntentMatcher) -> None:
    wrong = []
    for language, phrase, intent in _examples():
        result = matcher.match(phrase, language)
        if result["intent"] != intent:
            wrong.append(
                f"{language}: “{phrase}” → {result['intent']} (expected {intent}, "
                f"{result['reason']})"
            )
    assert not wrong, "examples the parser does not understand:\n  " + "\n  ".join(wrong)


def test_the_examples_are_a_command_and_two_status_questions(matcher: IntentMatcher) -> None:
    """One action and two questions: what a visitor actually tries."""
    per_language: dict[str, list[str]] = {}
    for language, phrase, _intent in _examples():
        per_language.setdefault(language, []).append(matcher.match(phrase, language)["kind"])
    for language, kinds in per_language.items():
        assert kinds.count("command") == 1, f"{language}: {kinds}"
        assert kinds.count("status") == 2, f"{language}: {kinds}"


def test_no_explanation_names_an_internal_command() -> None:
    """A visitor reads these; `LIGHTS_ON` means nothing to them."""
    text = EXAMPLES.read_text(encoding="utf-8")
    for explanation in re.findall(r"explanation: '([^']*)'", text):
        assert not re.search(r"[A-Z]{2,}_[A-Z]+", explanation), explanation
        assert "sends" not in explanation.lower(), explanation
