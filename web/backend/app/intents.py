from __future__ import annotations

import json
from pathlib import Path
from typing import Any


class IntentMatcher:
    """Deterministic allowlist matching for the three supported languages.

    This is deliberately not a language model.  It normalises the transcript,
    rejects any negation, scores whole phrase coverage, and refuses ties.  An
    unknown or ambiguous result must never actuate anything.
    """

    def __init__(self, path: Path):
        self.path = path
        self.data = json.loads(path.read_text(encoding="utf-8"))
        self.languages = [item["code"] for item in self.data["languages"]]
        self.by_id = {item["id"]: item for item in self.data["intents"]}

    # ------------------------------------------------------------------
    def normalize(self, text: str) -> str:
        text = text.strip().lower()
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

    def _phrase_hit(self, tokens: list[str], phrase_tokens: list[str]) -> bool:
        if not phrase_tokens:
            return False
        n = len(phrase_tokens)
        for i in range(0, len(tokens) - n + 1):
            if tokens[i : i + n] == phrase_tokens:
                return True
        return False

    def is_negated(self, text: str, language: str) -> bool:
        tokens = self._tokens(text)
        for phrase in self.data["negations"].get(language, []):
            if self._phrase_hit(tokens, self._tokens(phrase)):
                return True
        return False

    def detect_language(self, text: str, fallback: str = "en") -> str:
        if any("\u0d00" <= ch <= "\u0d7f" for ch in text):
            return "ml"
        if any("\u0900" <= ch <= "\u097f" for ch in text):
            return "hi"
        return fallback

    # ------------------------------------------------------------------
    def match(self, text: str, language: str) -> dict[str, Any]:
        language = language if language in self.languages else "en"
        transcript = (text or "").strip()
        unknown = self.data["unknown"].get(language, self.data["unknown"]["en"])
        no_speech = self.data["no_speech"].get(language, self.data["no_speech"]["en"])

        lowered = transcript.lower()
        silent_markers = {"[blank_audio]", "[silence]", "(silence)", "[music]", "[no speech]"}
        if not transcript or lowered in silent_markers or len(self._tokens(transcript)) == 0:
            return self._result("NO_SPEECH", "no_speech", 0.0, None, no_speech, language)

        if self.is_negated(transcript, language):
            return self._result("NEGATED", "negated", 0.0, None, unknown, language)

        tokens = self._tokens(transcript)
        token_set = set(tokens)
        scored: list[tuple[float, str, str, int]] = []
        for intent in self.data["intents"]:
            phrases = intent["phrases"].get(language, [])
            for phrase in phrases:
                phrase_tokens = self._tokens(phrase)
                if not phrase_tokens:
                    continue
                hits = sum(1 for token in phrase_tokens if token in token_set)
                coverage = hits / len(phrase_tokens)
                if coverage < 0.999:
                    continue
                phrase_set = set(phrase_tokens)
                unmatched = sum(1 for token in tokens if token not in phrase_set)
                # Prefer a longer, more specific phrase and penalise words the
                # phrase did not account for (e.g. "bin status" must not be
                # confused with the generic "status").
                score = 1.0 + min(len(phrase_tokens), 8) * 0.001 - 0.03 * unmatched
                scored.append((score, intent["id"], phrase, len(phrase_tokens)))

        if not scored:
            return self._result("UNKNOWN", "unsupported", 0.0, None, unknown, language)

        scored.sort(reverse=True)
        best_score, best_id, best_phrase, _ = scored[0]
        candidates = []
        seen = set()
        for score, intent_id, phrase, _ in scored:
            if intent_id in seen:
                continue
            seen.add(intent_id)
            candidates.append({"intent": intent_id, "phrase": phrase, "confidence": 1.0})
        distinct = [c for c in candidates if c["intent"] != best_id]
        if distinct:
            # A second, different intent with an equally complete phrase is
            # ambiguous.  Never guess between two actions.
            second = scored[1]
            if second[1] != best_id and abs(best_score - second[0]) < 0.02:
                return self._result("AMBIGUOUS", "ambiguous", 0.0, best_phrase, unknown, language)

        intent = self.by_id[best_id]
        response = intent.get("response", {}).get(language)
        pending = intent.get("response_pending", {}).get(language)
        done = intent.get("response_done", {}).get(language)
        return {
            "intent": best_id,
            "reason": "matched",
            "confidence": round(min(best_score, 1.0), 3),
            "matched_phrase": best_phrase,
            "message": None,
            "language": language,
            "command": intent.get("command"),
            "actuation": bool(intent.get("actuation", False)),
            "label": intent.get("label", {}).get(language, best_id),
            "response_text": response or pending or "",
            "pending_text": pending or response or "",
            "done_text": done or response or "",
            "candidates": candidates[:4],
            "supported": self.help_list(language),
            "unknown_message": unknown,
        }

    def _result(self, intent: str, reason: str, confidence: float,
                matched_phrase: str | None, message: str, language: str) -> dict[str, Any]:
        return {
            "intent": intent,
            "reason": reason,
            "confidence": confidence,
            "matched_phrase": matched_phrase,
            "message": message,
            "language": language,
            "command": None,
            "actuation": False,
            "label": None,
            "response_text": message,
            "pending_text": "",
            "done_text": "",
            "candidates": [],
            "supported": self.help_list(language),
            "unknown_message": message,
        }

    # ------------------------------------------------------------------
    def help_list(self, language: str) -> list[dict[str, Any]]:
        language = language if language in self.languages else "en"
        result = []
        for intent_id in self.data["help_order"]:
            intent = self.by_id[intent_id]
            result.append(
                {
                    "id": intent_id,
                    "label": intent["label"].get(language, intent_id),
                    "actuation": bool(intent.get("actuation", False)),
                    "command": intent.get("command"),
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
