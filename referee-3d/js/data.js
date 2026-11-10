/* WHISTLE — data: teams, historical matches, skins, achievements, dialogue */
window.REF = window.REF || {};

REF.DATA = (function () {
  'use strict';

  var TEAMS = {
    arg: {
      name: 'Argentina', abbr: 'ARG', shirt: '#7ec0ea', shirt2: '#ffffff',
      shorts: '#0f1b2d', socks: '#ffffff',
      squad: ['E. Martínez', 'N. Molina', 'C. Romero', 'N. Otamendi', 'M. Acuña', 'R. De Paul',
        'E. Fernández', 'A. Mac Allister', 'Á. Di María', 'L. Messi', 'J. Álvarez']
    },
    fra: {
      name: 'France', abbr: 'FRA', shirt: '#1b3f8b', shirt2: null,
      shorts: '#ffffff', socks: '#d81e2c',
      squad: ['H. Lloris', 'J. Koundé', 'R. Varane', 'D. Upamecano', 'T. Hernández', 'A. Tchouaméni',
        'A. Rabiot', 'A. Griezmann', 'O. Dembélé', 'K. Mbappé', 'O. Giroud']
    },
    esp: {
      name: 'Spain', abbr: 'ESP', shirt: '#c8102e', shirt2: null,
      shorts: '#1b3f8b', socks: '#c8102e',
      squad: ['U. Simón', 'D. Carvajal', 'S. Ramos', 'G. Piqué', 'J. Alba', 'S. Busquets',
        'Koke', 'A. Iniesta', 'D. Silva', 'Á. Morata', 'D. Costa']
    },
    ned: {
      name: 'Netherlands', abbr: 'NED', shirt: '#f36c21', shirt2: null,
      shorts: '#111827', socks: '#f36c21',
      squad: ['J. Cillessen', 'S. de Vrij', 'V. van Dijk', 'D. Blind', 'D. Kuyt', 'G. Wijnaldum',
        'N. de Jong', 'W. Sneijder', 'A. Robben', 'R. van Persie', 'K. Huntelaar']
    },
    ger: {
      name: 'Germany', abbr: 'GER', shirt: '#ffffff', shirt2: null,
      shorts: '#111827', socks: '#ffffff',
      squad: ['M. Neuer', 'J. Boateng', 'M. Hummels', 'P. Lahm', 'B. Höwedes', 'T. Kroos',
        'B. Schweinsteiger', 'M. Özil', 'T. Müller', 'M. Klose', 'A. Schürrle']
    },
    eng: {
      name: 'England', abbr: 'ENG', shirt: '#ffffff', shirt2: null,
      shorts: '#0b1f4d', socks: '#ffffff',
      squad: ['J. Pickford', 'K. Walker', 'J. Stones', 'H. Maguire', 'L. Shaw', 'D. Rice',
        'J. Bellingham', 'B. Saka', 'P. Foden', 'H. Kane', 'R. Sterling']
    },
    liv: {
      name: 'Liverpool', abbr: 'LIV', shirt: '#c8102e', shirt2: null,
      shorts: '#c8102e', socks: '#c8102e',
      squad: ['J. Dudek', 'S. Finnan', 'J. Carragher', 'S. Hyypiä', 'D. Traoré', 'S. Gerrard',
        'X. Alonso', 'D. Hamann', 'H. Kewell', 'M. Baroš', 'V. Šmicer']
    },
    mil: {
      name: 'AC Milan', abbr: 'MIL', shirt: '#c8102e', shirt2: '#111111',
      shorts: '#ffffff', socks: '#111111',
      squad: ['Dida', 'Cafu', 'A. Nesta', 'P. Maldini', 'J. Stam', 'A. Pirlo',
        'G. Gattuso', 'C. Seedorf', 'Kaká', 'A. Shevchenko', 'H. Crespo']
    },
    mun: {
      name: 'Man United', abbr: 'MUN', shirt: '#c8102e', shirt2: null,
      shorts: '#ffffff', socks: '#111111',
      squad: ['P. Schmeichel', 'G. Neville', 'J. Stam', 'R. Johnsen', 'D. Irwin', 'D. Beckham',
        'P. Scholes', 'R. Keane', 'R. Giggs', 'D. Yorke', 'A. Cole']
    },
    bay: {
      name: 'Bayern', abbr: 'BAY', shirt: '#b8121b', shirt2: null,
      shorts: '#b8121b', socks: '#b8121b',
      squad: ['O. Kahn', 'S. Kuffour', 'T. Linke', 'M. Babbel', 'B. Lizarazu', 'S. Effenberg',
        'J. Jeremies', 'M. Basler', 'H. Salihamidžić', 'C. Jancker', 'A. Zickler']
    },
    rma: {
      name: 'Real Madrid', abbr: 'RMA', shirt: '#ffffff', shirt2: null,
      shorts: '#ffffff', socks: '#ffffff',
      squad: ['T. Courtois', 'D. Carvajal', 'S. Ramos', 'R. Varane', 'Marcelo', 'Casemiro',
        'L. Modrić', 'T. Kroos', 'Isco', 'C. Ronaldo', 'K. Benzema']
    },
    juv: {
      name: 'Juventus', abbr: 'JUV', shirt: '#111111', shirt2: '#ffffff',
      shorts: '#ffffff', socks: '#111111',
      squad: ['G. Buffon', 'A. Barzagli', 'L. Bonucci', 'G. Chiellini', 'D. Alves', 'A. Pirlo',
        'S. Khedira', 'C. Marchisio', 'P. Dybala', 'G. Higuaín', 'M. Mandžukić']
    },
    atm: {
      name: 'Atlético', abbr: 'ATM', shirt: '#c8102e', shirt2: '#ffffff',
      shorts: '#1b3f8b', socks: '#c8102e',
      squad: ['J. Oblak', 'Juanfran', 'D. Godín', 'S. Savić', 'Filipe Luis', 'Gabi',
        'Tiago', 'Koke', 'Saúl', 'A. Griezmann', 'F. Torres']
    },
    bra: {
      name: 'Brazil', abbr: 'BRA', shirt: '#f7d117', shirt2: null,
      shorts: '#1b3f8b', socks: '#ffffff',
      squad: ['Alisson', 'Marquinhos', 'Thiago Silva', 'Danilo', 'Renan Lodi', 'Casemiro',
        'Fred', 'L. Paquetá', 'Neymar', 'Richarlison', 'Vinícius Jr']
    },
    ita: {
      name: 'Italy', abbr: 'ITA', shirt: '#1b4fa0', shirt2: null,
      shorts: '#ffffff', socks: '#1b4fa0',
      squad: ['G. Donnarumma', 'L. Bonucci', 'G. Chiellini', 'Emerson', 'L. Spinazzola', 'Jorginho',
        'M. Verratti', 'N. Barella', 'L. Insigne', 'C. Immobile', 'F. Chiesa']
    },
    bar: {
      name: 'Barcelona', abbr: 'BAR', shirt: '#a50044', shirt2: '#004d98',
      shorts: '#004d98', socks: '#a50044',
      squad: ['V. Valdés', 'D. Alves', 'G. Piqué', 'C. Puyol', 'J. Alba', 'S. Busquets',
        'X. Hernández', 'A. Iniesta', 'L. Messi', 'S. Eto\'o', 'T. Henry']
    },
    por: {
      name: 'Portugal', abbr: 'POR', shirt: '#c8102e', shirt2: '#0b6b3a',
      shorts: '#0b6b3a', socks: '#c8102e',
      squad: ['D. Costa', 'J. Cancelo', 'Pepe', 'R. Dias', 'N. Mendes', 'J. Palhinha',
        'B. Fernandes', 'V. Ferreira', 'B. Silva', 'C. Ronaldo', 'D. Jota']
    },
    bel: {
      name: 'Belgium', abbr: 'BEL', shirt: '#d21e2b', shirt2: null,
      shorts: '#111111', socks: '#d21e2b',
      squad: ['T. Courtois', 'T. Alderweireld', 'J. Vertonghen', 'D. Boyata', 'T. Meunier',
        'A. Witsel', 'K. De Bruyne', 'Y. Tielemans', 'E. Hazard', 'R. Lukaku', 'D. Mertens']
    },
    cro: {
      name: 'Croatia', abbr: 'CRO', shirt: '#ffffff', shirt2: '#d21e2b',
      shorts: '#1b3f8b', socks: '#ffffff',
      squad: ['D. Livaković', 'J. Juranović', 'D. Vida', 'J. Gvardiol', 'B. Sosa', 'M. Brozović',
        'L. Modrić', 'M. Kovačić', 'I. Perišić', 'A. Kramarić', 'B. Petković']
    },
    uru: {
      name: 'Uruguay', abbr: 'URU', shirt: '#5cb8e6', shirt2: null,
      shorts: '#111827', socks: '#ffffff',
      squad: ['S. Rochet', 'J. Giménez', 'D. Godín', 'R. Araujo', 'M. Olivera', 'R. Bentancur',
        'F. Valverde', 'N. De la Cruz', 'F. Pellistri', 'D. Núñez', 'L. Suárez']
    },
    mex: {
      name: 'Mexico', abbr: 'MEX', shirt: '#0b6b3a', shirt2: null,
      shorts: '#ffffff', socks: '#0b6b3a',
      squad: ['G. Ochoa', 'J. Sánchez', 'C. Montes', 'H. Moreno', 'J. Gallardo', 'E. Álvarez',
        'H. Herrera', 'A. Guardado', 'H. Lozano', 'R. Jiménez', 'A. Vega']
    },
    jpn: {
      name: 'Japan', abbr: 'JPN', shirt: '#1b3f8b', shirt2: null,
      shorts: '#ffffff', socks: '#1b3f8b',
      squad: ['S. Gonda', 'H. Sakai', 'M. Yoshida', 'K. Itakura', 'Y. Nagatomo', 'W. Endo',
        'H. Morita', 'D. Kamada', 'R. Doan', 'T. Minamino', 'A. Ueda']
    },
    mar: {
      name: 'Morocco', abbr: 'MAR', shirt: '#c8102e', shirt2: '#0b6b3a',
      shorts: '#c8102e', socks: '#0b6b3a',
      squad: ['Y. Bounou', 'A. Hakimi', 'N. Aguerd', 'R. Saïss', 'N. Mazraoui', 'S. Amrabat',
        'A. Ounahi', 'H. Ziyech', 'S. Boufal', 'Y. En-Nesyri', 'A. Hamdallah']
    },
    usa: {
      name: 'USA', abbr: 'USA', shirt: '#ffffff', shirt2: null,
      shorts: '#1b3f8b', socks: '#ffffff',
      squad: ['M. Turner', 'S. Dest', 'W. Zimmerman', 'T. Ream', 'A. Robinson', 'T. Adams',
        'W. McKennie', 'Y. Musah', 'C. Pulisic', 'T. Weah', 'R. Pepi']
    }
  };

  /* ---------------------------------------------------------- tournaments */
  var TOURNAMENTS = [
    {
      id: 'wc', name: 'World Cup', comp: 'WORLD CUP', size: 16,
      blurb: 'Sixteen nations, drawn at random. Four knockout rounds — a round of 16, then the quarters, the semis and the final.',
      pool: ['arg', 'fra', 'esp', 'ned', 'ger', 'eng', 'bra', 'ita',
        'por', 'bel', 'cro', 'uru', 'mex', 'jpn', 'mar', 'usa'],
      venues: ['Lusail Stadium', 'Maracanã', 'Wembley', 'Estadio Azteca', 'Soccer City', 'Allianz Arena',
        'MetLife Stadium', 'Education City']
    },
    {
      id: 'ucl', name: 'Champions League', comp: 'CHAMPIONS LEAGUE', size: 8,
      blurb: 'Eight clubs, drawn at random. Three knockout ties between you and the trophy. European nights, no second legs.',
      pool: ['liv', 'mil', 'mun', 'bay', 'rma', 'juv', 'atm', 'bar'],
      venues: ['Wembley', 'San Siro', 'Santiago Bernabéu', 'Allianz Arena', 'Anfield', 'Camp Nou']
    }
  ];

  /* the last four names, however many rounds a competition has */
  var ROUND_NAMES = ['Round of 16', 'Quarter-final', 'Semi-final', 'Final'];

  var MATCHES = [
    {
      id: 'wc22', comp: 'WORLD CUP', year: 2022, stage: 'Final', home: 'arg', away: 'fra',
      score: '3–3 (4–2 pens)', venue: 'Lusail Stadium', note: 'The greatest final ever played.'
    },
    {
      id: 'wc86', comp: 'WORLD CUP', year: 1986, stage: 'Quarter-final', home: 'arg', away: 'eng',
      score: '2–1', venue: 'Estadio Azteca', note: 'Hand of God. Goal of the Century.'
    },
    {
      id: 'f18', comp: 'FRIENDLY', year: 2018, stage: 'International', home: 'esp', away: 'arg',
      score: '6–1', venue: 'Metropolitano', note: 'Spain run riot in Madrid.'
    },
    {
      id: 'wc10', comp: 'WORLD CUP', year: 2010, stage: 'Final', home: 'esp', away: 'ned',
      score: '1–0', venue: 'Soccer City', note: 'Iniesta, 116th minute.'
    },
    {
      id: 'wc14', comp: 'WORLD CUP', year: 2014, stage: 'Final', home: 'ger', away: 'arg',
      score: '1–0', venue: 'Maracanã', note: 'Götze breaks Argentine hearts.'
    },
    {
      id: 'wc18', comp: 'WORLD CUP', year: 2018, stage: 'Round of 16', home: 'fra', away: 'arg',
      score: '4–3', venue: 'Kazan Arena', note: 'Mbappé announces himself.'
    },
    {
      id: 'ucl05', comp: 'CHAMPIONS LEAGUE', year: 2005, stage: 'Final', home: 'liv', away: 'mil',
      score: '3–3 (3–2 pens)', venue: 'Atatürk Olympic', note: 'The Miracle of Istanbul.'
    },
    {
      id: 'ucl99', comp: 'CHAMPIONS LEAGUE', year: 1999, stage: 'Final', home: 'mun', away: 'bay',
      score: '2–1', venue: 'Camp Nou', note: 'Fergie time: 90+1 and 90+3.'
    },
    {
      id: 'ucl17', comp: 'CHAMPIONS LEAGUE', year: 2017, stage: 'Final', home: 'rma', away: 'juv',
      score: '4–1', venue: 'Millennium Stadium', note: 'Ronaldo double, Madrid dynasty.'
    },
    {
      id: 'ucl14', comp: 'CHAMPIONS LEAGUE', year: 2014, stage: 'Final', home: 'rma', away: 'atm',
      score: '4–1 (aet)', venue: 'Estádio da Luz', note: 'La Décima, 93rd-minute equaliser.'
    },
    {
      id: 'copa21', comp: 'COPA AMÉRICA', year: 2021, stage: 'Final', home: 'arg', away: 'bra',
      score: '1–0', venue: 'Maracanã', note: 'Messi finally lifts it.'
    },
    {
      id: 'euro20', comp: 'EURO', year: 2020, stage: 'Final', home: 'ita', away: 'eng',
      score: '1–1 (3–2 pens)', venue: 'Wembley', note: 'Football almost came home.'
    }
  ];

  var SKINS = [
    { id: 'classic', name: 'Classic Black', cost: 0, shirt: '#2b2f3a', shirt2: null, shorts: '#1b1e26', socks: '#2b2f3a', desc: 'The uniform. No arguments.' },
    { id: 'volt', name: 'Volt', cost: 0, shirt: '#c6ff2e', shirt2: null, shorts: '#161a14', socks: '#c6ff2e', desc: 'You will be seen from the moon.' },
    { id: 'retro', name: 'Retro Red', cost: 150, shirt: '#d92b2b', shirt2: null, shorts: '#1a1a1a', socks: '#d92b2b', desc: '1970s cup-final energy.' },
    { id: 'ice', name: 'Ice Blue', cost: 250, shirt: '#5cd6ff', shirt2: null, shorts: '#0e1a2a', socks: '#5cd6ff', desc: 'Cool head, cold calls.' },
    { id: 'gold', name: 'Gold Elite', cost: 500, shirt: '#e8b53a', shirt2: null, shorts: '#2a1f0b', socks: '#e8b53a', desc: 'For referees who never get it wrong.' },
    { id: 'zebra', name: 'Zebra', cost: 800, shirt: '#ffffff', shirt2: '#111111', shorts: '#111111', socks: '#ffffff', desc: 'Black and white. No grey areas.' },
    { id: 'violet', name: 'Midnight Violet', cost: 1200, shirt: '#7a4bd8', shirt2: null, shorts: '#150e26', socks: '#7a4bd8', desc: 'Stoppage time, under the lights.' }
  ];

  var ACH = [
    { id: 'first_whistle', name: 'First Blast', desc: 'Blow your whistle for the first time.', pts: 25 },
    { id: 'first_yellow', name: 'Booked', desc: 'Show your first yellow card.', pts: 30 },
    { id: 'first_red', name: 'Off You Go', desc: 'Send a player off.', pts: 60 },
    { id: 'second_yellow', name: 'Two Yellows', desc: 'Send a player off with a second yellow.', pts: 80 },
    { id: 'goal', name: 'GOAL!', desc: 'Witness a goal from close range.', pts: 20 },
    { id: 'talk5', name: 'Man Management', desc: 'Talk to five different players.', pts: 40 },
    { id: 'calm', name: 'Cool Head', desc: 'Calm an angry player down.', pts: 40 },
    { id: 'offside', name: 'Flag Up', desc: 'Correctly call an offside.', pts: 50 },
    { id: 'full90', name: 'Full Time', desc: 'Complete a full match.', pts: 50 },
    { id: 'tutorial', name: 'Academy', desc: 'Finish the tutorial.', pts: 100 },
    { id: 'whistler', name: 'Whistle Happy', desc: 'Blow 50 whistles across your career.', pts: 60 },
    { id: 'collector', name: 'Wardrobe', desc: 'Unlock three referee kits.', pts: 60 },
    { id: 'tour_tie', name: 'Knockout', desc: 'Take charge of a tournament tie.', pts: 45 },
    { id: 'tour_champ', name: 'The Trophy', desc: 'Referee a tournament all the way to the final whistle.', pts: 180 }
  ];

  var DIALOGUE = {
    greet: [
      'Ref. Got a second?',
      'Boss — quick word.',
      'Hey ref, come here.',
      'You watching him? He is at it again.'
    ],
    calm: [
      'Fair enough, ref. We play on.',
      'No complaints from me. Good game so far.',
      'I saw it the same way you did.',
      'Keep it consistent and we are fine.',
      'He went down easy, but I will let it go.'
    ],
    angry: [
      'That is a joke! He dived, and you bought it!',
      'You are losing this match, ref. Everyone can see it.',
      'Open your eyes! That is twice now!',
      'Every single decision — against us!',
      'Do your job or give me the whistle!',
      'I got the ball! Ask anyone!'
    ],
    carded: [
      'A yellow? For THAT?',
      'Fine. But he started it and you know it.',
      'I will remember that, ref.',
      'Book him too, then. Go on.',
      'One more of those and I say something I regret.'
    ],
    sentoff: [
      'You cannot do this to me!',
      'This is a disgrace — an absolute disgrace!',
      'Enjoy your headlines, ref.',
      'I did nothing! NOTHING!'
    ],
    scored: [
      'That is how you finish, ref. Watch and learn.',
      'Did you see that?! Tell me you saw that!',
      'One more and this is over.',
      'Still think we do not deserve it?'
    ],
    down: [
      'He stamped on me. Right there.',
      'I felt that in my ankle, ref.',
      'Give him a card. Please.',
      'I am fine. I am fine. Let me up.'
    ],
    talkBack: [
      'Go on then.',
      'Whatever you say, ref.',
      'We will see.',
      'Respect, ref. Respect.'
    ]
  };

  var TOOLS = [
    { id: 'whistle', name: 'Whistle', key: '1', glyph: '◉', hint: 'Blow to stop play (LMB)' },
    { id: 'yellow', name: 'Yellow card', key: '2', glyph: '▮', hint: 'Click a player to book him', color: '#ffd23f' },
    { id: 'red', name: 'Red card', key: '3', glyph: '▮', hint: 'Click a player to send him off', color: '#ff4d4d' },
    { id: 'talk', name: 'Talk', key: '4', glyph: '❝', hint: 'Click a player to have a word' },
    { id: 'paint', name: 'Paint can', key: '5', glyph: '✚', hint: 'Click the pitch to spray the free-kick mark and the wall', color: '#e8f4ff' },
    { id: 'book', name: 'Notebook', key: '6', glyph: '▤', hint: 'Review the match log' }
  ];

  return {
    TEAMS: TEAMS, MATCHES: MATCHES, SKINS: SKINS, ACH: ACH, DIALOGUE: DIALOGUE, TOOLS: TOOLS,
    TOURNAMENTS: TOURNAMENTS, ROUND_NAMES: ROUND_NAMES
  };
})();
