# Collection Radar

Radar local de livros usados e importados para a coleção física. Varre Estante
Virtual, OLX, Mercado Livre e Enjoei, tenta identificar a edição certa e manda um
digest por e-mail. Não compra nada sozinho.

Primeiro caso de uso: Robin Hobb / Realm of the Elderlings na edição HarperVoyager
UK de 129 × 198 mm. O orçamento da AbeBooks e da Better World Books está em
[`docs/realm-of-the-elderlings-budget.md`](docs/realm-of-the-elderlings-budget.md).

## Como funciona

1. **Watchlist** (`config/watchlist.yaml`): obras, autor, série, editora
   preferida, formato, ISBN e preço-teto. Foi gerada a partir da biblioteca do
   Calibre em `C:\Users\Bellussi\Biblioteca do calibre` e pode ser editada à mão.
2. **Consultas** (`config/queries.yaml`): autores, séries e títulos que serão
   buscados em cada fonte.
3. **Coletores** (`src/sources/`): Playwright para as quatro fontes. OLX e
   Mercado Livre bloqueiam headless; o padrão é abrir um Chromium fora da tela.
4. **Matcher** (`src/match.ts`): título/autor/série com tolerância a variações,
   ISBN exato, editora, formato e idioma. Edição em português é descartada; o
   radar é para o original em inglês.
5. **Digest** (`src/digest.ts`): HTML e texto com link, preço, frete, fonte,
   localização e confiança. O e-mail é opcional; sem SMTP, o digest fica em
   `data/outbox/`.

## Requisitos

- Windows 11, Node.js 24+
- Chromium do Playwright: `npx.cmd playwright install chromium`
- Para OLX e Mercado Livre: deixe `HEADLESS=false` (padrão). O Chromium abre
  fora da tela (`--window-position=-32000,-32000`).

## Setup

```powershell
cd C:\Users\Bellussi\Documents\Workspace\collection-radar
npm.cmd install
npx.cmd playwright install chromium
Copy-Item .env.example .env
```

Edite `.env` com o SMTP. Para Gmail, use uma **senha de app** (não a senha da
conta):

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=seuemail@gmail.com
SMTP_PASS=senha-de-app
MAIL_FROM=seuemail@gmail.com
MAIL_TO=enzobellussi3@gmail.com
```

O Mercado Livre funciona sem token pela página, mas é instável. Se quiser a API
oficial, crie um app em https://developers.mercadolivre.com.br e preencha
`ML_ACCESS_TOKEN`.

O `npm run enrich` usa Open Library e Google Books. Sem chave, o Google Books
costuma responder 429; crie uma chave gratuita no Google Cloud Console
(Books API) e preencha `GOOGLE_BOOKS_API_KEY`. As propostas ficam em
`config/isbn-proposals.yaml`; os ISBNs com confiança suficiente vão para
`config/isbn-overrides.yaml`, que o radar aplica por cima da watchlist. Revise
antes de confiar: a API não sabe distinguir com perfeição hardcover de paperback.

## Comandos

```powershell
npm run watchlist                  # resumo da watchlist e das fontes
npm run sources -- --query "robin hobb" --limit 5
npm run scan -- --max-queries 10 --no-email
npm run scan                       # varredura completa + e-mail (manual)
npm run scan -- --no-email         # varredura sem e-mail (agendada)
npm run digest                     # reenvia os matches dos últimos 7 dias
npm run digest -- --new            # digest diário: só o que ainda não foi alertado
npm run digest -- --new --no-email # dry-run do digest diário
npm run dashboard                  # dashboard local em http://127.0.0.1:4317
npm run update                     # scan + rematch + pHash + OCR + digest HTML
npm run update -- --quick          # pula o scan e atualiza o resto
npm run rematch                    # recalcula todos os matches com o matcher atual
npm run backup                     # backup diário do SQLite com retenção
npm run covers -- --max-score 0.8  # verifica capa do anúncio contra a capa conhecida
npm run sellers:backfill           # preenche notas de vendedor a partir do raw_json
npm run isbn-scan -- --limit 5     # varre a AbeBooks por ISBN (semanal no agendador)
npm run bookfinder-scan            # ISBNs na Bookfinder (sebos internacionais)
npm run isbn-validate              # confere os ISBNs contra Open Library/Google Books
npm run ocr -- --limit 20          # lê o título nas fotos dos anúncios (Tesseract)
npm run shopee:login               # login único da Shopee no perfil persistente
npm run shopee-scan                # 8 autores prioritários na Shopee, sem e-mail
npm run sebos-scan                 # sebos independentes via Google Programmable Search
npm run fixtures:capture           # atualiza os HTMLs de amostra dos coletores
npm run email:test                 # testa o SMTP configurado
npm run enrich -- --limit 50       # propõe ISBNs via Open Library/Google Books
npm run lint                       # Biome: lint, formato e imports
npm run lint:fix                   # aplica as correções seguras do Biome
npm run ci                         # typecheck + lint + testes + build
npm test
npm run typecheck
```

Opções do scan:

- `--source estante|olx|mercadolivre|enjoei`
- `--query "termo"` (filtra as consultas por substring)
- `--queries "Robin Hobb,Brandon Sanderson,Steven Erikson"` (várias de uma vez)
- `--limit 30` (anúncios por consulta)
- `--max-queries 20`
- `--no-email`
- `--headless` (só use se a fonte aceitar; OLX/ML costumam bloquear)

Com `scan.max_queries: 40` no `settings.yaml`, cada rodada pega 40 consultas e
retoma da próxima; assim a watchlist é coberta em rodadas sem sobrecarregar os
sites.

Opções do digest:

- `--new`: envia só matches que ainda não foram alertados por e-mail, olhando os
  últimos 30 dias. Depois do envio, marca como alertados apenas os 20 que
  entraram no e-mail; o resto fica para o dia seguinte.
- `--no-email`: gera o HTML em `data/outbox` sem enviar.
- Sem `--new`, o comando reenvia os matches dos últimos 7 dias, mesmo os já
  alertados.

## Verificação de capa (pHash)

`npm run covers` baixa a foto do anúncio e a capa conhecida da obra (Open
Library pelo ISBN ou busca por título/autor, com fallback no Google Books),
calcula um dHash de 64 bits e compara as duas com distância de Hamming:

- `d <= 8`: capa praticamente igual
- `d <= 12`: capa provável
- `d > 20`: capa diferente
- entre 13 e 20: inconclusiva

O hash fica em cache nas tabelas `image_hashes` e `work_covers`, então a mesma
imagem não é baixada de novo. Por padrão o comando roda só em anúncios com
confiança até 80%; use `--max-score 1` para varrer todos, `--limit 50` para
limitar e `--force` para refazer. O dashboard mostra as duas capas lado a lado
e a distância; o score do matcher não é alterado automaticamente.

O pHash é um sinal, não um veredito: fotos em ângulo, capas de outra edição e
mockups 3D podem dar distância alta mesmo quando o livro é o certo. Confira as
capas antes de ignorar.

## Deduplicação por obra

O dashboard agrupa os anúncios pela obra. Cada grupo mostra a melhor oferta
(menor total dentro do teto, preferindo anúncios ativos) e as alternativas com
fonte, preço, confiança e status. O cabeçalho do grupo traz a quantidade de
ofertas e a faixa de preço. Os filtros continuam valendo por anúncio; a
ordenação usa a melhor oferta de cada grupo. O topo mostra anúncios e obras
separados.

## Vendedor e condição

OLX e Mercado Livre trazem a nota do vendedor no card de busca (0–5). O radar
guarda em `listings.seller_rating` e mostra a nota junto da condição do livro.
Enjoei e Estante não têm nota numérica; a condição aparece como `usado` ou
`novo` quando detectável.

O filtro **Vendedor** tem três modos:

- `Ocultar < 4,5`: esconde notas abaixo de 4,5, mas mantém anúncios sem nota.
- `Abaixo de 4,5`: mostra só notas baixas.
- `Sem nota`: mostra só anúncios sem nota.

`npm run sellers:backfill` reprocessa o `raw_json` antigo e preenche as notas.
As próximas varreduras já gravam a nota direto do card.

## Histórico de preço

Cada mudança de preço ou frete é gravada na tabela `price_history`. O dashboard
mostra “caiu X% desde a primeira vez” e o menor total já visto para aquele
anúncio. O e-mail só volta a alertar uma obra já alertada quando o total cai
pelo menos `scan.price_drop_pct` (padrão 5%) em relação ao total do último
alerta; aumento de preço não gera alerta. O total do último alerta fica em
`alerts.total`.

## Coleção física

No dashboard, a seção **Coleção física** lista o que você já comprou e permite
adicionar uma obra mesmo sem um anúncio ativo. O botão **Comprei** em qualquer
match marca a obra inteira, não só aquele anúncio. O radar, o digest e os
filtros de ativos ignoram obras marcadas como compradas; use **Remover** para
voltar a monitorá-las.

Os 5 volumes de ASOIAF já estão marcados como comprados.

## AbeBooks e Bookfinder por ISBN

`npm run isbn-scan` percorre as obras com ISBN-13 válido, consulta a AbeBooks
por ISBN (ordenado por menor total), pega até 3 ofertas por obra e grava no
radar. Os preços vêm em dólar e são convertidos pela PTAX do Banco Central
(cotação de venda do último dia útil), com cache de 12h em
`data/currency-cache.json`; o dashboard mostra o total em BRL e a nota
`US$ ... · câmbio ...`.

`npm run bookfinder-scan` usa a mesma varredura por ISBN, mas consulta a
Bookfinder com destino Brasil e preços em dólar. A fonte agrega sebos
internacionais (Alibris, GreatBookPrices, Amazon etc.) e lê os atributos
`data-csa-c-*` dos cards; o frete vem separado do preço e a conversão usa a
mesma PTAX do `isbn-scan`. O comando roda sob demanda e grava a saúde da fonte
no dashboard.

Se a PTAX falhar e não houver cache, o comando usa `currency.usd_brl` (padrão
5,52). O `currency.cache_hours` controla a validade do cache; um cache antigo
só é usado quando a consulta ao BCB falha.

A AbeBooks calcula frete por país (Brasil); o CEP 06636-220 é confirmado no
checkout. O radar usa o menor total livro + frete Brasil como estimativa. A
varredura roda toda segunda às 08:00 e o digest das 09:00 consolida os novos
matches. `settings.sources.abebooks` fica `false` porque essa fonte é ISBN-only
e não entra no scan normal por título.

## Validação de ISBN

Os ISBNs dos overrides e da watchlist podem envelhecer ou apontar para a edição
errada. `npm run isbn-validate` confere cada ISBN-13 contra Open Library e
Google Books e grava o relatório em `config/isbn-validation.yaml`:

```powershell
npm run isbn-validate
npm run isbn-validate -- --limit 10 --delay 500
```

Cada item recebe um status:

- `ok`: título, autor e editora batem.
- `review`: título/autor limítrofes, editora de outro selo, autor em outro
  alfabeto ou uma fonte indisponível.
- `divergent`: título ou autor apontam para outro livro.
- `missing`: nenhuma fonte encontrou o ISBN.

O comando não altera `config/watchlist.yaml` nem `config/isbn-overrides.yaml`;
o relatório é para revisão manual. O Google Books pode responder 429 por quota;
quando isso acontece, o comando segue só com Open Library e registra o erro no
relatório.

## Shopee

A Shopee exige login e às vezes pede um quebra-cabeça anti-bot. O radar usa um
perfil persistente do Chromium:

```powershell
npm run shopee:login   # abre uma janela visível; faça login, resolva o captcha e pressione Enter
npm run shopee-scan    # 8 autores prioritários, sem e-mail
```

O perfil fica em `data/shopee-profile`. A fonte fica fora do scan normal; para
uma consulta específica use
`npm run scan -- --source shopee --queries "Robin Hobb"`. Se você tiver uma
busca salva, defina `SHOPEE_SEARCH_URL` com `{query}` no lugar do termo.

Com `SHOPEE_VISIBLE=true` no `.env`, o scan abre a janela e espera até 2 minutos
para você resolver o captcha; sem isso, ele falha com a mensagem de verificação.
A Shopee mostra avaliação do produto, não do vendedor; o filtro de vendedor fica
“sem nota” e a avaliação aparece na nota de preço. O frete é confirmado no
checkout; o total do radar é o preço do item. A condição assume “novo” quando o
título não diz “usado”.

## Sebos independentes

A Estante Virtual agrega muitos sebos, mas não todos. O radar usa o Google
Programmable Search para varrer os domínios que você escolher:

1. Crie um mecanismo em https://programmablesearchengine.google.com/ e adicione
   os domínios dos sebos que você acompanha.
2. Cole o CX em `GOOGLE_CSE_CX` no `.env`.
3. Opcional: crie uma chave da Custom Search API em
   https://console.cloud.google.com/ e preencha `GOOGLE_CSE_API_KEY` para usar a
   API JSON. Sem chave, o radar usa a página pública do CSE via Playwright.

```powershell
npm run sebos-scan
```

O comando roda 8 autores prioritários, 10 resultados por consulta, e fica fora
do scan normal. Para uma consulta específica:
`npm run scan -- --source sebos --queries "Robin Hobb"`.

O preço vem do `pagemap` da API, de JSON-LD ou de meta tags da página; preços de
snippet são ignorados para não pegar recomendação. Quando o site não expõe
preço, o anúncio aparece com “—”. O vendedor é o domínio do sebo, sem nota
numérica; a condição vem do título/trecho (“usado”/“novo”). A tarefa
**Collection Radar Sebos** roda todos os dias às 08:30 e o digest das 09:00
consolida os novos matches.

## OCR de foto

`npm run ocr` usa Tesseract.js local (`eng+por`) para ler o título nas fotos dos
anúncios. Por padrão roda em matches de baixa confiança ou com capa
diferente/inconclusiva; use `--all` para todos, `--limit 50` para limitar e
`--force` para refazer.

O pipeline v3 faz upscale antes do Tesseract. O benchmark com 50 imagens fracas
mostrou que o upscale ajuda (0 → 3 títulos confirmados, média 0,077 → 0,11);
crop, threshold e deskew ficam como opções, fora do padrão, porque pioraram a
média ou geraram falsos positivos em capas upright. Muitas fotos são contracapas
ou não têm o título legível, então o OCR continua complementar.

O texto e o score ficam em `image_ocr`/`ocr_checks`; o dashboard mostra
`OCR título X% · confiança Y%: "texto lido"`. O OCR é um sinal complementar ao
pHash e não altera o score do matcher. A primeira execução baixa os dados de
idioma para `data/tesseract`. O cache é versionado; rodar o comando reprocessa
as imagens antigas sem precisar de `--force`.

## Testes de coletor

`tests/fixtures/*.html` guardam amostras dos cards de OLX, Mercado Livre,
Enjoei e Estante. `npm test` carrega esse HTML no Chromium e roda o mesmo parser
usado em produção, incluindo preço, vendedor, nota e condição. Se o layout
mudar, rode `npm run fixtures:capture` para atualizar as amostras e ajuste o
parser; o teste falha quando um seletor deixa de encontrar os campos.

A amostra do Mercado Livre foi montada a partir da estrutura real porque a
captura ao vivo estava bloqueada; atualize com `fixtures:capture` quando a
página voltar a responder.

## Lint e CI

Biome cuida de lint, formatação e ordenação de imports:

```powershell
npm run lint       # verifica
npm run lint:fix   # aplica correções seguras
npm run format     # só formata
npm run ci         # typecheck + lint + testes + build
```

O workflow `.github/workflows/ci.yml` roda a mesma sequência no GitHub Actions
em push e pull request, com Node 24 e Chromium do Playwright. O repositório é
local; o CI só roda quando ele for publicado.

## Atualizar o dashboard

`npm run dashboard` sobe o servidor local. `npm run update` atualiza os dados:
uma rodada de scan (40 consultas, sem e-mail), `rematch`, pHash, OCR e digest
HTML. Depois é só recarregar `http://127.0.0.1:4317`.

O servidor lê o SQLite a cada request; não precisa reiniciar quando entram dados
novos, só se você mudar código em `src/`.

A seção **Saúde das fontes** no topo do dashboard mostra a última rodada de cada
fonte, com consultas, anúncios, novos, erros e um estado (`ok`, `zero`,
`bloqueada`, `com erros` ou `sem execução`). O `scan` grava esse resumo ao final
de cada fonte; o `isbn-scan` grava o da AbeBooks. Na primeira abertura, o resumo
é preenchido a partir dos `runs` já existentes, então o Mercado Livre zerado
aparece sem precisar abrir log.

```powershell
npm run update              # scan + rematch + pHash + OCR + digest
npm run update -- --quick   # pula o scan; só rematch/pHash/OCR/digest
npm run update -- --dry-run # mostra as etapas
```

O scan é a parte lenta (~15–20 min). Shopee, sebos e AbeBooks rodam nas tarefas
separadas; o `update` cobre o scan normal e o pós-processamento.

## Anúncios brutos

O dashboard em `/` mostra só os matches. `/raw` lista todos os anúncios do
SQLite, com filtros por fonte, query, texto e presença de match. Cada linha
mostra a query que encontrou o anúncio, preço, vendedor, condição, data e o
melhor match ou `sem match`.

A query é gravada em `listing_queries` pelas próximas varreduras (incluindo
`isbn-scan` e `bookfinder-scan`); anúncios antigos aparecem sem query. O filtro
`Sem match` ajuda a explicar por que um anúncio não entrou, como as edições PT
da Estante na busca por Robin Hobb.

## Backup

O banco inteiro fica em `data/radar.db`: anúncios, matches, coleção física,
feedback e histórico de preço. O backup usa a API online do SQLite, então pode
rodar com o dashboard ou uma varredura em andamento.

```powershell
npm run backup
```

O comando grava `data/backups/radar-AAAA-MM-DD.db`, valida o arquivo com
`PRAGMA integrity_check` e confere a contagem das tabelas antes de substituir o
backup do dia. A retenção padrão é de 14 dias; os backups mais antigos são
removidos.

Variáveis e opções:

- `BACKUP_KEEP_DAYS=30` ou `npm run backup -- --keep 30` para mudar a retenção.
- `BACKUP_DIR=...` ou `--dir ...` para mudar a pasta.
- `RADAR_DB=...` ou `--db ...` para apontar para outro banco.

O backup diário também é registrado pelo `scripts/install-task.ps1` às 09:30
(tarefa **Collection Radar Backup**), com log em `logs/backup.log`.

Para restaurar, pare o dashboard, remova os arquivos `-wal`/`-shm` antigos e
copie o backup escolhido sobre o banco:

```powershell
Remove-Item data\radar.db-wal, data\radar.db-shm -ErrorAction SilentlyContinue
Copy-Item data\backups\radar-2026-11-10.db data\radar.db
```

## Agendamento

O script `scripts/scan.cmd` roda a varredura com `--no-email` e grava o log em
`logs/scan.log`. O script `scripts/digest.cmd` roda o digest diário com `--new` e
grava o log em `logs/digest.log`. O script `scripts/backup.cmd` roda o backup
diário e grava o log em `logs/backup.log`. Para registrar as tarefas:

```powershell
.\scripts\install-task.ps1
```

O script cria:

- **Collection Radar**: varredura a cada 6 horas, começando às 07:00, sem e-mail.
- **Collection Radar Digest**: todos os dias às 09:00, só matches ainda não
  alertados.
- **Collection Radar ISBN**: toda segunda-feira às 08:00, varredura da AbeBooks
  por ISBN.
- **Collection Radar Sebos**: todos os dias às 08:30, sebos independentes via
  Google Programmable Search.
- **Collection Radar Backup**: todos os dias às 09:30, backup do SQLite com
  retenção de 14 dias.

As tarefas usam **"Run only when user is logged on"** (`LogonType Interactive`).
Isso é necessário porque OLX e Mercado Livre bloqueiam headless; o Chromium
precisa de uma sessão de desktop. O digest também roda nesse contexto para ler o
banco local. O navegador abre fora da tela; se você estiver usando o PC, pode
ver o processo no gerenciador de tarefas.

O digest só envia se `email.enabled: true` no `settings.yaml`. Se não houver
match novo, ele não manda e-mail vazio. Para testar sem enviar, rode
`npm run digest -- --new --no-email` e abra o HTML gerado em `data/outbox`.

Se preferir o Task Scheduler manual, use a mesma condição de logon e aponte para
`scripts\scan.cmd`, `scripts\digest.cmd` e `scripts\backup.cmd`.

## Como editar a watchlist

Cada obra tem:

```yaml
- key: "assassin-s-quest--robin-hobb"
  title: "Assassin's Quest"
  author: "Robin Hobb"
  series: "The Farseer Trilogy"
  volume: 3
  status: "Want to Read"
  language: "en"
  priority: 1
  enabled: true
  aliases: ["A Fúria do Assassino"]
  preferred_publishers: ["HarperVoyager"]
  preferred_formats: ["hardcover", "paperback"]
  isbn13: "9780007562275"
  max_price: 150
```

- `priority`: 1 = coleção principal, 2 = quero ler, 3 = radar geral.
- `enabled: false` tira a obra das buscas.
- `isbn13` é a arma mais forte: se o anúncio tiver o ISBN, o match é 100%.
- `aliases` servem para títulos em português e variações.

O gerador `python scripts/build-watchlist.py` sobrescreve `watchlist.yaml` e
`queries.yaml`. Se você editou à mão, faça backup antes; ele foi pensado para
rodar quando a biblioteca do Calibre muda.

## Keepa

O CSV de Tracking Overview do Keepa entra como uma camada separada, sem
sobrescrever a watchlist do Calibre:

```powershell
python scripts/import-keepa.py "C:\Users\Bellussi\Downloads\KeepaExport-2026-11-09-TrackingOverview.csv"
```

Ele gera:

- `config/keepa-wishlist.yaml` — overrides de `max_price`/formato para obras
  existentes e obras novas (inclusive sets e edições illustrated/deluxe).
- `config/keepa-queries.yaml` — consultas de autor para as obras novas.

O `max_price` vem do **Preço desejado** do Keepa. Sets e edições específicas
viram obras próprias, para não aplicar o preço de um box ao volume 1. O radar
mescla os dois arquivos em `loadWorks`/`loadQueries`.

## Limites conhecidos

- **OLX e Mercado Livre** usam Cloudflare. Headless é bloqueado; o modo headed
  fora da tela funciona. Se mudar o layout, o coletor quebra e precisa de ajuste.
- **Shopee** ainda não está no MVP. A API oficial é para parceiros e o scraping
  é frágil.
- **Sebos independentes** entram depois, com parsers por site ou Google
  Programmable Search.
- **Matching de capa** (pHash) e OCR de foto são a próxima evolução para os
  anúncios vagos de desapego.
- O radar não compra, não negocia e não faz oferta. A confirmação de edição,
  idioma, formato e estado é humana.

## Estrutura

```
config/          watchlist, consultas e settings
src/sources/     estante, olx, mercadolivre, enjoei
src/match.ts     motor de matching
src/db.ts        SQLite (node:sqlite)
src/digest.ts    HTML/texto do e-mail
src/scan.ts      orquestrador
data/            radar.db e outbox (gitignored)
docs/            orçamentos e notas
scripts/         probe e scan.cmd
tests/           testes de normalize/match
```

## Uso e limites

Uso pessoal, volume baixo, sem revenda. Respeite os termos e o robots.txt de cada
site. Não contorne CAPTCHA nem aumente a frequência para burlar bloqueio. Se uma
fonte bloquear, o radar para aquela fonte na rodada e segue nas outras.
