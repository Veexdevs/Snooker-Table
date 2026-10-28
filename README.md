# 🎱 8 Ball Pool — mesa profissional

Recriação jogável do 8 Ball Pool no navegador, com o visual da mesa clássica:
pano azul, tabelas de veludo vermelho, moldura escura e HUD de partida.

![Mesa do jogo](docs/mesa.jpg)

**A diferença desta mesa:** as caçapas têm boca de **1,27 × o diâmetro da bola**
nos cantos e 1,32 × nas laterais (numa mesa comum é ~2,4 ×). Só entra quem
acerta a boca de verdade.

---

## Como rodar

```bash
npm run dev        # http://localhost:5173
```

Ou qualquer servidor estático (`python3 -m http.server 5173`). Abrir o
`index.html` direto por `file://` não funciona porque o navegador bloqueia
módulos ES.

## Controles

| Ação | Como |
| --- | --- |
| Mirar | mover o mouse sobre a mesa (setas ← → para ajuste fino, Shift mais fino) |
| Força | **puxar a barra da esquerda para baixo** — o taco se afasta e a força sobe de 0% a 100% |
| Tacar | soltar o botão: o taco avança, bate e a bola sai (se voltar a 0% e soltar, cancela) |
| Efeito | arrastar o ponto na bola branca (canto inferior esquerdo): topo, fundo ou lado |
| Giz branco | +45% de força por 45 s |
| Giz azul | efeito dobrado por 45 s |
| Bola na mão | clicar numa posição livre da mesa |
| Treino livre | Shift + clique move a branca para onde quiser |

## O que está implementado

### Física realista
- Cada bola tem velocidade **e rotação 3D**. O atrito do pano age no ponto de
  contato: enquanto a bola escorrega ela é freada e girada até "pegar" rolagem.
  É daí que vem o efeito de verdade — topo (follow), fundo (draw) e lateral
  (english), inclusive mudando o ângulo de saída nas tabelas.
- Colisões elásticas com atrito tangencial (throw), subpassos adaptativos
  (anti-tunneling) e captura de caçapa por profundidade e desvio lateral.
- A barra marca 0–100%, mas a potência real vai até **5×** a de uma tacada
  comum (curva de força `v = Vmax · p^2,15`). Com 30% da barra já se atravessa
  a mesa inteira; no topo, a bola dá várias voltas nas tabelas.

### Bolas que rolam de verdade
- Cada bola tem uma **matriz de rotação**. As listras e o adesivo do número são
  projetados na superfície da esfera, então giram, desaparecem no fundo da bola
  e reaparecem. Não é uma imagem fixa girando.
- Ao encaçapar, a bola **entra na boca e desce para o saco**: anda no eixo da
  caçapa, encolhe, escurece e some no fundo — com poeira subindo.

### Mira que funciona
- Traçado de raio com colisão real: desenha a linha até a **bola fantasma**,
  a direção que a bola alvo vai tomar (verde quando ela está alinhada com uma
  caçapa) e a tangente de desvio da branca.
- Quando não há bola no caminho, mostra o rebote na tabela ou a caçapa.
- Teste automatizado compara a direção prevista pela mira com a direção que a
  física produz: **6/6 casos, concordância 1.000**.

### Caçapas apertadas
- 1,27 × / 1,32 × o diâmetro da bola.
- Captura só quando a bola entra alinhada com a boca (profundidade + desvio
  lateral): raspar a mandíbula devolve a bola para a mesa.

### Som para tudo
- Sintetizado em WebAudio (sem arquivos): tacada (com intensidade), cada choque
  bola-bola, cada toque na tabela, **cada força de encaçapamento** (toc na boca,
  queda no saco, bola rolando no fundo quando entra forte), giz raspando,
  botões, virada de turno, falta, vitória e derrota.

### Pó e partículas
- Pó do pano levantando nas batidas fortes e nas tabelas.
- Poeira e anel de impacto quando a bola entra — quanto mais forte, maior.
- Faíscas nas colisões muito violentas.

### Regras oficiais do 8-Ball
Quebra válida (bola na caçapa ou 4 bolas na tabela), mesa aberta, grupos
definidos pela primeira bola legal, faltas completas (branca na caçapa, não
tocar, bola errada primeiro, sem tabela), falta = bola na mão, 8 só no fim
(antes disso é derrota) e 8 na quebra volta ao pé da mesa.

### Adversário
IA em 4 níveis (Amador, Intermediário, Profissional, Lenda) que calcula encaixes
com bola fantasma, **confirma cada lance numa simulação completa**, ajusta a
força até a bola entrar e joga segurança quando não há saída.

## Estrutura

```
index.html          HUD, menu, barra de força, giz, efeito
styles.css          todo o visual
js/
  table.js          geometria da mesa e caçapas apertadas
  physics.js        rotação 3D, atrito, colisões, captura, curva de força
  rules.js          regras do 8-ball, faltas, turnos, bola na mão
  ai.js             adversário + mira (bola fantasma, rebote)
  render.js         mesa azul/vermelha, bolas esféricas, taco, mira
  audio.js          todos os sons sintetizados
  fx.js             partículas de pó e faíscas
  app.js            HUD, controles, turnos, efeitos
tools/              servidor local e testes
```

## Testes

```bash
npm install
npm test              # partida completa em DOM headless com cliques reais
npm run test:physics  # curva de força, efeito (draw/follow) e rolagem
npm run test:aim      # mira × física (direção prevista = direção real)
npm run test:rules    # partidas IA × IA e estatísticas de faltas
node tools/screenshot.mjs   # regenera docs/mesa.jpg
```

O `npm test` percorre menu, escolha de nível, efeito, giz, tacada pela barra de
força, bola na mão, treino livre, dois jogadores, fim de partida e revanche —
tudo com eventos reais no DOM, verificando que nenhum erro de JavaScript acontece.

## Estatísticas

Vitórias, derrotas, bolas encaçapadas, melhor sequência e moedas ficam salvas no
`localStorage`. Cada vitória contra o computador rende 180 moedas, cada derrota 45.
