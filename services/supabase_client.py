"""
Supabase connection, auth helpers, and session management.
"""

from __future__ import annotations
import logging
import os
import streamlit as st
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

_SUPABASE_URL = os.getenv("SUPABASE_URL", "")
_SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "")
# Optional: full public URL of the Streamlit app, used as OAuth redirect_to.
# Example: http://localhost:8501  or  https://myapp.streamlit.app
_SITE_URL = os.getenv("SITE_URL", "")


@st.cache_resource
def get_supabase_client():
    """Return a cached Supabase client instance (one per app process)."""
    if not _SUPABASE_URL or not _SUPABASE_ANON_KEY:
        st.error(
            "⚠️ Variáveis de ambiente do Supabase não configuradas. "
            "Verifique o arquivo .env."
        )
        logger.error("SUPABASE_URL or SUPABASE_ANON_KEY not set.")
        return None
    from supabase import create_client
    client = create_client(_SUPABASE_URL, _SUPABASE_ANON_KEY)
    logger.info("Supabase client created for %s", _SUPABASE_URL)
    return client


# ─── Auth helpers ────────────────────────────────────────────────────────────

def get_session() -> dict | None:
    """Return the current session dict from st.session_state, or None."""
    return st.session_state.get("session")


def get_user_id() -> str | None:
    """Return the authenticated user's UUID, or None."""
    session = get_session()
    if session and "user" in session:
        return session["user"].get("id")
    return None


def get_user_email() -> str | None:
    """Return the authenticated user's email, or None."""
    session = get_session()
    if session and "user" in session:
        return session["user"].get("email")
    return None


def is_authenticated() -> bool:
    return get_user_id() is not None


def sign_in_with_google(redirect_url: str | None = None) -> str | None:
    """
    Trigger Supabase Google OAuth.
    Returns the authorization URL to redirect the user to, or None on error.
    """
    client = get_supabase_client()
    if client is None:
        return None

    # Determine where Supabase should redirect the user after authentication.
    # Priority: explicit argument > SITE_URL env var > empty (uses Supabase Site URL setting).
    target_redirect = redirect_url or _SITE_URL or ""
    logger.info("Starting Google OAuth, redirect_to=%r", target_redirect)

    try:
        response = client.auth.sign_in_with_oauth(
            {
                "provider": "google",
                "options": {
                    "redirect_to": target_redirect,
                },
            }
        )
        logger.info("OAuth URL generated: %s", response.url)
        return response.url
    except Exception as exc:
        logger.exception("Error starting Google OAuth: %s", exc)
        st.error(f"Erro ao iniciar login com Google: {exc}")
        return None


def handle_auth_callback() -> bool:
    """
    After OAuth redirect, exchange the code/token in the URL for a session.

    Supabase v2 uses PKCE flow by default: the callback URL receives a
    ``?code=...`` query parameter that must be exchanged server-side via
    ``exchange_code_for_session``.  The older implicit-flow fallback
    (``access_token`` / ``refresh_token`` in the URL) is also handled for
    backwards compatibility.

    Stores the session in st.session_state["session"] and triggers a rerun
    to clear the login screen.  Returns True if successful.
    """
    client = get_supabase_client()
    if client is None:
        return False

    params = st.query_params
    logger.debug("Query params on callback: %s", dict(params))

    # ── PKCE flow (Supabase v2 default) ──────────────────────────────────────
    code = params.get("code")
    if code:
        logger.info("Auth callback: PKCE code received, exchanging for session.")
        try:
            result = client.auth.exchange_code_for_session({"auth_code": code})
            session_obj = getattr(result, "session", None) or result
            _store_session(session_obj)
            st.query_params.clear()
            logger.info("PKCE auth successful for user %s", get_user_email())
            st.rerun()
            return True
        except Exception as exc:
            logger.exception("PKCE code exchange failed: %s", exc)
            st.error(f"Erro ao processar callback de autenticação: {exc}")
            return False

    # ── Implicit flow fallback (access_token + refresh_token as query params) ─
    access_token = params.get("access_token")
    refresh_token = params.get("refresh_token")
    if access_token and refresh_token:
        logger.info("Auth callback: implicit-flow tokens received.")
        try:
            result = client.auth.set_session(access_token, refresh_token)
            session_obj = getattr(result, "session", None) or result
            _store_session(session_obj)
            st.query_params.clear()
            logger.info("Implicit-flow auth successful for user %s", get_user_email())
            st.rerun()
            return True
        except Exception as exc:
            logger.exception("Implicit-flow session setup failed: %s", exc)
            st.error(f"Erro ao processar callback de autenticação: {exc}")
            return False

    return False


def _store_session(session_obj) -> None:
    """Normalise and persist a Supabase session object into session_state."""
    # Handle both object-style (PKCE response) and dict-style responses.
    if hasattr(session_obj, "access_token"):
        access_token  = session_obj.access_token
        refresh_token = session_obj.refresh_token
        user_id       = session_obj.user.id
        user_email    = session_obj.user.email
    else:
        # dict-style (set_session response wraps inside .session)
        inner = session_obj.session if hasattr(session_obj, "session") else session_obj
        access_token  = inner.access_token
        refresh_token = inner.refresh_token
        user_id       = inner.user.id
        user_email    = inner.user.email

    st.session_state["session"] = {
        "access_token":  access_token,
        "refresh_token": refresh_token,
        "user": {
            "id":    user_id,
            "email": user_email,
        },
    }
    logger.debug("Session stored for user_id=%s", user_id)


def sign_out() -> None:
    """Sign out the current user and clear session state."""
    client = get_supabase_client()
    email = get_user_email()
    if client:
        try:
            client.auth.sign_out()
        except Exception as exc:
            logger.warning("sign_out error (ignored): %s", exc)
    st.session_state.pop("session", None)
    logger.info("User %s signed out.", email)
    st.rerun()


def get_authenticated_client():
    """
    Return a Supabase client with the current user's access token injected,
    so RLS policies are enforced correctly.
    """
    client = get_supabase_client()
    if client is None:
        return None
    session = get_session()
    if session:
        try:
            client.auth.set_session(
                session["access_token"],
                session["refresh_token"],
            )
        except Exception as exc:
            logger.warning("Could not refresh session token: %s", exc)
    return client
