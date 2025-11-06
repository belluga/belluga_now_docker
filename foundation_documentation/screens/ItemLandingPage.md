# Template: Item Landing Page

**Propósito:** Servir como uma página de aterrissagem padrão e visualmente impactante para qualquer item individual da plataforma (Evento, Produto, Experiência).

---

## 1. Estrutura do Template (Mockup v1)

### 1.1. Seção Hero
- **Imagem de Capa:** Imagem de alta qualidade que preenche toda a altura inicial da tela (full-screen).
- **AppBar Transparente:** Sobrepõe a imagem de capa e contém um botão de "Voltar" com contraste dinâmico para garantir a visibilidade.
- **Título do Item:** Sobrepõe a imagem com um gradiente sutil para legibilidade.

### 1.2. Seção de Informações Chave (Abaixo da Imagem)
- **Link do Provedor/Parceiro:** "Oferecido por [Nome do Parceiro]" -> *Leva para a `PartnerLandingPage` correspondente.*
- **Localização/Endereço:** Se aplicável.
- **Data/Hora:** Para Eventos e Experiências agendadas.
- **Preço/Custo:** Se aplicável.

### 1.3. Seção de Descrição
- Texto descritivo detalhado sobre o item.

### 1.4. Galeria de Mídia
- Seção adicional para mais imagens ou vídeos.

### 1.5. Botão de Ação Principal (CTA)
- **Componente:** Botão Fixo (Sticky) na parte inferior da tela, sempre visível.
- **Lógica de Texto e Ação (Backend-Driven):**
    - **Para Produtos/Experiências:** "Contactar via WhatsApp".
    - **Para Eventos:** "Confirmar Presença".

---
---

## Funcionalidades para Versões Futuras

- **Venda de Ingressos/Produtos:** Integrar o CTA com um fluxo de pagamento.
- **Vídeo no Hero:** Permitir o uso de vídeos na seção de capa.
- **Seção de Comentários:** Permitir que usuários comentem no item.
