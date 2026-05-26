"""
Supabase connection, auth helpers, and session management.
"""

from __future__ import annotations
import os
import streamlit as st
from dotenv import load_dotenv

load_dotenv()

_SUPABASE_URL = os.getenv("SUPABASE_URL", "")
_SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "")


@st.cache_resource
def get_supabase_client():
    """Return a cached Supabase client instance (one per app process)."""
    if not _SUPABASE_URL or not _SUPABASE_ANON_KEY:
        st.error(
            "⚠️ Variáveis de ambiente do Supabase não configuradas. "
            "Verifique o arquivo .env."
        )
        return None
    from supabase import create_client
    return create_client(_SUPABASE_URL, _SUPABASE_ANON_KEY)


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
    try:
        response = client.auth.sign_in_with_oauth(
            {
                "provider": "google",
                "options": {
                    "redirect_to": redirect_url or st.get_option("server.baseUrlPath") or "",
                },
            }
        )
        return response.url
    except Exception as exc:
        st.error(f"Erro ao iniciar login com Google: {exc}")
        return None


def handle_auth_callback() -> bool:
    """
    After OAuth redirect, exchange the code/token in the URL for a session.
    Stores the session in st.session_state["session"].
    Returns True if successful.
    """
    client = get_supabase_client()
    if client is None:
        return False

    params = st.query_params
    # Supabase v2 sends access_token + refresh_token as hash params;
    # Streamlit exposes them as query params when using implicit flow.
    access_token = params.get("access_token")
    refresh_token = params.get("refresh_token")

    if access_token and refresh_token:
        try:
            session = client.auth.set_session(access_token, refresh_token)
            if session and session.session:
                st.session_state["session"] = {
                    "access_token": session.session.access_token,
                    "refresh_token": session.session.refresh_token,
                    "user": {
                        "id": session.session.user.id,
                        "email": session.session.user.email,
                    },
                }
                # Clean up URL params
                st.query_params.clear()
                return True
        except Exception as exc:
            st.error(f"Erro ao processar callback de autenticação: {exc}")
    return False


def sign_out() -> None:
    """Sign out the current user and clear session state."""
    client = get_supabase_client()
    if client:
        try:
            client.auth.sign_out()
        except Exception:
            pass
    st.session_state.pop("session", None)
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
        except Exception:
            pass
    return client
