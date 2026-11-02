# Salas Morada do Ser

Site separado para a locação das salas da Clínica Morada do Ser, com painel para a equipe editar sem precisar de programador.

- `index.html`: página pública (salas, fotos, montador de horários que envia o pedido pelo WhatsApp).
- `admin.html`: painel da equipe (link "Área da equipe" no rodapé). Pelo painel dá para adicionar, ocultar, reordenar e excluir salas, enviar e reordenar fotos, e trocar todos os textos, horários, dias e contatos.
- Os dados ficam no Supabase (banco + armazenamento de fotos). O site é só HTML/CSS/JS estático, sem build.

## Como colocar no ar

1. **Supabase**: crie um projeto em supabase.com (plano grátis atende).
   - Abra **SQL Editor**, cole todo o `supabase/schema.sql` e rode. Isso cria as tabelas, as regras de segurança e o bucket público `fotos`.
   - Em **Authentication → Sign In / Providers**, desligue **Allow new users to sign up** (só quem você cadastrar entra no painel).
   - Em **Authentication → Users → Add user**, crie o login de cada pessoa da clínica (e-mail + senha, marcando "Auto confirm").
   - Em **Authentication → URL Configuration**, coloque o endereço do site em **Site URL** e adicione `https://SEU-DOMINIO/admin.html` em **Redirect URLs** (para o "Esqueci minha senha").
2. **Config**: em **Project Settings → API**, copie a *Project URL* e a *anon public key* para `js/config.js`.
3. **Hospedagem**: suba a pasta inteira em qualquer hospedagem estática (Vercel, Netlify, Cloudflare Pages ou GitHub Pages). Dá para apontar um subdomínio, ex.: `salas.moradadoser.com.br`.

Sem o `config.js` preenchido o site abre em modo demonstração, com textos padrão e duas salas de exemplo.

## Observações

- Fotos são redimensionadas no navegador (máx. 1600 px, WebP) antes do envio, então foto de celular sobe rápido.
- A primeira foto de cada sala é a capa. Se a "Foto do topo" ficar vazia, o site usa a capa da primeira sala.
- No título principal, uma palavra entre `*asteriscos*` aparece em itálico rosé.
- Salas novas nascem ocultas; só aparecem no site depois de marcar "Mostrar esta sala no site" e salvar.
