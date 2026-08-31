"""The permanent-vs-transient classifier (`agent/errors.raise_mapped`).

This is the hinge of the "stuck on Classifying…" bug: Groq retired the
hardcoded model, answered 404, and nothing mapped that to a terminal state, so
the link rode the backoff ladder and then got resurrected hourly by the sweep.
The mapping is therefore asserted by *status code*, the way the providers
actually report it, rather than by message text.

Exceptions are built as stand-ins rather than real SDK objects on purpose: the
three OpenAI-codegen SDKs need a live `httpx.Request` to construct an
`APIStatusError`, and the attribute shape is the whole contract.
"""
import httpx
import pytest

from agent.errors import (
    AuthError,
    ModelError,
    ParseError,
    QuotaError,
    http_status_of,
    human_message,
    raise_mapped,
)


class SDKError(Exception):
    """groq / openai / anthropic: `status_code` on the instance."""

    def __init__(self, message: str, status_code: int):
        super().__init__(message)
        self.status_code = status_code


class GoogleError(Exception):
    """google.api_core.exceptions: `code` is the HTTP status."""

    def __init__(self, message: str, code: int):
        super().__init__(message)
        self.code = code


def http_error(status: int, body: str = "nope") -> httpx.HTTPStatusError:
    """Ollama's shape: the status lives on the response."""
    request = httpx.Request("POST", "http://ollama.test/api/chat")
    return httpx.HTTPStatusError(
        body, request=request, response=httpx.Response(status, request=request, text=body)
    )


# --------------------------------------------------------------------------- #
# Status extraction — one property per SDK shape
# --------------------------------------------------------------------------- #

def test_status_read_from_status_code_attribute():
    assert http_status_of(SDKError("x", 404)) == 404


def test_status_read_from_google_code_attribute():
    assert http_status_of(GoogleError("x", 400)) == 400


def test_status_read_from_response():
    assert http_status_of(http_error(404)) == 404


def test_status_is_none_when_there_is_no_http_layer():
    assert http_status_of(RuntimeError("connection reset")) is None


# --------------------------------------------------------------------------- #
# The mapping
# --------------------------------------------------------------------------- #

@pytest.mark.parametrize("status", [400, 404])
def test_bad_request_and_not_found_are_permanent_model_errors(status):
    """The model name is the only user-controlled part of a fixed SDK call, so
    both statuses mean "the configured model is wrong" — the reported bug."""
    with pytest.raises(ModelError):
        raise_mapped(SDKError("model_decommissioned", status))


@pytest.mark.parametrize("status", [401, 403])
def test_unauthorised_and_forbidden_are_auth_errors(status):
    with pytest.raises(AuthError):
        raise_mapped(SDKError("nope", status))


def test_too_many_requests_is_transient():
    with pytest.raises(QuotaError):
        raise_mapped(SDKError("slow down", 429))


@pytest.mark.parametrize("status", [500, 502, 503])
def test_server_errors_are_re_raised_unchanged_so_they_stay_on_the_ladder(status):
    """A provider outage is transient. Mapping it to anything in the taxonomy
    would make `classify_link` treat it as terminal and stop retrying."""
    original = SDKError("upstream exploded", status)
    with pytest.raises(SDKError) as caught:
        raise_mapped(original)
    assert caught.value is original


def test_error_with_no_status_is_re_raised_unchanged():
    original = RuntimeError("connection reset by peer")
    with pytest.raises(RuntimeError) as caught:
        raise_mapped(original)
    assert caught.value is original


def test_gemini_reports_a_rejected_key_as_400_and_is_still_auth_not_model():
    """Gemini answers `400 InvalidArgument / API_KEY_INVALID` for a bad key,
    which by status alone is indistinguishable from a bad model. The message
    marker has to win, or the user is told to change their model when the key is
    the problem."""
    with pytest.raises(AuthError):
        raise_mapped(GoogleError("API_KEY_INVALID: API key not valid", 400))


def test_gemini_missing_model_is_a_model_error():
    with pytest.raises(ModelError):
        raise_mapped(GoogleError("models/gemini-1.0-pro is not found", 404))


def test_ollama_missing_model_is_a_model_error():
    """A 404 from Ollama means the model was never pulled — user-fixable, same
    class as a retired hosted model."""
    with pytest.raises(ModelError):
        raise_mapped(http_error(404, 'model "llama9" not found'))


def test_quota_recognised_from_message_when_there_is_no_status():
    with pytest.raises(QuotaError):
        raise_mapped(RuntimeError("Resource_exhausted: quota exceeded"))


@pytest.mark.parametrize("exc", [ParseError("x"), AuthError("x"), QuotaError("x"), ModelError("x")])
def test_taxonomy_members_pass_through_untouched(exc):
    """Providers call `raise_mapped` in a blanket `except`, so a ParseError
    raised inside the try must not be reclassified into something retryable."""
    with pytest.raises(type(exc)) as caught:
        raise_mapped(exc)
    assert caught.value is exc


def test_provider_wording_survives_into_the_exception():
    """The message is what reaches the user's notification, so it has to be the
    provider's own words, not a generic summary."""
    message = "The model `llama-3.1-8b-instant` has been decommissioned"
    with pytest.raises(ModelError, match="decommissioned"):
        raise_mapped(SDKError(message, 404))


# --------------------------------------------------------------------------- #
# human_message — the provider's sentence, without its wire format
#
# Every SDK stringifies to `Error code: 401 - {'error': {'message': …}}`. That
# string is fine in a log and wrong in a UI: the user reads four useful words
# wrapped in a Python dict repr. These tests pin the real shapes each provider
# produces, because "parse the error text" only stays honest if the shapes are
# written down.
# --------------------------------------------------------------------------- #

GROQ_401 = (
    "Error code: 401 - {'error': {'message': 'Invalid API Key', "
    "'type': 'invalid_request_error', 'code': 'expired_api_key'}}"
)
GROQ_404 = (
    "Error code: 404 - {'error': {'message': 'The model `llama-3.1-8b-instant` has been "
    "decommissioned and is no longer supported.', 'type': 'invalid_request_error', "
    "'code': 'model_decommissioned'}}"
)
OPENAI_401 = (
    'Error code: 401 - {"error": {"message": "Incorrect API key provided: sk-abc. ", '
    '"type": "invalid_request_error", "param": null, "code": "invalid_api_key"}}'
)


def test_the_reported_error_becomes_a_sentence():
    """The exact string from the bug report."""
    assert human_message(GROQ_401) == "Invalid API Key (expired_api_key)"


def test_no_wire_format_survives():
    for raw in (GROQ_401, GROQ_404, OPENAI_401):
        out = human_message(raw)
        assert "{" not in out and "}" not in out
        assert "Error code" not in out
        assert "'type'" not in out and '"type"' not in out


def test_the_machine_code_is_kept_because_it_is_the_actionable_part():
    """`expired_api_key` and `invalid_api_key` send the user to different places:
    one means rotate, the other means you pasted the wrong string."""
    assert human_message(GROQ_401).endswith("(expired_api_key)")
    assert human_message(OPENAI_401).endswith("(invalid_api_key)")


def test_json_bodies_parse_as_well_as_python_reprs():
    """Some SDKs repr the dict, others hand back raw JSON. Both are real."""
    assert human_message(OPENAI_401) == "Incorrect API key provided: sk-abc (invalid_api_key)"


def test_the_model_message_is_the_one_the_user_needs():
    out = human_message(GROQ_404)
    assert out.startswith("The model `llama-3.1-8b-instant` has been decommissioned")
    assert out.endswith("(model_decommissioned)")


def test_gemini_style_plain_text_keeps_its_words():
    """Gemini raises `400 API key not valid…` with no JSON body at all. Only the
    status prefix goes."""
    assert human_message("400 API key not valid. Please pass a valid API key.") == (
        "API key not valid. Please pass a valid API key"
    )


def test_ollama_style_bare_error_string_is_dug_out():
    """Ollama answers `{"error": "model 'x' not found"}` — the message is the
    value of `error`, not nested under it."""
    assert human_message('{"error": "model \'llama9\' not found"}') == "model 'llama9' not found"


def test_an_exception_instance_works_the_same_as_its_string():
    assert human_message(AuthError(GROQ_401)) == human_message(GROQ_401)


def test_unparseable_text_is_returned_verbatim_not_replaced():
    """When there is nothing to extract, the raw text is the only clue the user
    has. Inventing a friendlier message would throw it away."""
    assert human_message("connection reset by peer") == "connection reset by peer"


def test_an_empty_message_still_says_something():
    """`str(e)` is empty for some SDK exceptions; a blank red box explains
    nothing."""
    assert human_message("") == "The provider returned an error with no message."
    assert human_message(RuntimeError()) == "The provider returned an error with no message."


def test_a_duplicated_code_is_not_repeated():
    """Some providers put the same token in `message` and `code`; printing it
    twice reads like a bug."""
    raw = "Error code: 429 - {'error': {'message': 'rate_limit_exceeded', 'code': 'rate_limit_exceeded'}}"
    assert human_message(raw) == "rate_limit_exceeded"
