"""
Authentication UI component — Google login/logout.
"""

from __future__ import annotations
import streamlit as st
from services.supabase_client import (
    handle_auth_callback,
    sign_in_with_google,
    sign_out,
    is_authenticated,
    get_user_email,
)


def render_login_page() -> None:
    """Full-page login view shown to unauthenticated users."""
    st.markdown(
        """
        <div style='text-align:center; padding: 60px 20px;'>
            <h1>📊 FundaScope</h1>
            <p style='font-size:1.2em; color: #888;'>
                Análise fundamentalista de ações US e Europa
            </p>
        </div>
        """,
        unsafe_allow_html=True,
    )

    col1, col2, col3 = st.columns([1, 1, 1])
    with col2:
        if st.button("🔑 Entrar com Google", use_container_width=True, type="primary"):
            url = sign_in_with_google()
            if url:
                st.markdown(
                    f'<meta http-equiv="refresh" content="0; url={url}">',
                    unsafe_allow_html=True,
                )
                st.info("Redirecionando para o Google…")

    st.markdown("---")
    st.markdown(
        "<p style='text-align:center; color:#555; font-size:0.85em;'>"
        "Seus dados são armazenados de forma segura no Supabase. "
        "Nenhuma credencial é compartilhada.</p>",
        unsafe_allow_html=True,
    )


def render_sidebar_user() -> None:
    """User info block inside the sidebar."""
    email = get_user_email()
    st.sidebar.markdown(f"👤 **{email}**")
    if st.sidebar.button("Sair", key="logout_btn"):
        sign_out()


def check_and_handle_auth() -> bool:
    """
    Called once on each Streamlit rerun:
    1. Try to consume OAuth callback params from the URL.
    2. Return True if the user is (now) authenticated.

    Note: on a successful callback, handle_auth_callback() calls st.rerun()
    internally, so this function will not return True in the same run that
    processes the callback — the rerun ensures a clean authenticated render.
    """
    if not is_authenticated():
        handle_auth_callback()

    return is_authenticated()
