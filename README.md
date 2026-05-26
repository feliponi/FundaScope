# 📊 FundaScope

Aplicação de análise fundamentalista de ações para mercados US e Europa, construída com **Streamlit + Supabase + SimFin**.

---

## ✨ Funcionalidades

| Módulo | Descrição |
|---|---|
| **Portfólios** | Crie e gerencie múltiplos portfólios de ações |
| **Visão do Portfólio** | Tabela com todos os KPIs fundamentalistas, colorida por faixas de qualidade |
| **Screener** | Filtre ações por KPIs com sliders dinâmicos e presets rápidos (Value, Quality, Dividend) |
| **Comparação** | Compare até 5 ativos lado a lado com radar chart e gráficos de barras |
| **Detalhe do Ativo** | Valuation de Graham, histórico de indicadores, dados brutos das demonstrações |

### KPIs incluídos

- **Valuation:** P/L, P/VPA, P/FCF, EV/EBITDA, Dividend Yield, Número de Graham, Margem de Segurança
- **Rentabilidade:** ROE, ROA, ROIC, Margens (Bruta, EBIT, Líquida)
- **Saúde Financeira:** Dívida/Patrimônio, Dívida Líq./EBITDA, Liquidez Corrente, Piotroski F-Score
- **Por Ação:** EPS, VPA, FCF/Ação, Dividendo/Ação, Receita/Ação
- **Qualidade:** FCF/Lucro, Payout Ratio, Beta

---

## 🚀 Configuração

### 1. Pré-requisitos

- Python 3.11+
- Conta no [Supabase](https://supabase.com) (plano gratuito funciona)
- Chave de API do [SimFin](https://simfin.com) (plano gratuito: 5 req/minuto)
- Google Cloud Console para OAuth (ou outro provider Supabase)

### 2. Clone e instale

```bash
git clone https://github.com/feliponi/fundascope
cd fundascope
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### 3. Configure o Supabase

1. Acesse [supabase.com](https://supabase.com) → **New Project**
2. Vá em **Database → SQL Editor** e execute o conteúdo de `supabase_schema.sql`
3. Vá em **Authentication → Providers → Google** e habilite o provider OAuth

### 4. Configure o Google OAuth

1. Acesse [console.cloud.google.com](https://console.cloud.google.com)
2. Crie um projeto → **APIs & Services → Credentials → Create OAuth 2.0 Client ID**
3. Authorized redirect URI: `https://<seu-projeto>.supabase.co/auth/v1/callback`
4. Copie o **Client ID** e **Client Secret** para o Supabase Authentication → Google

### 5. Configure o arquivo `.env`

```bash
cp .env.example .env
```

Edite `.env` com suas credenciais:

```env
SIMFIN_API_KEY=sua_chave_simfin
SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_ANON_KEY=sua_chave_anonima
GOOGLE_CLIENT_ID=seu_google_client_id
```

> **Dica:** A `SUPABASE_URL` e `SUPABASE_ANON_KEY` ficam em **Project Settings → API**.

### 6. Execute localmente

```bash
streamlit run app.py
```

Acesse [http://localhost:8501](http://localhost:8501).

---

## ☁️ Deploy no Streamlit Cloud

1. Faça push do repositório para o GitHub (sem o `.env` — ele está no `.gitignore`)
2. Acesse [share.streamlit.io](https://share.streamlit.io) → **New App**
3. Selecione o repositório e o arquivo `app.py`
4. Em **Advanced settings → Secrets**, adicione:

```toml
SIMFIN_API_KEY = "sua_chave"
SUPABASE_URL = "https://..."
SUPABASE_ANON_KEY = "..."
GOOGLE_CLIENT_ID = "..."
```

5. Clique em **Deploy**
6. Atualize o **Authorized redirect URI** no Google Console para a URL do Streamlit Cloud

---

## 📁 Estrutura do Projeto

```
fundascope/
├── app.py                  # Entry point Streamlit
├── .env.example            # Template de variáveis de ambiente
├── requirements.txt        # Dependências Python
├── supabase_schema.sql     # Schema do banco de dados + RLS
├── config/
│   └── settings.py         # Constantes, KPIs, presets
├── services/
│   ├── simfin.py           # Cliente SimFin API v3 com cache
│   ├── supabase_client.py  # Conexão e auth Supabase
│   └── portfolio.py        # CRUD de portfólios e holdings
├── components/
│   ├── auth.py             # UI de login/logout Google
│   ├── screener.py         # Screener com filtros dinâmicos
│   ├── stock_card.py       # Detalhe de um ativo
│   ├── portfolio_view.py   # Visão do portfólio
│   └── comparison.py       # Comparação de ativos
└── utils/
    ├── formatters.py       # Formatação de números
    └── graham.py           # Cálculos de Graham
```

---

## ⚙️ Limites MVP

- Máximo de **20 ativos** por portfólio
- Máximo de **5 ativos** na comparação
- Cache de dados fundamentalistas por **24 horas** (Supabase)
- Preços não são em tempo real — vêm dos dados do SimFin
- Sem alertas, backtesting ou notificações por e-mail

---

## 📄 Licença

MIT — use à vontade.
