// 원피스 시뮬봇 HUD — SillyTavern UI extension
// 대해적시대 시뮬레이션 전용 상태 엔진 + HUD.
// The model only writes per-turn deltas inside <state>…</state>. This extension
// replays every AI message from the start of the chat, so swipes, edits and
// deletions always produce a consistent state. The current state is injected
// once per generation; numbers never live in the prompt history.

const MODULE = 'onepiecesim';
const LOG = '[원피스 시뮬봇]';
const TITLE = '원피스 시뮬봇';
const INJECT_KEY = 'onepiecesim_state';
const PROMPT_IN_CHAT = 1; // extension_prompt_types.IN_CHAT
const ROLE_SYSTEM = 0; // extension_prompt_roles.SYSTEM

// 인원·기록 상한 (최적화: 매 턴 처음부터 다시 계산하므로 작게 유지)
const CAP = Object.freeze({ bonds: 10, crew: 10, memories: 30, finds: 40, news: 20, log: 80, checkpoints: 15 });

const DEFAULTS = Object.freeze({
    aiProfile: '', // 확장의 AI 호출(게시판·신문·섬 소문·캐릭터/열매 생성)에 쓸 연결 프로필 id, 비우면 메인 연결
    enabled: true,
    allCharacters: false,
    hudExpanded: false,
    hudMini: false,
    msgCard: 'compact', // full | compact | off
    choices: 'tense', // tense | always | off
    choiceClick: 'fill', // fill | send
    events: 'normal', // off | low | normal | high
    hexAuto: 'rare', // 해프닝 자동 발동: off | rare | normal
    // 부수 기능 켜고 끄기
    featAct: true, featLetter: true, featMemo: true, featHex: true, featBoard: true, featNews: true,
    featDates: true, featRumor: true, featAlbum: true,
    ticker: true,
    effects: true,
    injectDepth: 1,
    autoRegister: true,
});

// ───────────────────────────── 시대 ─────────────────────────────

const ERAS = [
    {
        id: 'roger', name: '로저 처형 · 대해적시대 개막', year: '해원력 1500년', token: '#ERA_ROGER', strawhat: false,
        note: '골드 로저가 로그타운에서 처형된 직후. "내 보물을 원하나?" 한마디에 온 세상이 바다로 나선다. 흰수염·빅맘·카이도·금사자 시키가 패권을 다투고, 해군 원수는 콩, 대장 센고쿠, 영웅 가프. 루피는 아직 태어나지 않았다.',
    },
    {
        id: 'east', name: '루피 출항 · 이스트블루', year: '해원력 1522년', token: '#ERA_EAST', strawhat: true,
        note: '루피가 밀짚모자를 쓰고 작은 보트로 출항한 해. 사황은 흰수염·카이도·빅맘·샹크스, 해군 원수 센고쿠, 대장 아카이누·아오키지·키자루. 칠무해 체제가 굳건하다.',
    },
    {
        id: 'war', name: '정상전쟁 직전', year: '해원력 1522년 말', token: '#ERA_WAR', strawhat: true,
        note: '화주 에이스의 공개 처형이 예고되고 세계가 마린포드를 지켜본다. 샤본디 제도에 초신성 11인. 루피 현상금 3억, 에니에스 로비 사건 직후.',
    },
    {
        id: 'newworld', name: '2년 후 · 신세계 ~ 와노쿠니', year: '해원력 1524년', token: '#ERA_NEWWORLD', strawhat: true,
        note: '샤본디 재집결 이후 어인섬·펑크 해저드·드레스로자·홀케이크·와노쿠니. 해군 원수 아카이누, 대장 키자루·후지토라·료쿠규. 와노가 끝나면 사황은 샹크스·검은수염·버기·루피로 바뀐다.',
    },
    {
        id: 'final', name: '최종장 · 에그헤드 ~ 엘바프', year: '해원력 1524년~', token: '#ERA_FINAL', strawhat: true,
        note: '칠무해는 폐지, 크로스 길드가 해군에게 현상금을 건다. 에그헤드 사건과 베가펑크의 세계 방송, 그리고 거인의 나라 엘바프. 원작은 연재 중 — 그 너머는 아직 쓰이지 않았다.',
    },
];

const CANON = [
    { id: 'free', name: '자유 (IF)', desc: '원작은 출발점일 뿐. 내 행동으로 누가 죽고 사는지도 바뀐다.' },
    { id: 'normal', name: '보통', desc: '원작 성격·관계·강함은 지킨다. 원작 사건은 일정대로 일어나지만 직접 개입하면 바뀐다.' },
    { id: 'strict', name: '엄격', desc: '원작 연표·전투력·죽음이 고정. 나는 원작의 틈에서 움직인다. 인물은 그 시점에 아는 것만 안다.' },
];
const CANON_EN = {
    free: 'Canon: FREE (IF) — canon cast and events are only a starting point; {{user}}\'s actions can change anything, deaths and outcomes included.',
    normal: 'Canon: STANDARD — keep canon personalities, relationships and power scale. Canon events happen on schedule unless {{user}} directly intervenes; interventions ripple realistically.',
    strict: 'Canon: STRICT — canon timeline, power scale and deaths are fixed; {{user}} acts in the margins and cannot save, kill or replace major canon figures. Characters know only what they would know at this point (no future spoilers).',
};

const DIFFICULTY = [
    { id: 'roman', name: '낭만', desc: '바다는 위험하지만 주인공 보정이 있다. 쓰러지면 죽는 대신 붙잡히거나 잃는다.', survive: 100, keepCash: 0.5 },
    { id: 'normal', name: '표준 (회귀)', desc: '바다는 사람을 죽인다. 죽으면 마지막으로 도착한 섬으로 회귀한다 — 기억은 남는다.', survive: 45, keepCash: 0 },
    { id: 'hard', name: '하드코어', desc: '보정 없음. 신체 손상·재산 몰수·수감·죽음이 전부 영구. 죽으면 끝.', survive: 30, keepCash: 0 },
];
const DIFF_EN = {
    roman: 'Difficulty 낭만: danger is real but there is plot armor — defeat means capture, loss or injury, not death.',
    normal: 'Difficulty 표준: the sea kills. Overreaching against a higher 격 ends at HP 0. Death is resolved by the system (rewind to the last island, memories kept).',
    hard: 'Difficulty 하드코어: no plot armor. Lost limbs, confiscation, imprisonment and death are permanent.',
};

// ───────────────────────────── 진영 ─────────────────────────────

const MARINE_RANKS = ['이등병', '일등병', '상등병', '하사', '중사', '상사', '준위', '소위', '중위', '대위', '소령', '중령', '대령', '준장', '소장', '중장', '대장', '원수'];
const GOV_RANKS = ['수습 요원', '정식 요원', '상급 요원', '지휘관', '장관급', '오로성 직속'];

const FACTIONS = [
    {
        id: 'strawhat', label: '밀짚모자 일味 (루피네)', short: '밀짚모자 일味', outlaw: true, color: '#e8b33a',
        heat: '악명', note: '루피의 배에 오른다. 모험과 사고가 끊이지 않는다. (로저 시대에는 선택 불가)',
        affil: () => ['몽키 D. 루피 선장'],
        roles: ['신입 선원', '기존 멤버로 플레이', '손님 · 동행자'],
        tier: 2, cash: 50000, kit: [['식량 (10일분)', 1], ['약품 상자', 1]],
    },
    {
        id: 'pirate', label: '기타 해적단', short: '해적', outlaw: true, color: '#c8463a',
        heat: '악명', note: '내 해적단을 만들거나 어느 해적단의 깃발 아래로 들어간다.',
        affil: (era) => ({
            roger: ['내 해적단 창단', '흰수염 해적단', '빅맘 해적단', '카이도 해적단', '금사자 해적단 (시키)', '해산한 로저 해적단의 옛 선원'],
            east: ['내 해적단 창단', '흰수염 해적단', '빅맘 해적단', '백수 해적단 (카이도)', '빨간머리 해적단 (샹크스)', '돈키호테 해적단 (도플라밍고)', '바로크 워크스 (크로커다일)', '버기 해적단', '아론 일당'],
            war: ['내 해적단 창단', '흰수염 해적단', '빅맘 해적단', '백수 해적단 (카이도)', '빨간머리 해적단 (샹크스)', '검은수염 해적단', '하트 해적단 (로)', '키드 해적단', '돈키호테 해적단 (도플라밍고)'],
            newworld: ['내 해적단 창단', '빅맘 해적단', '백수 해적단 (카이도)', '빨간머리 해적단 (샹크스)', '검은수염 해적단', '하트 해적단 (로)', '키드 해적단', '돈키호테 해적단 (도플라밍고)', '밀짚모자 대선단 산하'],
            final: ['내 해적단 창단', '빨간머리 해적단 (샹크스)', '검은수염 해적단', '크로스 길드 (버기)', '밀짚모자 대선단 산하', '하트 해적단 (로)', '거인 전사 해적단'],
        }[era] ?? ['내 해적단 창단']),
        roles: ['선장', '부선장', '간부', '선원', '막내 잡일꾼'],
        tier: 2, cash: 300000, kit: [['식량 (10일분)', 1], ['럼주 한 통', 1], ['무명 검', 1]],
    },
    {
        id: 'marine', label: '해군', short: '해군', outlaw: false, color: '#4f8fd6',
        heat: '공적', note: '정의를 등에 진다. 공적이 차면 진급한다. 상관과 정의 사이에서 흔들릴 수 있다.',
        affil: (era) => ({
            roger: ['원수 콩 직속', '대장 센고쿠 휘하', '중장 가프 휘하', '중장 츠루 휘하', '해군 지부'],
            east: ['원수 센고쿠 직속', '중장 가프 휘하', '대장 아오키지 휘하', '대장 아카이누 휘하', '대장 키자루 휘하', '중장 츠루 휘하', '대령 스모커 휘하 (로그타운)', '해군 153지부 (셸스 타운)'],
            war: ['원수 센고쿠 직속', '중장 가프 휘하', '대장 아오키지 휘하', '대장 아카이누 휘하', '대장 키자루 휘하', '준장 스모커 휘하', '마린포드 본부 수비대'],
            newworld: ['원수 아카이누 직속', '대장 키자루 휘하', '대장 후지토라 휘하', '대장 료쿠규 휘하', '중장 가프 휘하', '중장 스모커 휘하 (G-5)', '대령 코비 휘하'],
            final: ['원수 아카이누 직속', '대장 키자루 휘하', '대장 후지토라 휘하', '대장 료쿠규 휘하', 'SWORD (비공식 부대)', '중장 스모커 휘하 (G-5)', '해군 지부'],
        }[era] ?? ['해군 지부']),
        roles: MARINE_RANKS.slice(0, 17),
        tier: 1, cash: 50000, kit: [['해군 제식 소총', 1], ['소형 전보벌레', 1]],
    },
    {
        id: 'revolution', label: '혁명군', short: '혁명군', outlaw: true, color: '#7fbf6a',
        heat: '악명', note: '세계정부를 무너뜨리려는 자들. 존재만으로 현상금이 붙는다.',
        affil: (era) => era === 'roger'
            ? ['몽키 D. 드래곤 (아직 이름 없는 혁명의 싹)', '각지의 반정부 지하조직']
            : ['총사령관 드래곤 직속', '참모총장 사보 휘하', '동군 군대장 휘하', '서군 군대장 휘하', '남군 군대장 휘하', '북군 군대장 휘하', '이반코프 (뉴카마 군단)'],
        roles: ['신입 혁명가', '첩보원', '간부', '군대장'],
        tier: 2, cash: 100000, kit: [['위조 신분증', 1], ['소형 전보벌레', 1]],
    },
    {
        id: 'government', label: '세계정부', short: '세계정부', outlaw: false, color: '#b9a3e8',
        heat: '공적', note: '정의의 어둠. 첩보·암살·간수·관료. 천룡인의 변덕이 곧 명령이다.',
        affil: (era) => ['CP9 (사이퍼 폴)', 'CP0 (세계귀족 직속)', '임펠다운 간수', '마리조아 관료', '천룡인 수행원', '사이퍼 폴 하위 부서'],
        roles: GOV_RANKS.slice(0, 4),
        tier: 2, cash: 200000, kit: [['위조 신분증', 1], ['소형 전보벌레', 1], ['해루석 수갑', 1]],
    },
    {
        id: 'civil', label: '시민', short: '시민', outlaw: false, color: '#d6c08a',
        heat: '명성', note: '해적도 해군도 아닌 보통 사람. 대해적시대는 그런 사람에게 가장 가혹하다.',
        affil: () => ['섬 주민', '상인', '의사', '요리사', '기자 · 세계경제신문', '현상금 사냥꾼', '조선공 · 갈레라 컴퍼니', '술집 주인', '학자 · 고고학자', '왕족 · 귀족'],
        roles: ['평범한 사람', '이름난 신인', '업계의 거물'],
        tier: 1, cash: 200000, kit: [['식량 (10일분)', 1]],
    },
    {
        id: 'custom', label: '직접 입력', short: '', outlaw: false, color: '#aaa',
        heat: '명성', note: '어디에도 속하지 않거나, 위에 없는 곳.',
        affil: () => [], roles: [], tier: 1, cash: 100000, kit: [['식량 (10일분)', 1]],
    },
];
const factionOf = (id) => FACTIONS.find(f => f.id === id) ?? FACTIONS[FACTIONS.length - 1];

const RACES = ['인간', '어인', '인어', '밍크족', '거인족', '수장족', '팔다리족', '삼눈족', '소인족', '혼혈', '직접 입력'];
const STYLES = [
    { name: '검사', roll: 'skill' }, { name: '격투가', roll: 'power' }, { name: '저격수', roll: 'skill' },
    { name: '항해사', roll: 'sail' }, { name: '요리사', roll: 'power' }, { name: '의사', roll: 'sense' },
    { name: '고고학자', roll: 'sense' }, { name: '조선공', roll: 'sail' }, { name: '음악가', roll: 'talk' },
    { name: '사기꾼 · 협상가', roll: 'talk' }, { name: '암살자', roll: 'stealth' }, { name: '첩보원', roll: 'stealth' },
    { name: '직접 입력', roll: '' },
];
const GOALS = ['모험', '깽판', '전쟁', '혁명', '로맨스', '일상', '현상금 사냥', '보물 · 원피스', '복수', '출세', '자유'];
const ORIGINS = ['이스트블루', '웨스트블루', '노스블루', '사우스블루', '위대한 항로', '신세계', '하늘섬', '어인섬', '직접 입력'];

const TIER = ['—', '잡졸', '루키', '실력자', '강자', '괴물', '정점'];
const TIER_HELP = [
    '',
    '잡졸 — 동네 불량배, 말단 병사. 총 한 발이 무섭다.',
    '루키 — 이스트블루 해적 선장, 해군 위관급. 바다에 나설 자격.',
    '실력자 — 파라다이스의 초신성, 해군 장성 하위. 이름이 신문에 오른다.',
    '강자 — 신세계 간부, 해군 중장. 섬 하나를 혼자 상대한다.',
    '괴물 — 해군 대장, 사황 최고 간부. 날씨가 바뀐다.',
    '정점 — 사황, 원수, 전설. 바다 그 자체.',
];
const TIER_EN = ['', 'grunt (thugs, common soldiers)', 'rookie (East Blue captains, Marine junior officers)', 'veteran (Paradise Supernovas, Marine commodores/rear admirals)', 'elite (New World commanders, Vice Admirals)', 'monster (Admirals, Yonko top commanders)', 'apex (Yonko, Fleet Admiral, legends)'];

const FAME = [[0, '무명'], [10, '소문'], [25, '신문 단신'], [45, '신문 1면'], [70, '세계적 유명인'], [90, '전설']];
const fameTitle = (f) => FAME.filter(([t]) => f >= t).pop()[1];

// 위험도 ★ = 현상금 구간
const DANGER_AT = [1, 50_000_000, 200_000_000, 1_000_000_000, 3_000_000_000];
const dangerOf = (bounty) => DANGER_AT.filter(x => bounty >= x).length;
const DANGER_NAME = ['안전', '수배', '주목', '요주의', '최우선 추적', '세계적 위협'];
const HUNT_EN = [
    '',
    'local Marine branch soldiers and small-time bounty hunters may come after {{user}}',
    'Marine branch captains/commodores and seasoned bounty hunters actively pursue; townsfolk may sell {{user}} out',
    'HQ Vice Admiral-class pursuit or CP agents may be assigned; {{user}}\'s face is known everywhere',
    'an Admiral-class pursuit is possible; whole islands may turn {{user}} in',
    'world-level threat: Admirals, Buster Call and Yonko-level attention are all on the table',
];
const HUNT_KO = ['', '지부 해군과 잔챙이 현상금 사냥꾼이 노린다', '지부 대령·준장급과 노련한 사냥꾼이 추격한다', '본부 중장급 또는 CP 요원이 배정될 수 있다', '대장 출격이 가능한 수준이다', '버스터콜과 사황급의 관심 — 세계가 당신을 본다'];
// 현상금 갱신 시 격별 기본 상승폭
const TIER_BOUNTY = [0, 5_000_000, 30_000_000, 100_000_000, 400_000_000, 1_000_000_000, 2_500_000_000];

const TIMES = ['새벽', '아침', '낮', '저녁', '밤', '심야'];
const MODES = { '일상': 'daily', '항해': 'sail', '의뢰': 'case', '전투': 'battle', '수감': 'prison' };
const MODE_TOKEN = { '일상': '#MODE_DAILY', '항해': '#MODE_SAIL', '의뢰': '#MODE_CASE', '전투': '#MODE_BATTLE', '수감': '#MODE_PRISON' };

// ───────────────────────────── 지도 ─────────────────────────────

const SEAS = [
    {
        id: 'north', name: '노스블루', pos: 'nw', color: '#7fb4e0', alias: ['노스'],
        desc: '춥고 거친 북쪽 바다. 전쟁과 암흑가의 고향. 도플라밍고, 로, 상디가 이 바다 출신이다.',
        islands: [
            { n: '플레반스', d: '"흰 마을". 호박납 중독으로 나라째 지워졌다. 지금은 폐허.' },
            { n: '미니온 섬', d: '눈 덮인 섬. 어떤 해적들의 운명이 이곳에서 엇갈렸다.' },
            { n: '스파이더 마일스', d: '쓰레기와 고철의 항구. 암흑가의 거래가 오간다.' },
            { n: '제르마 왕국', d: '영토 없이 바다를 떠도는 나라. 과학의 군대가 있다.' },
            { n: '루브니르 왕국', d: '거짓말쟁이 노란드의 전설이 남은 나라.' },
        ],
    },
    {
        id: 'east', name: '이스트블루', pos: 'ne', color: '#8fd3c0', alias: ['이스트'],
        desc: '가장 평화로운 바다. 그러나 해적왕과 그 뒤를 잇는 자가 태어난 바다.',
        islands: [
            { n: '돈 섬 · 후샤 마을', d: '풍차와 술집이 있는 작은 마을. 산 너머엔 산적과 쓰레기산.' },
            { n: '셸스 타운', d: '해군 153지부가 있는 항구 마을.' },
            { n: '오렌지 마을', d: '애완동물 가게와 개 한 마리의 의리가 있는 마을.' },
            { n: '시럽 마을', d: '거짓말쟁이 소년과 병약한 아가씨의 저택이 있는 평화로운 마을.' },
            { n: '해상 레스토랑 바라티에', d: '바다 위 레스토랑. 요리사가 싸움도 한다.' },
            { n: '코코야시 마을', d: '귤밭의 마을. 어인 해적이 세운 아론 파크가 근처에 있다.' },
            { n: '로그타운', d: '"시작과 끝의 마을". 해적왕이 처형된 처형대가 서 있다.' },
        ],
    },
    {
        id: 'west', name: '웨스트블루', pos: 'sw', color: '#d9a46a', alias: ['웨스트'],
        desc: '마피아와 패밀리의 바다. 학문의 섬이 불타 사라진 바다.',
        islands: [
            { n: '오하라', d: '세계 최대의 도서관이 있던 학자의 섬. 버스터콜로 지도에서 지워졌다.' },
            { n: '마피아 항구', d: '패밀리들이 구역을 나눠 가진 항구. 총보다 의리가 먼저다.' },
            { n: '이름 없는 어촌', d: '대해적시대의 그늘 아래, 어디에나 있는 작은 섬.' },
        ],
    },
    {
        id: 'south', name: '사우스블루', pos: 'se', color: '#e08f7a', alias: ['사우스'],
        desc: '따뜻하고 거친 남쪽 바다. 해적왕의 아들이 태어난 바다.',
        islands: [
            { n: '바테리라', d: '한 여인이 아이를 지키기 위해 스무 달을 버틴 섬.' },
            { n: '소르베 왕국', d: '폭군이 다스렸던 나라. 한때 성자 같은 왕이 있었다.' },
            { n: '뒷골목 항구', d: '빈민가에서 거친 해적들이 자라나는 항구.' },
        ],
    },
    {
        id: 'paradise', name: '위대한 항로 전반', pos: 'w', color: '#e7cf7a', alias: ['파라다이스', '위대한 항로', '그랜드라인'],
        desc: '"파라다이스". 기록지침(로그 포스)이 없으면 항해조차 못 하는 바다. 신세계에 비하면 낙원이라 불린다.',
        islands: [
            { n: '리버스 마운틴 · 쌍둥이 곶', d: '네 바다의 물이 산을 거슬러 오르는 입구. 거대한 고래가 운다.' },
            { n: '위스키 피크', d: '해적을 환영하는 마을. 환영이 진짜인지는 모른다.' },
            { n: '리틀 가든', d: '공룡이 사는 태고의 섬. 거인 둘이 백 년째 결투 중이다.' },
            { n: '드럼 왕국', d: '눈의 나라. 의사들이 성에 있다.' },
            { n: '알라바스타 왕국', d: '사막의 왕국. 비가 내리지 않는다.' },
            { n: '자야 · 모크 타운', d: '꿈을 비웃는 해적들의 마을. 하늘로 가는 길이 위에 있다.' },
            { n: '하늘섬 스카이피아', d: '구름 위의 섬들. 신이라 자칭하는 자가 다스렸다.' },
            { n: '워터 세븐', d: '물의 도시, 조선의 도시. 해열차가 오간다.' },
            { n: '에니에스 로비', d: '낮만 있는 사법의 섬. 정의의 문 너머로 죄인이 끌려간다.' },
            { n: '스릴러 바크', d: '안개 속 거대한 유령선. 그림자를 빼앗긴다.' },
            { n: '샤본디 제도', d: '비눗방울의 맹그로브 섬. 천룡인과 인신매매, 그리고 레드라인 앞의 마지막 항구.' },
            { n: '아마존 릴리', d: '칼름벨트의 여인국. 남자는 들어갈 수 없다.' },
            { n: '임펠다운', d: '칼름벨트 해저의 대감옥. 한 번 들어가면 나올 수 없다.' },
            { n: '마린포드', d: '해군본부. 정상전쟁의 무대.' },
        ],
    },
    {
        id: 'redline', name: '레드라인', pos: 'c', color: '#d4574a', alias: ['레드 라인'],
        desc: '세계를 가로지르는 붉은 대륙. 위에는 성지가, 아래 해저 1만 미터에는 어인섬이 있다.',
        islands: [
            { n: '성지 마리조아', d: '천룡인이 사는 성지. 노예와 보물, 그리고 텅 빈 왕좌.' },
            { n: '어인섬', d: '해저 1만 미터, 거대한 비눗방울 속의 섬. 어인과 인어의 나라 류구 왕국.' },
        ],
    },
    {
        id: 'newworld', name: '신세계', pos: 'e', color: '#b48ce0', alias: ['신세계', '위대한 항로 후반'],
        desc: '위대한 항로 후반. 날씨도, 해적도, 섬도 상식이 통하지 않는다. 사황의 바다.',
        islands: [
            { n: '펑크 해저드', d: '반은 불, 반은 얼음의 섬. 금지된 연구의 흔적.' },
            { n: '드레스로자', d: '사랑과 정열과 장난감의 나라. 투기장의 함성 아래 무언가 숨겨져 있다.' },
            { n: '조우', d: '천 년을 걷는 거대한 코끼리 등 위의 밍크족 나라.' },
            { n: '홀케이크 아일랜드', d: '빅맘의 토토랜드. 과자와 혼인과 수명의 거래.' },
            { n: '와노쿠니', d: '쇄국의 사무라이 나라. 폭포 위 산성과 오니가시마.' },
            { n: '해군본부 (신세계)', d: '정상전쟁 이후 옛 G-1 지부로 옮긴 해군본부.' },
            { n: 'G-5 해군 지부', d: '해군의 쓰레기통이라 불리는 거친 지부.' },
            { n: '에그헤드', d: '미래섬. 천재 과학자 베가펑크의 연구소.' },
            { n: '엘바프', d: '거인족의 나라. 하늘을 찌르는 보물나무 아담.' },
            { n: '해적섬 하치노스', d: '무법자들의 섬. 해골 모양 바위산.' },
            { n: '라프텔', d: '해적왕만 도달한 마지막 섬. 지금은 전설.' },
        ],
    },
];
const islandList = SEAS.flatMap(sea => sea.islands.map(i => ({ ...i, sea })));
function islandOf(loc) {
    const L = String(loc ?? '').replace(/\s+/g, '');
    if (!L) return null;
    return islandList.find(i => i.n.split(/\s*·\s*/).some(p => p.length >= 2 && L.includes(p.replace(/\s+/g, '').replace(/\(.*?\)/g, '')))) ?? null;
}
function seaOf(name) {
    const n = String(name ?? '').replace(/\s+/g, '');
    if (!n) return null;
    return SEAS.find(s => [s.name, ...s.alias].some(a => n.includes(a.replace(/\s+/g, '')))) ?? null;
}

const IMPEL = [
    { lv: 'LV1', name: '홍련지옥', d: '피처럼 붉은 가시 숲. 가시가 몸을 찢는다.', diff: 2 },
    { lv: 'LV2', name: '맹수지옥', d: '맹수들이 풀려 있는 층.', diff: 2 },
    { lv: 'LV3', name: '기아지옥', d: '타는 듯한 더위와 굶주림.', diff: 3 },
    { lv: 'LV4', name: '초열지옥', d: '끓는 피의 연못. 고문의 층.', diff: 3 },
    { lv: 'LV5', name: '극한지옥', d: '얼어붙는 냉기와 늑대들.', diff: 4 },
    { lv: 'LV6', name: '무한지옥', d: '세상에서 지워진 거물들의 층. 사형을 기다린다.', diff: 4 },
];

// ───────────────────────────── 신체 손상 ─────────────────────────────

const MAIMS = [
    { name: '왼눈 실명', desc: '왼쪽 시야가 사라졌다. 거리 감각이 틀어진다.' },
    { name: '손가락 두 개 상실', desc: '오른손 약지와 새끼손가락이 없다. 무기를 쥐는 손이 어색하다.' },
    { name: '왼다리 손상', desc: '다리를 절게 되었다. 뛰면 통증이 올라온다.' },
    { name: '얼굴의 큰 흉터', desc: '얼굴을 가로지르는 흉터. 누구든 한 번은 다시 본다.' },
    { name: '갈비뼈 변형', desc: '숨이 짧아졌다. 오래 싸우면 가슴이 타는 듯하다.' },
    { name: '한쪽 귀 청력 손상', desc: '오른쪽 소리가 먹먹하다.' },
    { name: '왼팔 상실', desc: '왼팔이 어깨 아래로 없다.' },
];
// 손상 부위 키워드 → 판정 보정
const MAIM_MOD = [
    [/팔|손|어깨/, { power: -15, skill: -15 }],
    [/다리|발|무릎/, { agile: -20, stealth: -15 }],
    [/눈|실명/, { sense: -10, skill: -5 }],
    [/귀|청력/, { sense: -5 }],
    [/갈비|폐|숨|내장/, { power: -5, agile: -5, will: -5 }],
];

// ───────────────────────────── 상점 · 장비 ─────────────────────────────

const SHOP = [
    { name: '식량 (10일분)', qty: 1, price: 30000, desc: '배 위의 열흘. 떨어지면 체력이 깎인다.' },
    { name: '약품 상자', qty: 1, price: 60000, desc: '붕대·소독약·진통제. 부상 1개 응급처치.' },
    { name: '로그 포스', qty: 1, price: 200000, desc: '위대한 항로의 필수품. 다음 섬을 가리킨다.' },
    { name: '이터널 포스', qty: 1, price: 1500000, desc: '정해진 섬 하나만 영원히 가리킨다.' },
    { name: '소형 전보벌레', qty: 1, price: 150000, desc: '휴대용 통신. 도청될 수 있다.' },
    { name: '무명 검', qty: 1, price: 150000, desc: '이름 없는 칼. 쓸 만하다.' },
    { name: '권총과 탄약', qty: 1, price: 90000, desc: '해적의 기본 소양.' },
    { name: '연막탄', qty: 3, price: 15000, desc: '도주용. 3개.' },
    { name: '수리 자재', qty: 1, price: 120000, desc: '선체 +20 수리.' },
    { name: '럼주 한 통', qty: 1, price: 20000, desc: '선원의 사기.' },
    { name: '해루석 수갑', qty: 1, price: 3000000, desc: '암시장 물건. 능력자를 무력화한다.' },
    { name: '변장 도구', qty: 1, price: 50000, desc: '가발과 안경. 수배서 얼굴을 가린다.' },
];

// ───────────────────────────── 의뢰 게시판 ─────────────────────────────

const BOARD_SRC = {
    strawhat: ['술집 소문', '정보상', '도움 요청', '보물 지도'],
    pirate: ['정보상', '술집 소문', '지하 중개', '사황 하달'],
    marine: ['지부 명령', '본부 하달', '민간 신고', '상관의 사적 부탁'],
    revolution: ['사령부 작전', '현지 동지', '첩보 의뢰'],
    government: ['CP 지령', '천룡인 요청', '정부 공문'],
    civil: ['마을 게시판', '상인 조합', '현상금 공고', '이웃의 부탁'],
    custom: ['마을 게시판', '정보상', '술집 소문'],
};
const BOARD_POOL = {
    outlaw: [
        { src: '정보상', title: '해군 보급선 항로', grade: 3, pay: '보급품 절반', hook: '다음 주 이 해역을 지나는 해군 보급선의 항로가 팔렸다. 호위는 대령급 하나.' },
        { src: '술집 소문', title: '침몰선의 금고', grade: 2, pay: '찾는 자 몫', hook: '열흘 전 가라앉은 상선에 귀족의 금고가 실려 있었다는 소문. 해왕류의 둥지 근처다.' },
        { src: '지하 중개', title: '탈주 노예 호송', grade: 3, pay: '3,000만 베리', hook: '샤본디에서 도망친 어인 하나를 안전한 섬까지. 추격자는 천룡인의 사병이다.' },
        { src: '도움 요청', title: '해적에게 점령된 마을', grade: 2, pay: '마을의 감사', hook: '어부의 아이가 배에 매달린다. 우리 마을을 구해 줘요. 해군은 오지 않아요.' },
        { src: '보물 지도', title: '반쪽짜리 지도', grade: 3, pay: '보물', hook: '찢긴 지도의 나머지 반쪽을 가진 자가 이 섬 투기장에 나온다.' },
        { src: '사황 하달', title: '영역 표시', grade: 4, pay: '깃발의 비호', hook: '이 섬에 우리 깃발을 꽂아라. 거부하는 놈은 알아서.' },
    ],
    marine: [
        { src: '지부 명령', title: '해적 토벌 — 현상금 1,200만', grade: 2, pay: '공적 + 수당 20만 베리', hook: '근해 어선을 터는 해적단. 선장은 칼잡이, 부하는 스무 명.' },
        { src: '본부 하달', title: '능력자 호송', grade: 4, pay: '공적 대', hook: '해루석 수갑을 찬 능력자 죄수를 임펠다운까지 호송. 그의 동료들이 노린다.' },
        { src: '민간 신고', title: '사라지는 어부들', grade: 2, pay: '공적', hook: '밤마다 어부가 한 명씩 사라진다. 마을은 해적을 의심하지만 증거가 없다.' },
        { src: '상관의 사적 부탁', title: '조용히 처리할 일', grade: 3, pay: '상관의 신임', hook: '상관이 문을 닫고 말한다. 이건 기록에 남지 않는다.' },
        { src: '본부 하달', title: '혁명군 첩보원 색출', grade: 3, pay: '공적', hook: '지부 안에 혁명군 첩자가 있다. 누구도 믿지 마라.' },
    ],
    revolution: [
        { src: '사령부 작전', title: '노예선 습격', grade: 3, pay: '동지들의 신뢰', hook: '천룡인에게 바칠 노예를 실은 배가 이 해역을 지난다.' },
        { src: '현지 동지', title: '폭군의 무기고', grade: 3, pay: '혁명의 불씨', hook: '세계정부 가맹국 왕이 백성의 곡식을 무기로 바꾸고 있다.' },
        { src: '첩보 의뢰', title: '사라진 기록', grade: 4, pay: '정보', hook: 'CP가 회수하려는 문서가 이 섬 도서관 지하에 있다.' },
    ],
    government: [
        { src: 'CP 지령', title: '학자 감시', grade: 2, pay: '공적', hook: '고대 문자를 읽을 수 있다는 학자가 있다. 접촉한 자를 전부 보고하라.' },
        { src: '천룡인 요청', title: '도망친 "물건"', grade: 3, pay: '천룡인의 기분', hook: '세계귀족의 노예가 도망쳤다. 산 채로 데려오라. 무슨 수를 써서든.' },
        { src: '정부 공문', title: '가맹국 왕의 감시', grade: 3, pay: '공적', hook: '레버리 참석국 왕 하나가 혁명군과 접촉한다는 첩보.' },
    ],
    civil: [
        { src: '마을 게시판', title: '항구 일손 구함', grade: 1, pay: '일당 8,000 베리', hook: '상선 하역. 오늘은 해적선도 들어온다고 한다.' },
        { src: '현상금 공고', title: '현상금 800만 베리', grade: 2, pay: '800만 베리', hook: '근처 섬에 숨어든 해적. 해군 지부에 데려가면 바로 지급.' },
        { src: '상인 조합', title: '호위 구함', grade: 2, pay: '50만 베리', hook: '다음 섬까지 상선 호위. 이 해역엔 해왕류가 나온다.' },
        { src: '이웃의 부탁', title: '돌아오지 않는 아들', grade: 1, pay: '따뜻한 밥', hook: '해적이 되겠다며 떠난 아들이 사흘째 돌아오지 않는다.' },
        { src: '상인 조합', title: '수상한 화물', grade: 3, pay: '200만 베리', hook: '내용물을 묻지 말고 옮겨 달라. 상자 안에서 숨소리가 들린다.' },
    ],
};

// ───────────────────────────── 랜덤 이벤트 ─────────────────────────────
// who: any | outlaw | lawful(해군·정부) | civil  · min: 최소 위험도 · mode: 이 모드일 때만
const EVENTS = [
    { w: 3, ko: '폭풍 — 바다가 돌변한다', en: 'a sudden storm or freak Grand Line weather strikes', mode: ['항해'] },
    { w: 2, ko: '해왕류 출현', en: 'a Sea King surfaces nearby', mode: ['항해'] },
    { w: 2, ko: '보급 부족', en: 'supplies run short (food, water or medicine) — make it bite', mode: ['항해'] },
    { w: 2, ko: '표류자 발견', en: 'a castaway or wreck asks for help (it might be a trap)', mode: ['항해'] },
    { w: 3, ko: '해군 순찰선 발견', en: 'a Marine patrol ship spots {{user}}', who: 'outlaw' },
    { w: 3, ko: '현상금 사냥꾼의 습격', en: 'bounty hunters who recognized the wanted poster make their move', who: 'outlaw', min: 1 },
    { w: 2, ko: 'CP 요원의 그림자', en: 'a CP agent is quietly tailing {{user}}', who: 'outlaw', min: 3 },
    { w: 2, ko: '대장 출격 소문', en: 'rumor spreads that an Admiral has been dispatched toward this area', who: 'outlaw', min: 4 },
    { w: 1, ko: '버스터콜 경보', en: 'a Buster Call is being weighed for {{user}}\'s location', who: 'outlaw', min: 5 },
    { w: 3, ko: '해적 출몰 신고', en: 'a report: pirates are raiding a nearby village', who: 'lawful' },
    { w: 2, ko: '상관의 호출', en: '{{user}}\'s superior summons them — an order or a test', who: 'lawful' },
    { w: 1, ko: '정의의 균열', en: 'an order arrives that clashes with {{user}}\'s sense of justice', who: 'lawful' },
    { w: 2, ko: '해적의 습격', en: 'a pirate crew raids the place {{user}} is in', who: 'civil' },
    { w: 2, ko: '수상한 거래 제안', en: 'a shady broker offers a deal too good to be true' },
    { w: 3, ko: '호외 — 세계를 흔드는 뉴스', en: 'a News Coo drops an extra with major world news fitting the era', news: true },
    { w: 2, ko: '적대 세력과 조우', en: 'a rival crew or hostile group crosses paths with {{user}}' },
    { w: 2, ko: '섬의 축제', en: 'a local festival, market or celebration', mode: ['일상'] },
    { w: 2, ko: '옛 인연의 소식', en: 'news from or about someone {{user}} knows' },
    { w: 1, ko: '정체불명의 열매', en: 'a strange swirled fruit turns up — a Devil Fruit? (rare, dangerous to claim)' },
];

// ───────────────────────────── 꿈 · 활동 · 발견 ─────────────────────────────

const DREAMS = ['해적왕이 된다', '올블루를 찾는다', '세계 지도를 그린다', '세계 최강의 검사', '용감한 바다의 전사', '진짜 역사를 안다', '꿈의 배로 세계 일주', '진정한 정의를 세운다', '모두가 자유로운 세상', '잃어버린 가족을 찾는다', '내 가게를 연다', '평범하게, 행복하게', '직접 입력'];
const FIND_KINDS = ['요리', '명소', '생물', '보물', '전설', '역사', '사람', '물건'];

// need: bond = 인연 선택, item = 소지품 선택, crew = 동료 필요
const ACTIVITIES = {
    '일상': [
        { ico: '🍖', name: '명물 먹기', text: '이 섬의 명물 요리를 먹으러 간다.' },
        { ico: '🍺', name: '술집 소문', text: '술집에 들러 한 잔 시키고 소문에 귀를 기울인다.' },
        { ico: '🛍️', name: '시장 구경', text: '시장을 천천히 구경한다. 이 섬에서만 파는 걸 찾아본다.' },
        { ico: '🧭', name: '섬 탐험', text: '지도에 없는 곳을 찾아 섬 안쪽으로 걸어 들어간다.' },
        { ico: '💪', name: '수련', text: '사람 없는 곳에서 몸을 단련한다.' },
        { ico: '💰', name: '하루 일하기', text: '오늘 하루 벌이가 되는 일을 찾는다.' },
        { ico: '🛏️', name: '푹 쉬기', text: '오늘은 아무것도 하지 않고 푹 쉰다.' },
        { ico: '💞', name: '함께 시간 보내기', text: '{who}와(과) 함께 시간을 보내러 간다.', need: 'bond' },
        { ico: '🎁', name: '선물하기', text: '{who}에게 {item}을(를) 건넨다.', need: 'gift' },
        { ico: '☎️', name: '전보벌레 연락', text: '전보벌레로 {who}에게 연락한다.', need: 'bond' },
        { ico: '🎉', name: '연회 열기', text: '오늘 밤은 다 같이 연회다! 고기와 술을 잔뜩 준비한다.', need: 'crew' },
        { ico: '📝', name: '일기 쓰기', text: '오늘 있었던 일을 일기에 적는다. 무엇을 남겨 둘까.' },
    ],
    '항해': [
        { ico: '🎣', name: '낚시', text: '뱃전에 걸터앉아 낚싯대를 드리운다.' },
        { ico: '🌌', name: '밤 당번', text: '밤 당번을 서며 별과 수평선을 본다.' },
        { ico: '🍻', name: '갑판 연회', text: '갑판에서 한바탕 떠들썩하게 논다.', need: 'crew' },
        { ico: '🔨', name: '배 손질', text: '배 구석구석을 점검하고 손본다.' },
        { ico: '💪', name: '수련', text: '흔들리는 갑판 위에서 수련한다.' },
        { ico: '💞', name: '대화하기', text: '{who}에게 말을 건다.', need: 'bond' },
        { ico: '📝', name: '항해 일지', text: '항해 일지를 펼쳐 오늘을 기록한다.' },
    ],
    '수감': [
        { ico: '🗣️', name: '감방 동기', text: '옆 감방의 죄수에게 말을 건다.' },
        { ico: '👁️', name: '간수 관찰', text: '간수들의 교대 시간과 버릇을 몰래 살핀다.' },
        { ico: '🫀', name: '버틴다', text: '이를 악물고 오늘을 버틴다. 살아서 나간다.' },
    ],
};

// ───────────────────────────── 달력 · 생일 (토큰 0) ─────────────────────────────
// 원작 공식 생일 (월, 일). 인연 이름과 맞으면 그날 이벤트.
const BIRTHDAYS = [
    ['몽키 D. 루피', 5, 5], ['롤로노아 조로', 11, 11], ['나미', 7, 3], ['우솝', 4, 1], ['상디', 3, 2], ['토니토니 쵸파', 12, 24],
    ['니코 로빈', 2, 6], ['프랑키', 3, 9], ['브룩', 4, 3], ['징베', 4, 2], ['트라팔가 로', 10, 6], ['포트거스 D. 에이스', 1, 1],
    ['샹크스', 3, 9], ['스모커', 3, 14], ['타시기', 10, 6], ['보아 핸콕', 9, 2], ['유스타스 키드', 1, 10], ['코비', 5, 13],
    ['사보', 3, 20], ['드라큘 미호크', 3, 9], ['버기', 8, 8], ['크로커다일', 9, 5], ['돈키호테 도플라밍고', 10, 23], ['마르코', 10, 5],
    ['네페르타리 비비', 2, 2], ['샬롯 카타쿠리', 11, 25], ['쿠잔', 9, 21], ['볼사리노', 11, 23], ['사카즈키', 8, 16], ['몽키 D. 가프', 5, 2],
];
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
function dateOf(start, day) {
    let m = (start?.m ?? 1) - 1, d = (start?.d ?? 1) - 1 + (day - 1);
    while (d >= MONTH_DAYS[m]) { d -= MONTH_DAYS[m]; m = (m + 1) % 12; }
    return { m: m + 1, d: d + 1 };
}
const dateText = (dt) => `${dt.m}월 ${dt.d}일`;

// ───────────────────────────── 시대별 원작 핵심 인물 (시대 시작 시점, 10명 이내) ─────────────────────────────
const ERA_CAST = {
    roger: [['센고쿠', '마린포드', '해군 대장'], ['몽키 D. 가프', '마린포드', '해군 중장'], ['금사자 시키', '임펠다운', '수감 중'], ['포트거스 D. 루쥬', '바테리라', '몸을 숨기고 있다'], ['클로버 박사', '오하라', '고고학자'], ['니코 로빈', '오하라', '어린아이'], ['넵튠', '어인섬', '류구 왕국의 왕'], ['돈키호테 도플라밍고', '스파이더 마일스', '패밀리를 꾸리는 중']],
    east: [['몽키 D. 루피', '돈 섬 · 후샤 마을', '출항 직전'], ['롤로노아 조로', '셸스 타운', '해군 기지에 묶여 있다'], ['버기', '오렌지 마을', '마을을 점거 중'], ['아론', '코코야시 마을', '아론 파크'], ['스모커', '로그타운', '해군 대령'], ['크로커다일', '알라바스타 왕국', '칠무해 · 영웅 행세'], ['아이스버그', '워터 세븐', '시장 · 갈레라 사장'], ['실버즈 레일리', '샤본디 제도', '코팅 장인'], ['보아 핸콕', '아마존 릴리', '여제'], ['센고쿠', '마린포드', '해군 원수']],
    war: [['포트거스 D. 에이스', '임펠다운', 'LV6 · 처형 대기'], ['센고쿠', '마린포드', '전쟁 준비'], ['몽키 D. 가프', '마린포드', '해군 중장'], ['마젤란', '임펠다운', '서장'], ['에포니 이반코프', '임펠다운', 'LV5.5 뉴카마랜드'], ['크로커다일', '임펠다운', 'LV6 수감'], ['징베', '임펠다운', 'LV6 수감'], ['보아 핸콕', '아마존 릴리', '여제'], ['실버즈 레일리', '샤본디 제도', '코팅 장인']],
    newworld: [['사카즈키', '해군본부 (신세계)', '해군 원수'], ['넵튠', '어인섬', '류구 왕국의 왕'], ['시라호시', '어인섬', '인어 공주'], ['시저 클라운', '펑크 해저드', '불법 연구'], ['돈키호테 도플라밍고', '드레스로자', '국왕'], ['이누아라시', '조우', '낮의 공작'], ['샬롯 링링', '홀케이크 아일랜드', '사황 빅맘'], ['카이도', '와노쿠니', '사황'], ['스모커', 'G-5 해군 지부', '중장'], ['실버즈 레일리', '샤본디 제도', '코팅 장인']],
    final: [['베가펑크', '에그헤드', '천재 과학자'], ['사카즈키', '해군본부 (신세계)', '해군 원수'], ['마셜 D. 티치', '해적섬 하치노스', '사황 검은수염'], ['로키', '엘바프', '사슬에 묶인 왕자'], ['코즈키 모모노스케', '와노쿠니', '쇼군'], ['보아 핸콕', '아마존 릴리', '여제'], ['넵튠', '어인섬', '류구 왕국의 왕'], ['리쿠 돌드 3세', '드레스로자', '국왕'], ['스모커', 'G-5 해군 지부', '중장']],
};

// ───────────────────────────── 배 · 개조 ─────────────────────────────
const SHIPS = [
    { name: '소형 보트', price: 300000, desc: '한두 명이 타는 돛단배. 위대한 항로에선 목숨을 건다.' },
    { name: '소형 범선', price: 5000000, desc: '대여섯 명이 지낼 수 있는 캐러벨.' },
    { name: '중형 범선', price: 30000000, desc: '선실·주방·창고가 갖춰진 제대로 된 해적선.' },
    { name: '대형 범선', price: 150000000, desc: '수십 명이 타는 브리그. 아담나무급은 아니다.' },
];
const SHIP_PARTS = [
    { name: '보강 선체', price: 2000000, desc: '선체 손상이 줄어든다.', en: 'reinforced hull (takes less damage)' },
    { name: '대포', price: 1500000, desc: '측면 대포 2문.', en: 'two broadside cannons' },
    { name: '의무실', price: 3000000, desc: '생존 판정 +10 (배 위에서).', en: 'sick bay (better survival aboard)' },
    { name: '넓은 주방', price: 1000000, desc: '요리사가 좋아한다. 연회가 즐겁다.', en: 'big galley' },
    { name: '대욕장', price: 1500000, desc: '항해의 피로가 풀린다.', en: 'bath' },
    { name: '망대', price: 800000, desc: '멀리 있는 배·섬을 먼저 본다.', en: 'crow\'s nest lookout' },
    { name: '수족관 바', price: 4000000, desc: '바다를 보며 마시는 술.', en: 'aquarium bar' },
    { name: '측면 외륜', price: 6000000, desc: '바람 없는 칼름벨트도 건넌다.', en: 'paddle wheels (can cross the Calm Belt)' },
];


// ───────────────────────────── 해프닝 (랜덤 저주) ─────────────────────────────
// days: 지속 일수(0 = 그 자리에서 끝나는 사건) · mods: 판정 보정(all = 모든 판정) · ops: 즉시 효과
const HEXES = [
    { name: '고양이가 됐다', kind: '웃김', days: 1, desc: '몸이 고양이로 변했다. 말은 전부 "냥"으로 나온다.', en: 'turned into a cat; can only say "meow"', mods: { talk: -25, stealth: 15, agile: 10 } },
    { name: '다람쥐 목소리', kind: '웃김', days: 1, desc: '목소리가 헬륨 마신 것처럼 높아졌다. 아무도 진지하게 안 듣는다.', en: 'squeaky helium voice; nobody takes {{user}} seriously', mods: { talk: -10 } },
    { name: '거짓말 금지', kind: '웃김', days: 2, desc: '입만 열면 진실이 튀어나온다. 속마음까지.', en: 'can only speak the truth, even inner thoughts', mods: { talk: -10 } },
    { name: '영혼 체인지', kind: '웃김', days: 1, desc: '가장 가까운 동료와 몸이 바뀌었다.', en: 'swapped bodies with the closest companion' },
    { name: '꼬마가 됐다', kind: '웃김', days: 2, desc: '몸이 열 살 꼬마로 줄었다. 옷이 너무 크다.', en: 'shrunk into a ten-year-old body', mods: { power: -20, stealth: 10 } },
    { name: '웃음 버섯', kind: '웃김', days: 1, desc: '이상한 버섯을 먹었다. 웃음이 멈추지 않는다.', en: 'ate a laughing mushroom; cannot stop laughing', mods: { stealth: -20, talk: -10 } },
    { name: '모든 말이 노래', kind: '웃김', days: 1, desc: '하는 말이 전부 뮤지컬 노래가 된다.', en: 'every sentence comes out as a musical number', mods: { stealth: -10 } },
    { name: '갈매기의 원한', kind: '웃김', days: 2, desc: '갈매기 떼가 졸졸 따라다니며 쪼아 댄다.', en: 'a flock of gulls follows and pecks {{user}} everywhere', mods: { stealth: -15 } },
    { name: '해왕류의 짝사랑', kind: '웃김', days: 2, desc: '거대한 해왕류 한 마리가 배를 따라오며 구애한다.', en: 'a giant Sea King is in love with {{user}} and follows the ship' },
    { name: '사랑의 묘약', kind: '로맨스', days: 1, desc: '처음 눈이 마주친 사람에게 홀딱 반해 버렸다.', en: 'love potion: hopelessly smitten with the first person they lock eyes with (temporary, embarrassing)' },
    { name: '속마음 들림', kind: '로맨스', days: 1, desc: '가까운 사람의 속마음이 가끔 들린다. 듣고 싶지 않은 것까지.', en: 'sometimes hears the inner thoughts of people nearby', mods: { sense: 10 } },
    { name: '젖은 발소리', kind: '공포', days: 2, desc: '밤마다 아무도 없는 갑판에 젖은 발자국이 찍힌다.', en: 'every night wet footprints appear on the empty deck; something follows', mods: { will: -10 } },
    { name: '그림자 도둑', kind: '공포', days: 1, desc: '그림자가 사라졌다. 햇빛이 살을 태운다.', en: 'shadow stolen; sunlight burns', mods: { all: -5 } },
    { name: '거울 속 타인', kind: '공포', days: 2, desc: '거울 속의 내가 반 박자 늦게 움직이고, 가끔 웃는다.', en: '{{user}}\'s reflection moves late and sometimes smiles on its own', mods: { sense: -10, will: -5 } },
    { name: '유령선 조우', kind: '공포', days: 0, desc: '안개 속에서 낡은 유령선이 다가온다.', en: 'a ghost ship drifts out of the fog toward {{user}}' },
    { name: '배가 뒤집혔다', kind: '재난', days: 0, desc: '돌풍에 배가 뒤집혔다. 짐 일부가 바다로.', en: 'a freak wave capsizes the ship; some cargo is lost', ops: [['ship', '-30'], ['item', '-식량 (10일분) 1']] },
    { name: '움직이는 비구름', kind: '재난', days: 2, desc: '가는 곳마다 머리 위에만 비가 온다.', en: 'a personal rain cloud follows {{user}}', mods: { stealth: -5 } },
    { name: '검은 고양이의 불운', kind: '이상', days: 2, desc: '하는 일마다 꼬인다.', en: 'everything goes wrong; comically bad luck', mods: { all: -10 } },
    { name: '사라지는 동전', kind: '이상', days: 1, desc: '손에 쥔 동전이 하나씩 사라진다.', en: 'coins vanish from {{user}}\'s hands', ops: [['cash', '-3만']] },
    { name: '바위처럼 무거움', kind: '이상', days: 1, desc: '몸이 바위처럼 무거워졌다. 물에 들어가면 가라앉는다.', en: 'body heavy as stone; sinks in water', mods: { agile: -20 } },
    { name: '하루치 기억 상실', kind: '이상', days: 1, desc: '어제 일이 하나도 기억나지 않는다.', en: 'cannot remember yesterday at all' },
];
const HEX_KINDS = ['웃김', '로맨스', '공포', '재난', '이상'];

// 진영별 추가 활동 (오늘 뭐 하지?)
const FACTION_ACTS = {
    marine: [{ ico: '🚩', name: '순찰 돌기', text: '맡은 구역을 순찰한다.' }, { ico: '🎯', name: '훈련', text: '연병장에서 훈련에 참가한다.' }, { ico: '📄', name: '보고서', text: '밀린 보고서를 쓴다. 무엇을 적고 무엇을 뺄까.' }],
    government: [{ ico: '🕶️', name: '잠입·감시', text: '표적을 몰래 지켜본다.' }, { ico: '📞', name: '본부에 보고', text: '전보벌레로 본부에 보고를 올린다.' }],
    revolution: [{ ico: '🤝', name: '동지와 접선', text: '현지 동지와 비밀리에 접선한다.' }, { ico: '🗂️', name: '첩보 수집', text: '이 섬의 권력자에 대해 조사한다.' }],
    civil: [{ ico: '🏪', name: '가게 일', text: '오늘도 가게 문을 연다.' }, { ico: '🪙', name: '장사·흥정', text: '물건을 사고팔며 흥정한다.' }, { ico: '🙋', name: '이웃 돕기', text: '이웃의 부탁을 들어준다.' }],
};

// ───────────────────────────── 유틸 ─────────────────────────────

const ctx = () => SillyTavern.getContext();
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const clone = (o) => structuredClone(o);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '±0');

// 1,032,000,000 → "10억 3,200만"
function korNum(n) {
    n = Math.round(Number(n) || 0);
    const neg = n < 0; n = Math.abs(n);
    const eok = Math.floor(n / 1e8), man = Math.floor((n % 1e8) / 1e4), rest = n % 1e4;
    const parts = [];
    if (eok) parts.push(`${eok.toLocaleString('ko-KR')}억`);
    if (man) parts.push(`${man.toLocaleString('ko-KR')}만`);
    if (rest && !eok) parts.push(rest.toLocaleString('ko-KR'));
    return (neg ? '−' : '') + (parts.join(' ') || '0');
}
const berry = (n) => `${korNum(n)} 베리`;

function hashStr(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
        h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
        h = (h << 13) | (h >>> 19);
    }
    return h >>> 0;
}
function rngFrom(seed) {
    let a = hashStr(String(seed));
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
function d100() {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return (buf[0] % 100) + 1;
}
function h(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
}
const norm = (x) => String(x ?? '').replace(/\s+/g, '');
// 이름 맞추기: 완전 일치 → 이름 토큰 일치("로" = "트라팔가 로") → 3글자 이상일 때만 부분 일치. "로"≠"로빈", "인물1"≠"인물10"
const nameTokens = (x) => String(x ?? '').split(/[\s.·,]+/).filter(Boolean);
function nameMatch(a, b) {
    const na = norm(a), nb = norm(b);
    if (!na || !nb) return false;
    if (na === nb) return true;
    if (nameTokens(a).includes(String(b).trim()) || nameTokens(b).includes(String(a).trim())) return true;
    const [s, l] = na.length <= nb.length ? [na, nb] : [nb, na];
    return s.length >= 3 && l.includes(s);
}
function fuzzyFind(list, name, field = 'name') {
    const n = norm(name);
    if (!n) return null;
    return list.find(x => norm(x[field]) === n) ?? list.find(x => nameMatch(x[field], name)) ?? null;
}

// ───────────────────────────── 설정 / 메타 ─────────────────────────────

function settings() {
    const { extensionSettings } = ctx();
    if (!extensionSettings[MODULE]) extensionSettings[MODULE] = structuredClone(DEFAULTS);
    for (const k of Object.keys(DEFAULTS)) {
        if (!Object.hasOwn(extensionSettings[MODULE], k)) extensionSettings[MODULE][k] = DEFAULTS[k];
    }
    return extensionSettings[MODULE];
}
function saveSettings() { ctx().saveSettingsDebounced(); }

function getMeta(create = false) {
    const md = ctx().chatMetadata;
    if (!md) return null;
    if (!md[MODULE] && create) md[MODULE] = { v: 1, profile: null, adjust: [] };
    return md[MODULE] ?? null;
}
async function saveMeta(now = false) {
    const c = ctx();
    if (now || !c.saveMetadataDebounced) await c.saveMetadata();
    else c.saveMetadataDebounced();
}

function cardHasFlag(ch) { return !!ch?.data?.extensions?.[MODULE]; }
function isActive() {
    const s = settings();
    if (!s.enabled) return false;
    const c = ctx();
    if (!c.getCurrentChatId?.()) return false;
    if (s.allCharacters) return true;
    if (c.groupId) {
        const g = c.groups?.find(x => x.id == c.groupId);
        return !!g?.members?.some(av => cardHasFlag(c.characters.find(ch => ch.avatar === av)));
    }
    if (c.characterId === undefined) return false;
    return cardHasFlag(c.characters[c.characterId]);
}

// ───────────────────────────── 상태 엔진 ─────────────────────────────

const isOutlaw = (s) => factionOf(s.faction).outlaw || s.bounty > 0;
const heatName = (s) => (isOutlaw(s) ? '악명' : factionOf(s.faction).heat);
const eraOf = (s) => ERAS[clamp(s.era ?? 1, 0, ERAS.length - 1)];

function freshState(profile) {
    const s = {
        registered: false, name: '', faction: 'custom', factionLabel: '', affil: '', rank: '',
        race: '', style: '', origin: '', story: '', canonChar: false,
        era: 1, canon: 'normal', diff: 'normal', goals: [],
        hp: 100, tier: 1, cash: 0, bounty: 0, heat: 0, fame: 0,
        day: 1, time: '아침', loc: '', sea: '', mode: '일상',
        fruit: null, haki: { 견문: 0, 무장: 0, 패왕: 0 }, conqueror: false,
        wounds: [], maims: [], items: [], crew: [], bonds: [], ship: null,
        case: '', foe: null, prison: null, seastone: false,
        dead: false, rewinds: 0, deaths: [], cgBounty: false, peakDanger: 0,
        news: [], alerts: [], log: [], checkpoints: [], pending: [], opening: false,
        dream: { text: '', pct: 0 }, memories: [], finds: [], visited: [], start: { m: 1, d: 1 }, birthday: null, hexes: [], mail: [], eraDetail: '',
    };
    if (!profile) return s;
    const f = factionOf(profile.faction);
    Object.assign(s, {
        registered: true,
        name: profile.name, faction: f.id, factionLabel: profile.factionLabel || f.short, affil: profile.affil ?? '',
        rank: profile.rank ?? '', race: profile.race ?? '인간', style: profile.style ?? '', origin: profile.origin ?? '',
        story: profile.story ?? '', canonChar: !!profile.canonChar, age: profile.age ?? '', gender: profile.gender ?? '',
        era: profile.era ?? 1, canon: profile.canon ?? 'normal', diff: profile.diff ?? 'normal', goals: clone(profile.goals ?? []),
        hp: 100, tier: clamp(profile.tier ?? f.tier, 1, 6), cash: profile.cash ?? f.cash, bounty: profile.bounty ?? 0,
        fame: profile.fame ?? 0, loc: profile.loc ?? '', sea: profile.sea ?? '', time: '아침',
        fruit: profile.fruit ? clone(profile.fruit) : null,
        haki: { 견문: 0, 무장: 0, 패왕: 0, ...(profile.haki ?? {}) }, conqueror: !!profile.conqueror,
        ship: profile.ship ? { name: profile.ship, hull: 100, status: '' } : null,
        items: clone(profile.items ?? []),
        dream: { text: profile.dream ?? '', pct: 0 },
        start: profile.start ?? { m: 1, d: 1 }, birthday: profile.birthday ?? null, photo: profile.photo ?? '',
    });
    if (s.ship) s.ship.parts = [];
    s.peakDanger = dangerOf(s.bounty);
    s.checkpoints.push({ at: -1, day: 1, loc: s.loc, island: islandOf(s.loc)?.n ?? s.loc });
    const isl0 = islandOf(s.loc);
    if (isl0) s.visited.push({ n: isl0.n, day: 1 });
    for (const [nm, rel, , aff, love] of (profile.startBonds ?? []).slice(0, CAP.bonds)) s.bonds.push({ name: nm, aff: clamp(Number(aff ?? 30) || 30, -100, 100), love: clamp(Number(love ?? 0) || 0, 0, 100), rel, note: '', met: 1 });
    for (const [nm, role] of (profile.startCrew ?? []).slice(0, CAP.crew)) if (nm && !nameMatch(nm, s.name)) s.crew.push({ name: nm, role: role ?? '', status: '' });
    s.eraDetail = profile.eraDetail ?? '';
    s.log.push({ day: 1, text: `출항 — ${s.factionLabel}${s.affil ? ` · ${s.affil}` : ''} · ${eraOf(s).name}` });
    return s;
}

const KEYMAP = {
    hp: 'hp', '체력': 'hp', cash: 'cash', berry: 'cash', '베리': 'cash', '돈': 'cash', '재산': 'cash', '자금': 'cash', money: 'cash',
    bounty: 'bounty', '현상금': 'bounty', heat: 'heat', '악명': 'heat', '공적': 'heat', '주목': 'heat',
    fame: 'fame', '명성': 'fame', tier: 'tier', '격': 'tier', '등급': 'tier',
    day: 'day', '일차': 'day', '날짜': 'day', time: 'time', '시간': 'time', '시간대': 'time',
    loc: 'loc', '장소': 'loc', '위치': 'loc', location: 'loc', sea: 'sea', '바다': 'sea', '해역': 'sea',
    mode: 'mode', '모드': 'mode', case: 'case', '의뢰': 'case', foe: 'foe', '적': 'foe', enemy: 'foe',
    wound: 'wound', wounds: 'wound', '부상': 'wound', maim: 'maim', '신체손상': 'maim', '손상': 'maim', '영구부상': 'maim',
    item: 'item', items: 'item', '소지품': 'item', '아이템': 'item',
    crew: 'crew', '동료': 'crew', '선원': 'crew', '크루': 'crew', bond: 'bond', '인연': 'bond', '호감': 'bond', '관계': 'bond',
    ship: 'ship', '배': 'ship', '선박': 'ship', fruit: 'fruit', '열매': 'fruit', '악마의열매': 'fruit',
    haki: 'haki', '패기': 'haki', prison: 'prison', '수감': 'prison', '감옥': 'prison',
    confiscate: 'confiscate', '몰수': 'confiscate', news: 'news', '뉴스': 'news', '신문': 'news', '호외': 'news',
    alert: 'alert', '경보': 'alert', rank: 'rank', '계급': 'rank', '직책': 'rank', seastone: 'seastone', '해루석': 'seastone',
    love: 'love', '설렘': 'love', '애정': 'love', romance: 'love',
    memory: 'memory', '추억': 'memory', discover: 'discover', '발견': 'discover', find: 'discover',
    dream: 'dream', '꿈': 'dream',
    hex: 'hex', '해프닝': 'hex', '저주': 'hex', curse: 'hex', letter: 'letter', '편지': 'letter',
    upgrade: 'upgrade', '개조': 'upgrade', _newship: '_newship',
    _timeskip: '_timeskip', _era: '_era', _rewind: '_rewind', _die: '_die', _survive: '_survive',
};

const BLOCK_RE = /<state>([\s\S]*?)(?:<\/state>|$)/gi;
function extractOps(text) {
    const ops = [];
    if (!text || !/<state>/i.test(text)) return ops;
    for (const m of String(text).matchAll(BLOCK_RE)) {
        for (const line of m[1].split(/\r?\n/)) {
            const lm = line.match(/^\s*[-*•]?\s*([A-Za-z_가-힣]+)\s*[:：]\s*(.*?)\s*$/);
            if (lm && KEYMAP[lm[1].toLowerCase()]) ops.push([lm[1], lm[2]]);
        }
    }
    return ops;
}

// "+3000만", "-1억 2000만", "30억", "1,500,000", "+12"
function parseNum(raw, cur) {
    let t = String(raw ?? '').trim().replace(/[−–—]/g, '-').replace(/[,\s]|베리|berry|원|%|₿|฿/gi, '');
    t = t.split('/')[0].split('|')[0];
    const m = t.match(/^([+-])?((?:\d+(?:\.\d+)?억)?(?:\d+(?:\.\d+)?천만)?(?:\d+(?:\.\d+)?만)?(?:\d+(?:\.\d+)?)?)/);
    if (!m || !m[2]) return cur;
    let n = 0, body = m[2];
    const take = (re, mul) => { const x = body.match(re); if (x) { n += parseFloat(x[1]) * mul; body = body.replace(x[0], ''); } };
    take(/(\d+(?:\.\d+)?)억/, 1e8);
    take(/(\d+(?:\.\d+)?)천만/, 1e7);
    take(/(\d+(?:\.\d+)?)만/, 1e4);
    if (/^\d+(?:\.\d+)?$/.test(body)) n += parseFloat(body);
    if (m[1] === '+') return cur + n;
    if (m[1] === '-') return cur - n;
    return n;
}

const normTime = (v) => TIMES.find(t => v.includes(t)) ?? (v.includes('자정') ? '심야' : v.includes('오후') ? '낮' : v.includes('오전') ? '아침' : '밤');
const normMode = (v) => v.includes('전투') ? '전투' : v.includes('수감') || v.includes('감옥') ? '수감' : v.includes('항해') || v.includes('바다') ? '항해' : v.includes('의뢰') || v.includes('임무') || v.includes('작전') ? '의뢰' : '일상';
const NONE_RE = /^(?:없음|없다|-|—|none|null|해결|완료|종료|퇴치|격파|도주|이탈|사라짐|해제|석방)(?![가-힣A-Za-z0-9])/i;

function pushNews(s, text, kind = 'world') {
    s.news.push({ day: s.day, text, kind });
    if (s.news.length > CAP.news) s.news = s.news.slice(-CAP.news);
}
function pushAlert(s, text) {
    s.alerts = s.alerts.filter(a => a.text !== text);
    s.alerts.push({ day: s.day, text });
    if (s.alerts.length > 4) s.alerts = s.alerts.slice(-4);
}

function checkDanger(s, info) {
    const d = dangerOf(s.bounty);
    if (d > s.peakDanger) {
        for (let st = s.peakDanger + 1; st <= d; st++) {
            pushAlert(s, `위험도 ★${st} ${DANGER_NAME[st]} — ${HUNT_KO[st]}`);
            info.events.push({ type: 'alert', text: `위험도 ★${st} ${DANGER_NAME[st]} — ${HUNT_KO[st]}` });
        }
        s.peakDanger = d;
    }
}

function setBounty(s, n, info, why = '') {
    n = Math.max(0, Math.round(n));
    if (n === s.bounty) return;
    const up = n > s.bounty;
    const first = s.bounty === 0;
    s.bounty = n;
    if (up) {
        const t = `${first ? '첫 현상수배서' : '현상금 갱신'} — ${s.name} ${berry(n)}${why ? ` (${why})` : ''}`;
        pushNews(s, t, 'bounty');
        s.log.push({ day: s.day, text: t });
        info.events.push({ type: 'bounty', text: t, bounty: n });
        s.fame = clamp(s.fame + (first ? 6 : 4), 0, 100);
    }
    checkDanger(s, info);
}

function rankUp(s, ladder, info, cap) {
    const i = ladder.indexOf(s.rank);
    if (i < 0 || i >= cap) { s.fame = clamp(s.fame + 6, 0, 100); info.events.push({ type: 'fame', text: `공적 누적 — 명성 상승 (${fameTitle(s.fame)})` }); return; }
    const prev = s.rank;
    s.rank = ladder[i + 1];
    const t = `진급 — ${prev} → ${s.rank}`;
    s.log.push({ day: s.day, text: t });
    info.events.push({ type: 'rank', text: t });
    if (i + 1 >= 12) pushNews(s, `${s.factionLabel} ${s.name}, ${s.rank}으로 승진`, 'world');
}

// 악명/공적/명성 게이지가 100을 넘을 때
function stepUp(s, info) {
    const rnd = rngFrom(`${info.seed}:step:${s.bounty}:${s.fame}`);
    const era = eraOf(s);
    if (isOutlaw(s)) {
        const base = TIER_BOUNTY[clamp(s.tier, 1, 6)];
        let inc = base * (0.6 + rnd() * 0.9);
        const unit = inc >= 1e8 ? 1e7 : inc >= 1e7 ? 1e6 : 1e5;
        inc = Math.max(unit, Math.round(inc / unit) * unit);
        setBounty(s, s.bounty + inc, info, '악명 누적');
        return;
    }
    if (s.faction === 'marine') rankUp(s, MARINE_RANKS, info, 15);
    else if (s.faction === 'government') rankUp(s, GOV_RANKS, info, 4);
    else {
        s.fame = clamp(s.fame + 12, 0, 100);
        info.events.push({ type: 'fame', text: `명성 상승 — ${fameTitle(s.fame)}` });
    }
    // 최종장: 크로스 길드는 이름난 해군에게 현상금을 건다
    if (era.id === 'final' && ['marine', 'government'].includes(s.faction) && s.fame >= 45 && !s.cgBounty && s.bounty === 0) {
        s.cgBounty = true;
        const n = Math.max(TIER_BOUNTY[s.tier] * 2, 50_000_000);
        setBounty(s, n, info, '크로스 길드가 건 현상금');
        pushAlert(s, '크로스 길드의 현상금 — 이제 해적이 당신을 사냥한다');
    }
}

function eventRoll(s, d, info) {
    const rate = { off: 0, low: 0.12, normal: 0.22, high: 0.36 }[settings().events] ?? 0.22;
    if (!rate || s.mode === '수감' || s.dead) return;
    const danger = dangerOf(s.bounty);
    const rnd = rngFrom(`${info.seed}:ev:${d}`);
    if (rnd() > rate + danger * 0.07) return;
    const who = isOutlaw(s) ? 'outlaw' : ['marine', 'government'].includes(s.faction) ? 'lawful' : 'civil';
    const pool = EVENTS.filter(e => (!e.who || e.who === who) && (e.min ?? 0) <= danger && (!e.mode || e.mode.includes(s.mode)));
    const total = pool.reduce((a, e) => a + e.w, 0);
    let r = rnd() * total;
    const ev = pool.find(e => (r -= e.w) < 0) ?? pool[0];
    if (!ev) return;
    s.pending.push({ kind: 'event', en: ev.en, ko: ev.ko });
    info.events.push({ type: 'event', text: `이벤트 — ${ev.ko}` });
    if (ev.news) pushNews(s, `호외 — ${ev.ko.replace(/^호외 — /, '')}`, 'world');
    if ((ev.min ?? 0) >= 3) pushAlert(s, ev.ko);
}

function checkDates(s, d, info) {
    if (!settings().featDates) return;
    const dt = dateOf(s.start, d);
    if (s.birthday && s.birthday.m === dt.m && s.birthday.d === dt.d) {
        info.events.push({ type: 'love', text: `🎂 오늘은 ${s.name}의 생일 (${dateText(dt)})` });
        s.pending.push({ kind: 'birthday', self: true });
    }
    for (const b of s.bonds) {
        const bd = BIRTHDAYS.find(([n]) => nameMatch(n, b.name));
        if (bd && bd[1] === dt.m && bd[2] === dt.d) {
            info.events.push({ type: 'love', text: `🎂 오늘은 ${b.name}의 생일 (${dateText(dt)})` });
            s.pending.push({ kind: 'birthday', name: b.name });
        }
        const n = d - (b.met ?? d);
        if (n > 0 && n % 100 === 0 && (b.love >= 35 || b.rel)) {
            info.events.push({ type: 'love', text: `💐 ${b.name}와(과) 만난 지 ${n}일` });
            s.pending.push({ kind: 'anniv', name: b.name, n });
        }
    }
}

function hexRoll(s, d, info) {
    const set = settings();
    const rate = !set.featHex ? 0 : { off: 0, rare: 0.04, normal: 0.09 }[set.hexAuto] ?? 0;
    if (!rate || s.mode === '수감' || s.dead) return;
    const rnd = rngFrom(`${info.seed}:hex:${d}`);
    if (rnd() > rate) return;
    const pool = HEXES.filter(x => !s.hexes.some(y => y.name === x.name) && (x.name !== '배가 뒤집혔다' || (s.ship && !s.ship.status)));
    const h = pool[Math.floor(rnd() * pool.length)];
    if (h) applyOp(s, 'hex', `+${h.name}`, info);
}

function advanceDays(s, nd, info) {
    const from = s.day;
    s.day = nd;
    for (let d = from + 1; d <= nd; d++) checkDates(s, d, info);
    for (let d = from + 1; d <= Math.min(nd, from + 3); d++) { eventRoll(s, d, info); hexRoll(s, d, info); }
    s.hexes = s.hexes.filter(x => x.until >= s.day);
    s.alerts = s.alerts.filter(a => a.day >= s.day - 1);
}

const TRUST_AT = [20, 50, 80];
const LOVE_AT = [15, 35, 60, 85];
const LOVE_NAME = ['', '신경 쓰임', '설렘', '사랑', '깊은 사랑'];
const loveStage = (v) => LOVE_AT.filter(x => (v ?? 0) >= x).length;
function bondMilestone(s, b, kind, before, info) {
    const now = kind === 'love' ? b.love : b.aff;
    const marks = kind === 'love' ? LOVE_AT : TRUST_AT;
    for (const at of marks) {
        if (before < at && now >= at) {
            const label = kind === 'love' ? LOVE_NAME[marks.indexOf(at) + 1] : ['호감', '신뢰', '특별한 사이'][marks.indexOf(at)];
            info.events.push({ type: kind === 'love' ? 'love' : 'keep', text: `${b.name} — ${label}` });
            s.log.push({ day: s.day, text: `${b.name}와(과)의 관계 — ${label}` });
            s.pending.push({ kind: 'bond', name: b.name, what: kind, at, label });
        }
        if (before >= at && now < at && kind === 'aff') info.events.push({ type: 'warn', text: `${b.name}와(과)의 사이가 멀어졌다` });
    }
}
// 인연이 너무 많으면 가장 옅은 인연부터 정리 (연인·동료·깊은 관계는 지킨다)
function trimBonds(s, info) {
    if (s.bonds.length <= CAP.bonds) return;
    const keep = (b, i) => Math.abs(b.aff) + (b.love ?? 0) * 1.5 + (b.rel ? 60 : 0) + (s.crew.some(c => norm(c.name) === norm(b.name)) ? 80 : 0) + i;
    const order = s.bonds.map((b, i) => [b, keep(b, i)]).sort((a, b) => a[1] - b[1]);
    const drop = new Set(order.slice(0, s.bonds.length - CAP.bonds).map(x => x[0]));
    for (const b of drop) { s.log.push({ day: s.day, text: `인연 정리 — ${b.name}` }); info?.events.push({ type: 'warn', text: `인연은 최대 ${CAP.bonds}명 — 가장 옅은 ${b.name}을(를) 정리했다` }); }
    s.bonds = s.bonds.filter(b => !drop.has(b));
}

function splitBar(val) { return String(val).split('|').map(x => x.trim()); }

function applyOp(s, rawKey, rawVal, info) {
    const key = KEYMAP[String(rawKey).trim().toLowerCase()];
    if (!key) return;
    const val = String(rawVal ?? '').trim();
    switch (key) {
        case 'hp': s.hp = clamp(Math.round(parseNum(val, s.hp)), 0, 100); break;
        case 'cash': s.cash = Math.round(parseNum(val, s.cash)); break;
        case 'bounty': setBounty(s, parseNum(val, s.bounty), info, splitBar(val)[1] ?? ''); break;
        case 'fame': s.fame = clamp(Math.round(parseNum(val, s.fame)), 0, 100); break;
        case 'heat': {
            const nv = Math.round(parseNum(val, s.heat));
            const gain = nv - s.heat;
            if (gain > 0) s.fame = clamp(s.fame + Math.round(gain / 4), 0, 100);
            s.heat = Math.max(0, nv);
            let guard = 0;
            while (s.heat >= 100 && guard++ < 5) { s.heat -= 100; stepUp(s, info); }
            break;
        }
        case 'tier': {
            const want = clamp(Math.round(parseNum(val, s.tier)), 1, 6);
            const nt = clamp(want, s.tier - 1, s.tier + 1);
            if (nt !== s.tier) {
                const up = nt > s.tier;
                const t = `격 ${up ? '상승' : '하락'} — ${TIER[s.tier]} → ${TIER[nt]}`;
                s.tier = nt;
                s.log.push({ day: s.day, text: t });
                info.events.push({ type: up ? 'rank' : 'warn', text: t });
            }
            break;
        }
        case 'day': {
            const nd = Math.round(parseNum(val, s.day));
            if (nd > s.day) advanceDays(s, Math.min(nd, s.day + 60), info);
            break;
        }
        case 'time': {
            if (!val) break;
            const nt = normTime(val);
            const a = TIMES.indexOf(s.time), b = TIMES.indexOf(nt);
            if (!info.hasDay && a >= 4 && b >= 0 && b <= 2) advanceDays(s, s.day + 1, info);
            s.time = nt;
            break;
        }
        case 'loc': {
            if (!val || NONE_RE.test(val)) break;
            s.loc = val;
            const isl = islandOf(val);
            if (isl) s.sea = isl.sea.name;
            break;
        }
        case 'sea': { if (val) s.sea = seaOf(val)?.name ?? val; break; }
        case 'rank': {
            if (!val) break;
            const ladder = s.faction === 'marine' ? MARINE_RANKS : s.faction === 'government' ? GOV_RANKS : null;
            const a = ladder?.indexOf(s.rank) ?? -1, b = ladder?.indexOf(val) ?? -1;
            if (a >= 0 && b >= 0 && a !== b) {
                const t = `${b > a ? '진급' : '강등'} — ${s.rank} → ${val}`;
                s.log.push({ day: s.day, text: t });
                info.events.push({ type: b > a ? 'rank' : 'warn', text: t });
            }
            s.rank = val;
            break;
        }
        case 'mode': if (val) { s.mode = normMode(val); if (s.mode === '일상' || s.mode === '항해') s.foe = null; } break;
        case 'case': {
            const closing = !val || NONE_RE.test(val);
            if (closing && s.case) {
                s.log.push({ day: s.day, text: `의뢰 종료 — ${s.case}` });
                info.events.push({ type: 'keep', text: `의뢰 종료 — ${s.case}` });
                s.case = '';
            } else if (!closing) s.case = val;
            break;
        }
        case 'foe': {
            if (!val || NONE_RE.test(val)) { s.foe = null; break; }
            const [name, a, b, ...rest] = splitBar(val);
            const prev = s.foe && norm(s.foe.name) === norm(name) ? s.foe : null;
            let tier = prev?.tier ?? s.tier, pct = prev?.pct ?? 100, note = prev?.note ?? '';
            for (const part of [a, b]) {
                if (part == null || part === '') continue;
                const tn = TIER.findIndex((t, i) => i > 0 && part.includes(t));
                if (/격/.test(part) || tn > 0) { tier = tn > 0 ? tn : clamp(parseInt(part.replace(/\D/g, ''), 10) || tier, 1, 6); continue; }
                if (/%/.test(part) || /^[+-]?\d+$/.test(part)) { pct = clamp(Math.round(parseNum(part, pct)), 0, 100); continue; }
                note = part;
            }
            if (rest.length) note = rest.join(' | ');
            s.foe = { name, tier, pct, note };
            if (pct <= 0) { s.log.push({ day: s.day, text: `격파 — ${name}` }); info.events.push({ type: 'keep', text: `격파 — ${name}` }); s.foe = null; }
            break;
        }
        case 'wound': {
            if (!val || NONE_RE.test(val)) { if (s.wounds.length) info.events.push({ type: 'keep', text: '부상 회복' }); s.wounds = []; break; }
            for (const part of val.split(/\s*,\s*/)) {
                const m = part.match(/^([+\-−])?\s*(.+)$/);
                if (!m) continue;
                const [nm, desc] = splitBar(m[2]);
                if (m[1] && m[1] !== '+') s.wounds = s.wounds.filter(w => !norm(w.name).includes(norm(nm)) && !norm(nm).includes(norm(w.name)));
                else if (!s.wounds.some(w => norm(w.name) === norm(nm))) s.wounds.push({ name: nm, desc: desc ?? '' });
            }
            break;
        }
        case 'maim': {
            const m = val.match(/^([+\-−])?\s*(.+)$/);
            if (!m || NONE_RE.test(m[2])) break;
            const [nm, desc] = splitBar(m[2]);
            if (m[1] && m[1] !== '+') { s.maims = s.maims.filter(x => norm(x.name) !== norm(nm)); break; }
            if (s.maims.some(x => norm(x.name) === norm(nm))) break;
            const known = fuzzyFind(MAIMS, nm);
            s.maims.push({ name: nm, desc: desc || known?.desc || '' });
            s.log.push({ day: s.day, text: `신체 손상 — ${nm}` });
            info.events.push({ type: 'maim', text: `영구 손상 「${nm}」${desc ? ` — ${desc}` : ''}` });
            break;
        }
        case 'item': applyItems(s, val); break;
        case 'crew': {
            for (const part of val.split(/\s*,\s*(?=[+\-−])/)) {
                const m = part.match(/^([+\-−])?\s*(.+)$/);
                if (!m || NONE_RE.test(m[2])) continue;
                const [nm, extra] = splitBar(m[2]);
                const ex = fuzzyFind(s.crew, nm);
                if (m[1] && m[1] !== '+') {
                    if (ex) {
                        s.crew = s.crew.filter(c => c !== ex);
                        const t = `동료 이탈 — ${ex.name}${extra ? ` (${extra})` : ''}`;
                        s.log.push({ day: s.day, text: t });
                        info.events.push({ type: /사망|전사|죽/.test(extra ?? '') ? 'end' : 'warn', text: t });
                    }
                } else if (ex) { if (extra) ex.role = extra; ex.status = ''; }
                else if (s.crew.length >= CAP.crew) {
                    info.events.push({ type: 'warn', text: `동료는 최대 ${CAP.crew}명 — ${nm}은(는) 태울 자리가 없다` });
                } else {
                    s.crew.push({ name: nm, role: extra ?? '', status: '' });
                    s.log.push({ day: s.day, text: `동료 합류 — ${nm}${extra ? ` (${extra})` : ''}` });
                    info.events.push({ type: 'keep', text: `동료 합류 — ${nm}${extra ? ` · ${extra}` : ''}` });
                }
            }
            break;
        }
        case 'bond': {
            for (const part of val.split(/\s*,\s*(?=[^,]*[+\-−=]\s*\S)/)) {
                const [head, memo] = splitBar(part);
                const m = head.match(/^(.+?)\s*(?:([+\-−]\s*\d+)|=\s*(.+))?$/);
                if (!m) continue;
                const nm = m[1].trim();
                if (!nm || NONE_RE.test(nm)) continue;
                let b = fuzzyFind(s.bonds, nm);
                const isNew = !b;
                if (!b) { b = { name: nm, aff: 0, love: 0, rel: '', note: '', met: s.day }; s.bonds.push(b); }
                if (m[2]) {
                    const before = b.aff;
                    b.aff = clamp(b.aff + parseInt(m[2].replace(/[−\s]/g, c => (c === '−' ? '-' : '')), 10), -100, 100);
                    bondMilestone(s, b, 'aff', before, info);
                }
                if (m[3]) {
                    const rel = m[3].trim();
                    if (rel !== b.rel) { b.rel = rel; info.events.push({ type: /연인|약혼|부부/.test(rel) ? 'love' : 'keep', text: `관계 — ${nm}: ${rel}` }); }
                }
                if (memo) b.note = memo;
                if (isNew && !m[3]) info.events.push({ type: 'keep', text: `새 인연 — ${nm}` });
            }
            trimBonds(s, info);
            break;
        }
        case 'love': {
            for (const part of val.split(/\s*,\s*/)) {
                const [head, memo] = splitBar(part);
                const m = head.match(/^(.+?)\s*([+\-−]\s*\d+)$/);
                if (!m) continue;
                const nm = m[1].trim();
                let b = fuzzyFind(s.bonds, nm);
                if (!b) { b = { name: nm, aff: 0, love: 0, rel: '', note: '', met: s.day }; s.bonds.push(b); info.events.push({ type: 'keep', text: `새 인연 — ${nm}` }); }
                const before = b.love ?? 0;
                b.love = clamp(before + parseInt(m[2].replace(/[−\s]/g, c => (c === '−' ? '-' : '')), 10), 0, 100);
                if (memo) b.note = memo;
                bondMilestone(s, b, 'love', before, info);
            }
            trimBonds(s, info);
            break;
        }
        case 'memory': {
            if (!val || NONE_RE.test(val)) break;
            const [title, desc, withWho] = splitBar(val);
            if (s.memories.some(x => x.title === title && x.day === s.day)) break;
            s.memories.push({ title, desc: desc ?? '', with: withWho ?? '', day: s.day, loc: s.loc });
            if (s.memories.length > CAP.memories) s.memories = s.memories.slice(-CAP.memories);
            info.events.push({ type: 'memory', text: `추억 — ${title}` });
            break;
        }
        case 'discover': {
            if (!val || NONE_RE.test(val)) break;
            const [name, kind, desc] = splitBar(val);
            if (s.finds.some(x => norm(x.name) === norm(name))) break;
            s.finds.push({ name, kind: kind ?? '', desc: desc ?? '', day: s.day, loc: s.loc });
            if (s.finds.length > CAP.finds) s.finds = s.finds.slice(-CAP.finds);
            info.events.push({ type: 'find', text: `발견 — ${name}${kind ? ` (${kind})` : ''}` });
            break;
        }
        case 'dream': {
            if (!val) break;
            const [num, why] = splitBar(val);
            if (!/\d/.test(num)) { s.dream.text = num; break; }
            const before = s.dream.pct;
            s.dream.pct = clamp(Math.round(parseNum(num, before)), 0, 100);
            for (const at of [25, 50, 75, 100]) {
                if (before < at && s.dream.pct >= at) {
                    const tx = at === 100 ? `꿈을 이뤘다 — ${s.dream.text}` : `꿈에 한 걸음 (${at}%) — ${s.dream.text}${why ? ` · ${why}` : ''}`;
                    s.log.push({ day: s.day, text: tx });
                    info.events.push({ type: 'dream', text: tx });
                    s.pending.push({ kind: 'dream', at });
                }
            }
            break;
        }
        case 'ship': {
            if (!val) break;
            if (NONE_RE.test(val)) { s.ship = null; break; }
            const parts = splitBar(val);
            for (const p of parts) {
                if (/침몰|대파|가라앉/.test(p)) {
                    s.ship ??= { name: '배', hull: 0, status: '' };
                    s.ship.hull = 0; s.ship.status = '침몰';
                    s.log.push({ day: s.day, text: `침몰 — ${s.ship.name}` });
                    info.events.push({ type: 'end', text: `배가 가라앉았다 — ${s.ship.name}` });
                } else if (/압수|나포|빼앗/.test(p)) {
                    if (s.ship) { s.ship.status = '압수'; info.events.push({ type: 'warn', text: `배 압수 — ${s.ship.name}` }); }
                } else if (/[+\-−]\s*\d|선체|^\d+%?$/.test(p)) {
                    s.ship ??= { name: '배', hull: 100, status: '' };
                    let nv = clamp(Math.round(parseNum(p.replace(/선체|수리|손상|내구도/g, ''), s.ship.hull)), 0, 100);
                    if (nv < s.ship.hull && s.ship.parts?.includes('보강 선체')) nv = s.ship.hull - Math.ceil((s.ship.hull - nv) / 2);
                    s.ship.hull = nv;
                    if (s.ship.hull === 0 && s.ship.status !== '침몰') { s.ship.status = '침몰'; info.events.push({ type: 'end', text: `배가 가라앉았다 — ${s.ship.name}` }); }
                    else if (s.ship.hull > 0 && s.ship.status === '침몰') s.ship.status = '';
                } else if (p) {
                    if (!s.ship || s.ship.status === '침몰' || s.ship.status === '압수') {
                        s.ship = { name: p, hull: 100, status: '', parts: [] };
                        s.log.push({ day: s.day, text: `새 배 — ${p}` });
                        info.events.push({ type: 'keep', text: `새 배 — ${p}` });
                    } else s.ship.name = p;
                }
            }
            break;
        }
        case 'fruit': {
            if (!val) break;
            if (NONE_RE.test(val)) { s.fruit = null; break; }
            const [name, type, desc] = splitBar(val);
            const had = !!s.fruit;
            s.fruit = { name, type: type ?? s.fruit?.type ?? '', desc: desc ?? s.fruit?.desc ?? '' };
            if (!had) { s.log.push({ day: s.day, text: `악마의 열매 — ${name}` }); info.events.push({ type: 'rank', text: `악마의 열매를 먹었다 — ${name}. 이제 바다가 당신을 거부한다.` }); }
            break;
        }
        case 'haki': {
            for (const part of val.split(/\s*,\s*/)) {
                const kind = /견문/.test(part) ? '견문' : /무장/.test(part) ? '무장' : /패왕/.test(part) ? '패왕' : null;
                if (!kind) continue;
                const rest = part.replace(/견문색?|무장색?|패왕색?|패기/g, '').trim();
                const cur = s.haki[kind] ?? 0;
                let nv = /각성|발현/.test(rest) && cur === 0 ? 1 : clamp(Math.round(parseNum(rest, cur)), 0, 3);
                nv = clamp(nv, cur - 1, cur + 1);
                if (kind === '패왕' && nv > 0 && !s.conqueror) s.conqueror = true;
                if (nv !== cur) {
                    s.haki[kind] = nv;
                    const t = nv > cur ? `${kind}색 패기 ${nv === 1 ? '각성' : `Lv${nv}`}` : `${kind}색 패기 약화`;
                    s.log.push({ day: s.day, text: t });
                    info.events.push({ type: nv > cur ? 'rank' : 'warn', text: t });
                }
            }
            break;
        }
        case 'prison': {
            if (!val || NONE_RE.test(val) || /탈옥|출소|풀려/.test(val)) {
                if (s.prison) {
                    const t = /탈옥/.test(val) ? `탈옥 — ${s.prison.place}` : `석방 — ${s.prison.place}`;
                    s.log.push({ day: s.day, text: t });
                    info.events.push({ type: 'keep', text: t });
                    if (/탈옥/.test(val)) { pushNews(s, `${s.prison.place}에서 탈옥 사건 — ${s.name}`, 'world'); s.heat += 40; }
                    s.prison = null; s.seastone = false; if (s.mode === '수감') s.mode = '일상';
                }
                break;
            }
            const lvM = val.match(/(?:LV|레벨|Lv|lv)\s*(\d)/);
            const place = val.replace(/\s*(?:LV|레벨|Lv|lv)\s*\d\S*/, '').trim() || '감옥';
            const entering = !s.prison;
            s.prison = { place, level: lvM ? clamp(Number(lvM[1]), 1, 6) : (s.prison?.level ?? 0), since: s.prison?.since ?? s.day };
            s.mode = '수감'; s.seastone = true; s.foe = null;
            if (entering) {
                const diff = DIFFICULTY.find(d => d.id === s.diff) ?? DIFFICULTY[1];
                const lost = Math.round(Math.max(0, s.cash) * (1 - diff.keepCash));
                s.cash -= lost;
                s.items = [];
                if (s.ship && s.ship.status !== '침몰') s.ship.status = '압수';
                for (const c of s.crew) c.status = '흩어짐';
                const t = `수감 — ${place}${s.prison.level ? ` LV${s.prison.level}` : ''} · 재산 몰수 ${berry(lost)} · 소지품·배 압수`;
                s.log.push({ day: s.day, text: t });
                info.events.push({ type: 'end', text: t });
                pushNews(s, `${s.name}, ${place}에 수감`, 'world');
            }
            break;
        }
        case 'confiscate': {
            if (!val || NONE_RE.test(val)) break;
            const lost = [];
            if (/전부|모두|재산|돈|베리/.test(val) || /^전/.test(val)) { lost.push(berry(s.cash)); s.cash = 0; }
            else if (/절반|반/.test(val)) { const n = Math.round(s.cash / 2); lost.push(berry(n)); s.cash -= n; }
            else if (/\d/.test(val)) { const n = Math.min(s.cash, Math.round(parseNum(val.replace(/^[+\-−]/, ''), 0))); if (n > 0) { lost.push(berry(n)); s.cash -= n; } }
            if (/전부|모두|소지품|무기/.test(val) && s.items.length) { lost.push('소지품'); s.items = []; }
            if (/배|선박|전부|모두/.test(val) && s.ship && s.ship.status !== '침몰') { lost.push(`배(${s.ship.name})`); s.ship.status = '압수'; }
            if (lost.length) {
                const t = `몰수 — ${lost.join(' · ')}`;
                s.log.push({ day: s.day, text: t });
                info.events.push({ type: 'end', text: t });
            }
            break;
        }
        case 'news': if (val && !NONE_RE.test(val)) pushNews(s, val, 'world'); break;
        case 'hex': {
            if (!val || NONE_RE.test(val)) { if (s.hexes.length) info.events.push({ type: 'keep', text: '해프닝이 풀렸다' }); s.hexes = []; break; }
            const m = val.match(/^([+\-−])?\s*(.+)$/);
            const [nm, dayStr, desc] = splitBar(m[2]);
            if (m[1] && m[1] !== '+') { s.hexes = s.hexes.filter(x => !nameMatch(x.name, nm)); info.events.push({ type: 'keep', text: `해프닝이 풀렸다 — ${nm}` }); break; }
            if (s.hexes.some(x => x.name === nm)) break;
            const known = HEXES.find(x => x.name === nm);
            const days = dayStr && /\d/.test(dayStr) ? clamp(parseInt(dayStr, 10), 0, 30) : (known?.days ?? 1);
            const h = { name: nm, kind: known?.kind ?? '', desc: desc || known?.desc || '', en: known?.en ?? '', until: s.day + days, mods: known?.mods ?? null };
            if (days > 0) s.hexes.push(h);
            for (const [k, v] of known?.ops ?? []) applyOp(s, k, v, info);
            s.log.push({ day: s.day, text: `해프닝 — ${nm}` });
            info.events.push({ type: 'hex', text: `🌀 해프닝 — ${nm}${h.desc ? ` · ${h.desc}` : ''}${days > 1 ? ` (${days}일)` : ''}` });
            s.pending.push({ kind: 'hex', name: nm, en: h.en || h.desc, days });
            break;
        }
        case 'letter': {
            if (!val || NONE_RE.test(val)) break;
            const [from, ...rest] = splitBar(val);
            const text = rest.join(' | ');
            if (!from || !text) break;
            s.mail.push({ from, text, day: s.day });
            if (s.mail.length > 10) s.mail = s.mail.slice(-10);
            info.events.push({ type: 'letter', text: `✉️ 편지가 왔다 — ${from}` });
            break;
        }
        case 'upgrade': {
            if (!s.ship || !val) break;
            s.ship.parts ??= [];
            for (const part of val.split(/\s*,\s*/)) {
                const m = part.match(/^([+\-−])?\s*(.+)$/);
                if (!m) continue;
                const nm = m[2].trim();
                if (m[1] && m[1] !== '+') s.ship.parts = s.ship.parts.filter(x => x !== nm);
                else if (!s.ship.parts.includes(nm)) { s.ship.parts.push(nm); info.events.push({ type: 'keep', text: `배 개조 — ${nm}` }); }
            }
            break;
        }
        case '_newship': {
            const [name, kind] = splitBar(val);
            if (s.ship && s.ship.status !== '침몰') s.log.push({ day: s.day, text: `배를 바꿨다 — ${s.ship.name} → ${name}` });
            s.ship = { name: name || kind || '새 배', kind: kind ?? '', hull: 100, status: '', parts: [] };
            info.events.push({ type: 'keep', text: `새 배 — ${s.ship.name}${kind ? ` (${kind})` : ''}` });
            break;
        }
        case 'alert': {
            if (!val || NONE_RE.test(val)) { s.alerts = []; break; }
            pushAlert(s, val);
            info.events.push({ type: 'alert', text: `경보 — ${val}` });
            break;
        }
        case 'seastone': s.seastone = !/해제|풀|없음|벗/.test(val); break;
        case '_timeskip': {
            const months = clamp(parseInt(val, 10) || 6, 1, 60);
            s.day += Math.round(months * 30);
            if (s.prison) {
                s.log.push({ day: s.day, text: `${months}개월 후 — ${s.prison.place}에서 나왔다` });
                s.prison = null; s.seastone = false;
            }
            s.mode = '일상'; s.foe = null; s.case = ''; s.alerts = [];
            s.hp = Math.max(s.hp, 60); s.wounds = [];
            for (const c of s.crew) c.status = c.status || '소식 끊김';
            s.pending.push({ kind: 'timeskip', months });
            s.log.push({ day: s.day, text: `타임스킵 — ${months}개월이 흘렀다` });
            info.events.push({ type: 'alert', text: `타임스킵 — ${months}개월이 흘렀다. 세계는 기다려 주지 않았다.` });
            break;
        }
        case '_era': {
            const ni = clamp(parseInt(val, 10), 0, ERAS.length - 1);
            if (ni !== s.era) { s.era = ni; s.log.push({ day: s.day, text: `시대 이동 — ${ERAS[ni].name}` }); s.pending.push({ kind: 'era', era: ni }); }
            break;
        }
        case '_die': {
            s.dead = true; s.hp = 0;
            s.deaths.push({ day: s.day, loc: s.loc, cause: val && val !== '1' ? val : '' });
            s.log.push({ day: s.day, text: `사망 — ${s.loc || '바다 위'}` });
            info.events.push({ type: 'end', text: '사망' });
            break;
        }
        case '_survive': {
            const [hp, maim] = splitBar(val);
            s.hp = clamp(parseInt(hp, 10) || 15, 1, 100);
            s.log.push({ day: s.day, text: '죽음의 문턱에서 살아남았다' });
            info.events.push({ type: 'keep', text: '살아남았다' });
            if (maim) applyOp(s, 'maim', `+${maim}`, info);
            break;
        }
    }
}

function addItem(s, name, qty) {
    name = name.trim();
    if (!name) return;
    let it = s.items.find(x => x.name === name) ?? fuzzyFind(s.items, name);
    if (!it) { if (qty <= 0) return; it = { name, qty: 0 }; s.items.push(it); }
    it.qty = Math.max(0, it.qty + qty);
    if (it.qty === 0) s.items = s.items.filter(x => x !== it);
}
function applyItems(s, val) {
    for (const part of val.split(/\s*[,/]\s*/)) {
        const m = part.trim().match(/^([+\-−])?\s*(.+?)\s*(?:[x×*]\s*)?(\d+)?(?:개|장|병|통|자루|일분)?$/);
        if (!m || NONE_RE.test(m[2])) continue;
        const n = parseInt(m[3] ?? '1', 10) || 1;
        addItem(s, m[2], m[1] && m[1] !== '+' ? -n : n);
    }
}
const itemsText = (s) => s.items.map(i => `${i.name}${i.qty > 1 ? `×${i.qty}` : ''}`).join(', ');

function replaceState(s, base) {
    for (const k of Object.keys(s)) delete s[k];
    Object.assign(s, clone(base));
}

const adjEvents = new Map();
function compute(limit) {
    const c = ctx();
    const chat = c.chat ?? [];
    const meta = getMeta();
    const s = freshState(meta?.profile);
    const snaps = new Map();
    if (!s.registered) return { state: s, snaps };
    const initial = clone(s);
    const adj = (meta.adjust ?? []).slice().sort((a, b) => a.at - b.at || a.t - b.t);
    const seed = String(c.getCurrentChatId?.() ?? MODULE);
    const n = Math.min(limit ?? chat.length, chat.length);
    const startAt = meta.profile.at ?? 0;
    let ai = 0, aiSeen = false, lastSnap = null;
    const runAdjust = (a) => {
        lastSnap = null;
        const info = { seed: `${seed}:adj:${a.t}`, events: [], hasDay: a.ops.some(([k]) => KEYMAP[String(k).toLowerCase()] === 'day') };
        const hp0 = s.hp;
        for (const [k, v] of a.ops) {
            if (k === '_rewind') {
                const at = Number(v);
                const base = at < 0 ? initial : snaps.get(at)?.state;
                if (!base) continue;
                const keep = { rewinds: s.rewinds + 1, deaths: s.deaths, log: s.log, pending: [] };
                replaceState(s, base);
                Object.assign(s, keep);
                s.dead = false; s.hp = Math.max(s.hp, 30);
                s.checkpoints = s.checkpoints.filter(cp => cp.at <= at);
                const cp = s.checkpoints.at(-1);
                s.pending.push({ kind: 'rewind', n: s.rewinds, cp });
                s.log.push({ day: s.day, text: `회귀 ${s.rewinds}회차 — ${cp?.loc || '출항 시점'}으로 돌아왔다` });
                info.events.push({ type: 'alert', text: `회귀 ${s.rewinds}회차 — ${cp?.loc || '출항 시점'}(${s.day}일차)로 돌아왔다. 기억은 남아 있다.` });
                continue;
            }
            applyOp(s, k, v, info);
        }
        if (hp0 > 0 && s.hp <= 0 && !s.dead) info.events.push({ type: 'end', text: '체력 0 · 빈사 — 생존 판정이 필요하다' });
        if (a.label) s.log.push({ day: s.day, text: a.label });
        adjEvents.set(a.t, info.events);
    };
    for (let i = 0; i < n; i++) {
        while (ai < adj.length && adj[ai].at <= i) runAdjust(adj[ai++]);
        const m = chat[i];
        if (!m || m.is_user) continue; // /hide 된 AI 메시지(is_system)도 상태를 가진다
        if (i >= startAt) { aiSeen = true; s.pending = []; }
        const ops = extractOps(m.mes);
        if (!ops.length) continue;
        const prev = lastSnap ?? clone(s); // 직전 스냅샷을 재사용해 복제를 절반으로
        const info = { seed: `${seed}:${i}`, events: [], prevTier: prev.tier, hasDay: ops.some(([k]) => KEYMAP[k.toLowerCase()] === 'day') };
        for (const [k, v] of ops) applyOp(s, k, v, info);
        if (prev.hp > 0 && s.hp <= 0 && !s.dead) info.events.push({ type: 'end', text: '체력 0 · 빈사 — 생존 판정이 필요하다' });
        // 새 섬에 닿으면 회귀 지점
        const isl = islandOf(s.loc)?.n ?? null;
        if (isl && !s.visited.some(v => v.n === isl)) {
            s.visited.push({ n: isl, day: s.day });
            info.events.push({ type: 'find', text: `첫 상륙 — ${isl} (${s.visited.length}/${islandList.length})` });
            s.pending.push({ kind: 'island', n: isl });
        }
        const last = s.checkpoints.at(-1);
        if (isl && (!last || last.island !== isl)) {
            s.checkpoints.push({ at: i, day: s.day, loc: s.loc, island: isl });
            if (s.checkpoints.length > CAP.checkpoints) s.checkpoints = [s.checkpoints[0], ...s.checkpoints.slice(-(CAP.checkpoints - 1))];
        }
        const st = clone(s);
        snaps.set(i, { state: st, prev, events: info.events });
        lastSnap = st;
    }
    while (ai < adj.length) runAdjust(adj[ai++]);
    s.opening = !aiSeen;
    if (s.log.length > CAP.log) s.log = s.log.slice(-CAP.log);
    return { state: s, snaps };
}

async function addAdjust(ops, label = '', at = null) {
    const meta = getMeta(true);
    meta.adjust ??= [];
    const a = { at: at ?? (ctx().chat?.length ?? 0), t: Date.now(), ops, label };
    meta.adjust.push(a);
    await saveMeta();
    refreshNow();
    for (const e of adjEvents.get(a.t) ?? []) notifyEvent(e);
}

// ───────────────────────────── 프롬프트 주입 ─────────────────────────────

const HAKI_LV = ['none', 'basic', 'advanced', 'mastery'];

function rollTagRule() {
    return 'Tags in {{user}}\'s message: [판정 …] result is binding (대성공 beyond intent / 성공 as intended / 실패 fails with a cost / 대실패 worst case). [의뢰 수락 …] opens that job: start with how it reaches {{user}}. [탈옥 …] is an escape roll — honor it. [생존 판정 …] and [회귀 …] were already resolved by the system. [신문 …] means {{user}} reads that article.';
}

function gapLine(s) {
    if (!s.foe) return '';
    const g = s.foe.tier - s.tier;
    if (g >= 2) return 'FAR beyond {{user}}: a straight fight means crushing defeat — only escape, tricks, allies, terrain or a 대성공 [판정] buys anything.';
    if (g === 1) return 'Stronger than {{user}}: even a win costs blood.';
    if (g === 0) return 'Even match: decided by wits, terrain and rolls.';
    return '{{user}} outclasses this foe.';
}

const FACTION_LIFE = {
    marine: 'Marine life: duty rosters, patrols, drills, reports, superiors and comrades, the weight of orders vs. personal justice. Pirates are enemies but also people.',
    government: 'Government agent life: covers, surveillance, reports by den den mushi, the Celestial Dragons\' whims; trust no one.',
    revolution: 'Revolutionary life: secret contacts, safehouses, forged papers, oppressed towns, the cost of hope.',
    civil: 'Civilian life: work, rent, neighbors, prices, rumors of pirates and Marines passing through; an ordinary person\'s view of the Great Pirate Era — small acts matter.',
};
function unreadMail(s) {
    const m = getMeta();
    const seen = m?.mailSeen ?? 0;
    const arrived = (m?.letters ?? []).filter(l => l.reply && !l.seen && l.arrive <= s.day).length;
    return arrived + Math.max(0, s.mail.length - seen);
}
function lettersLine(s) {
    const ls = (getMeta()?.letters ?? []).filter(l => l.status !== 'sending').slice(-3);
    const parts = ls.map(l => `{{user}} → ${l.to} (Day ${l.day}): "${l.text.slice(0, 140)}"${l.status === 'lost' ? ' — never arrived (lost)' : l.reply && l.arrive <= s.day ? ` — reply from ${l.reply.from} (Day ${l.arrive}): "${l.reply.text.slice(0, 160)}"` : ' — reply not yet arrived'}`);
    for (const m of s.mail.slice(-2)) parts.push(`${m.from} → {{user}} (Day ${m.day}): "${m.text.slice(0, 140)}"`);
    return parts.length ? `Letters by News Coo post (both sides remember them): ${parts.join(' / ')}` : '';
}
function notesLine() {
    const ns = (getMeta()?.notes ?? []).filter(n => n.reflect && !n.done).slice(-6);
    if (!ns.length) return '';
    return `{{user}}'s notebook (written by the player — 할 일 = what {{user}} intends to do, 기록 = what happened and should be remembered, 메모 = facts to keep): ${ns.map(n => `[${n.kind}] ${n.text.slice(0, 150)}`).join(' / ')}`;
}

function topBonds(s, n) {
    const score = (b, i) => Math.abs(b.aff) + (b.love ?? 0) * 1.5 + (b.rel ? 40 : 0) + i * 2 + (s.crew.some(c => norm(c.name) === norm(b.name)) ? 30 : 0);
    return s.bonds.map((b, i) => [b, score(b, i)]).sort((a, b) => b[1] - a[1]).slice(0, n).map(x => x[0]);
}

function buildInjection(s) {
    const set = settings();
    if (!s.registered) {
        return `[${TITLE}] {{user}} has not set sail yet (the 출항 setup is not done). Do not start the story and do not write a <state> block. Narrate in Korean.`;
    }
    const era = eraOf(s);
    const d = dangerOf(s.bounty);
    const L = [];
    L.push(`[${TITLE} STATE — authoritative. Never recompute or invent these numbers.]`);
    L.push(`Era: ${era.name} (${era.year}) ${era.token}${s.eraDetail ? ` — exact point: ${s.eraDetail}` : ''}`);
    L.push(`{{user}}: ${s.name}${s.age ? `, ${s.age}` : ''}${s.gender ? `, ${s.gender}` : ''} · ${s.race}${s.style ? ` · ${s.style}` : ''}${s.origin ? ` · from ${s.origin}` : ''} | ${s.factionLabel}${s.affil ? ` — ${s.affil}` : ''}${s.rank ? ` · ${s.rank}` : ''}${s.canonChar ? ' (plays this canon character: keep their canon history, abilities and relationships as of this era)' : ''}`);
    if (s.story) L.push(`Backstory: ${s.story}`);
    L.push(`Day ${s.day} (${dateText(dateOf(s.start, s.day))}) ${s.time} | ${s.loc || 'location unset'}${s.sea ? ` (${s.sea})` : ''} | ${MODE_TOKEN[s.mode] ?? '#MODE_DAILY'}`);
    L.push(`HP ${s.hp}/100${s.dead ? ' #DEAD' : s.hp <= 0 ? ' #DYING' : s.hp <= 30 ? ' (badly hurt, sluggish)' : ''} · 격 ${TIER[s.tier]} (Tier ${s.tier}/6 = ${TIER_EN[s.tier]}) · ${berry(s.cash)} · Bounty ${s.bounty ? berry(s.bounty) : 'none'} · ${heatName(s)} ${s.heat}/100 · Danger ★${d} · Fame ${fameTitle(s.fame)}`);
    if (d) L.push(`Pursuit #HUNT${d}: ${HUNT_EN[d]}.`);
    if (s.fruit) L.push(`Devil Fruit: ${s.fruit.name}${s.fruit.type ? ` (${s.fruit.type})` : ''}${s.fruit.desc ? ` — ${s.fruit.desc}` : ''}. Cannot swim; sea water and 해루석 drain the user.${s.seastone ? ' NOW 해루석-bound: no powers, weak as a child.' : ''}`);
    else if (s.seastone) L.push('Bound in 해루석 cuffs.');
    const hk = Object.entries(s.haki).filter(([k, v]) => v > 0 || (k === '패왕' && s.conqueror));
    if (hk.length) L.push(`Haki: ${hk.map(([k, v]) => `${k} ${v ? HAKI_LV[v] : 'latent'}`).join(' · ')}`);
    if (s.wounds.length || s.maims.length) L.push(`${s.wounds.length ? `Wounds: ${s.wounds.map(w => w.name).join(', ')}` : ''}${s.wounds.length && s.maims.length ? ' · ' : ''}${s.maims.length ? `Permanent: ${s.maims.map(m => `${m.name}${m.desc ? ` (${m.desc})` : ''}`).join(', ')}` : ''}`);
    if (s.ship) L.push(`Ship: ${s.ship.name}${s.ship.kind ? ` (${s.ship.kind})` : ''} — hull ${s.ship.hull}%${s.ship.status ? ` [${s.ship.status}]` : ''}${s.ship.parts?.length ? ` · ${s.ship.parts.map(p => SHIP_PARTS.find(x => x.name === p)?.en ?? p).join(', ')}` : ''}`);
    if (s.crew.length) L.push(`Crew: ${s.crew.slice(0, CAP.crew).map(c => `${c.name}${c.role || c.status ? ` (${[c.role, c.status].filter(Boolean).join(', ')})` : ''}`).join(', ')}`);
    if (s.bonds.length) {
        const top = topBonds(s, 6);
        L.push(`Bonds #BONDS (trust -100~100 · ♥ romance 0~100): ${top.map(b => `${b.name} (trust ${b.aff >= 0 ? '+' : ''}${b.aff}${b.love ? `, ♥${b.love} ${LOVE_NAME[loveStage(b.love)]}` : ''}${b.rel ? `, ${b.rel}` : ''}${b.note ? `; ${b.note}` : ''})`).join(' / ')}`);
    }
    if (s.dream?.text) L.push(`Dream: "${s.dream.text}" — ${s.dream.pct}% (raise only when a real step happens; it is {{user}}'s compass)`);
    if (s.memories.length) L.push(`Shared memories (call back to them naturally): ${s.memories.slice(-3).map(m => `${m.title}${m.with ? ` w/ ${m.with}` : ''}`).join(' / ')}`);
    if (set.featAlbum) L.push(`Explored: ${s.visited.length}/${islandList.length} islands · ${s.finds.length} discoveries`);
    if (s.hexes.length) L.push(`Happenings (play them up — comedy or creepiness as fits, without breaking the story): ${s.hexes.map(x => `${x.name} (until Day ${x.until}): ${x.en || x.desc}`).join(' / ')}`);
    if (set.featLetter) { const lt = lettersLine(s); if (lt) L.push(lt); }
    if (set.featMemo) { const nt = notesLine(); if (nt) L.push(nt); }
    if (!s.fruit) L.push('No Devil Fruit: {{user}} can swim and relies on skill, tools, haki and wits — make that path feel viable and cool.');
    if (FACTION_LIFE[s.faction]) L.push(FACTION_LIFE[s.faction]);
    L.push(`Inventory: ${s.items.length ? itemsText(s) : 'nothing'} (only these items exist)`);
    if (s.case) L.push(`Job: ${s.case}`);
    if (s.foe) L.push(`Foe: ${s.foe.name} — 격 ${TIER[s.foe.tier]} (Tier ${s.foe.tier}), ${s.foe.pct}% left${s.foe.note ? ` (${s.foe.note})` : ''}. ${gapLine(s)}`);
    if (s.prison) {
        const fl = s.prison.level ? IMPEL[s.prison.level - 1] : null;
        L.push(`Prison: ${s.prison.place}${fl ? ` ${fl.lv} ${fl.name}` : ''} since Day ${s.prison.since}. Everything confiscated, 해루석 cuffs. Escape is near-impossible and needs [탈옥] rolls; torture, hunger and despair are daily.`);
    }
    if (s.rewinds) L.push(`Rewinds: ${s.rewinds} — {{user}} has died and returned to an earlier moment ${s.rewinds} time(s), memories intact; nobody else remembers. Past deaths: ${s.deaths.slice(-3).map(x => `Day ${x.day} ${x.loc}${x.cause ? ` (${x.cause})` : ''}`).join(' / ')}.`);
    if (s.alerts.length) L.push(`Active alerts: ${s.alerts.map(a => a.text).join(' / ')}`);
    const heads = s.news.slice(-2).map(n => n.text);
    if (heads.length) L.push(`Recent headlines: ${heads.join(' / ')}`);
    if (s.goals.length) L.push(`{{user}} wants this story to focus on: ${s.goals.join(', ')}. Weight hooks, NPC initiative and events toward these.${s.goals.includes('로맨스') ? ' Romance: any canon character may come to care for {{user}} — slow-burn, in character, earned through scenes; reflect it in bond.' : ''}`);
    L.push(CANON_EN[s.canon] ?? CANON_EN.normal);
    L.push(DIFF_EN[s.diff] ?? DIFF_EN.normal);
    L.push('Pacing: this is an adventure and life sim. Most scenes are exploration, food, work, odd locals, crew life, friendship and romance; fights are occasional punctuation, not the default. Let NPCs start conversations, invite {{user}} places and have their own days.');
    L.push('Harsh sea: never soften consequences. A higher 격 crushes a lower one; Marines confiscate; bounty hunters sell faces; Impel Down is hell. When a blow should kill, write hp: 0 — never declare death yourself, the system rolls survival. Wounds, losses and permanent damage stay.');

    const dir = [];
    if (s.dead) dir.push('#DEAD {{user}} is dead. Write only the aftermath or ending; no more <state> changes except news.');
    else if (s.hp <= 0) dir.push('#DYING {{user}} is at death\'s door: fading senses, the world going quiet. Do NOT resolve survival — stop and wait.');
    for (const p of s.pending) {
        if (p.kind === 'event') dir.push(`[EVENT — bring this in now, naturally] ${p.en}.`);
        if (p.kind === 'timeskip') dir.push(`[TIMESKIP] ${p.months} months have passed. Open with what {{user}} endured and how they came out, then show how the world changed in that time (canon events of the period per the canon setting), where crew and bonds are now, and what was lost. Update day/loc/mode in <state>.`);
        if (p.kind === 'rewind') dir.push(`[REWIND] {{user}} just died — and woke up back at ${p.cp?.loc || 'the start of the voyage'} on Day ${p.cp?.day ?? 1}, remembering everything after it. Nobody else remembers. Open on that jolt; the same dangers are coming unless {{user}} changes course.`);
        if (p.kind === 'bond') dir.push(`[BOND] ${p.name} → ${p.label}: show this shift in one small in-character moment (a look, a habit, a slip of words, a choice made for {{user}}).${p.what === 'love' && p.at < 60 ? ' No confession yet.' : p.what === 'love' ? ' A confession is possible only if it fits their personality and the moment.' : ''}`);
        if (p.kind === 'island') dir.push(`[FIRST LANDING] First time on ${p.n}: open with a vivid first impression — sights, smells, a local specialty, and one person or rumor worth chasing.`);
        if (p.kind === 'dream') dir.push(`[DREAM] {{user}} just took a real step toward their dream (${p.at}%). Let someone notice, or the world answer.`);
        if (p.kind === 'birthday') dir.push(p.self ? '[BIRTHDAY] Today is {{user}}\'s birthday. Those close to {{user}} may know (or find out) — let it show in their own way.' : `[BIRTHDAY] Today is ${p.name}'s birthday. Weave it in naturally; {{user}} may or may not know.`);
        if (p.kind === 'anniv') dir.push(`[ANNIVERSARY] It has been ${p.n} days since {{user}} met ${p.name}. Let it surface quietly if they are together or in contact.`);
        if (p.kind === 'hex') dir.push(`[HAPPENING] "${p.name}" just struck {{user}}: ${p.en}. Show it now, vividly${p.days ? ` (it lasts about ${p.days} day${p.days > 1 ? 's' : ''})` : ''}. Let others react.`);
        if (p.kind === 'era') dir.push(`[ERA SHIFT] The world has moved into: ${ERAS[p.era].name}. Reflect the new status quo.`);
    }
    if (s.opening) dir.push(s.canonChar
        ? '[OPENING] This is the first scene. {{user}} IS this canon character at this exact point in the story: their crew, history, reputation and relationships already exist (see Crew/Bonds). Start in medias res at their current place — never from their very beginning — with a vivid hook. Do not recap the setup.'
        : '[OPENING] This is the first scene. Open {{user}}\'s story in their starting situation (faction, affiliation, era, place) with a vivid, concrete hook. Bring in one or two era-appropriate canon or local characters. Do not recap the setup.');
    if (dir.length) L.push(dir.join('\n'));

    L.push('');
    L.push('[OUTPUT] Narrate in Korean (Korean official names: 루피, 조로, 나미, 상디, 아카이누…). END every reply with a <state> block: only what changed THIS turn, one key per line, numbers signed (+/-). Nothing changed → <state></state>. No code fences.');
    L.push(`Keys: hp · cash (베리, e.g. -5만) · heat (notorious or meritorious acts; the system converts it into bounty or promotion) · fame · bounty (only for canon-scheduled or explicit government decisions) · tier (+1 only after a defining victory or training arc) · day (+1 when the date changes) · time (새벽/아침/낮/저녁/밤/심야) · loc (섬 · 장소) · sea · mode (일상/항해/의뢰/전투/수감) · case (이름 | 진행; 없음 closes) · foe (이름 | 격 1-6 | 남은% | 특징; 없음 clears) · wound (+이름 / -이름) · maim (+부위 | 묘사 — permanent loss only) · item (+이름 2 / -이름 1) · crew (+이름 | 역할 / -이름 | 사유) · bond (이름 +10 | memo, or 이름 = 관계) · love (이름 +5 — romantic feeling, separate from bond trust; slow-burn) · ${set.featAlbum ? 'memory (제목 | 한 줄 | 함께한 사람 — a moment worth remembering, at most one per scene) · discover (이름 | 종류 요리/명소/생물/보물/전설/역사/사람/물건 | 한 줄) · ' : ''}${set.featLetter ? 'letter (보낸 사람 | 내용 — an NPC writes to {{user}} by gull post; occasionally) · ' : ''}${set.featHex ? 'hex (+이름 | 일수 | 묘사 — a rare absurd or eerie mishap; -이름 when lifted) · ' : ''}dream (+5 | 이유) · ship (이름 | -20 / 침몰 / 압수) · fruit (이름 | 계통 | 능력) · haki (무장 +1) · prison (임펠다운 LV4 / 없음) · confiscate (전부/절반/배/금액) · news (one headline) · alert (danger warning) · rank · seastone (착용/해제). Values in Korean.`);
    L.push('Example:\n<state>\nhp: -18\nheat: +15\ncash: +120만\nloc: 로그타운 · 처형대 광장\nfoe: 해군 대령 | 3 | 70 | 연기를 다룬다\nwound: +왼쪽 어깨 자상\n</state>');
    L.push(`Keep the named cast small: {{user}} tracks at most ${CAP.bonds} bonds and ${CAP.crew} crew. Passers-by stay unnamed and get no bond line; only add a bond for someone who will matter.`);
    L.push('Romance & social rolls: [판정 · 매력/교섭 · 대상 X …] decides how X takes it — 성공 = it lands in X\'s own way, 실패 = X is unmoved or put off (no love gain), 대실패 = an awkward setback (trust -5~10). Unrolled flirting with someone whose ♥ is under 15 mostly does not land: canon characters are not easy.');
    L.push('Relationships — bond: a meaningful scene +3~10, betrayal -20+ · love: +2~8, never jumps; canon characters fall for people in their own way and pace (or not at all).');
    L.push('Scale — hp: graze -3~8 · solid hit -10~20 · a stronger 격\'s full blow -30~60 · two tiers above can end it in one hit · rest/doctor +10~30. heat: bar brawl +3 · beating a wanted pirate or Marine officer +10~20 · attacking officials +20~40 · a world-shaking incident +60~100.');
    L.push(rollTagRule());
    const tense = ['의뢰', '전투', '수감'].includes(s.mode);
    if (!s.dead && (set.choices === 'always' || (set.choices === 'tense' && tense))) {
        L.push(`[CHOICES] ${set.choices === 'always' ? 'Every reply' : 'At decision points during jobs, combat and prison'}: after the narration and before <state>, give 2-4 numbered one-line action choices inside <choices>…</choices>, in Korean. At least one should be bold or reckless.`);
    }
    return L.join('\n');
}

function setInjection(text) {
    const c = ctx();
    const depth = clamp(parseInt(settings().injectDepth, 10) || 0, 0, 20);
    c.setExtensionPrompt(INJECT_KEY, text ?? '', PROMPT_IN_CHAT, depth, true, ROLE_SYSTEM);
}

// ───────────────────────────── 화면 갱신 ─────────────────────────────

let current = null;
let refreshTimer = null;
let lastNotified = '';

function refresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refreshNow, 60);
}
function refreshNow() {
    clearTimeout(refreshTimer);
    try {
        if (!isActive()) {
            current = null;
            setInjection('');
            renderHUD(null);
            document.body.classList.remove('op-on', 'op-dying', 'op-prison', 'op-dead');
            return;
        }
        current = compute();
        setInjection(buildInjection(current.state));
        renderHUD(current.state);
        const b = document.body.classList, s = current.state;
        b.add('op-on');
        b.toggle('op-dying', settings().effects && s.registered && s.hp <= 0 && !s.dead);
        b.toggle('op-dead', settings().effects && s.dead);
        b.toggle('op-prison', settings().effects && !!s.prison);
        decorateAll();
    } catch (e) {
        console.error(LOG, e);
    }
}

const TOAST_TYPE = { memory: 'info', find: 'info', dream: 'success', keep: 'success', rank: 'success', love: 'success', fame: 'info', bounty: 'warning', alert: 'warning', event: 'info', warn: 'warning', maim: 'error', end: 'error' };
function notifyEvent(e) {
    const fn = toastr[TOAST_TYPE[e.type] ?? 'info'] ?? toastr.info;
    fn(esc(e.text), e.type === 'bounty' ? '📜 현상수배' : e.type === 'event' ? '🌊 이벤트' : e.type === 'love' ? '♥' : e.type === 'memory' ? '📷 추억' : e.type === 'find' ? '🧭 발견' : e.type === 'dream' ? '⭐ 꿈' : TITLE, { timeOut: e.type === 'bounty' ? 9000 : 6000, escapeHtml: false });
}
function notifyLatest() {
    if (!current) return;
    const c = ctx();
    const last = (c.chat?.length ?? 0) - 1;
    const snap = current.snaps.get(last);
    const key = `${c.getCurrentChatId?.()}:${last}:${c.chat[last]?.swipe_id ?? 0}`;
    if (key === lastNotified || c.chat[last]?.is_user) return;
    lastNotified = key;
    for (const e of snap?.events ?? []) notifyEvent(e);
    if (settings().effects && snap?.events?.some(e => e.type === 'bounty')) {
        const hud = document.getElementById('op-hud');
        hud?.classList.remove('op-flash'); void hud?.offsetWidth; hud?.classList.add('op-flash');
    }
}

// ───────────────────────────── HUD ─────────────────────────────

const BAR_HELP = {
    hp: '체력 — 0이 되면 빈사. 생존 판정에 실패하면 죽는다(난이도에 따라 회귀 또는 엔딩). 휴식·의사로 회복.',
    heat: '악명/공적/명성 게이지 — 사건을 일으킬수록 찬다. 100이 차면 해적·혁명군은 현상금 갱신, 해군·정부는 진급, 시민은 명성 상승.',
};
const MODE_HELP = '일상 = 섬에서 지내는 시간 · 항해 = 바다 위 · 의뢰 = 임무 중 · 전투 = 교전 중(선택지) · 수감 = 감옥';

function bar(kind, label, value, max, sub, prevVal) {
    const pct = clamp((value / max) * 100, 0, 100);
    const diff = prevVal == null ? 0 : value - prevVal;
    const fx = diff === 0 ? '' : (kind === 'heat' ? (diff > 0 ? 'op-up' : 'op-down') : (diff < 0 ? 'op-down' : 'op-up'));
    return `<div class="op-bar op-bar-${kind} ${fx}" title="${esc(BAR_HELP[kind] ?? label)}">
        <div class="op-bar-head"><span>${label}</span><b>${value}</b>${sub ? `<em>${esc(sub)}</em>` : ''}</div>
        <div class="op-bar-track"><i style="width:${pct}%"></i></div>
    </div>`;
}
const stars = (n) => `${'★'.repeat(n)}${'☆'.repeat(5 - n)}`;
const shortBerry = (n) => (n >= 1e8 ? `${(n / 1e8).toFixed(n >= 1e9 ? 1 : 2).replace(/\.?0+$/, '')}억` : n >= 1e4 ? `${Math.round(n / 1e4).toLocaleString('ko-KR')}만` : `${n}`);

// 수배서 사진: 출항 창에 넣은 주소 → 페르소나 아바타 → 이름 첫 글자
function faceUrl(s) {
    if (s.photo) return s.photo;
    try {
        const c = ctx();
        const av = c.user_avatar ?? globalThis.user_avatar;
        if (av && typeof c.getThumbnailUrl === 'function') return c.getThumbnailUrl('persona', av);
    } catch { /* 없으면 아래 */ }
    const img = document.querySelector('#chat .mes[is_user="true"] .avatar img') ?? document.querySelector('#user_avatar_block .selected img');
    return img?.getAttribute('src') ?? '';
}
function wantedHTML(s, n, big = false) {
    const url = faceUrl(s);
    const dead = s.faction === 'marine' || s.faction === 'government' ? 'WANTED' : 'DEAD OR ALIVE';
    return `<div class="op-wanted${big ? ' op-wanted-big' : ''}">
        <b>WANTED</b>
        <div class="op-wanted-face"${url ? ` style="background-image:url('${esc(url).replace(/'/g, '%27')}')"` : ''}>${url ? '' : esc((s.name || '?').slice(0, 1))}</div>
        <i>${dead}</i>
        <strong>${esc(s.name)}</strong>
        <em>${esc(korNum(n))} <small>베리</small></em>
        <small class="op-wanted-foot">${s.cgBounty ? 'CROSS GUILD' : 'MARINE'}</small>
    </div>`;
}

let hudPrev = null;
function renderHUD(s) {
    let hud = document.getElementById('op-hud');
    if (!s) { if (hud) hud.style.display = 'none'; return; }
    const chatEl = document.getElementById('chat');
    if (!chatEl) return;
    if (!hud) {
        hud = document.createElement('div');
        hud.id = 'op-hud';
        hud.className = 'op-root';
        chatEl.parentElement.insertBefore(hud, chatEl);
        hud.addEventListener('click', onHudClick);
    }
    hud.style.display = '';
    const set = settings();
    hud.classList.toggle('op-mini', !!set.hudMini && s.registered);
    if (!s.registered) {
        hud.innerHTML = `<div class="op-hud-unreg">
            <i class="fa-solid fa-anchor op-bob"></i>
            <div><b>아직 출항하지 않았다</b><small>시대, 진영, 바다를 정하면 이야기가 시작된다.</small></div>
            <button class="op-btn" data-act="guide">처음이세요?</button>
            <button class="op-btn op-btn-hot" data-act="register">출항하기</button>
        </div>`;
        hudPrev = null;
        return;
    }
    const p = hudPrev;
    const era = eraOf(s);
    const d = dangerOf(s.bounty);
    const mode = MODES[s.mode] ?? 'daily';
    const f = factionOf(s.faction);
    const nextHint = isOutlaw(s) ? '100 → 현상금 갱신' : s.faction === 'marine' || s.faction === 'government' ? '100 → 진급' : '100 → 명성 상승';
    const alert = s.alerts.at(-1);
    const news = s.news.at(-1);
    const more = set.hudExpanded ? `<div class="op-more">
        <div class="op-row op-click" data-act="map" title="지도"><i class="fa-solid fa-map-location-dot"></i> ${esc(s.loc || '—')}${s.sea ? ` <span class="op-dim">· ${esc(s.sea)}</span>` : ''} <span class="op-dim">· 지도 ›</span></div>
        <div class="op-row op-click" data-act="album" title="앨범"><i class="fa-solid fa-compass"></i> 상륙한 섬 ${s.visited.length}/${islandList.length} <span class="op-dim">· 발견 ${s.finds.length} · 추억 ${s.memories.length} · 앨범 ›</span></div>
        ${topBonds(s, 4).length ? `<div class="op-chips">${topBonds(s, 4).map(b => `<span class="op-chip op-chip-bond op-click" data-act="bondview" data-n="${esc(b.name)}" title="${esc(b.note)}">${b.love >= 15 ? '♥' : '♡'} ${esc(b.name)} <small>${esc(b.rel || (b.love >= 15 ? LOVE_NAME[loveStage(b.love)] : affLabel(b)))}</small></span>`).join('')}</div>` : ''}
        <div class="op-row op-dim"><i class="fa-solid fa-hourglass-half"></i> ${esc(era.name)} · 캐논 ${esc(CANON.find(c => c.id === s.canon)?.name ?? '')} · ${esc(DIFFICULTY.find(x => x.id === s.diff)?.name ?? '')}${s.rewinds ? ` · 회귀 ${s.rewinds}회` : ''}</div>
        ${s.case ? `<div class="op-row"><i class="fa-solid fa-scroll"></i> ${esc(s.case)}</div>` : ''}
        ${s.ship ? `<div class="op-row"><i class="fa-solid fa-sailboat"></i> ${esc(s.ship.name)} <span class="op-dim">선체 ${s.ship.hull}%${s.ship.status ? ` · ${esc(s.ship.status)}` : ''}</span></div>` : ''}
        ${s.crew.length ? `<div class="op-chips">${s.crew.map(c => `<span class="op-chip op-chip-crew${c.status ? ' op-off' : ''}" title="${esc(c.role)}">${esc(c.name)}${c.status ? ` <small>${esc(c.status)}</small>` : ''}</span>`).join('')}</div>` : ''}
        ${s.wounds.length || s.maims.length ? `<div class="op-chips">${s.wounds.map(w => `<span class="op-chip op-chip-wound" title="${esc(w.desc)}">✚ ${esc(w.name)}</span>`).join('')}${s.maims.map(m => `<span class="op-chip op-chip-maim" title="${esc(m.desc)}">✖ ${esc(m.name)}</span>`).join('')}</div>` : ''}
        ${s.items.length ? `<div class="op-chips">${s.items.map(i => `<span class="op-chip op-chip-item">${esc(i.name)}${i.qty > 1 ? ` ×${i.qty}` : ''}</span>`).join('')}</div>` : ''}
    </div>` : '';
    const foe = s.foe ? `<div class="op-foe"><span class="op-foe-name"><em class="op-tier op-tier-${s.foe.tier}">${TIER[s.foe.tier]}</em>${esc(s.foe.name)}</span>
        <div class="op-bar-track"><i style="width:${s.foe.pct}%"></i></div><b>${s.foe.pct}%</b>
        ${s.foe.note ? `<small>${esc(s.foe.note)}</small>` : ''}</div>` : '';
    let panel = '';
    if (s.dead) {
        panel = `<div class="op-alert op-alert-dead"><b>사망</b> ${s.diff === 'hard' ? '이 바다에서 당신의 항해는 끝났다.' : '숨이 멎었다. 그러나 무언가가 시간을 붙잡는다.'}
            ${s.diff !== 'hard' ? '<button class="op-btn op-btn-hot" data-act="rewind">회귀한다</button>' : ''}
            <button class="op-btn" data-act="newgame">새 항해</button></div>`;
    } else if (s.hp <= 0) {
        panel = `<div class="op-alert op-alert-dying"><b>빈사</b> 의식이 바다 밑으로 가라앉는다.
            <button class="op-btn op-btn-hot" data-act="survive">생존 판정</button></div>`;
    } else if (s.prison) {
        const fl = s.prison.level ? IMPEL[s.prison.level - 1] : null;
        panel = `<div class="op-alert op-alert-prison"><b>수감</b> ${esc(s.prison.place)}${fl ? ` ${fl.lv} ${fl.name}` : ''} · ${s.day - s.prison.since + 1}일째
            <button class="op-btn op-btn-hot" data-act="escape">탈옥 시도</button>
            <button class="op-btn" data-act="timeskip">형기를 견딘다</button></div>`;
    }
    hud.innerHTML = `
        <div class="op-hud-top">
            <button class="op-ico" data-act="sheet" title="상태창"><i class="fa-solid fa-anchor"></i></button>
            <div class="op-id" data-act="mini" title="한 줄로 접기/펴기"><b>${esc(s.name)}</b><small><span style="color:${f.color}">${esc(s.factionLabel)}</span>${s.rank ? ` · ${esc(s.rank)}` : ''} · ${s.day}일차 ${dateText(dateOf(s.start, s.day))} ${esc(s.time)}</small></div>
            <div class="op-minis"><span class="op-m-hp">♥ ${s.hp}</span>${s.bounty ? `<span class="op-m-bounty">฿ ${shortBerry(s.bounty)}</span>` : ''}${d ? `<span class="op-m-danger">★${d}</span>` : ''}</div>
            <span class="op-mode" data-mode="${mode}" title="${MODE_HELP}">${esc(s.mode)}</span>
            <div class="op-acts">
                ${set.featAct ? '<button class="op-ico" data-act="act" title="오늘 뭐 하지? (활동)"><i class="fa-solid fa-umbrella-beach"></i></button>' : ''}
                ${set.featLetter ? `<button class="op-ico" data-act="letter" title="편지 (뉴스 쿠 우편)"><i class="fa-solid fa-envelope"></i>${unreadMail(s) ? `<em class="op-badge">${unreadMail(s)}</em>` : ''}</button>` : ''}
                <button class="op-ico" data-act="roll" title="주사위 판정"><i class="fa-solid fa-dice-d20"></i></button>
                <button class="op-ico" data-act="menu" title="더 보기 — 게시판 · 신문 · 메모장 · 해프닝 · 지도 · 안내"><i class="fa-solid fa-ellipsis"></i></button>
                <button class="op-ico" data-act="expand" title="${set.hudExpanded ? '접기' : '펼치기'}"><i class="fa-solid fa-chevron-${set.hudExpanded ? 'up' : 'down'}"></i></button>
            </div>
        </div>
        <div class="op-bars">
            ${bar('hp', '체력', s.hp, 100, s.hp <= 0 ? '빈사' : s.hp <= 30 ? '중상' : s.wounds.length ? `부상 ${s.wounds.length}` : '', p?.hp)}
            ${bar('heat', heatName(s), s.heat, 100, nextHint, p?.heat)}
        </div>
        <div class="op-pills">
            <span class="op-pill" title="재산"><i class="fa-solid fa-coins"></i> ${berry(s.cash)}</span>
            ${isOutlaw(s) ? `<span class="op-pill op-pill-bounty" title="현상금">฿ ${s.bounty ? esc(korNum(s.bounty)) : '없음'}</span>
            <span class="op-pill op-pill-danger" data-d="${d}" title="위험도 — ${esc(HUNT_KO[d] || '아직 아무도 당신을 쫓지 않는다')}">${stars(d)} <small>${DANGER_NAME[d]}</small></span>` : `<span class="op-pill op-pill-rank" title="${esc(s.affil)}">${s.faction === 'civil' ? '🏠' : '🎖️'} ${esc(s.rank || s.affil || s.factionLabel)}</span>`}
            <span class="op-pill" title="명성 ${s.fame}/100">명성 ${esc(fameTitle(s.fame))}</span>
            <span class="op-pill op-tier op-tier-${s.tier}" title="${esc(TIER_HELP[s.tier])}">격 ${TIER[s.tier]}</span>
            ${s.dream?.text ? `<span class="op-pill op-pill-dream" title="꿈: ${esc(s.dream.text)}">⭐ ${s.dream.pct}%</span>` : ''}
        </div>
        ${s.hexes.length ? `<div class="op-chips op-hexline">${s.hexes.map(x => `<span class="op-chip op-chip-hex" title="${esc(x.desc)}">🌀 ${esc(x.name)} <small>~${x.until}일차</small></span>`).join('')}</div>` : ''}
        ${alert && alert.day >= s.day - 1 ? `<div class="op-alertline"><i class="fa-solid fa-triangle-exclamation"></i> ${esc(alert.text)}</div>` : ''}
        ${set.ticker && set.featNews && news ? `<div class="op-ticker op-click" data-act="news" title="세계경제신문"><i class="fa-solid fa-newspaper"></i><span>${esc(news.text)}</span><small>${news.day}일차</small></div>` : ''}
        ${foe}${panel}${more}`;
    hudPrev = { hp: s.hp, heat: s.heat };
}

async function onHudClick(ev) {
    const btn = ev.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const set = settings();
    switch (act) {
        case 'register': return openRegister();
        case 'sheet': return openSheet();
        case 'roll': return openRoll();
        case 'board': return openBoard();
        case 'news': return openNews();
        case 'guide': return openGuide();
        case 'map': return openSheetTab('map');
        case 'mini': set.hudMini = !set.hudMini; saveSettings(); return renderHUD(current?.state);
        case 'expand': set.hudExpanded = !set.hudExpanded; saveSettings(); return renderHUD(current?.state);
        case 'survive': return openSurvive();
        case 'rewind': return openRewind();
        case 'escape': return openEscape();
        case 'timeskip': return openTimeskip();
        case 'newgame': return newVoyage();
        case 'act': return openActivity();
        case 'letter': return openLetters();
        case 'menu': return openMenu();
        case 'album': return openSheetTab('album');
        case 'bondview': return openBond(btn.dataset.n);
    }
}

// mode: 'tag' = 기존 입력 앞에 태그를 붙임(같은 종류 태그는 교체), 'replace' = 입력을 통째로 바꿈(태그는 유지)
const TAG_KINDS = '판정|의뢰 수락|탈옥|생존 판정|회귀|타임스킵|신문';
function insertInput(text, send = false, mode = 'tag') {
    const ta = document.getElementById('send_textarea');
    if (!ta) return;
    if (mode === 'replace') {
        const tags = (ta.value.match(new RegExp(`^(\\s*\\[(?:${TAG_KINDS})[^\\]]*\\]\\s*)+`)) ?? [''])[0];
        ta.value = `${tags}${text}`;
    } else {
        const kind = /^\[/.test(text) ? text.match(new RegExp(`^\\[(${TAG_KINDS})`))?.[1] : null;
        let rest = ta.value;
        if (kind) rest = rest.replace(new RegExp(`\\[${kind}[^\\]]*\\]\\s*`), '');
        else rest = rest.replace(/^\(.*?\)\s*/, '');
        ta.value = `${text}${rest}`;
    }
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.focus();
    if (send) document.getElementById('send_but')?.click();
}

// ───────────────────────────── 메시지 장식 ─────────────────────────────

function deltaChip(label, now, before, fmt = (x) => x, invert = false) {
    const d = now - before;
    const cls = d === 0 ? '' : ((invert ? d > 0 : d < 0) ? 'neg' : 'pos');
    return `<span class="op-chip">${label} <b>${fmt(now)}</b>${d ? ` <em class="${cls}">${d > 0 ? '+' : '−'}${fmt(Math.abs(d))}</em>` : ''}</span>`;
}

function cardHTML(snap, full) {
    const { state: s, prev: p, events } = snap;
    const ev = events.filter(e => e.type !== 'bounty').map(e => `<div class="op-ev op-ev-${e.type}">${esc(e.text)}</div>`).join('');
    const poster = s.bounty > p.bounty ? wantedHTML(s, s.bounty) : '';
    const ch = [];
    if (s.loc !== p.loc) ch.push(`<span class="op-chip"><i class="fa-solid fa-location-dot"></i> ${esc(s.loc)}</span>`);
    if (s.mode !== p.mode) ch.push(`<span class="op-chip op-mode-chip" data-mode="${MODES[s.mode]}">${esc(s.mode)}</span>`);
    if (s.cash !== p.cash) ch.push(`<span class="op-chip">베리 <em class="${s.cash < p.cash ? 'neg' : 'pos'}">${s.cash > p.cash ? '+' : '−'}${esc(korNum(Math.abs(s.cash - p.cash)))}</em></span>`);
    if (s.heat !== p.heat && s.bounty === p.bounty && s.rank === p.rank) ch.push(`<span class="op-chip">${heatName(s)} <b>${s.heat}</b> <em class="${s.heat > p.heat ? 'warn' : 'pos'}">${signed(s.heat - p.heat)}</em></span>`);
    if (s.case !== p.case) ch.push(`<span class="op-chip"><i class="fa-solid fa-scroll"></i> ${esc(s.case || '의뢰 종료')}</span>`);
    if (JSON.stringify(s.foe) !== JSON.stringify(p.foe) && s.foe) {
        ch.push(`<span class="op-chip op-chip-foe"><em class="op-tier op-tier-${s.foe.tier}">${TIER[s.foe.tier]}</em> ${esc(s.foe.name)} <b>${s.foe.pct}%</b>${p.foe && p.foe.name === s.foe.name && p.foe.pct !== s.foe.pct ? ` <em class="pos">${signed(s.foe.pct - p.foe.pct)}</em>` : ''}</span>`);
    }
    for (const w of s.wounds) if (!p.wounds.some(x => x.name === w.name)) ch.push(`<span class="op-chip op-chip-wound">✚ ${esc(w.name)}</span>`);
    for (const b of s.bonds) {
        const pb = p.bonds.find(x => x.name === b.name);
        if (pb && (pb.love ?? 0) !== (b.love ?? 0)) ch.push(`<span class="op-chip op-chip-love">♥ ${esc(b.name)} <em class="${(b.love ?? 0) < (pb.love ?? 0) ? 'neg' : 'pos'}">${signed((b.love ?? 0) - (pb.love ?? 0))}</em></span>`);
        if (!pb || pb.aff !== b.aff) ch.push(`<span class="op-chip op-chip-bond">♡ ${esc(b.name)} ${pb ? `<em class="${b.aff < pb.aff ? 'neg' : 'pos'}">${signed(b.aff - pb.aff)}</em>` : '<em class="pos">새 인연</em>'}</span>`);
    }
    if (s.ship && p.ship && s.ship.hull !== p.ship.hull) ch.push(`<span class="op-chip"><i class="fa-solid fa-sailboat"></i> 선체 ${s.ship.hull}% <em class="${s.ship.hull < p.ship.hull ? 'neg' : 'pos'}">${signed(s.ship.hull - p.ship.hull)}</em></span>`);
    if (full) {
        return `<div class="op-card op-full">
            <div class="op-card-head"><span>${s.day}일차 · ${esc(s.time)}</span><span>${esc(s.loc)}</span></div>
            <div class="op-bars">${bar('hp', '체력', s.hp, 100, '', p.hp)}${bar('heat', heatName(s), s.heat, 100, '', p.heat)}</div>
            ${ch.length ? `<div class="op-chips">${ch.join('')}</div>` : ''}${poster}${ev}</div>`;
    }
    return `<div class="op-card op-compact">
        <span class="op-chip op-chip-day">${s.day}일차 ${esc(s.time)}</span>
        ${deltaChip('체력', s.hp, p.hp)}
        ${ch.join('')}${poster}${ev}</div>`;
}

function choiceItems(box) {
    const lis = box.querySelectorAll('li');
    let raw;
    if (lis.length) raw = [...lis].map(li => li.textContent);
    else {
        const c = box.cloneNode(true);
        c.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
        c.querySelectorAll('p, div').forEach(el => el.append('\n'));
        raw = c.textContent.replace(/\s+(?=(?:\d{1,2}|[①-⑨])\s*[.)．]\s)/g, '\n').split(/\n+/);
    }
    return raw.map(t => t.trim().replace(/^(?:\d{1,2}|[①-⑨])\s*[.)．:]\s*/, '').replace(/^[-*•]\s*/, '')).filter(Boolean).slice(0, 6);
}

function decorateMessage(mesEl, isLastAI) {
    if (!current) return;
    const i = Number(mesEl.getAttribute('mesid'));
    const textEl = mesEl.querySelector('.mes_text');
    if (!textEl || Number.isNaN(i)) return;
    const set = settings();
    const snap = current.snaps.get(i);
    textEl.querySelectorAll('.op-slot, .custom-op-slot').forEach((slot, k) => {
        if (k > 0 || !snap || set.msgCard === 'off') { slot.innerHTML = ''; slot.style.display = 'none'; return; }
        slot.style.display = '';
        slot.innerHTML = cardHTML(snap, set.msgCard === 'full' && isLastAI);
    });
    textEl.querySelectorAll('.op-choices, .custom-op-choices').forEach(box => {
        if (box.dataset.opDone === '1') { box.classList.toggle('op-stale', !isLastAI); return; }
        const items = choiceItems(box);
        if (!items.length) return;
        const list = document.createElement('div');
        list.className = 'op-choice-list';
        items.forEach((t, n) => {
            const b = document.createElement('button');
            b.className = 'op-choice';
            b.innerHTML = `<span>${n + 1}</span>${esc(t)}`;
            b.addEventListener('click', () => {
                if (box.classList.contains('op-stale')) return;
                insertInput(t, settings().choiceClick === 'send', 'replace');
            });
            list.appendChild(b);
        });
        box.replaceChildren(list);
        box.dataset.opDone = '1';
        box.classList.toggle('op-stale', !isLastAI);
    });
    textEl.querySelectorAll('.op-tag, .custom-op-tag').forEach(tag => {
        const t = tag.textContent;
        tag.dataset.kind = /대성공/.test(t) ? 'crit' : /대실패|사망/.test(t) ? 'fumble' : /실패/.test(t) ? 'fail' : /성공/.test(t) ? 'ok' : /회귀|타임스킵/.test(t) ? 'time' : 'info';
    });
}

function decorateAll() {
    if (!current) return;
    const chat = ctx().chat ?? [];
    let lastAI = -1;
    for (let i = chat.length - 1; i >= 0; i--) { if (!chat[i].is_user && !chat[i].is_system) { lastAI = i; break; } }
    document.querySelectorAll('#chat .mes').forEach(el => decorateMessage(el, Number(el.getAttribute('mesid')) === lastAI));
}

// ───────────────────────────── 팝업 공통 ─────────────────────────────

async function popup(el, opts = {}) {
    const { Popup, POPUP_TYPE } = ctx();
    const p = new Popup(el, POPUP_TYPE.TEXT, '', { wide: true, allowVerticalScrolling: true, okButton: '닫기', ...opts });
    return await p.show();
}
const closePopup = (el) => el.closest('dialog')?.querySelector('.popup-button-ok')?.click();

// ── 확장 전용 AI 호출: 설정에서 고른 연결 프로필(모델)로 보내고, 없거나 실패하면 메인 연결 ──
function listProfiles() {
    const es = ctx().extensionSettings ?? {};
    if (es.disabledExtensions?.includes('connection-manager')) return [];
    return es.connectionManager?.profiles ?? [];
}
async function connService() {
    const c = ctx();
    if (c.ConnectionManagerRequestService) return c.ConnectionManagerRequestService;
    try { return (await import('/scripts/extensions/shared.js')).ConnectionManagerRequestService ?? null; } catch { return null; }
}
async function aiGenerate(systemPrompt, prompt) {
    const id = settings().aiProfile;
    if (id) {
        const prof = listProfiles().find(p => p.id === id);
        const svc = prof ? await connService() : null;
        if (prof && svc?.sendRequest) {
            try {
                let r;
                try { r = await svc.sendRequest(id, [{ role: 'system', content: systemPrompt }, { role: 'user', content: prompt }], 1500); }
                catch { r = await svc.sendRequest(id, `${systemPrompt}\n\n${prompt}`, 1500); } // 텍스트 완성 API용
                const text = typeof r === 'string' ? r : (r?.content ?? '');
                if (text) return String(text);
            } catch (e) {
                console.warn(LOG, 'profile request failed', e);
                toastr.warning(`연결 프로필 「${esc(prof.name)}」로 보내지 못해 메인 연결을 씁니다.`, TITLE);
            }
        } else toastr.warning(prof ? '연결 프로필 기능을 쓸 수 없어 메인 연결을 씁니다. (Connection Profiles 확장을 켜 주세요)' : '선택한 연결 프로필이 없어 메인 연결을 씁니다.', TITLE);
    }
    return String(await ctx().generateRaw({ systemPrompt, prompt }) ?? '');
}

async function aiLines(systemPrompt, prompt, btn, busy) {
    const old = btn?.innerHTML;
    if (btn) { btn.disabled = true; btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${busy}`; }
    try {
        return await aiGenerate(systemPrompt, prompt);
    } catch (e) {
        console.error(LOG, e);
        toastr.error('생성에 실패했습니다. API 연결을 확인하세요.', TITLE);
        return '';
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = old; }
    }
}
const pickLine = (out, k) => (String(out).match(new RegExp(`(?:^|\\n)\\s*[-*]?\\s*${k}\\s*[:：]\\s*(.+)`)) ?? [])[1]?.trim() ?? '';

// ───────────────────────────── 출항 (캐릭터 생성) ─────────────────────────────

function parseMD(v) {
    const m = String(v ?? '').match(/(\d{1,2})\s*(?:\/|월|\.|-)\s*(\d{1,2})/);
    if (!m) return null;
    const mo = clamp(Number(m[1]), 1, 12), d = clamp(Number(m[2]), 1, MONTH_DAYS[mo - 1]);
    return { m: mo, d };
}
const FRUIT_TYPES = ['초인계', '자연계', '동물계', '동물계 · 환수종', '동물계 · 고대종', '알 수 없음'];
const opt = (v, label, sel) => `<option value="${esc(v)}" ${sel ? 'selected' : ''}>${esc(label ?? v)}</option>`;

function defaultTier(fid, role) {
    if (fid === 'marine') {
        const i = MARINE_RANKS.indexOf(role);
        return i < 0 ? 1 : i < 7 ? 1 : i < 10 ? 2 : i < 14 ? 3 : i < 16 ? 4 : i < 17 ? 5 : 6;
    }
    const map = {
        pirate: { 선장: 2, 부선장: 2, 간부: 2, 선원: 1, '막내 잡일꾼': 1 },
        revolution: { '신입 혁명가': 1, 첩보원: 2, 간부: 3, 군대장: 4 },
        government: { '수습 요원': 1, '정식 요원': 2, '상급 요원': 3, 지휘관: 4 },
        civil: { '평범한 사람': 1, '이름난 신인': 2, '업계의 거물': 2 },
        strawhat: { '신입 선원': 2, '기존 멤버로 플레이': 4, '손님 · 동행자': 2 },
    };
    return map[fid]?.[role] ?? factionOf(fid).tier;
}

async function openRegister(editing = false) {
    if (!isActive()) return toastr.info(`${TITLE} 카드가 열린 채팅에서만 사용할 수 있습니다.`, TITLE);
    const c = ctx();
    const p = editing ? getMeta()?.profile ?? null : null;
    const el = h(`<div class="op-root op-pop">
        <h3 class="op-title">⚓ 출항</h3>
        <p class="op-dim op-center">시대와 진영, 바다를 정한다. 고른 대로 세계가 움직이고, 고르지 않은 것은 바다가 정한다.</p>
        <details class="op-help"><summary>처음이세요? 30초 안내</summary>${GUIDE[0][1]}</details>

        <h4 class="op-sub">1 · 시대</h4>
        <select class="text_pole" data-f="era">${ERAS.map((e, i) => opt(i, `${e.name} (${e.year})`, (p?.era ?? 4) === i)).join('')}</select>
        <p class="op-dim" data-o="eranote"></p>
        <input class="text_pole" data-f="eraDetail" value="${esc(p?.eraDetail ?? '')}" placeholder="세부 시점 (선택) — 예: 드레스로자 직후, 에니에스 로비 사건 사흘 전">

        <h4 class="op-sub">2 · 진영과 소속</h4>
        <div class="op-form-grid">
            <label>진영<select class="text_pole" data-f="faction">${FACTIONS.map(f => opt(f.id, f.label, (p?.faction ?? 'strawhat') === f.id)).join('')}</select>
                <input class="text_pole op-hidden" data-f="factionCustom" placeholder="진영 이름 (예: 현상금 사냥꾼 길드)" value="${esc(p?.faction === 'custom' ? p.factionLabel : '')}"></label>
            <label>소속 · 상관<select class="text_pole" data-f="affil"></select>
                <input class="text_pole op-hidden" data-f="affilCustom" placeholder="예: ○○ 해적단 / 해군 77지부"></label>
            <label class="op-wide">직책 · 계급<select class="text_pole" data-f="role"></select>
                <input class="text_pole op-hidden" data-f="roleCustom" placeholder="직접 입력"></label>
        </div>
        <p class="op-dim" data-o="facnote"></p>

        <h4 class="op-sub">3 · 캐릭터</h4>
        <div class="op-seg op-seg-sm" data-g="ctype">
            <button type="button" data-v="new" class="${p?.canonChar ? '' : 'on'}"><b>새 캐릭터</b><small>나만의 인물</small></button>
            <button type="button" data-v="canon" class="${p?.canonChar ? 'on' : ''}"><b>원작 캐릭터</b><small>예: 조로, 로, 코비</small></button>
        </div>
        <div class="op-form-grid">
            <label class="op-wide">이름<div class="op-inline"><input class="text_pole" data-f="name" value="${esc(p?.name ?? c.name1 ?? '')}">
                <button type="button" class="op-btn op-btn-sm" data-a="aichar"><i class="fa-solid fa-wand-magic-sparkles"></i> <span data-o="aibtn">AI로 채우기</span></button></div>
                <small class="op-dim" data-o="aihint"></small></label>
            <label>나이<input class="text_pole" data-f="age" value="${esc(p?.age ?? '')}" placeholder="예: 19"></label>
            <label>성별<input class="text_pole" data-f="gender" value="${esc(p?.gender ?? '')}" placeholder="예: 여성"></label>
            <label>종족<select class="text_pole" data-f="race">${RACES.map(r => opt(r, r, (p?.race ?? '인간') === r)).join('')}</select>
                <input class="text_pole op-hidden" data-f="raceCustom" placeholder="직접 입력" value="${esc(p && !RACES.includes(p.race) ? p.race : '')}"></label>
            <label>출신<select class="text_pole" data-f="origin">${ORIGINS.map(r => opt(r, r, p?.origin === r)).join('')}</select>
                <input class="text_pole op-hidden" data-f="originCustom" placeholder="직접 입력" value="${esc(p && p.origin && !ORIGINS.includes(p.origin) ? p.origin : '')}"></label>
            <label class="op-wide">전투 · 특기<select class="text_pole" data-f="style">${STYLES.map(r => opt(r.name, r.name, p?.style === r.name)).join('')}</select>
                <input class="text_pole op-hidden" data-f="styleCustom" placeholder="직접 입력" value="${esc(p && p.style && !STYLES.some(x => x.name === p.style) ? p.style : '')}"></label>
            <label>생일 (선택)<input class="text_pole" data-f="birthday" value="${esc(p?.birthday ? `${p.birthday.m}/${p.birthday.d}` : '')}" placeholder="예: 3/14"></label>
            <label>수배서 사진 (선택)<input class="text_pole" data-f="photo" value="${esc(p?.photo ?? '')}" placeholder="이미지 주소 · 비우면 페르소나 사진"></label>
            <label class="op-wide">한 줄 사연 (선택)<textarea class="text_pole" rows="2" data-f="story" placeholder="예: 해군에게 마을을 잃고, 그 해군에 입대했다.">${esc(p?.story ?? '')}</textarea></label>
        </div>

        <h4 class="op-sub">4 · 힘</h4>
        <div class="op-form-grid">
            <label class="op-wide">격 (전투력 등급)<select class="text_pole" data-f="tier">${TIER.map((t, i) => i ? opt(i, `${i} · ${TIER_HELP[i]}`, (p?.tier ?? 2) === i) : '').join('')}</select></label>
            <label>악마의 열매<select class="text_pole" data-f="fruitOn">${opt('none', '없음', !p?.fruit)}${opt('yes', '있음 (직접 정하기 / AI)', !!p?.fruit)}</select></label>
            <label>패왕색 자질<select class="text_pole" data-f="conqueror">${opt('0', '없음', !p?.conqueror)}${opt('1', '있음 (왕의 자질)', !!p?.conqueror)}</select></label>
            <div class="op-wide op-hidden op-fruit" data-o="fruit">
                <div class="op-form-grid">
                    <label>열매 이름<input class="text_pole" data-f="fruitName" value="${esc(p?.fruit?.name ?? '')}" placeholder="예: 파도파도 열매"></label>
                    <label>계통<select class="text_pole" data-f="fruitType">${FRUIT_TYPES.map(t => opt(t, t, p?.fruit?.type === t)).join('')}</select></label>
                    <label class="op-wide">능력<textarea class="text_pole" rows="2" data-f="fruitDesc" placeholder="무엇을 할 수 있고, 무엇이 약점인가">${esc(p?.fruit?.desc ?? '')}</textarea></label>
                    <button type="button" class="op-btn op-btn-sm" data-a="aifruit"><i class="fa-solid fa-wand-magic-sparkles"></i> AI가 오리지널 열매 만들기</button>
                </div>
            </div>
            <label>견문색 패기<select class="text_pole" data-f="hakiK">${['미각성', '기초', '숙련', '극의'].map((t, i) => opt(i, t, (p?.haki?.견문 ?? 0) === i)).join('')}</select></label>
            <label>무장색 패기<select class="text_pole" data-f="hakiB">${['미각성', '기초', '숙련', '극의'].map((t, i) => opt(i, t, (p?.haki?.무장 ?? 0) === i)).join('')}</select></label>
        </div>

        <h4 class="op-sub">5 · 시작 바다</h4>
        <div class="op-form-grid">
            <label>바다<select class="text_pole" data-f="sea">${SEAS.map(sea => opt(sea.id, sea.name, (seaOf(p?.sea)?.id ?? 'east') === sea.id)).join('')}</select></label>
            <label>섬<select class="text_pole" data-f="island"></select>
                <input class="text_pole op-hidden" data-f="islandCustom" placeholder="섬 이름" value=""></label>
            <label>시작 재산 (베리)<input class="text_pole" data-f="cash" value="${esc(p?.cash ?? '')}" placeholder="예: 30만"></label>
            <label>현상금 (베리)<input class="text_pole" data-f="bounty" value="${esc(p?.bounty ? p.bounty : '')}" placeholder="없으면 비워 두기"></label>
            <label>출항하는 날<input class="text_pole" data-f="start" value="${esc(p?.start ? `${p.start.m}/${p.start.d}` : `${new Date().getMonth() + 1}/${new Date().getDate()}`)}" placeholder="월/일 — 예: 5/5"></label>
            <label class="op-wide">배 이름 (선택)<input class="text_pole" data-f="ship" value="${esc(p?.ship ?? '')}" placeholder="예: 고잉 메리호 · 없으면 비워 두기"></label>
        </div>
        <p class="op-dim" data-o="seanote"></p>

        <h4 class="op-sub">6 · 꿈과 인연</h4>
        <div class="op-form-grid">
            <label>꿈 — 이 바다에 나선 이유<select class="text_pole" data-f="dream">${DREAMS.map(d => opt(d, d, p?.dream === d)).join('')}</select>
                <input class="text_pole op-hidden" data-f="dreamCustom" placeholder="예: 언젠가 하늘섬에 빵집을 연다" value="${esc(p?.dream && !DREAMS.includes(p.dream) ? p.dream : '')}"></label>
            <label>시작 인연 (선택)<input class="text_pole" data-f="bonds" value="${esc((p?.startBonds ?? []).filter(x => !x[2]).map(([n, r, , a, l]) => `${n}=${r}${a != null && a !== 30 ? `:${a}` : ''}${l ? `:${l}` : ''}`).join(', '))}" placeholder="예: 나미=소꿉친구, 스모커=옛 상관:-20"></label>
            <label class="op-wide">동료 · 선원 (선택, 최대 ${CAP.crew}명)<input class="text_pole" data-f="crew" value="${esc((p?.startCrew ?? []).map(([n, r]) => `${n}|${r}`).join(', '))}" placeholder="예: 조로|검사, 나미|항해사"></label>
            <label class="op-wide">소지품 (선택)<input class="text_pole" data-f="items" value="${esc((p?.items ?? []).map(i => `${i.name}${i.qty > 1 ? ` ${i.qty}` : ''}`).join(', '))}" placeholder="비우면 진영 기본 장비 · 예: 밀짚모자, 고기 3"></label>
        </div>
        <p class="op-dim">꿈은 상태창에 ⭐로 표시되고, 진짜 한 걸음을 뗄 때마다 차오릅니다. 시작 인연은 "이름=관계" 또는 "이름=관계:신뢰:설렘"(예: 조로=동료:70:10). 소속의 선장·상관은 자동으로 들어갑니다. 원작 캐릭터라면 위의 「AI로 채우기」가 여기까지 대략 채워 줍니다.</p>

        <h4 class="op-sub">7 · 이야기의 목표 <small class="op-dim">(여러 개)</small></h4>
        <div class="op-checks">${GOALS.map(g => `<label><input type="checkbox" data-goal="${g}" ${(p?.goals ?? ['모험']).includes(g) ? 'checked' : ''}><span>${g}</span></label>`).join('')}</div>
        <input class="text_pole" data-f="goalCustom" value="${esc((p?.goals ?? []).filter(g => !GOALS.includes(g)).join(', '))}" placeholder="직접 입력 (선택) — 예: 요리 대회 우승, 해군 몰래 연애">

        <h4 class="op-sub">8 · 캐논 엄격도</h4>
        <div class="op-seg op-seg-sm" data-g="canon">${CANON.map(x => `<button type="button" data-v="${x.id}" class="${(p?.canon ?? 'normal') === x.id ? 'on' : ''}"><b>${x.name}</b><small>${esc(x.desc)}</small></button>`).join('')}</div>

        <h4 class="op-sub">9 · 난이도</h4>
        <div class="op-seg op-seg-sm" data-g="diff">${DIFFICULTY.map(x => `<button type="button" data-v="${x.id}" class="${(p?.diff ?? 'normal') === x.id ? 'on' : ''}"><b>${x.name}</b><small>${esc(x.desc)}</small></button>`).join('')}</div>
    </div>`);
    const q = (s) => el.querySelector(s);
    const val = (f) => q(`[data-f="${f}"]`).value;
    let ctype = p?.canonChar ? 'canon' : 'new', canon = p?.canon ?? 'normal', diff = p?.diff ?? 'normal', tierTouched = !!p;

    const fillAffil = (keep) => {
        const f = factionOf(val('faction'));
        const era = ERAS[Number(val('era'))];
        const list = f.affil(era.id);
        const roles = f.roles;
        const a = q('[data-f="affil"]'), r = q('[data-f="role"]');
        const curA = keep?.affil ?? a.value, curR = keep?.rank ?? r.value;
        const custA = keep?.affil ? !list.includes(keep.affil) : curA === '__custom';
        const custR = keep?.rank ? !roles.includes(keep.rank) : curR === '__custom';
        a.innerHTML = list.map(x => opt(x, x, x === curA)).join('') + opt('__custom', '직접 입력', custA || !list.length);
        r.innerHTML = roles.map(x => opt(x, x, x === curR)).join('') + opt('__custom', '직접 입력', custR || !roles.length);
        if (keep?.affil && !list.includes(keep.affil)) q('[data-f="affilCustom"]').value = keep.affil;
        if (keep?.rank && !roles.includes(keep.rank)) q('[data-f="roleCustom"]').value = keep.rank;
        if (!list.length) a.value = '__custom';
    };
    const fillIslands = (keepLoc) => {
        const sea = SEAS.find(x => x.id === val('sea'));
        const cur = keepLoc ?? q('[data-f="island"]').value;
        const known = sea.islands.some(i => i.n === cur);
        q('[data-f="island"]').innerHTML = sea.islands.map(i => opt(i.n, i.n, i.n === cur)).join('') + opt('__custom', '직접 입력', !!cur && !known);
        if (keepLoc && !known) q('[data-f="islandCustom"]').value = keepLoc;
    };
    const sync = () => {
        const era = ERAS[Number(val('era'))];
        const f = factionOf(val('faction'));
        q('[data-o="eranote"]').textContent = era.note;
        const shOpt = q('[data-f="faction"] option[value="strawhat"]');
        shOpt.disabled = !era.strawhat;
        if (!era.strawhat && val('faction') === 'strawhat') { q('[data-f="faction"]').value = 'pirate'; fillAffil(); }
        q('[data-o="facnote"]').textContent = `${f.note} · 게이지: ${f.heat}`;
        q('[data-f="factionCustom"]').classList.toggle('op-hidden', f.id !== 'custom');
        q('[data-f="affilCustom"]').classList.toggle('op-hidden', val('affil') !== '__custom');
        q('[data-f="roleCustom"]').classList.toggle('op-hidden', val('role') !== '__custom');
        q('[data-f="dreamCustom"]').classList.toggle('op-hidden', val('dream') !== '직접 입력');
        for (const k of ['race', 'origin', 'style']) q(`[data-f="${k}Custom"]`).classList.toggle('op-hidden', val(k) !== '직접 입력');
        q('[data-f="islandCustom"]').classList.toggle('op-hidden', val('island') !== '__custom');
        q('[data-o="fruit"]').classList.toggle('op-hidden', val('fruitOn') !== 'yes');
        const sea = SEAS.find(x => x.id === val('sea'));
        const isl = sea.islands.find(i => i.n === val('island'));
        q('[data-o="seanote"]').textContent = `${sea.desc}${isl ? ` — ${isl.n}: ${isl.d}` : ''}`;
        q('[data-o="aibtn"]').textContent = ctype === 'canon' ? 'AI로 원작 설정 채우기' : 'AI 랜덤 생성';
        q('[data-o="aihint"]').textContent = ctype === 'canon' ? '원작 인물의 이름을 쓰고 누르면, 고른 시대 기준의 소속·격·현상금·열매·패기를 채웁니다.' : '진영·시대·바다에 어울리는 새 인물을 만듭니다(이름을 비우면 이름도).';
        if (!tierTouched) {
            const role = val('role') === '__custom' ? '' : val('role');
            q('[data-f="tier"]').value = String(defaultTier(f.id, role));
        }
    };
    fillAffil(p ? { affil: p.affil, rank: p.rank } : null);
    fillIslands(p?.loc);
    el.addEventListener('change', (e) => {
        const f = e.target.dataset.f;
        if (f === 'faction' || f === 'era') fillAffil();
        if (f === 'sea') fillIslands();
        if (f === 'tier') tierTouched = true;
        sync();
    });
    el.addEventListener('click', async (e) => {
        const seg = e.target.closest('.op-seg button');
        if (seg) {
            const g = seg.parentElement.dataset.g;
            seg.parentElement.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === seg));
            if (g === 'ctype') ctype = seg.dataset.v;
            if (g === 'canon') canon = seg.dataset.v;
            if (g === 'diff') diff = seg.dataset.v;
            sync();
            return;
        }
        const a = e.target.closest('[data-a]');
        if (!a) return;
        if (a.dataset.a === 'aichar') await aiCharacter(el, ctype, a, () => { fillAffil(); sync(); });
        if (a.dataset.a === 'aifruit') await aiFruit(el, a);
        tierTouched = true;
        sync();
    });
    sync();

    const { POPUP_RESULT } = c;
    const r = await popup(el, { okButton: editing ? '수정한다' : '출항한다', cancelButton: '나중에' });
    if (r !== POPUP_RESULT.AFFIRMATIVE) return;

    const f = factionOf(val('faction'));
    const pickC = (k, list) => (val(k) === '직접 입력' || val(k) === '__custom') ? q(`[data-f="${k}Custom"]`).value.trim() : val(k);
    const affil = val('affil') === '__custom' ? q('[data-f="affilCustom"]').value.trim() : val('affil');
    const rank = val('role') === '__custom' ? q('[data-f="roleCustom"]').value.trim() : val('role');
    const seaObj = SEAS.find(x => x.id === val('sea'));
    const loc = val('island') === '__custom' ? (q('[data-f="islandCustom"]').value.trim() || seaObj.name) : val('island');
    const fruit = val('fruitOn') === 'yes' && val('fruitName').trim() ? { name: val('fruitName').trim(), type: val('fruitType'), desc: val('fruitDesc').trim() } : null;
    const cashIn = val('cash').trim();
    const kit = clone(f.kit);
    if (['paradise', 'newworld', 'redline'].includes(seaObj.id) && !['marine', 'government'].includes(f.id)) kit.push(['로그 포스', 1]);
    const startBonds = [];
    for (const part of val('bonds').split(/\s*,\s*/).slice(0, CAP.bonds - 1)) {
        const [n, rest] = part.split('=').map(x => x?.trim());
        const [r, a, l] = String(rest ?? '').split(':').map(x => x.trim());
        if (n) startBonds.push([n, r || '아는 사이', '', a !== undefined && a !== '' ? Number(a) : 30, l ? Number(l) : 0]);
    }
    const startCrew = val('crew').split(/\s*,\s*/).map(x => x.split('|').map(y => y.trim())).filter(([n]) => n).slice(0, CAP.crew);
    const itemsIn = val('items').trim()
        ? val('items').split(/\s*,\s*/).map(x => x.match(/^(.+?)\s*(?:[x×]\s*)?(\d+)?$/)).filter(Boolean).map(m => ({ name: m[1].trim(), qty: Number(m[2] ?? 1) || 1 }))
        : null;
    const auto = f.id === 'strawhat' ? ['몽키 D. 루피', '선장']
        : (affil.match(/(?:원수|대장|중장|소장|준장|대령|참모총장|총사령관)\s+([^\s(]+)/) ? [affil.match(/(?:원수|대장|중장|소장|준장|대령|참모총장|총사령관)\s+([^\s(]+)/)[1], '상관'] : null)
        ?? (affil.match(/\(([^)]+)\)/) && !/셸스|로그타운|G-5|비공식|군단|사이퍼|세계귀족|아직/.test(affil) ? [affil.match(/\(([^)]+)\)/)[1], f.id === 'pirate' ? '선장' : '상관'] : null);
    const myName = val('name').trim() || c.name1 || '';
    if (auto && !startBonds.some(([n]) => nameMatch(n, auto[0])) && !startCrew.some(([n]) => nameMatch(n, auto[0])) && !nameMatch(myName, auto[0]) && !(ctype === 'canon' && /선장|총사령관|원수/.test(rank))) startBonds.unshift([auto[0], auto[1], 'auto', 40, 0]);
    const profile = {
        birthday: parseMD(val('birthday')), start: parseMD(val('start')) ?? { m: new Date().getMonth() + 1, d: new Date().getDate() },
        photo: val('photo').trim(),
        dream: val('dream') === '직접 입력' ? q('[data-f="dreamCustom"]').value.trim() : val('dream'),
        startBonds, startCrew, eraDetail: val('eraDetail').trim(),
        name: val('name').trim() || c.name1 || '이름 없는 자',
        age: val('age').trim(), gender: val('gender').trim(),
        race: pickC('race') || '인간', origin: pickC('origin'), style: pickC('style'), story: val('story').trim(),
        faction: f.id, factionLabel: f.id === 'custom' ? (q('[data-f="factionCustom"]').value.trim() || '무소속') : f.short,
        affil, rank, canonChar: ctype === 'canon',
        era: Number(val('era')), canon, diff,
        goals: [...el.querySelectorAll('[data-goal]:checked')].map(x => x.dataset.goal).concat(val('goalCustom').split(/\s*,\s*/).filter(Boolean)),
        tier: Number(val('tier')),
        cash: cashIn ? Math.max(0, Math.round(parseNum(cashIn, 0))) : f.cash,
        bounty: val('bounty').trim() ? Math.max(0, Math.round(parseNum(val('bounty'), 0))) : 0,
        fruit, haki: { 견문: Number(val('hakiK')), 무장: Number(val('hakiB')), 패왕: 0 }, conqueror: val('conqueror') === '1',
        sea: seaObj.name, loc, ship: val('ship').trim(),
        items: itemsIn ?? (editing && p?.items ? p.items : kit.map(([name, qty]) => ({ name, qty }))),
        fame: p?.fame ?? (val('bounty').trim() ? 20 : 0),
        at: editing && p ? (p.at ?? 0) : (c.chat?.length ?? 0),
    };
    if (profile.bounty >= 1e9) profile.fame = Math.max(profile.fame, 75);
    else if (profile.bounty >= 1e8) profile.fame = Math.max(profile.fame, 45);
    const meta = getMeta(true);
    meta.profile = profile;
    if (!editing) { meta.adjust = []; meta.board = null; meta.paper = null; }
    await saveMeta(true);
    refreshNow();
    if (!editing) {
        toastr.success(`${esc(profile.name)} — ${esc(ERAS[profile.era].name)}, ${esc(loc)}. 첫 행동을 보내면 항해가 시작된다.`, '출항', { timeOut: 7000 });
        insertInput('(출항한다.) ');
    }
}

async function aiCharacter(root, ctype, btn, after) {
    const q = (s) => root.querySelector(s);
    const val = (f) => q(`[data-f="${f}"]`).value;
    const era = ERAS[Number(val('era'))];
    const name = val('name').trim();
    if (ctype === 'canon' && !name) return toastr.warning('원작 인물의 이름을 먼저 쓰세요.', TITLE);
    const tierScale = TIER.map((t, i) => i ? `${i}=${TIER_EN[i]}` : '').filter(Boolean).join('; ');
    const prompt = ctype === 'canon'
        ? `One Piece canon reference. Character: ${name}. Point in time: ${era.name} (${era.year}).
Describe this character's status exactly at that point (if they are not yet born or not yet active, say so in 사연 and give their closest situation). Values in Korean (Korean official translation names). Power scale for 격: ${tierScale}.
Output exactly these lines, nothing else:
이름:
진영: (밀짚모자/해적/해군/혁명군/세계정부/시민 중 하나)
소속:
직책:
나이:
성별:
종족:
출신:
특기:
격: (1-6)
현상금: (베리 숫자, 없으면 0)
열매: (이름 | 계통 | 한 줄 능력, 없으면 없음)
견문: (0-3)
무장: (0-3)
패왕: (있음/없음)
위치: (그 시점에 있는 섬)
사연: (그 시점의 상황 한 줄)
꿈: (한 줄)
베리: (대략, 숫자)
배: (타고 있는 배 이름, 없으면 없음)
동료: (함께 다니는 동료, 최대 9명, "이름|역할"을 쉼표로)
인연: (동료 말고 중요한 인물, 최대 6명, "이름=관계:신뢰(-100~100)"를 쉼표로)
소지품: (상징적인 것 최대 4개, 쉼표로)
Keep it rough and short: core people only, approximate numbers are fine.`
        : `Create one ORIGINAL character (not a canon character) for a One Piece role-play sim.
Era: ${era.name}. Faction: ${factionOf(val('faction')).label}. Start sea: ${SEAS.find(x => x.id === val('sea')).name}.${name ? ` Name: ${name}.` : ''}
Make them vivid with a concrete hook that fits the era. Values in Korean; the name should sound natural in the One Piece world.
Output exactly these lines, nothing else:
이름:
나이:
성별:
종족:
출신:
특기:
사연:
꿈: (one line)`;
    const out = await aiLines('You are an expert on the manga One Piece. Output only the requested format.', prompt, btn, ctype === 'canon' ? '원작을 뒤지는 중…' : '바다에서 사람을 찾는 중…');
    if (!out) return;
    const setv = (f, v) => { const el = q(`[data-f="${f}"]`); if (el && v) el.value = v; };
    const setSel = (f, v, list) => {
        if (!v) return;
        const m = list.find(x => v.includes(x) || x.includes(v));
        if (m && m !== '직접 입력') setv(f, m); else { setv(f, '직접 입력'); setv(`${f}Custom`, v); }
    };
    setv('name', pickLine(out, '이름'));
    setv('age', pickLine(out, '나이')); setv('gender', pickLine(out, '성별'));
    setSel('race', pickLine(out, '종족'), RACES);
    setSel('origin', pickLine(out, '출신'), ORIGINS);
    setSel('style', pickLine(out, '특기'), STYLES.map(x => x.name));
    setv('story', pickLine(out, '사연'));
    if (ctype !== 'canon' && pickLine(out, '꿈')) { setv('dream', '직접 입력'); setv('dreamCustom', pickLine(out, '꿈')); }
    if (ctype === 'canon') {
        const fx = pickLine(out, '진영');
        const fid = /밀짚/.test(fx) ? 'strawhat' : /해군/.test(fx) ? 'marine' : /혁명/.test(fx) ? 'revolution' : /정부|CP/.test(fx) ? 'government' : /시민|민간/.test(fx) ? 'civil' : /해적/.test(fx) ? 'pirate' : null;
        if (fid) setv('faction', fid);
        after();
        const affil = pickLine(out, '소속'), rank = pickLine(out, '직책');
        const sa = q('[data-f="affil"]'), sr = q('[data-f="role"]');
        const near = (sel, v) => [...sel.options].find(o => o.value === v) ?? [...sel.options].find(o => o.value !== '__custom' && (o.value.includes(v) || v.includes(o.value.replace(/\s*\(.*?\)/g, ''))));
        if (affil) { const o = near(sa, affil); if (o) sa.value = o.value; else { sa.value = '__custom'; setv('affilCustom', affil); } }
        if (rank) { const o = near(sr, rank); if (o) sr.value = o.value; else { sr.value = '__custom'; setv('roleCustom', rank); } }
        const t = parseInt(pickLine(out, '격'), 10); if (t >= 1 && t <= 6) setv('tier', String(t));
        const b = pickLine(out, '현상금'); const bn = Math.round(parseNum(b, 0)); setv('bounty', bn > 0 ? String(bn) : '');
        const fr = pickLine(out, '열매');
        if (fr && !NONE_RE.test(fr)) {
            const [fname, ftype, fdesc] = splitBar(fr);
            setv('fruitOn', 'yes'); setv('fruitName', fname); setv('fruitDesc', fdesc ?? '');
            const ft = FRUIT_TYPES.find(x => (ftype ?? '').includes(x.split(' ')[0]) && (!x.includes('·') || (ftype ?? '').includes(x.split('· ')[1]))) ?? FRUIT_TYPES.find(x => (ftype ?? '').includes(x.split(' ')[0]));
            if (ft) setv('fruitType', ft);
        } else setv('fruitOn', 'none');
        setv('hakiK', String(clamp(parseInt(pickLine(out, '견문'), 10) || 0, 0, 3)));
        setv('hakiB', String(clamp(parseInt(pickLine(out, '무장'), 10) || 0, 0, 3)));
        setv('conqueror', /있/.test(pickLine(out, '패왕')) ? '1' : '0');
        const dream = pickLine(out, '꿈');
        if (dream) { setv('dream', '직접 입력'); setv('dreamCustom', dream); }
        const cash = Math.round(parseNum(pickLine(out, '베리'), 0)); if (cash > 0) setv('cash', String(cash));
        const ship = pickLine(out, '배'); if (ship && !NONE_RE.test(ship)) setv('ship', ship);
        const crewL = pickLine(out, '동료'); if (crewL && !NONE_RE.test(crewL)) setv('crew', crewL.split(/\s*,\s*/).filter(x => x && !nameMatch(x.split('|')[0], name)).slice(0, CAP.crew).join(', '));
        const bondL = pickLine(out, '인연'); if (bondL && !NONE_RE.test(bondL)) setv('bonds', bondL.split(/\s*,\s*/).slice(0, 6).join(', '));
        const itemL = pickLine(out, '소지품'); if (itemL && !NONE_RE.test(itemL)) setv('items', itemL);
        const where = pickLine(out, '위치');
        const isl = islandOf(where);
        if (isl) { setv('sea', isl.sea.id); const si = q('[data-f="island"]'); si.innerHTML = isl.sea.islands.map(i => opt(i.n, i.n, i.n === isl.n)).join('') + opt('__custom', '직접 입력'); }
        else if (where) { const si = q('[data-f="island"]'); si.value = '__custom'; setv('islandCustom', where); }
    }
}

async function aiFruit(root, btn) {
    const q = (s) => root.querySelector(s);
    const hint = q('[data-f="fruitName"]').value.trim();
    const out = await aiLines('You design original Devil Fruits for a One Piece role-play. Output only the requested format.',
        `Invent ONE original Devil Fruit that does not exist in canon.${hint ? ` Concept or name: ${hint}.` : ''} It should be fun, clever and have a clear limit or weakness besides the sea. Korean names follow the "OO OO 열매" pattern.
Output exactly these lines in Korean:
이름:
계통: (초인계/자연계/동물계/동물계 · 환수종/동물계 · 고대종 중 하나)
능력: (one or two sentences: what it does and its limit)`, btn, '열매를 찾는 중…');
    if (!out) return;
    q('[data-f="fruitName"]').value = pickLine(out, '이름') || q('[data-f="fruitName"]').value;
    const t = pickLine(out, '계통');
    const ft = FRUIT_TYPES.find(x => t.includes(x.replace(/\s/g, '')) || t.replace(/\s/g, '').includes(x.replace(/\s/g, ''))) ?? FRUIT_TYPES.find(x => t.includes(x.split(' ')[0]));
    if (ft) q('[data-f="fruitType"]').value = ft;
    q('[data-f="fruitDesc"]').value = pickLine(out, '능력') || q('[data-f="fruitDesc"]').value;
}

// ───────────────────────────── 판정 ─────────────────────────────

const ROLL_TYPES = [
    { id: 'power', name: '힘', desc: '정면 공격·완력·버티기', phys: true },
    { id: 'skill', name: '기술', desc: '검술·사격·체술의 정밀함', phys: true },
    { id: 'agile', name: '민첩', desc: '회피·추격·도주', phys: true },
    { id: 'sense', name: '견문', desc: '기척·관찰·통찰' },
    { id: 'talk', name: '교섭', desc: '설득·흥정·허세·거짓말', social: true },
    { id: 'sail', name: '항해', desc: '조타·날씨·수리·지리' },
    { id: 'stealth', name: '은신', desc: '잠입·변장·숨기' },
    { id: 'will', name: '의지', desc: '패기 대결·공포·고문 버티기', phys: true },
    { id: 'charm', name: '매력', desc: '호감 사기·유혹·설레게 하기', social: true },
    { id: 'etc', name: '기타', desc: '직접 이름 붙이기' },
];
const DIFFS = [{ name: '쉬움', t: 75 }, { name: '보통', t: 55 }, { name: '어려움', t: 35 }, { name: '무모', t: 15 }, { name: '절망', t: 5 }];

// 상대와의 관계가 판정을 바꾼다 — 너무 쉽게 넘어오지 않게
function relMods(s, type, target, confess) {
    const m = [];
    const b = target ? fuzzyFind(s.bonds, target) : null;
    if (!target) return m;
    if (!b) { if (type === 'charm') m.push(['처음 보는 사이', -15]); return m; }
    const love = b.love ?? 0;
    if (b.aff <= -20) m.push([`${b.name}의 적의`, -20]);
    else if (b.aff >= 50) m.push([`${b.name}의 신뢰`, 8]);
    if (type === 'charm') {
        if (love >= 60) m.push(['이미 마음이 있다', 15]);
        else if (love >= 35) m.push(['설레는 사이', 8]);
        else if (love < 15 && b.aff < 20) m.push(['아직 그럴 사이가 아니다', -15]);
    }
    if (confess) m.push(['고백', love >= 60 ? 0 : love >= 35 ? -15 : -35]);
    return m;
}

function rollMods(s, type, target, confess) {
    const m = relMods(s, type, target, confess);
    for (const h of s.hexes) { const v = h.mods?.[type] ?? h.mods?.all; if (v) m.push([`🌀 ${h.name}`, v]); }
    if (!s.fruit && type === 'sail') m.push(['헤엄칠 수 있다', 5]);
    const rt = ROLL_TYPES.find(x => x.id === type);
    if (s.foe && ['power', 'skill', 'agile', 'will'].includes(type)) {
        const g = clamp((s.tier - s.foe.tier) * 12, -48, 24);
        if (g) m.push([`격 차이 (${TIER[s.tier]} 대 ${TIER[s.foe.tier]})`, g]);
    }
    if (rt?.phys && s.hp <= 30) m.push(['중상', -15]);
    if (rt?.phys && s.wounds.length) m.push([`부상 ${s.wounds.length}`, -5 * Math.min(s.wounds.length, 4)]);
    let maim = 0;
    for (const x of s.maims) for (const [re, mod] of MAIM_MOD) if (re.test(x.name) && mod[type]) maim += mod[type];
    if (maim) m.push(['신체 손상', Math.max(maim, -35)]);
    const st = STYLES.find(x => x.name === s.style);
    if (st?.roll === type) m.push([`${s.style} 특기`, 10]);
    const hk = s.haki ?? {};
    if (hk.견문 && type === 'sense') m.push([`견문색 ${HAKI_LV[hk.견문]}`, hk.견문 * 8]);
    if (hk.견문 && type === 'agile') m.push([`견문색 예지`, hk.견문 * 4]);
    if (hk.무장 && type === 'power') m.push([`무장색 ${HAKI_LV[hk.무장]}`, hk.무장 * 6]);
    if (hk.무장 && type === 'skill') m.push(['무장색', hk.무장 * 4]);
    if (type === 'will' && (hk.패왕 || s.conqueror)) m.push([hk.패왕 ? `패왕색 Lv${hk.패왕}` : '왕의 자질', hk.패왕 ? hk.패왕 * 10 : 5]);
    if (s.fruit && !s.seastone && ['power', 'skill'].includes(type)) m.push(['열매 능력', 8]);
    if (s.seastone && rt?.phys) m.push([s.fruit ? '해루석 (능력 봉인·탈력)' : '해루석 수갑', s.fruit ? -25 : -10]);
    if ((type === 'talk' || type === 'charm') && s.fame >= 45) m.push(['명성', 5]);
    if (type === 'stealth' && dangerOf(s.bounty) >= 3) m.push(['얼굴이 알려짐', -10]);
    return m;
}
function judge(roll, target, s) {
    const fumbleAt = s.hp <= 30 ? 91 : 96;
    if (roll <= Math.max(1, Math.floor(target / 5))) return '대성공';
    if (roll >= fumbleAt) return '대실패';
    return roll <= target ? '성공' : '실패';
}

function diceAnim(box, r, label, sub, cls) {
    box.className = 'op-dice op-rolling';
    let n = 0;
    const iv = setInterval(() => {
        box.innerHTML = `<div class="op-dice-in"><span>${d100()}</span></div>`;
        if (++n > 9) {
            clearInterval(iv);
            box.className = `op-dice op-j-${cls}`;
            box.innerHTML = `<div class="op-dice-in"><span>${r}</span><b>${esc(label)}</b><small>${esc(sub)}</small></div>`;
        }
    }, 55);
    return new Promise(res => setTimeout(res, 620));
}
const JCLS = { 대성공: 'crit', 성공: 'ok', 실패: 'fail', 대실패: 'fumble' };

async function openRoll(preType, preDiff, tag = '판정') {
    const s = current?.state;
    if (!s?.registered) return openRegister();
    const el = h(`<div class="op-root op-pop">
        <h3 class="op-title">🎲 ${tag === '탈옥' ? '탈옥 시도' : '판정'}</h3>
        <p class="op-dim op-center">위험한 행동의 성패를 주사위(1~100)로 정합니다. 목표 이하면 성공 · 목표의 1/5 이하면 대성공 · 96 이상은 대실패. 격이 높은 적 앞에서는 목표가 크게 깎입니다. 결과를 입력창에 넣으면 AI가 그대로 따릅니다.</p>
        <div class="op-seg" data-g="type">${ROLL_TYPES.map((t, i) => `<button type="button" data-v="${t.id}" class="${(preType ? t.id === preType : i === 0) ? 'on' : ''}"><b>${t.name}</b><small>${t.desc}</small></button>`).join('')}</div>
        <div class="op-seg op-seg-sm" data-g="diff">${DIFFS.map((d, i) => `<button type="button" data-v="${i}" class="${(preDiff != null ? i === preDiff : i === 1) ? 'on' : ''}"><b>${d.name}</b><small>${d.t}</small></button>`).join('')}</div>
        <div class="op-form-grid op-hidden" data-o="social">
            <label>상대<select class="text_pole" data-f="target"><option value="">(없음)</option>${s.bonds.map(b => opt(b.name, `${b.name}${b.love ? ` ♥${b.love}` : ''}`)).join('')}<option value="__custom">직접 입력</option></select>
                <input class="text_pole op-hidden" data-f="targetCustom" placeholder="이름"></label>
            <label class="checkbox_label"><input type="checkbox" data-f="confess"> 고백한다</label>
        </div>
        <input class="text_pole op-hidden" data-f="etc" placeholder="판정 이름 — 예: 요리, 노래, 낚시">
        <label class="op-wide">무엇을 하는가 (선택)<input class="text_pole" data-f="what" placeholder="${tag === '탈옥' ? '예: 간수 교대 시간에 환풍구로 기어오른다' : '예: 돛대를 타고 올라 대포를 피한다'}"></label>
        <div class="op-mods" data-o="mods"></div>
        <div class="op-dice" data-o="dice"><div class="op-dice-in"><span>?</span></div></div>
        <div class="op-roll-actions">
            <button type="button" class="op-btn op-btn-hot" data-a="roll"><i class="fa-solid fa-dice-d20"></i> 굴린다</button>
            <button type="button" class="op-btn op-hidden" data-a="use"><i class="fa-solid fa-arrow-turn-down"></i> 입력창에 넣기</button>
        </div>
    </div>`);
    const q = (x) => el.querySelector(x);
    let type = preType ?? 'power', diff = preDiff ?? 1, result = null;
    const who = () => { const v = q('[data-f="target"]').value; return v === '__custom' ? q('[data-f="targetCustom"]').value.trim() : v; };
    const conf = () => q('[data-f="confess"]').checked;
    const target = () => clamp(DIFFS[diff].t + rollMods(s, type, ROLL_TYPES.find(x => x.id === type)?.social ? who() : '', conf()).reduce((a, [, v]) => a + v, 0), 1, 95);
    const showMods = () => {
        const social = !!ROLL_TYPES.find(x => x.id === type)?.social;
        q('[data-o="social"]').classList.toggle('op-hidden', !social);
        q('[data-f="targetCustom"]').classList.toggle('op-hidden', q('[data-f="target"]').value !== '__custom');
        q('[data-f="etc"]').classList.toggle('op-hidden', type !== 'etc');
        const mods = rollMods(s, type, social ? who() : '', social && conf());
        q('[data-o="mods"]').innerHTML = `기본 ${DIFFS[diff].t}${mods.map(([n, v]) => ` <span class="${v < 0 ? 'neg' : 'pos'}">${esc(n)} ${signed(v)}</span>`).join('')} → <b>목표 ${target()}</b>`;
    };
    el.addEventListener('click', async (e) => {
        const seg = e.target.closest('.op-seg button');
        if (seg) {
            const g = seg.parentElement.dataset.g;
            seg.parentElement.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === seg));
            if (g === 'type') type = seg.dataset.v; else diff = Number(seg.dataset.v);
            showMods();
            return;
        }
        const a = e.target.closest('[data-a]')?.dataset.a;
        if (a === 'roll') {
            q('[data-a="roll"]').classList.add('op-hidden');
            const t = target(), r = d100(), j = judge(r, t, s);
            result = { r, t, j };
            await diceAnim(q('[data-o="dice"]'), r, j, `목표 ${t}`, JCLS[j]);
            q('[data-a="use"]').classList.remove('op-hidden');
        }
        if (a === 'use' && result) {
            const tn = type === 'etc' ? (q('[data-f="etc"]').value.trim() || '기타') : ROLL_TYPES.find(t => t.id === type).name;
            const what = q('[data-f="what"]').value.trim();
            const social = ROLL_TYPES.find(x => x.id === type)?.social && who();
            insertInput(`[${tag} · ${tn}${social ? ` · 대상 ${who()}${conf() ? ' · 고백' : ''}` : ''} · ${DIFFS[diff].name} · 목표 ${result.t} · 굴림 ${result.r} → ${result.j}] ${what}`);
            closePopup(el);
        }
    });
    el.addEventListener('change', showMods);
    el.addEventListener('input', (e) => { if (e.target.dataset.f === 'targetCustom') showMods(); });
    showMods();
    await popup(el, { okButton: '닫기' });
}

async function openEscape() {
    const s = current?.state;
    if (!s?.prison) return;
    const lv = s.prison.level ? IMPEL[s.prison.level - 1].diff : 2;
    return openRoll('stealth', lv, '탈옥');
}

// ───────────────────────────── 생존 · 회귀 · 타임스킵 ─────────────────────────────

function surviveTarget(s) {
    const d = DIFFICULTY.find(x => x.id === s.diff) ?? DIFFICULTY[1];
    const m = [[`난이도 ${d.name}`, d.survive]];
    if (d.survive < 100) {
        if (s.crew.some(c => /의사|의원|군의|닥터/.test(c.role) && !c.status)) m.push(['곁에 의사가 있다', 15]);
        if (s.tier >= 4) m.push(['단련된 몸', 5]);
        if (s.ship?.parts?.includes('의무실') && !s.ship.status && s.mode !== '수감') m.push(['배의 의무실', 10]);
        if (s.maims.length) m.push(['누적된 손상', -5 * Math.min(s.maims.length, 3)]);
        if (s.rewinds) m.push(['회귀의 피로', -3 * Math.min(s.rewinds, 5)]);
    }
    return { mods: m, t: clamp(m.reduce((a, [, v]) => a + v, 0), 5, 100) };
}

async function openSurvive() {
    const s = current?.state;
    if (!s || s.hp > 0 || s.dead) return;
    const { mods, t } = surviveTarget(s);
    const el = h(`<div class="op-root op-pop">
        <h3 class="op-title">☠ 생존 판정</h3>
        <p class="op-dim op-center">의식이 꺼져 간다. 주사위가 목표 이하면 살아남는다 — 다만 몸 어딘가를 잃을 수 있다. 실패하면 죽는다${s.diff === 'hard' ? '. 하드코어: 되돌릴 수 없다.' : s.diff === 'normal' ? '. 표준: 죽으면 마지막 섬으로 회귀할 수 있다.' : '.'}</p>
        <div class="op-mods">${mods.map(([n, v], i) => `<span class="${i && v < 0 ? 'neg' : 'pos'}">${esc(n)} ${i ? signed(v) : v}</span>`).join(' ')} → <b>목표 ${t}</b></div>
        <div class="op-dice" data-o="dice"><div class="op-dice-in"><span>?</span></div></div>
        <div class="op-roll-actions"><button type="button" class="op-btn op-btn-hot" data-a="roll"><i class="fa-solid fa-heart-pulse"></i> 숨을 붙잡는다</button></div>
        <p class="op-center" data-o="res"></p>
    </div>`);
    let done = false;
    el.addEventListener('click', async (e) => {
        if (e.target.closest('[data-a="roll"]') && !done) {
            done = true;
            el.querySelector('[data-a="roll"]').classList.add('op-hidden');
            const r = d100();
            const ok = r <= t;
            await diceAnim(el.querySelector('[data-o="dice"]'), r, ok ? '생존' : '사망', `목표 ${t}`, ok ? 'ok' : 'fumble');
            if (ok) {
                const rnd = rngFrom(`${ctx().getCurrentChatId?.()}:surv:${s.day}:${r}`);
                const free = MAIMS.filter(x => !s.maims.some(y => y.name === x.name));
                const maim = rnd() < (s.diff === 'roman' ? 0.25 : 0.4) && free.length ? free[Math.floor(rnd() * free.length)] : null;
                await addAdjust([['_survive', `15${maim ? `|${maim.name}` : ''}`]], '');
                insertInput(`[생존 판정 · 굴림 ${r} / 목표 ${t} → 생존${maim ? ` · 영구 손상: ${maim.name}` : ''}] `);
                el.querySelector('[data-o="res"]').innerHTML = maim ? `살아남았다. 그러나 <b class="neg">${esc(maim.name)}</b> — ${esc(maim.desc)}` : '살아남았다.';
            } else {
                await addAdjust([['_die', s.foe ? `${s.foe.name}에게` : '']], '');
                insertInput(`[생존 판정 · 굴림 ${r} / 목표 ${t} → 사망] `);
                el.querySelector('[data-o="res"]').innerHTML = s.diff === 'hard' ? '<b class="neg">당신은 죽었다.</b> 마지막 장면을 보내면 이야기가 막을 내린다.' : '<b class="neg">당신은 죽었다.</b> 마지막 장면을 본 뒤, 상태창의 「회귀한다」를 누를 수 있다.';
            }
        }
    });
    await popup(el, { okButton: '닫기' });
}

async function openRewind() {
    const s = current?.state;
    if (!s?.dead || s.diff === 'hard') return;
    const cps = s.checkpoints.slice().reverse().slice(0, 10);
    const el = h(`<div class="op-root op-pop">
        <h3 class="op-title">⏳ 회귀</h3>
        <p class="op-dim op-center">숨이 멎은 순간, 시간이 거꾸로 감긴다. 도착했던 섬 가운데 하나로 돌아간다. 그 뒤의 일은 당신만 기억한다. 재산·부상·관계도 그 시점으로 돌아간다.</p>
        <div class="op-list">${cps.map((cp, i) => `<label class="op-item op-pick"><input type="radio" name="op-cp" value="${cp.at}" ${i === 0 ? 'checked' : ''}><b>${cp.day}일차</b><span>${esc(cp.loc || '출항 시점')}</span></label>`).join('')}</div>
        <p class="op-dim">지금까지 회귀 ${s.rewinds}회. 회귀할수록 생존 판정이 조금씩 어려워진다.</p>
    </div>`);
    const { POPUP_RESULT } = ctx();
    const r = await popup(el, { okButton: '돌아간다', cancelButton: '그만둔다' });
    if (r !== POPUP_RESULT.AFFIRMATIVE) return;
    const at = Number(el.querySelector('input[name="op-cp"]:checked')?.value ?? -1);
    const cp = s.checkpoints.find(x => x.at === at);
    await addAdjust([['_rewind', String(at)]], '');
    insertInput(`[회귀 · ${s.rewinds + 1}회차 · ${cp?.day ?? 1}일차 ${cp?.loc ?? ''}] `);
}

async function openTimeskip() {
    const s = current?.state;
    if (!s?.registered) return;
    const canEra = s.era < ERAS.length - 1;
    const el = h(`<div class="op-root op-pop">
        <h3 class="op-title">⌛ 타임스킵</h3>
        <p class="op-dim op-center">${s.prison ? '형기를 견딘다. 시간이 흐르는 동안 세계는 당신 없이 움직인다. 끝나면 감옥 밖에서 다시 시작한다.' : '수련, 잠적, 표류 — 시간을 건너뛴다. 세계는 그동안 움직인다.'}</p>
        <div class="op-seg op-seg-sm" data-g="m">${[3, 6, 12, 24].map((m, i) => `<button type="button" data-v="${m}" class="${i === 1 ? 'on' : ''}"><b>${m >= 12 ? `${m / 12}년` : `${m}개월`}</b></button>`).join('')}</div>
        <label class="op-wide">직접 입력 (개월)<input type="number" min="1" max="60" class="text_pole" data-f="months" placeholder="비우면 위에서 고른 값"></label>
        ${canEra ? `<label class="checkbox_label"><input type="checkbox" data-f="era"> 다음 시대로 넘어간다 — ${esc(ERAS[s.era + 1].name)}</label>` : ''}
        <p class="op-dim">흩어진 동료는 "소식 끊김"이 되고, 부상은 낫습니다. 이미 몰수된 재산은 돌아오지 않습니다.</p>
    </div>`);
    let months = 6;
    el.addEventListener('click', (e) => {
        const b = e.target.closest('.op-seg button');
        if (!b) return;
        el.querySelectorAll('.op-seg button').forEach(x => x.classList.toggle('on', x === b));
        months = Number(b.dataset.v);
    });
    const { POPUP_RESULT } = ctx();
    const r = await popup(el, { okButton: '시간을 보낸다', cancelButton: '그만둔다' });
    if (r !== POPUP_RESULT.AFFIRMATIVE) return;
    const m = clamp(Number(el.querySelector('[data-f="months"]').value) || months, 1, 60);
    const era = canEra && el.querySelector('[data-f="era"]')?.checked;
    const ops = [['_timeskip', String(m)]];
    if (era) ops.push(['_era', String(s.era + 1)]);
    await addAdjust(ops, '');
    insertInput(`[타임스킵 · ${m >= 12 && m % 12 === 0 ? `${m / 12}년` : `${m}개월`}${era ? ` · ${ERAS[s.era + 1].name}` : ''}] `);
}

async function newVoyage() {
    const { Popup, POPUP_RESULT } = ctx();
    const r = await Popup.show.confirm('새 항해', '이 채팅의 프로필과 기록을 지우고 출항 창을 엽니다. AI 메시지는 남습니다. (새 채팅에서 시작하는 것을 추천합니다)');
    if (r !== POPUP_RESULT.AFFIRMATIVE) return;
    const m = getMeta(true); m.profile = null; m.adjust = []; m.board = null; m.paper = null;
    await saveMeta(true); refreshNow();
    setTimeout(() => openRegister(), 200);
}

// ───────────────────────────── 의뢰 게시판 ─────────────────────────────

function boardGroup(s) {
    if (s.faction === 'marine') return 'marine';
    if (s.faction === 'revolution') return 'revolution';
    if (s.faction === 'government') return 'government';
    if (s.faction === 'civil' && !s.bounty) return 'civil';
    return isOutlaw(s) ? 'outlaw' : 'civil';
}

function parseBoard(text) {
    const out = [];
    for (const blk of String(text).split(/#{3,}/)) {
        const g = (k) => (blk.match(new RegExp(`${k}\\s*[:：]\\s*(.+)`)) ?? [])[1]?.trim() ?? '';
        const title = g('제목');
        if (!title) continue;
        out.push({ src: g('출처') || '소문', title, area: g('장소') || '근해', grade: clamp(parseInt(g('등급'), 10) || 2, 1, 5), pay: g('보수') || '협의', hook: g('개요') });
    }
    return out.slice(0, 3);
}

async function fetchBoard(s) {
    const era = eraOf(s);
    const srcs = BOARD_SRC[s.faction] ?? BOARD_SRC.custom;
    const out = await aiLines('You write job postings for a One Piece role-play sim. Output only the requested format, in Korean.',
        `Era: ${era.name} (${era.year}). ${CANON_EN[s.canon]}
${s.name}: ${s.factionLabel}${s.affil ? ` / ${s.affil}` : ''}${s.rank ? ` / ${s.rank}` : ''}, 격 ${s.tier}/6, bounty ${s.bounty ? berry(s.bounty) : 'none'}, at ${s.loc || s.sea || 'sea'} (${s.sea || ''}), day ${s.day}.
Write 3 different jobs fitting this faction (sources: ${srcs.join(', ')}). Mix risk levels; at least one ties into the era's canon situation or a nearby island; one may be a trap. Concrete, era-accurate names. Pay in 베리 or in kind.
Format exactly, separated by ###:
###
출처:
제목:
장소:
등급: (1-5 risk)
보수:
개요: (one or two sentences)`, null, '');
    const list = parseBoard(out);
    if (list.length) return list;
    const rnd = rngFrom(`${ctx().getCurrentChatId?.()}:${s.day}:${Date.now()}`);
    return (BOARD_POOL[boardGroup(s)] ?? BOARD_POOL.civil).slice().sort(() => rnd() - .5).slice(0, 3).map(b => ({ ...b, area: b.area ?? (s.loc || '근해') }));
}

async function openBoard(force = false) {
    const s = current?.state;
    if (!s?.registered) return openRegister();
    const meta = getMeta(true);
    const el = h(`<div class="op-root op-pop">
        <h3 class="op-title">📋 의뢰 게시판</h3>
        <p class="op-dim op-center">${s.day}일차 · ${esc(s.loc || s.sea || '바다 위')}${s.case ? ` · <span class="op-warn">진행 중: ${esc(s.case)}</span>` : ''}</p>
        <p class="op-dim op-center">◆ 개수 = 위험도. 진영에 따라 들어오는 일이 다릅니다. 수락하면 의뢰 모드가 되고 입력창에 의뢰 태그가 들어갑니다.</p>
        <div class="op-board" data-o="list"><div class="op-center op-dim"><i class="fa-solid fa-spinner fa-spin"></i> 전보벌레가 울리는 중…</div></div>
        <div class="op-roll-actions"><button type="button" class="op-btn" data-a="reload"><i class="fa-solid fa-rotate"></i> 다른 의뢰 받기</button></div>
    </div>`);
    const draw = (list) => {
        el.querySelector('[data-o="list"]').innerHTML = list.map((b, i) => `<div class="op-job">
            <div class="op-job-head"><span class="op-job-src">${esc(b.src)}</span><b>${esc(b.title)}</b><span class="op-job-grade">${'◆'.repeat(b.grade)}${'◇'.repeat(5 - b.grade)}</span></div>
            <p>${esc(b.hook)}</p>
            <div class="op-job-foot"><span><i class="fa-solid fa-location-dot"></i> ${esc(b.area)}</span><span><i class="fa-solid fa-coins"></i> ${esc(b.pay)}</span>
            <button type="button" class="op-btn op-btn-hot op-btn-sm" data-a="take" data-i="${i}">수락</button></div></div>`).join('') || '<p class="op-dim op-center">오늘은 들어온 일이 없다.</p>';
    };
    const load = async (regen) => {
        if (!regen && meta.board?.day === s.day && meta.board.list?.length) return draw(meta.board.list);
        el.querySelector('[data-o="list"]').innerHTML = '<div class="op-center op-dim"><i class="fa-solid fa-spinner fa-spin"></i> 전보벌레가 울리는 중…</div>';
        const list = await fetchBoard(s);
        meta.board = { day: s.day, list };
        saveMeta();
        draw(list);
    };
    el.addEventListener('click', async (e) => {
        const a = e.target.closest('[data-a]');
        if (!a || a.disabled) return;
        if (a.dataset.a === 'reload') { a.disabled = true; await load(true); a.disabled = false; }
        if (a.dataset.a === 'take') {
            const b = meta.board.list[Number(a.dataset.i)];
            await addAdjust([['case', `${b.title} | 수락`], ['mode', '의뢰']], `의뢰 수락 — ${b.title} (${b.src})`);
            meta.board.list.splice(Number(a.dataset.i), 1);
            saveMeta();
            insertInput(`[의뢰 수락 · ${b.src} · ${b.title} · ${b.area} · 보수 ${b.pay} · ${b.hook}] `);
            closePopup(el);
        }
    });
    setTimeout(() => load(force), 0);
    await popup(el, { okButton: '닫기' });
}

// ───────────────────────────── 세계경제신문 ─────────────────────────────

async function fetchPaper(s) {
    const era = eraOf(s);
    const out = await aiLines('You are the editor of 세계경제신문 (World Economic Journal) in One Piece. Output only the requested format, in Korean.',
        `Era: ${era.name} (${era.year}), day ${s.day} of ${s.name}'s voyage. ${CANON_EN[s.canon]}
${s.name}: ${s.name}, ${s.factionLabel}${s.rank ? ` ${s.rank}` : ''}, fame ${fameTitle(s.fame)}, bounty ${s.bounty ? berry(s.bounty) : 'none'}, near ${s.loc || s.sea}.
Recent events in ${s.name}'s story: ${s.log.slice(-4).map(l => l.text).join(' / ') || 'none'}.
Write 4 headlines for today's paper: world-level news fitting this era (canon figures, Marines, Yonko, government moves, rumors)${s.fame >= 25 || s.bounty ? ', and one item about ${s.name} (biased the way the paper would be)' : ''}. Sensational tone; keep canon-accurate for this era; future events must not appear.
Format: one per line, exactly:
- [분류] 헤드라인 | 한 줄 내용`, null, '');
    const list = String(out).split('\n').map(l => l.match(/^\s*[-*]\s*\[(.+?)\]\s*(.+?)\s*\|\s*(.+)$/)).filter(Boolean).map(m => ({ tag: m[1], head: m[2], body: m[3] }));
    return list.slice(0, 5);
}

async function openNews() {
    const s = current?.state;
    if (!s?.registered) return openRegister();
    const meta = getMeta(true);
    const el = h(`<div class="op-root op-pop op-paper">
        <h3 class="op-title op-paper-title">世界經濟新聞 <small>세계경제신문 · ${s.day}일차</small></h3>
        <div data-o="paper"><p class="op-dim op-center">뉴스 쿠가 신문을 물고 온다. <button type="button" class="op-btn op-btn-sm" data-a="get"><i class="fa-solid fa-dove"></i> 오늘 신문 받기</button></p></div>
        <h4 class="op-sub">스크랩 — 지금까지의 소식</h4>
        <div class="op-news">${s.news.slice().reverse().slice(0, 20).map(n => `<div class="op-news-i op-news-${n.kind}"><span>${n.day}일차</span>${esc(n.text)}</div>`).join('') || '<p class="op-dim">아직 소식이 없다.</p>'}</div>
        <p class="op-dim">기사를 누르면 "그 기사를 읽는다" 태그가 입력창에 들어갑니다. 신문은 하루 한 부 — 다시 받으면 새로 찍습니다.</p>
    </div>`);
    const draw = (list) => {
        el.querySelector('[data-o="paper"]').innerHTML = list.length ? `<div class="op-headlines">${list.map((n, i) => `<button type="button" class="op-head" data-a="read" data-i="${i}"><em>${esc(n.tag)}</em><b>${esc(n.head)}</b><span>${esc(n.body)}</span></button>`).join('')}</div>
            <div class="op-roll-actions"><button type="button" class="op-btn op-btn-sm" data-a="regen"><i class="fa-solid fa-rotate"></i> 다시 찍기</button></div>` : '<p class="op-dim op-center">신문이 젖어서 읽을 수 없다. (생성 실패 — 잠시 후 다시)</p>';
    };
    const load = async (regen) => {
        if (!regen && meta.paper?.day === s.day && meta.paper.list?.length) return draw(meta.paper.list);
        el.querySelector('[data-o="paper"]').innerHTML = '<p class="op-center op-dim"><i class="fa-solid fa-spinner fa-spin"></i> 윤전기가 돌아가는 중…</p>';
        const list = await fetchPaper(s);
        if (list.length) { meta.paper = { day: s.day, list }; saveMeta(); }
        draw(list);
    };
    if (meta.paper?.day === s.day && meta.paper.list?.length) setTimeout(() => draw(meta.paper.list), 0);
    el.addEventListener('click', async (e) => {
        const a = e.target.closest('[data-a]');
        if (!a || a.disabled) return;
        if (a.dataset.a === 'get' || a.dataset.a === 'regen') { a.disabled = true; await load(a.dataset.a === 'regen'); }
        if (a.dataset.a === 'read') {
            const n = meta.paper.list[Number(a.dataset.i)];
            await addAdjust([['news', `[${n.tag}] ${n.head}`]], '');
            insertInput(`[신문 · ${n.tag} · ${n.head} — ${n.body}] `);
            closePopup(el);
        }
    });
    await popup(el, { okButton: '닫기' });
}

// ───────────────────────────── 활동 ─────────────────────────────

async function openActivity(preset) {
    const s = current?.state;
    if (!s?.registered) return openRegister();
    if (s.dead) return;
    if (s.mode === '전투') return toastr.warning('지금은 그럴 때가 아니다 — 싸우는 중이다.', TITLE);
    const kind = s.mode === '수감' ? '수감' : s.mode === '항해' ? '항해' : '일상';
    const list = [...ACTIVITIES[kind], ...(kind === '일상' ? FACTION_ACTS[s.faction] ?? [] : [])];
    const bonds = topBonds(s, CAP.bonds).filter(b => b.aff > -60);
    const crewN = s.crew.filter(c => !c.status).length;
    const el = h(`<div class="op-root op-pop">
        <h3 class="op-title">🏝️ 오늘 뭐 하지?</h3>
        <p class="op-dim op-center">${s.day}일차 ${esc(s.time)} · ${esc(s.loc || s.sea || '바다 위')} — 고르면 입력창에 행동이 들어갑니다. 고친 뒤 보내세요.</p>
        <div class="op-acts-grid">${list.map((a, i) => {
            const off = (a.need === 'crew' && !crewN) || ((a.need === 'bond' || a.need === 'gift') && !bonds.length) || (a.need === 'gift' && !s.items.length);
            return `<button type="button" class="op-actbtn" data-i="${i}" ${off ? 'disabled title="동료·인연·소지품이 필요하다"' : ''}><span>${a.ico}</span><b>${esc(a.name)}</b></button>`;
        }).join('')}</div>
        <div class="op-hidden op-act-more" data-o="more">
            <div class="op-form-grid">
                <label data-o="who">누구와<select class="text_pole" data-f="who">${bonds.map(b => opt(b.name, `${b.name}${b.rel ? ` · ${b.rel}` : ''}`)).join('')}</select></label>
                <label data-o="item">무엇을<select class="text_pole" data-f="item">${s.items.map(i => opt(i.name, `${i.name}${i.qty > 1 ? ` ×${i.qty}` : ''}`)).join('')}</select></label>
            </div>
            <div class="op-roll-actions"><button type="button" class="op-btn op-btn-hot" data-a="go">이걸로 한다</button></div>
        </div>
        <div class="op-inline op-act-custom"><input class="text_pole" data-f="custom" placeholder="직접 쓰기 — 예: 항구에서 그림을 그려 판다"><button type="button" class="op-btn op-btn-sm" data-a="custom">넣기</button></div>
    </div>`);
    let cur = null;
    const fire = async () => {
        const who = el.querySelector('[data-f="who"]')?.value ?? '';
        const item = el.querySelector('[data-f="item"]')?.value ?? '';
        if (cur.need === 'gift') await addAdjust([['item', `-${item} 1`]], `선물 — ${who}에게 ${item}`);
        insertInput(`(${cur.text.replace('{who}', who).replace('{item}', item)}) `, false, 'replace');
        closePopup(el);
    };
    el.addEventListener('click', async (e) => {
        const b = e.target.closest('.op-actbtn');
        if (b && !b.disabled) {
            cur = list[Number(b.dataset.i)];
            el.querySelectorAll('.op-actbtn').forEach(x => x.classList.toggle('on', x === b));
            if (cur.need === 'bond' || cur.need === 'gift') {
                el.querySelector('[data-o="more"]').classList.remove('op-hidden');
                el.querySelector('[data-o="item"]').classList.toggle('op-hidden', cur.need !== 'gift');
                if (preset?.who) el.querySelector('[data-f="who"]').value = preset.who;
                return;
            }
            return fire();
        }
        if (e.target.closest('[data-a="go"]') && cur) fire();
        if (e.target.closest('[data-a="custom"]')) {
            const v = el.querySelector('[data-f="custom"]').value.trim();
            if (v) { insertInput(`(${v.replace(/^\(|\)$/g, '')}) `, false, 'replace'); closePopup(el); }
        }
    });
    if (preset?.act) setTimeout(() => el.querySelectorAll('.op-actbtn')[list.findIndex(a => a.name === preset.act)]?.click(), 0);
    await popup(el, { okButton: '닫기' });
}

// ───────────────────────────── 인연 상세 ─────────────────────────────

async function openBond(name) {
    const s = current?.state;
    const b = s && fuzzyFind(s.bonds, name);
    if (!b) return;
    const crew = fuzzyFind(s.crew, b.name);
    const mems = s.memories.filter(m => m.with && (m.with.includes(b.name) || b.name.includes(m.with)));
    const trustPct = (b.aff + 100) / 2;
    const ls = loveStage(b.love);
    const el = h(`<div class="op-root op-pop">
        <h3 class="op-title">${b.love >= 15 ? '♥' : '♡'} ${esc(b.name)}</h3>
        <p class="op-dim op-center">${esc([b.rel, crew && `동료 · ${crew.role || '선원'}${crew.status ? ` (${crew.status})` : ''}`, b.met && `${b.met}일차에 만남`].filter(Boolean).join(' · ') || '아는 사람')}</p>
        <div class="op-bars op-bars-1">
            <div class="op-bar op-bar-trust" title="신뢰 −100~100"><div class="op-bar-head"><span>신뢰</span><b>${b.aff}</b><em>${esc(affLabel(b))}</em></div><div class="op-bar-track"><i style="width:${trustPct}%"></i></div></div>
            <div class="op-bar op-bar-love" title="설렘 0~100 · 15 신경 쓰임 · 35 설렘 · 60 사랑 · 85 깊은 사랑"><div class="op-bar-head"><span>설렘</span><b>${b.love ?? 0}</b><em>${ls ? LOVE_NAME[ls] : '아직'}</em></div><div class="op-bar-track"><i style="width:${b.love ?? 0}%"></i></div></div>
        </div>
        ${b.note ? `<p><b>메모</b> ${esc(b.note)}</p>` : ''}
        <h4 class="op-sub">함께한 추억</h4>
        ${mems.length ? mems.slice().reverse().map(m => `<div class="op-item"><b>📷 ${esc(m.title)}</b><span>${m.day}일차 · ${esc(m.desc)}</span></div>`).join('') : '<p class="op-dim">아직 함께 남긴 장면이 없다.</p>'}
        <div class="op-roll-actions">
            <button type="button" class="op-btn op-btn-hot" data-a="meet"><i class="fa-solid fa-person-walking"></i> 만나러 간다</button>
            <button type="button" class="op-btn" data-a="call">☎️ 연락</button>
            <button type="button" class="op-btn" data-a="gift" ${s.items.length ? '' : 'disabled'}>🎁 선물</button>
        </div>
        <details class="op-edit"><summary>관계 직접 고치기</summary>
            <div class="op-form-grid">
                <label>관계 이름<input class="text_pole" data-f="rel" value="${esc(b.rel)}" placeholder="예: 연인, 라이벌, 소꿉친구"></label>
                <label>메모<input class="text_pole" data-f="note" value="${esc(b.note)}"></label>
                <div class="op-roll-actions op-wide">
                    <button type="button" class="op-btn op-btn-sm" data-a="adj" data-k="bond" data-v="-10">신뢰 −10</button>
                    <button type="button" class="op-btn op-btn-sm" data-a="adj" data-k="bond" data-v="+10">신뢰 +10</button>
                    <button type="button" class="op-btn op-btn-sm" data-a="adj" data-k="love" data-v="-5">설렘 −5</button>
                    <button type="button" class="op-btn op-btn-sm" data-a="adj" data-k="love" data-v="+5">설렘 +5</button>
                    <button type="button" class="op-btn op-btn-sm" data-a="save">저장</button>
                </div>
            </div>
        </details>
    </div>`);
    el.addEventListener('click', async (e) => {
        const a = e.target.closest('[data-a]');
        if (!a || a.disabled) return;
        const act = a.dataset.a;
        if (act === 'meet') { insertInput(`(${b.name}을(를) 찾아간다.) `, false, 'replace'); closePopup(el); }
        if (act === 'call') { insertInput(`(전보벌레로 ${b.name}에게 연락한다.) `, false, 'replace'); closePopup(el); }
        if (act === 'gift') { closePopup(el); setTimeout(() => openActivity({ act: '선물하기', who: b.name }), 200); }
        if (act === 'adj') { await addAdjust([[a.dataset.k, `${b.name} ${a.dataset.v}`]], ''); closePopup(el); setTimeout(() => openBond(b.name), 200); }
        if (act === 'save') {
            const ops = [];
            const rel = el.querySelector('[data-f="rel"]').value.trim(), note = el.querySelector('[data-f="note"]').value.trim();
            if (rel && rel !== b.rel) ops.push(['bond', `${b.name} = ${rel}`]);
            if (note !== b.note) ops.push(['bond', `${b.name} +0 | ${note}`]);
            if (ops.length) await addAdjust(ops, `관계 수정 — ${b.name}`);
            closePopup(el);
        }
    });
    await popup(el, { okButton: '닫기' });
}

// ───────────────────────────── 섬의 지금 (AI) ─────────────────────────────

async function fetchIsle(s, n, btn) {
    const meta = getMeta(true);
    meta.isles ??= {};
    const key = `${s.era}:${n}`;
    if (meta.isles[key]) return meta.isles[key];
    const era = eraOf(s);
    const out = await aiLines('You are an expert on the manga One Piece. Output only the requested format, in Korean.',
        `Island: ${n}. Point in time: ${era.name} (${era.year}). ${CANON_EN[s.canon]}
Describe the island as a traveler would find it AT THIS POINT IN TIME (before/after canon events as appropriate; nothing from the future). If canon says little, invent plausible local color but never invent canon facts.
Output exactly these 4 lines:
분위기: (one sentence)
명물: (food, sight or product)
지금 이곳에: (canon characters plausibly here at this time, or "알려진 인물 없음")
소문: (one hook worth chasing)`, btn, '소문을 모으는 중…');
    const r = { mood: pickLine(out, '분위기'), spec: pickLine(out, '명물'), who: pickLine(out, '지금 이곳에'), rumor: pickLine(out, '소문') };
    if (r.mood || r.rumor) { meta.isles[key] = r; saveMeta(); }
    return r;
}


// ───────────────────────────── 더 보기 메뉴 ─────────────────────────────

async function openMenu() {
    const s = current?.state;
    if (!s?.registered) return openRegister();
    const set = settings();
    const items = [
        set.featBoard && ['board', '📋', '의뢰 게시판'], set.featNews && ['news', '📰', '세계경제신문'],
        set.featMemo && ['memo', '📝', '메모장'], set.featHex && ['hex', '🌀', '해프닝'],
        ['map', '🗺️', '지도'], set.featAlbum && ['album', '📷', '앨범'], ['web', '💞', '관계'], ['sheet', '⚓', '상태창'], ['guide', '🧭', '안내'],
    ].filter(Boolean);
    const el = h(`<div class="op-root op-pop"><h3 class="op-title">⋯ 더 보기</h3>
        <div class="op-acts-grid">${items.map(([k, ico, n]) => `<button type="button" class="op-actbtn" data-k="${k}"><span>${ico}</span><b>${n}</b></button>`).join('')}</div>
        <p class="op-dim op-center">기능은 확장 설정에서 하나씩 끄고 켤 수 있습니다.</p></div>`);
    el.addEventListener('click', (e) => {
        const k = e.target.closest('[data-k]')?.dataset.k;
        if (!k) return;
        closePopup(el);
        const go = { board: openBoard, news: openNews, memo: openMemo, hex: openHex, guide: () => openGuide(), sheet: openSheet, map: () => openSheetTab('map'), album: () => openSheetTab('album'), web: () => openSheetTab('web') }[k];
        setTimeout(go, 200);
    });
    await popup(el, { okButton: '닫기' });
}

// ───────────────────────────── 편지 (뉴스 쿠 우편) ─────────────────────────────
// 보낸 편지: 채팅 메타에 저장(상태 계산과 무관). 받은 편지: AI가 <state> letter: 로 보낸 것 + 내 편지의 답장.

function letterFate() {
    const r = d100();
    if (r <= 12) return { status: 'lost', delay: 0 };
    if (r <= 20) return { status: 'stray', delay: 1 + (r % 2) };
    if (r <= 35) return { status: 'delivered', delay: 1 + (r % 3) };
    return { status: 'delivered', delay: 0 };
}

async function writeReply(s, to, text, stray) {
    const b = fuzzyFind(s.bonds, to);
    const era = eraOf(s);
    const mems = s.memories.filter(m => m.with && nameMatch(m.with, to)).slice(-2).map(m => m.title).join(', ');
    const prompt = stray
        ? `One Piece world, ${era.name}. A News Coo got lost and delivered a letter meant for "${to}" to a random stranger instead (could be a sailor, a Marine, a child, a cook, a grumpy old man, a pirate — pick something fun and era-appropriate).
The letter, from ${s.name}:
"""${text}"""
Write the stranger's short reply letter in Korean (2-5 sentences, letter style, signed with who they are). It can be confused, funny or oddly touching.
Output only:
보낸 사람: (who)
내용: (the reply)`
        : `One Piece role-play, ${era.name} (${era.year}). ${CANON_EN[s.canon]}
${s.name} (${s.factionLabel}${s.rank ? `, ${s.rank}` : ''}) sent a letter by News Coo post to ${to}.
Relationship from ${to}'s side: ${b ? `trust ${b.aff} (-100~100), romantic feeling ${b.love ?? 0} (0~100)${b.rel ? `, relation: ${b.rel}` : ''}${b.note ? `, note: ${b.note}` : ''}` : 'barely know each other'}${mems ? `; shared memories: ${mems}` : ''}.
The letter:
"""${text}"""
Write ${to}'s reply letter in Korean, in their own voice (canon personality and speech if canon). 2-6 sentences, letter style — it can be short, awkward, teasing or warm as fits them and the relationship. No confession unless romantic feeling is 60+. Do not decide anything for ${s.name}.
Output only:
보낸 사람: ${to}
내용: (the reply)`;
    const out = await aiGenerate('You write in-character letters for a One Piece role-play. Output only the requested format, in Korean.', prompt);
    const from = pickLine(out, '보낸 사람') || to;
    const body = (String(out).match(/내용\s*[:：]\s*([\s\S]+)/)?.[1] ?? '').trim();
    return body ? { from, text: body.slice(0, 900) } : null;
}

async function openLetters(preTo) {
    const s = current?.state;
    if (!s?.registered) return openRegister();
    const meta = getMeta(true);
    meta.letters ??= [];
    // 도착한 답장·받은 편지는 연 순간 읽음 처리
    meta.letters.forEach(l => { if (l.reply && l.arrive <= s.day) l.seen = true; });
    meta.mailSeen = s.mail.length;
    saveMeta();
    renderHUD(s);
    const people = [...new Set([...s.crew.map(c => c.name), ...s.bonds.map(b => b.name)])];
    const threads = {};
    for (const l of meta.letters) (threads[l.to] ??= []).push({ kind: 'out', ...l });
    for (const m of s.mail) (threads[m.from] ??= []).push({ kind: 'in', day: m.day, text: m.text, from: m.from });
    const names = Object.keys(threads).sort((a, b) => Math.max(...threads[b].map(x => x.day)) - Math.max(...threads[a].map(x => x.day)));
    const bubble = (x) => {
        if (x.kind === 'in') return `<div class="op-msg op-msg-in"><small>${esc(x.from)} · ${x.day}일차</small><p>${esc(x.text)}</p></div>`;
        const st = x.status === 'lost' ? '<em class="neg">갈매기가 돌아오지 않았다</em>' : x.arrive > s.day ? '<em>날아가는 중… 🕊️</em>' : x.status === 'stray' ? '<em class="warn">엉뚱한 사람에게 갔다</em>' : '<em class="pos">전해짐</em>';
        let out = `<div class="op-msg op-msg-out"><small>나 · ${x.day}일차 · ${st}</small><p>${esc(x.text)}</p></div>`;
        if (x.reply && x.arrive <= s.day) out += `<div class="op-msg op-msg-in"><small>${esc(x.reply.from)} · ${x.arrive}일차</small><p>${esc(x.reply.text)}</p></div>`;
        return out;
    };
    const el = h(`<div class="op-root op-pop">
        <h3 class="op-title">✉️ 뉴스 쿠 우편</h3>
        <p class="op-dim op-center">짧게 써서 갈매기에게 맡기면 상대에게 전해지고 답장이 옵니다. 가끔은 늦게 오고, 엉뚱한 사람에게 가고, 아예 사라지기도 합니다. 주고받은 편지는 AI도 기억합니다.</p>
        <div class="op-letter-new">
            <div class="op-inline"><select class="text_pole" data-f="to">${people.map(n => opt(n, n, n === preTo)).join('')}<option value="__custom">직접 입력</option></select>
                <input class="text_pole ${people.length ? 'op-hidden' : ''}" data-f="toCustom" placeholder="받는 사람"></div>
            <textarea class="text_pole" rows="3" data-f="text" maxlength="600" placeholder="예: 잘 지내? 이번 섬은 고기가 맛있어. 네 생각이 났어."></textarea>
            <div class="op-roll-actions"><button type="button" class="op-btn op-btn-hot" data-a="send"><i class="fa-solid fa-dove"></i> 갈매기에게 맡긴다</button></div>
            <p class="op-center" data-o="res"></p>
        </div>
        <h4 class="op-sub">주고받은 편지</h4>
        <div class="op-threads">${names.map(n => `<details class="op-thread" ${n === preTo || names[0] === n ? 'open' : ''}><summary>${esc(n)} <small>${threads[n].length}통</small></summary>${threads[n].sort((a, b) => a.day - b.day).map(bubble).join('')}</details>`).join('') || '<p class="op-dim">아직 주고받은 편지가 없다.</p>'}</div>
    </div>`);
    const q = (x) => el.querySelector(x);
    if (!people.length) q('[data-f="to"]').value = '__custom';
    el.addEventListener('change', () => q('[data-f="toCustom"]').classList.toggle('op-hidden', q('[data-f="to"]').value !== '__custom'));
    el.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-a="send"]');
        if (!btn || btn.disabled) return;
        const to = q('[data-f="to"]').value === '__custom' ? q('[data-f="toCustom"]').value.trim() : q('[data-f="to"]').value;
        const text = q('[data-f="text"]').value.trim();
        if (!to || !text) return toastr.warning('받는 사람과 내용을 써 주세요.', TITLE);
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 갈매기가 날아가는 중…';
        const fate = letterFate();
        const l = { id: Date.now(), to, text, day: s.day, status: fate.status, arrive: s.day + fate.delay, reply: null, seen: false };
        if (fate.status !== 'lost') {
            try { l.reply = await writeReply(s, to, text, fate.status === 'stray'); } catch (err) { console.warn(LOG, err); }
            if (!l.reply) l.status = 'lost';
        }
        meta.letters.push(l);
        if (meta.letters.length > 30) meta.letters = meta.letters.slice(-30);
        await saveMeta(true);
        refreshNow();
        const msg = l.status === 'lost' ? '갈매기가 바다 너머로 사라졌다. 편지는 닿지 못한 것 같다…'
            : l.arrive > s.day ? `편지는 떠났다. 답장은 ${l.arrive - s.day}일쯤 뒤에 올 것 같다.`
            : l.status === 'stray' ? '답장이 왔다. …그런데 모르는 사람이다?' : `${to}에게서 답장이 왔다!`;
        closePopup(el);
        toastr.info(esc(msg), '✉️ 뉴스 쿠 우편');
        setTimeout(() => openLetters(to), 250);
    });
    await popup(el, { okButton: '닫기' });
}

// ───────────────────────────── 메모장 ─────────────────────────────

const NOTE_KINDS = ['할 일', '오늘의 기록', '메모'];
async function openMemo() {
    const s = current?.state;
    if (!s?.registered) return openRegister();
    const meta = getMeta(true);
    meta.notes ??= [];
    const draw = () => meta.notes.slice().reverse().map(n => `<div class="op-note${n.done ? ' op-done' : ''}" data-id="${n.id}">
        <span class="op-note-k">${esc(n.kind)}</span><p>${esc(n.text)}</p><small>${n.day}일차</small>
        <span class="op-note-acts">
            ${n.kind === '할 일' ? `<button type="button" data-a="done" title="완료">${n.done ? '↺' : '✓'}</button>` : ''}
            <button type="button" data-a="reflect" class="${n.reflect ? 'on' : ''}" title="AI에 반영">${n.reflect ? 'AI 반영 중' : 'AI 미반영'}</button>
            <button type="button" data-a="del" title="지우기">×</button></span></div>`).join('') || '<p class="op-dim">아직 메모가 없다.</p>';
    const el = h(`<div class="op-root op-pop">
        <h3 class="op-title">📝 메모장</h3>
        <p class="op-dim op-center">할 일 · 오늘의 기록 · 메모. "AI 반영"을 켠 메모(최근 6개)만 AI에게 전달됩니다. 끈 메모는 나만 봅니다.</p>
        <div class="op-seg op-seg-sm" data-g="kind">${NOTE_KINDS.map((k, i) => `<button type="button" data-v="${k}" class="${i === 0 ? 'on' : ''}"><b>${k}</b></button>`).join('')}</div>
        <textarea class="text_pole" rows="2" data-f="text" maxlength="300" placeholder="예: 다음 섬에서 조로에게 술 사 주기"></textarea>
        <div class="op-inline op-note-opts">
            <label class="checkbox_label"><input type="checkbox" data-f="reflect" checked> AI에 반영</label>
            ${settings().featAlbum ? '<label class="checkbox_label"><input type="checkbox" data-f="album"> 앨범 추억으로도 남기기</label>' : ''}
            <button type="button" class="op-btn op-btn-hot op-btn-sm" data-a="add">적기</button>
        </div>
        <div class="op-notes" data-o="list">${draw()}</div>
    </div>`);
    let kind = NOTE_KINDS[0];
    el.addEventListener('click', async (e) => {
        const seg = e.target.closest('.op-seg button');
        if (seg) { el.querySelectorAll('.op-seg button').forEach(b => b.classList.toggle('on', b === seg)); kind = seg.dataset.v; return; }
        const a = e.target.closest('[data-a]')?.dataset.a;
        if (!a) return;
        if (a === 'add') {
            const text = el.querySelector('[data-f="text"]').value.trim();
            if (!text) return;
            meta.notes.push({ id: Date.now(), kind, text, reflect: el.querySelector('[data-f="reflect"]').checked, done: false, day: s.day });
            if (meta.notes.length > 20) meta.notes = meta.notes.slice(-20);
            if (el.querySelector('[data-f="album"]')?.checked) await addAdjust([['memory', `${text.slice(0, 24)} | ${text}`]], '');
            el.querySelector('[data-f="text"]').value = '';
        } else {
            const id = Number(e.target.closest('[data-id]')?.dataset.id);
            const n = meta.notes.find(x => x.id === id);
            if (!n) return;
            if (a === 'done') n.done = !n.done;
            if (a === 'reflect') n.reflect = !n.reflect;
            if (a === 'del') meta.notes = meta.notes.filter(x => x !== n);
        }
        await saveMeta();
        refreshNow();
        el.querySelector('[data-o="list"]').innerHTML = draw();
    });
    await popup(el, { okButton: '닫기' });
}

// ───────────────────────────── 해프닝 ─────────────────────────────

async function openHex() {
    const s = current?.state;
    if (!s?.registered) return openRegister();
    const el = h(`<div class="op-root op-pop">
        <h3 class="op-title">🌀 해프닝</h3>
        <p class="op-dim op-center">위대한 항로에선 이상한 일이 일어납니다. 고양이가 되거나, 배가 뒤집히거나, 거울 속의 내가 웃거나. 날짜가 바뀔 때 가끔 저절로 일어나고(설정에서 빈도 조절), 여기서 직접 일으킬 수도 있습니다.</p>
        ${s.hexes.length ? `<h4 class="op-sub">지금 걸려 있는 것</h4>${s.hexes.map(x => `<div class="op-item"><b>🌀 ${esc(x.name)}</b><span>${esc(x.desc)} · ~${x.until}일차</span><button type="button" class="op-x" data-a="lift" data-n="${esc(x.name)}" title="풀기">×</button></div>`).join('')}` : ''}
        <h4 class="op-sub">무작위로 일으키기</h4>
        <div class="op-acts-grid">${['랜덤', ...HEX_KINDS].map(k => `<button type="button" class="op-actbtn" data-kind="${k}"><span>${{ 랜덤: '🎲', 웃김: '🤪', 로맨스: '💘', 공포: '👻', 재난: '🌊', 이상: '🔮' }[k]}</span><b>${k}</b></button>`).join('')}</div>
        <h4 class="op-sub">직접 정하기</h4>
        <div class="op-form-grid">
            <label>이름<input class="text_pole" data-f="name" placeholder="예: 펭귄이 됐다"></label>
            <label>며칠 동안<input type="number" min="0" max="30" class="text_pole" data-f="days" value="1"></label>
            <label class="op-wide">어떤 일인지<input class="text_pole" data-f="desc" placeholder="예: 뒤뚱뒤뚱 걷고 물고기가 맛있어 보인다"></label>
            <button type="button" class="op-btn op-btn-hot op-btn-sm" data-a="custom">일으킨다</button>
        </div>
    </div>`);
    el.addEventListener('click', async (e) => {
        const k = e.target.closest('[data-kind]')?.dataset.kind;
        const a = e.target.closest('[data-a]');
        if (k) {
            const pool = HEXES.filter(x => (k === '랜덤' || x.kind === k) && !s.hexes.some(y => y.name === x.name) && (x.name !== '배가 뒤집혔다' || (s.ship && !s.ship.status)));
            const pick = pool[Math.floor(Math.random() * pool.length)];
            if (!pick) return toastr.info('일으킬 해프닝이 없다.', TITLE);
            await addAdjust([['hex', `+${pick.name}`]], '');
            closePopup(el);
        } else if (a?.dataset.a === 'custom') {
            const nm = el.querySelector('[data-f="name"]').value.trim();
            if (!nm) return toastr.warning('이름을 써 주세요.', TITLE);
            await addAdjust([['hex', `+${nm} | ${el.querySelector('[data-f="days"]').value || 1} | ${el.querySelector('[data-f="desc"]').value.trim()}`]], '');
            closePopup(el);
        } else if (a?.dataset.a === 'lift') {
            await addAdjust([['hex', `-${a.dataset.n}`]], `해프닝 풀림 — ${a.dataset.n}`);
            closePopup(el);
        }
    });
    await popup(el, { okButton: '닫기' });
}

// ───────────────────────────── 안내 ─────────────────────────────

const GUIDE = [
    ['처음이라면', `
        <p><b>원피스 시뮬봇</b>은 대해적시대의 한 사람이 되어 바다를 건너는 이야기입니다. 하고 싶은 행동을 평소처럼 쓰면 됩니다. 숫자는 확장이 계산합니다.</p>
        <ol>
            <li><b>출항</b> — 시대, 진영(루피네·해적·해군·혁명군·세계정부·시민), 소속, 바다, 목표, 캐논 엄격도, 난이도를 고릅니다. 원작 캐릭터로도 할 수 있어요.</li>
            <li><b>행동 쓰기</b> — "술집에서 정보를 캔다", "해군 대령에게 덤빈다"처럼 자유롭게.</li>
            <li><b>📋 의뢰 게시판</b> — 진영에 맞는 일거리가 들어옵니다. 막히면 여기부터.</li>
            <li><b>📰 신문</b> — 세계경제신문. 그 시대의 큰 사건과, 이름이 알려지면 내 기사도 실립니다.</li>
            <li><b>🏝️ 오늘 뭐 하지?</b> — 명물 먹기, 섬 탐험, 낚시, 연회, 함께 시간 보내기, 선물… 막막할 때 누르세요. 직접 써 넣을 수도 있어요.</li>
            <li><b>✉️ 편지</b> — 갈매기에게 맡기면 답장이 옵니다. 가끔 늦거나, 엉뚱한 사람에게 가거나, 사라져요.</li>
            <li><b>⋯ 더 보기</b> — 게시판·신문·📝 메모장·🌀 해프닝·지도·앨범·안내.</li>
            <li><b>🎲 판정</b> — 위험한 행동은 주사위로. 격이 높은 적 앞에선 목표가 확 떨어집니다.</li>
        </ol>
        <p class="op-dim">이 바다는 빡셉니다. 강한 놈은 정말 강하고, 몸은 다치면 안 돌아오고, 붙잡히면 재산을 다 뺏기고 임펠다운에 갑니다. 그래도 낭만은 있습니다.</p>`],
    ['용어 사전', `<dl class="op-dl">
        <dt>격(格)</dt><dd>전투력 등급 1~6. 잡졸 · 루키 · 실력자 · 강자 · 괴물 · 정점. 두 단계 위의 적은 정면으로 이길 수 없다.</dd>
        <dt>악명 · 공적 · 명성 게이지</dt><dd>사건을 일으키면 찬다. 100이 차면 해적·혁명군은 <b>현상금 갱신</b>, 해군·정부는 <b>진급</b>, 시민은 <b>명성 상승</b>.</dd>
        <dt>현상금 · 위험도 ★</dt><dd>현상금이 오를수록 위험도가 오르고 쫓아오는 자가 강해진다. ★1 잔챙이 사냥꾼 → ★5 버스터콜·대장급.</dd>
        <dt>신뢰 · 설렘</dt><dd>인연마다 두 줄. 신뢰(−100~100)는 우정과 믿음, 설렘(0~100)은 연애 감정. 설렘 15 신경 쓰임 → 35 설렘 → 60 사랑 → 85 깊은 사랑. 문턱을 넘으면 작은 장면이 생긴다.</dd>
        <dt>꿈 ⭐</dt><dd>바다에 나선 이유. 진짜 한 걸음을 뗄 때마다 차오르고, 25·50·75·100%에서 이야기가 반응한다.</dd>
        <dt>매력 판정</dt><dd>🎲에서 매력·교섭을 고르면 상대를 정할 수 있다. 아직 낯선 사이면 목표가 크게 깎이고, 마음이 있으면 오른다. 고백은 설렘 60 전엔 아주 어렵다.</dd>
        <dt>해프닝</dt><dd>가끔 일어나는 이상한 일. 고양이가 되거나, 배가 뒤집히거나, 거울 속 내가 웃거나. 며칠 지나면 풀린다.</dd>
        <dt>메모장</dt><dd>할 일·오늘의 기록·메모. "AI 반영"을 켠 것만 AI가 읽는다.</dd>
        <dt>앨범</dt><dd>추억(함께한 장면), 발견(명물·비경·생물·전설·보물), 상륙한 섬. 처음 상륙한 섬은 첫인상 장면이 나온다.</dd>
        <dt>명성</dt><dd>무명 → 소문 → 신문 단신 → 신문 1면 → 세계적 유명인 → 전설.</dd>
        <dt>악마의 열매</dt><dd>먹으면 능력을 얻는 대신 헤엄칠 수 없다. 해루석에 닿으면 힘이 빠진다.</dd>
        <dt>패기</dt><dd>견문색(기척·예지) · 무장색(단단함·능력자 타격) · 패왕색(왕의 자질, 극소수).</dd>
        <dt>부상 · 영구 손상</dt><dd>부상은 쉬면 낫는다. 영구 손상(눈·손가락·팔 등)은 평생 판정에 불이익.</dd>
        <dt>수감</dt><dd>붙잡히면 재산·소지품·배를 몰수당하고 해루석 수갑을 찬다. 탈옥 판정을 하거나, 형기를 견디며 시간을 건너뛴다.</dd>
        <dt>회귀</dt><dd>표준 난이도에서 죽으면 마지막으로 도착했던 섬으로 돌아간다. 기억은 나만 가진다.</dd>
        <dt>캐논 엄격도</dt><dd>자유=원작을 바꿀 수 있음 · 보통=개입하면 바뀜 · 엄격=원작 고정, 나는 틈에서 움직인다.</dd>
    </dl>`],
    ['상태 읽는 법', `
        <p><b>♥ 체력</b> 0이면 빈사 → <b>생존 판정</b>. 실패하면 사망(표준=회귀 가능, 하드코어=끝).</p>
        <p><b>게이지</b> 악명/공적/명성. 100마다 현상금·진급·명성이 오른다.</p>
        <p><b>฿ 현상금 · ★ 위험도</b> <span class="op-dim">0 · 1 · 5,000만 · 2억 · 10억 · 30억에서 ★이 하나씩.</span></p>
        <p><b>격</b> <span class="op-dim">적과의 격 차이 × 12가 힘·기술·민첩·의지 판정에 더해진다(최대 −48).</span></p>
        <p><b>판정</b> <span class="op-dim">1~100. 목표 이하 성공, 목표의 1/5 이하 대성공, 96 이상(중상이면 91 이상) 대실패.</span></p>
        <p><b>보정</b> <span class="op-dim">특기 +10 · 패기 · 열매 +8 · 중상 −15 · 부상당 −5 · 신체 손상 · 해루석 −25 · 얼굴이 알려짐(★3) 은신 −10.</span></p>`],
    ['진행 팁', `
        <ul>
            <li>지도에서 섬 옆 👂 버튼을 누르면 그 시대 그 섬의 분위기·명물·지금 있는 원작 인물·소문을 알려 줍니다.</li>
            <li>상태창의 인연 칩이나 시트 › 관계에서 이름을 누르면 신뢰·설렘·함께한 추억을 보고 만나러 가거나 선물할 수 있어요.</li>
            <li>막히면 📋 게시판이나 📰 신문을 열어 보세요. 신문 기사를 누르면 그 소식을 따라갈 수 있어요.</li>
            <li>격이 두 단계 위인 적과는 싸우지 말고 도망치거나 머리를 쓰세요. 진짜로 죽습니다.</li>
            <li>새 섬에 도착할 때마다 자동으로 회귀 지점이 생깁니다.</li>
            <li>수감되면 상태창에서 「탈옥 시도」 또는 「형기를 견딘다」(타임스킵)를 고르세요.</li>
            <li>2년 수련 같은 시간 건너뛰기는 시트 › 관리 › 타임스킵.</li>
            <li>숫자가 이상하면 해당 AI 메시지를 수정·스와이프하세요. 자동으로 다시 계산됩니다.</li>
            <li>모바일에서는 상태창의 이름을 누르면 한 줄로 접힙니다.</li>
        </ul>`],
];
function guideHTML(start = 0) {
    return `<div class="op-guide">
        <div class="op-tabs op-tabs-guide">${GUIDE.map(([n], i) => `<button type="button" data-g="${i}" class="${i === start ? 'on' : ''}">${n}</button>`).join('')}</div>
        ${GUIDE.map(([, body], i) => `<div class="op-guide-p${i === start ? '' : ' op-hidden'}" data-gp="${i}">${body}</div>`).join('')}
    </div>`;
}
function bindGuide(root) {
    root.addEventListener('click', (e) => {
        const b = e.target.closest('[data-g]');
        if (!b || !b.closest('.op-guide')) return;
        const box = b.closest('.op-guide');
        box.querySelectorAll('[data-g]').forEach(x => x.classList.toggle('on', x === b));
        box.querySelectorAll('[data-gp]').forEach(p => p.classList.toggle('op-hidden', p.dataset.gp !== b.dataset.g));
    });
}
async function openGuide(start = 0) {
    const el = h(`<div class="op-root op-pop"><h3 class="op-title">🧭 안내</h3>${guideHTML(start)}</div>`);
    bindGuide(el);
    await popup(el, { okButton: '닫기' });
}

// ───────────────────────────── 지도 ─────────────────────────────

// 그림 지도: 레드라인(세로) × 위대한 항로(가로), 네 바다, 섬 점, 지나온 항로, 지금 위치의 배
const MAP_BOX = { north: [40, 40, 400, 190], east: [560, 40, 400, 190], west: [40, 380, 400, 190], south: [560, 380, 400, 190] };
function islePos(sea, k, n) {
    if (sea.id === 'redline') return [500, k === 0 ? 248 : 352];
    if (sea.id === 'paradise' || sea.id === 'newworld') {
        const [x0, x1] = sea.id === 'paradise' ? [44, 462] : [540, 972];
        return [x0 + (x1 - x0) * (n === 1 ? .5 : k / (n - 1)), 300 + [-20, 0, 20][k % 3]];
    }
    const [x, y, w, hh] = MAP_BOX[sea.id];
    const cols = 3, rows = Math.ceil(n / cols);
    return [x + ((k % cols) + .5) * (w / cols) + (Math.floor(k / cols) % 2 ? 22 : -22), y + (Math.floor(k / cols) + .5) * (hh / rows)];
}
const ISLE_XY = new Map(SEAS.flatMap(sea => sea.islands.map((i, k) => [i.n, islePos(sea, k, sea.islands.length)])));

function mapHTML(s) {
    const here = islandOf(s.loc);
    const route = s.visited.map(v => ISLE_XY.get(v.n)).filter(Boolean);
    const seaLabel = { north: [240, 26], east: [760, 26], west: [240, 592], south: [760, 592], paradise: [250, 250], newworld: [756, 250] };
    const dots = SEAS.flatMap(sea => sea.islands.map(i => {
        const [x, y] = ISLE_XY.get(i.n);
        const v = s.visited.some(x => x.n === i.n), cur = here?.n === i.n;
        const cast = (ERA_CAST[eraOf(s).id] ?? []).some(c => c[1] === i.n);
        return `<g class="op-mdot${v ? ' v' : ''}${cur ? ' cur' : ''}" data-a="isle" data-n="${esc(i.n)}" style="--c:${sea.color}">
            <title>${esc(i.n)}</title><circle cx="${x}" cy="${y}" r="13" class="hit"/>
            <circle cx="${x}" cy="${y}" r="${cur ? 7 : 5}"/>${cast ? `<circle cx="${x + 7}" cy="${y - 7}" r="2.6" class="cast"/>` : ''}
            ${cur ? `<text x="${x}" y="${y + 24}">${esc(i.n.split(' · ')[0])}</text>` : ''}</g>`;
    })).join('');
    const ship = here ? (() => { const [x, y] = ISLE_XY.get(here.n); return `<circle cx="${x}" cy="${y}" r="12" class="op-mpulse"/><text x="${x}" y="${y - 12}" class="op-mship">⛵</text>`; })() : '';
    return `<div class="op-svgmap"><svg viewBox="0 0 1000 620" role="img" aria-label="세계 지도">
        <defs><linearGradient id="opsea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#173452"/><stop offset="1" stop-color="#0b1a2b"/></linearGradient></defs>
        <rect width="1000" height="620" fill="url(#opsea)"/>
        <rect x="0" y="262" width="1000" height="76" fill="#e8b33a" opacity=".09"/>
        <line x1="0" y1="262" x2="1000" y2="262" class="op-mbelt"/><line x1="0" y1="338" x2="1000" y2="338" class="op-mbelt"/>
        <rect x="484" y="0" width="32" height="620" class="op-mred"/><rect x="0" y="0" width="12" height="620" class="op-mred"/>
        <text x="500" y="610" class="op-mlab op-mlab-red">레드라인</text><text x="18" y="356" class="op-mlab op-mlab-sm" style="text-anchor:start">◂ 리버스 마운틴</text>
        <text x="740" y="356" class="op-mlab op-mlab-sm">— 칼름벨트 —</text>
        ${Object.entries(seaLabel).map(([id, [x, y]]) => { const sea = SEAS.find(z => z.id === id); return `<text x="${x}" y="${y}" class="op-mlab" data-a="sea" data-n="${id}" style="fill:${sea.color}">${sea.name} <tspan class="op-mcount">${sea.islands.filter(i => s.visited.some(v => v.n === i.n)).length}/${sea.islands.length}</tspan></text>`; }).join('')}
        ${route.length > 1 ? `<polyline points="${route.map(p => p.join(',')).join(' ')}" class="op-mroute"/>` : ''}
        ${dots}${ship}
    </svg></div>
    <div class="op-map-info" data-o="sea">${here ? isleInfo(here, s) : '<p class="op-dim op-center">섬을 누르면 정보가, 바다 이름을 누르면 섬 목록이 보입니다.</p>'}</div>
    <p class="op-dim">● 금색 = 상륙한 섬 · 작은 점 = 이 시대에 원작 인물이 있는 섬 · 점선 = 지나온 항로. 위대한 항로는 로그 포스 없이는 항해할 수 없고, 양옆 칼름벨트엔 바람이 없고 해왕류가 산다. 레드라인은 어인섬(해저)이나 마리조아(위)로 넘는다.</p>`;
}
function castHTML(s, n) {
    const cast = (ERA_CAST[eraOf(s).id] ?? []).filter(c => c[1] === n);
    return cast.length ? `<div class="op-cast">${cast.map(([nm, , st]) => `<span>👤 ${esc(nm)} <small>${esc(st)}</small></span>`).join('')}</div>` : '';
}
function isleInfo(i, s) {
    const r = getMeta()?.isles?.[`${s.era}:${i.n}`];
    const v = s.visited.find(x => x.n === i.n);
    return `<div class="op-sea" style="--c:${i.sea.color}">
        <div class="op-sea-head"><b>${esc(i.n)}</b> <small class="op-dim">${esc(i.sea.name)}${v ? ` · ✓ ${v.day}일차 상륙` : ''}</small></div>
        <p>${esc(i.d)}</p>${castHTML(s, i.n)}
        <div class="op-rumor" data-o="rumor-${esc(i.n)}">${r ? rumorHTML(r) : ''}</div>
        <div class="op-roll-actions">
            ${settings().featRumor ? `<button type="button" class="op-btn op-btn-sm" data-a="rumor" data-n="${esc(i.n)}"><i class="fa-solid fa-ear-listen"></i> 이 시대의 소문</button>` : ''}
            <button type="button" class="op-btn op-btn-sm op-btn-hot" data-a="goto" data-n="${esc(i.n)}"><i class="fa-solid fa-sailboat"></i> 이곳으로 향한다</button>
            <button type="button" class="op-btn op-btn-sm" data-a="sea" data-n="${i.sea.id}">${esc(i.sea.name)} 목록</button>
        </div></div>`;
}
function seaInfo(sea, here, s) {
    const meta = getMeta();
    return `<div class="op-sea" style="--c:${sea.color}">
        <div class="op-sea-head"><b>${sea.name}</b></div>
        <p>${esc(sea.desc)}</p>
        <div class="op-isles">${sea.islands.map(i => {
            const v = s?.visited.some(x => x.n === i.n);
            const r = meta?.isles?.[`${s?.era}:${i.n}`];
            return `<div class="op-isle${here?.n === i.n ? ' here' : ''}${v ? ' op-visited' : ''}">
            <div><b>${v ? '✓ ' : ''}${esc(i.n)}</b>${here?.n === i.n ? ' <span class="op-pin">● 현재</span>' : ''}<small>${esc(i.d)}</small>${s ? castHTML(s, i.n) : ''}
                <div class="op-rumor" data-o="rumor-${esc(i.n)}">${r ? rumorHTML(r) : ''}</div></div>
            ${settings().featRumor ? `<button type="button" class="op-btn op-btn-sm" data-a="rumor" data-n="${esc(i.n)}" title="이 시대의 이 섬 — 분위기·명물·인물·소문 (AI)"><i class="fa-solid fa-ear-listen"></i></button>` : ''}
            <button type="button" class="op-btn op-btn-sm" data-a="goto" data-n="${esc(i.n)}" title="이곳으로 향한다"><i class="fa-solid fa-sailboat"></i></button></div>`;
        }).join('')}</div>
    </div>`;
}

const rumorHTML = (r) => `<p><span>분위기</span>${esc(r.mood)}</p><p><span>명물</span>${esc(r.spec)}</p><p><span>지금 이곳에</span>${esc(r.who)}</p><p><span>소문</span>${esc(r.rumor)}</p>`;

function albumHTML(s) {
    const byKind = {};
    for (const f of s.finds) (byKind[f.kind || '기타'] ??= []).push(f);
    return `<h4 class="op-sub">📷 추억 ${s.memories.length}</h4>
        ${s.memories.length ? `<div class="op-album">${s.memories.slice().reverse().map(m => `<div class="op-photo"><b>${esc(m.title)}</b><span>${esc(m.desc)}</span><small>${m.day}일차 · ${esc(m.loc || '')}${m.with ? ` · ${esc(m.with)}` : ''}</small></div>`).join('')}</div>` : '<p class="op-dim">기억해 둘 만한 장면이 생기면 AI가 여기에 남깁니다. 「오늘 뭐 하지? › 일기 쓰기」로 직접 남겨도 돼요.</p>'}
        <h4 class="op-sub">🧭 발견 ${s.finds.length}</h4>
        ${s.finds.length ? Object.entries(byKind).map(([k, l]) => `<p class="op-findrow"><span>${esc(k)}</span>${l.map(f => `<em title="${esc(`${f.desc} — ${f.day}일차 ${f.loc}`)}">${esc(f.name)}</em>`).join('')}</p>`).join('') : '<p class="op-dim">명물 요리, 비경, 생물, 전설, 보물… 처음 본 것이 여기에 모입니다.</p>'}
        <h4 class="op-sub">⚓ 상륙한 섬 ${s.visited.length}/${islandList.length}</h4>
        <div class="op-chips">${s.visited.map(v => `<span class="op-chip">✓ ${esc(v.n)} <small>${v.day}일차</small></span>`).join('') || '<span class="op-dim">아직 없다.</span>'}</div>
        <details class="op-edit"><summary>직접 남기기</summary>
            <div class="op-form-grid">
                <label>종류<select class="text_pole" data-f="alKind">${opt('memory', '추억')}${FIND_KINDS.map(k => opt(k, `발견 · ${k}`)).join('')}</select></label>
                <label>제목·이름<input class="text_pole" data-f="alName" placeholder="예: 첫 연회"></label>
                <label>한 줄<input class="text_pole" data-f="alDesc" placeholder="예: 다 같이 고기를 굽고 노래했다"></label>
                <label>함께한 사람 (추억)<input class="text_pole" data-f="alWith" placeholder="예: 루피"></label>
                <button type="button" class="op-btn op-btn-sm op-btn-hot" data-a="aladd">남기기</button>
            </div>
        </details>`;
}

// ───────────────────────────── 관계도 ─────────────────────────────

const affLabelBase = (b) => b.rel || (b.aff >= 80 ? '특별' : b.aff >= 50 ? '신뢰' : b.aff >= 20 ? '호감' : b.aff > -20 ? '안면' : b.aff > -60 ? '경계' : '적대');
const affLabel = (b) => affLabelBase(b);
const affTone = (b) => (b.love >= 35 ? '#ff7fa8' : 0) || (/연인|약혼|부부/.test(b.rel) ? '#ff7fa8' : b.aff >= 50 ? '#7fd1b9' : b.aff >= 20 ? '#e8b33a' : b.aff > -20 ? '#b8ad97' : '#ff6a5a');


// ───────────────────────────── 상태 시트 ─────────────────────────────

async function openSheetTab(tab) {
    const p = openSheet();
    setTimeout(() => document.querySelector(`dialog .op-sheet [data-tab="${tab}"]`)?.click(), 60);
    return p;
}

async function openSheet() {
    if (!isActive()) return toastr.info(`${TITLE} 카드가 열린 채팅에서만 사용할 수 있습니다.`, TITLE);
    const s = current?.state;
    if (!s?.registered) return openRegister();
    const era = eraOf(s);
    const d = dangerOf(s.bounty);
    const f = factionOf(s.faction);
    const tabs = [['stat', '상태'], ['web', '관계'], ['map', '지도'], settings().featAlbum && ['album', '앨범'], ['power', '능력'], ['inv', '소지품·배'], ['log', '항해일지'], ['help', '안내'], ['admin', '관리']].filter(Boolean);
    const el = h(`<div class="op-root op-pop op-sheet">
        <div class="op-sheet-head">
            ${s.bounty ? wantedHTML(s, s.bounty) : `<div class="op-seal" style="--c:${f.color}">${esc(s.name.slice(0, 1))}</div>`}
            <div><h3>${esc(s.name)}</h3>
                <small><span style="color:${f.color}">${esc(s.factionLabel)}</span>${s.affil ? ` · ${esc(s.affil)}` : ''}${s.rank ? ` · ${esc(s.rank)}` : ''}</small>
                <small>${esc([s.race, s.style, s.origin && `${s.origin} 출신`].filter(Boolean).join(' · '))}</small>
                <small>${s.day}일차 ${esc(s.time)} · ${esc(s.loc || '—')} · ${berry(s.cash)}</small></div>
        </div>
        <div class="op-tabs">${tabs.map(([k, n], i) => `<button type="button" data-tab="${k}" class="${i === 0 ? 'on' : ''}">${n}</button>`).join('')}</div>
        <section data-p="stat">
            <div class="op-bars">${bar('hp', '체력', s.hp, 100, s.hp <= 30 ? '중상' : '')}${bar('heat', heatName(s), s.heat, 100, '')}</div>
            <div class="op-pills">
                <span class="op-pill op-pill-bounty">฿ ${s.bounty ? esc(berry(s.bounty)) : '현상금 없음'}</span>
                <span class="op-pill op-pill-danger" data-d="${d}">${stars(d)} ${DANGER_NAME[d]}</span>
                <span class="op-pill">명성 ${esc(fameTitle(s.fame))} <small>${s.fame}/100</small></span>
                <span class="op-pill op-tier op-tier-${s.tier}">격 ${TIER[s.tier]}</span>
            </div>
            ${s.dream?.text ? `<div class="op-dream"><b>⭐ 꿈</b><span>${esc(s.dream.text)}</span><div class="op-bar-track"><i style="width:${s.dream.pct}%"></i></div><em>${s.dream.pct}%</em></div>` : ''}
            ${d ? `<p class="op-dim">추격: ${esc(HUNT_KO[d])}</p>` : ''}
            <p class="op-dim">${esc(era.name)} (${esc(era.year)}) · 캐논 ${esc(CANON.find(c => c.id === s.canon)?.name ?? '')} · 난이도 ${esc(DIFFICULTY.find(x => x.id === s.diff)?.name ?? '')}${s.goals.length ? ` · 목표: ${esc(s.goals.join(', '))}` : ''}</p>
            ${s.case ? `<p><b>의뢰</b> ${esc(s.case)}</p>` : ''}
            ${s.foe ? `<p><b>교전</b> ${esc(s.foe.name)} — 격 ${TIER[s.foe.tier]} · ${s.foe.pct}% ${esc(s.foe.note)}</p>` : ''}
            ${s.prison ? `<p class="op-warn"><b>수감</b> ${esc(s.prison.place)}${s.prison.level ? ` ${IMPEL[s.prison.level - 1].lv} ${IMPEL[s.prison.level - 1].name}` : ''} · ${s.prison.since}일차부터</p>` : ''}
            <h4 class="op-sub">부상 · 신체 손상</h4>
            ${s.wounds.map(w => `<div class="op-item"><b>✚ ${esc(w.name)}</b><span>${esc(w.desc)}</span><button type="button" class="op-x" data-a="heal" data-n="${esc(w.name)}" title="나았다">✓</button></div>`).join('')}
            ${s.maims.map(m => `<div class="op-item op-item-maim"><b>✖ ${esc(m.name)}</b><span>${esc(m.desc)}</span></div>`).join('')}
            ${!s.wounds.length && !s.maims.length ? '<p class="op-dim">아직 몸은 멀쩡하다.</p>' : ''}
            <details class="op-edit"><summary>수치 직접 고치기</summary>
                <div class="op-form-grid">
                    ${[['hp', '체력', s.hp], ['cash', '베리', s.cash], ['bounty', '현상금', s.bounty], ['heat', heatName(s), s.heat], ['fame', '명성', s.fame], ['tier', '격 (1-6)', s.tier], ['day', '일차', s.day]].map(([k, n, v]) => `<label>${n}<input type="number" class="text_pole" data-e="${k}" value="${v}"></label>`).join('')}
                    <label>시간대<select class="text_pole" data-e="time">${TIMES.map(t => opt(t, t, t === s.time)).join('')}</select></label>
                    <label>모드<select class="text_pole" data-e="mode">${Object.keys(MODES).map(t => opt(t, t, t === s.mode)).join('')}</select></label>
                    <label class="op-wide">장소<input class="text_pole" data-e="loc" value="${esc(s.loc)}"></label>
                    <label class="op-wide">직책 · 계급<input class="text_pole" data-e="rank" value="${esc(s.rank)}"></label>
                    <button type="button" class="op-btn op-btn-hot" data-a="apply">적용</button>
                </div>
                <p class="op-dim">게이지를 100 이상으로 올리면 현상금·진급이 바로 처리됩니다. 격은 한 번에 한 단계만 바뀝니다.</p>
            </details>
        </section>
        <section data-p="power" class="op-hidden">
            <div class="op-item"><b>격 ${TIER[s.tier]}</b><span>${esc(TIER_HELP[s.tier])}</span></div>
            <h4 class="op-sub">악마의 열매</h4>
            ${s.fruit ? `<div class="op-item op-item-fruit"><b>${esc(s.fruit.name)}</b><span>${esc(s.fruit.type)}${s.fruit.desc ? ` — ${esc(s.fruit.desc)}` : ''}</span></div><p class="op-dim">헤엄칠 수 없다. 바닷물·해루석에 닿으면 힘이 빠진다.${s.seastone ? ' <b class="neg">지금 해루석에 묶여 있다.</b>' : ''}</p>` : '<p class="op-dim">먹지 않았다. 바다는 아직 당신을 받아 준다.</p>'}
            <h4 class="op-sub">패기</h4>
            <div class="op-haki">${['견문', '무장', '패왕'].map(k => `<div class="op-haki-i${k === '패왕' && !s.conqueror && !s.haki.패왕 ? ' op-off' : ''}"><b>${k}색</b><span>${'●'.repeat(s.haki[k] ?? 0)}${'○'.repeat(3 - (s.haki[k] ?? 0))}</span><small>${(s.haki[k] ?? 0) ? ['', '기초', '숙련', '극의'][s.haki[k]] : k === '패왕' ? (s.conqueror ? '잠든 왕의 자질' : '자질 없음') : '미각성'}</small></div>`).join('')}</div>
            <p class="op-dim">패기는 이야기 속 각성(<code>haki: 무장 +1</code>)으로만 오릅니다. 특기 「${esc(s.style || '없음')}」은 해당 판정 +10.</p>
        </section>
        <section data-p="inv" class="op-hidden">
            <h4 class="op-sub">배</h4>
            ${s.ship ? `<div class="op-item"><b><i class="fa-solid fa-sailboat"></i> ${esc(s.ship.name)}</b><span>${esc(s.ship.kind || '')} 선체 ${s.ship.hull}%${s.ship.status ? ` · <b class="neg">${esc(s.ship.status)}</b>` : ''}</span></div>
                ${s.ship.parts?.length ? `<div class="op-chips">${s.ship.parts.map(x => `<span class="op-chip" title="${esc(SHIP_PARTS.find(y => y.name === x)?.desc ?? '')}">🔧 ${esc(x)}</span>`).join('')}</div>` : ''}` : '<p class="op-dim">배가 없다.</p>'}
            ${s.prison ? '' : ['marine', 'government'].includes(s.faction) && !isOutlaw(s) ? '<p class="op-dim">함선은 소속에서 배정됩니다. 개인 배는 필요 없다.</p>' : `<details class="op-edit"><summary>조선소 — 배 사기 · 개조하기</summary>
                ${s.ship && !s.ship.status ? `<h4 class="op-sub">개조</h4><div class="op-shop">${SHIP_PARTS.filter(x => !s.ship.parts?.includes(x.name)).map(x => `<div class="op-item"><b>${esc(x.name)}</b><span>${esc(x.desc)}</span><button type="button" class="op-btn op-btn-sm" data-a="buypart" data-i="${SHIP_PARTS.indexOf(x)}" ${s.cash < x.price ? 'disabled' : ''}>${esc(korNum(x.price))}</button></div>`).join('')}</div>` : ''}
                <h4 class="op-sub">새 배</h4><div class="op-shop">${SHIPS.map((x, i) => `<div class="op-item"><b>${esc(x.name)}</b><span>${esc(x.desc)}</span><button type="button" class="op-btn op-btn-sm" data-a="buyship" data-i="${i}" ${s.cash < x.price ? 'disabled' : ''}>${esc(korNum(x.price))}</button></div>`).join('')}</div>
                ${s.ship && !s.ship.status ? '<div class="op-inline"><input class="text_pole" data-f="partCustom" placeholder="개조 직접 입력 — 예: 미니 수영장"><button type="button" class="op-btn op-btn-sm" data-a="partcustom">달기</button></div>' : ''}
                <p class="op-dim">새 배를 사면 지금 배는 놓고 갑니다(개조도 사라짐). 직접 입력한 개조는 돈이 들지 않으니 이야기에 맞게 쓰세요.</p></details>`}
            <h4 class="op-sub">소지품 · ${berry(s.cash)}</h4>
            ${s.items.length ? s.items.map(i => `<div class="op-item"><b>${esc(i.name)}</b><span>×${i.qty}</span>
                <span class="op-mini"><button type="button" data-a="use" data-n="${esc(i.name)}" title="하나 쓰기">−</button><button type="button" data-a="addone" data-n="${esc(i.name)}" title="하나 추가">+</button></span></div>`).join('') : '<p class="op-dim">빈손이다.</p>'}
            <div class="op-inline"><input class="text_pole" data-f="itemCustom" placeholder="소지품 직접 추가 — 예: 비브르 카드"><input type="number" min="1" class="text_pole op-num" data-f="itemQty" value="1"><button type="button" class="op-btn op-btn-sm" data-a="itemcustom">추가</button></div>
            <h4 class="op-sub">항구 상점</h4>
            ${s.prison ? '<p class="op-dim">감옥 안에서는 살 수 없다.</p>' : `<div class="op-shop">${SHOP.map((x, i) => `<div class="op-item"><b>${esc(x.name)}${x.qty > 1 ? ` ×${x.qty}` : ''}</b><span>${esc(x.desc)}</span>
                <button type="button" class="op-btn op-btn-sm" data-a="buy" data-i="${i}" ${s.cash < x.price ? 'disabled' : ''}>${esc(korNum(x.price))}</button></div>`).join('')}</div>`}
        </section>
        <section data-p="map" class="op-hidden">${mapHTML(s)}</section>
        <section data-p="album" class="op-hidden">${albumHTML(s)}</section>
        <section data-p="web" class="op-hidden">
            <h4 class="op-sub">동료 ${s.crew.length}/${CAP.crew}</h4>
            ${s.crew.length ? s.crew.map(c => `<div class="op-item"><b>${esc(c.name)}</b><span>${esc(c.role)}${c.status ? ` · <b class="neg">${esc(c.status)}</b>` : ''}</span>${c.status ? `<button type="button" class="op-x" data-a="regroup" data-n="${esc(c.name)}" title="다시 모였다">✓</button>` : ''}</div>`).join('') : '<p class="op-dim">아직 혼자다.</p>'}
            <h4 class="op-sub">인연 ${s.bonds.length}/${CAP.bonds}</h4>
            ${s.bonds.length ? topBonds(s, CAP.bonds).map(b => `<div class="op-item op-click" data-a="bondview" data-n="${esc(b.name)}"><b style="color:${affTone(b)}">${b.love >= 15 ? '♥' : '♡'} ${esc(b.name)}</b><span>${esc(b.rel ? `${b.rel} · ` : '')}신뢰 ${b.aff >= 0 ? '+' : ''}${b.aff}${b.love ? ` · 설렘 ${b.love} ${LOVE_NAME[loveStage(b.love)]}` : ''} ${esc(b.note)}</span><span class="op-dim">›</span></div>`).join('') : '<p class="op-dim">이야기 속에서 이름을 알게 된 사람이 여기에 남습니다.</p>'}
            ${s.mail.length ? `<h4 class="op-sub">받은 편지</h4>${s.mail.slice().reverse().map(m => `<div class="op-item"><b>✉️ ${esc(m.from)}</b><span>${m.day}일차 · ${esc(m.text.slice(0, 60))}${m.text.length > 60 ? '…' : ''}</span></div>`).join('')}` : ''}
        </section>
        <section data-p="log" class="op-hidden">
            <h4 class="op-sub">항해일지</h4>
            ${s.deaths.length ? `<p class="op-warn">사망 ${s.deaths.length}회 · 회귀 ${s.rewinds}회 — ${s.deaths.map(x => `${x.day}일차 ${esc(x.loc)}`).join(' / ')}</p>` : ''}
            <div class="op-log">${s.log.slice().reverse().map(l => `<div><span>${l.day}일차</span>${esc(l.text)}</div>`).join('')}</div>
        </section>
        <section data-p="help" class="op-hidden">${guideHTML(0)}</section>
        <section data-p="admin" class="op-hidden">
            <button type="button" class="op-btn" data-a="undo"><i class="fa-solid fa-rotate-left"></i> 마지막 수동 조정 되돌리기</button>
            <button type="button" class="op-btn" data-a="editprof"><i class="fa-solid fa-pen"></i> 출항 설정 수정 (시대·캐논·난이도 포함)</button>
            <button type="button" class="op-btn" data-a="skip"><i class="fa-solid fa-hourglass-half"></i> 타임스킵</button>
            <button type="button" class="op-btn op-btn-hot" data-a="reset"><i class="fa-solid fa-skull-crossbones"></i> 새 항해 (이 채팅 초기화)</button>
            <p class="op-dim">회귀 지점 ${s.checkpoints.length}개 · 수동 조정 ${getMeta()?.adjust?.length ?? 0}건. AI 응답의 상태 변화는 메시지를 수정·삭제·스와이프하면 자동으로 다시 계산됩니다.</p>
        </section>
    </div>`);
    bindGuide(el);
    const close = () => closePopup(el);
    el.addEventListener('click', async (e) => {
        const tab = e.target.closest('[data-tab]');
        if (tab) {
            el.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('on', b === tab));
            el.querySelectorAll('section[data-p]').forEach(p => p.classList.toggle('op-hidden', p.dataset.p !== tab.dataset.tab));
            return;
        }
        const b = e.target.closest('[data-a]');
        if (!b || b.disabled) return;
        const a = b.dataset.a;
        const { Popup, POPUP_RESULT } = ctx();
        if (a === 'apply') {
            const ops = [];
            for (const k of ['hp', 'cash', 'bounty', 'heat', 'fame', 'tier', 'day']) {
                const v = Number(el.querySelector(`[data-e="${k}"]`).value);
                if (!Number.isNaN(v) && v !== s[k]) ops.push([k, String(v)]);
            }
            for (const k of ['time', 'mode', 'loc', 'rank']) {
                const v = el.querySelector(`[data-e="${k}"]`).value.trim();
                if (v && v !== s[k]) ops.push([k, v]);
            }
            if (!ops.length) return toastr.info('바뀐 값이 없다.');
            await addAdjust(ops, '수동 조정');
            close(); toastr.success('적용했다.', TITLE);
        }
        if (a === 'heal') { await addAdjust([['wound', `-${b.dataset.n}`]], `회복 — ${b.dataset.n}`); close(); setTimeout(openSheet, 200); }
        if (a === 'regroup') {
            const c = fuzzyFind(s.crew, b.dataset.n);
            await addAdjust([['crew', `+${b.dataset.n}${c?.role ? ` | ${c.role}` : ''}`]], `재회 — ${b.dataset.n}`);
            close(); setTimeout(() => openSheetTab('web'), 200);
        }
        if (a === 'bondview') { close(); setTimeout(() => openBond(b.dataset.n), 200); return; }
        if (a === 'rumor') {
            const box = el.querySelector(`[data-o="rumor-${CSS.escape(b.dataset.n)}"]`);
            const r = await fetchIsle(s, b.dataset.n, b);
            if (box && (r.mood || r.rumor)) box.innerHTML = rumorHTML(r);
            else if (box) box.innerHTML = '<p class="op-dim">소문을 듣지 못했다. (생성 실패)</p>';
            return;
        }
        if (a === 'sea') {
            const sea = SEAS.find(x => x.id === b.dataset.n);
            el.querySelector('[data-o="sea"]').innerHTML = seaInfo(sea, islandOf(s.loc), s);
            return;
        }
        if (a === 'isle') {
            const i = islandList.find(x => x.n === b.dataset.n);
            if (i) el.querySelector('[data-o="sea"]').innerHTML = isleInfo(i, s);
            el.querySelectorAll('.op-mdot').forEach(d => d.classList.toggle('sel', d === b));
            return;
        }
        if (a === 'buyship') {
            const x = SHIPS[Number(b.dataset.i)];
            if (s.cash < x.price) return toastr.warning('베리가 모자라다.', TITLE);
            const name = (await ctx().Popup.show.input?.('새 배 이름', `${x.name}의 이름을 지어 주세요.`, s.ship?.name ?? '')) || x.name;
            await addAdjust([['cash', `-${x.price}`], ['_newship', `${name} | ${x.name}`]], `배 구입 — ${name} (${x.name})`);
            close(); setTimeout(() => openSheetTab('inv'), 200); return;
        }
        if (a === 'buypart') {
            const x = SHIP_PARTS[Number(b.dataset.i)];
            if (s.cash < x.price) return toastr.warning('베리가 모자라다.', TITLE);
            await addAdjust([['cash', `-${x.price}`], ['upgrade', `+${x.name}`]], `배 개조 — ${x.name}`);
            close(); setTimeout(() => openSheetTab('inv'), 200); return;
        }

        if (a === 'goto') { insertInput(`(${b.dataset.n}(으)로 향한다.) `, false, 'replace'); close(); return; }
        if (a === 'buy') {
            const x = SHOP[Number(b.dataset.i)];
            if (s.cash < x.price) return toastr.warning('베리가 모자라다.', TITLE);
            await addAdjust([['cash', `-${x.price}`], ['item', `+${x.name} ${x.qty}`]], `구입 — ${x.name}${x.qty > 1 ? ` ×${x.qty}` : ''}`);
            toastr.success(`${esc(x.name)} 구입`, TITLE); close(); setTimeout(() => openSheetTab('inv'), 200); return;
        }
        if (a === 'itemcustom') {
            const n = el.querySelector('[data-f="itemCustom"]').value.trim();
            if (!n) return;
            await addAdjust([['item', `+${n} ${Math.max(1, Number(el.querySelector('[data-f="itemQty"]').value) || 1)}`]], `추가 — ${n}`);
            close(); setTimeout(() => openSheetTab('inv'), 200); return;
        }
        if (a === 'partcustom') {
            const n = el.querySelector('[data-f="partCustom"]').value.trim();
            if (!n) return;
            await addAdjust([['upgrade', `+${n}`]], `배 개조 — ${n}`);
            close(); setTimeout(() => openSheetTab('inv'), 200); return;
        }
        if (a === 'aladd') {
            const k = el.querySelector('[data-f="alKind"]').value, n = el.querySelector('[data-f="alName"]').value.trim();
            const d = el.querySelector('[data-f="alDesc"]').value.trim(), w = el.querySelector('[data-f="alWith"]').value.trim();
            if (!n) return toastr.warning('제목을 써 주세요.', TITLE);
            await addAdjust([k === 'memory' ? ['memory', `${n} | ${d} | ${w}`] : ['discover', `${n} | ${k} | ${d}`]], '');
            close(); setTimeout(() => openSheetTab('album'), 200); return;
        }
        if (a === 'use' || a === 'addone') {
            const n = b.dataset.n;
            const ops = [['item', `${a === 'use' ? '-' : '+'}${n} 1`]];
            if (a === 'use' && /수리 자재/.test(n) && s.ship) ops.push(['ship', '+20']);
            await addAdjust(ops, `${a === 'use' ? '사용' : '추가'} — ${n}`);
            close(); setTimeout(() => openSheetTab('inv'), 200); return;
        }
        if (a === 'undo') {
            const m = getMeta();
            if (!m?.adjust?.length) return toastr.info('되돌릴 조정이 없다.');
            const last = m.adjust.sort((x, y) => x.t - y.t).pop();
            await saveMeta(); refreshNow(); close();
            toastr.info(`되돌렸다: ${esc(last.label || last.ops.map(o => o.join(' ')).join(', '))}`, TITLE);
        }
        if (a === 'editprof') { close(); setTimeout(() => openRegister(true), 200); }
        if (a === 'skip') { close(); setTimeout(openTimeskip, 200); }
        if (a === 'reset') { close(); setTimeout(newVoyage, 200); }
    });
    await popup(el, { okButton: '닫기' });
}

// ───────────────────────────── 설정 패널 ─────────────────────────────

function profileOptions(sel) {
    const list = listProfiles();
    const label = (p) => `${p.name}${p.model ? ` — ${p.model}` : p.api ? ` — ${p.api}` : ''}`;
    return `<option value="" ${!sel ? 'selected' : ''}>메인 연결 (지금 채팅과 같은 모델)</option>`
        + list.map(p => `<option value="${esc(p.id)}" ${p.id === sel ? 'selected' : ''}>${esc(label(p))}</option>`).join('')
        + (sel && !list.some(p => p.id === sel) ? `<option value="${esc(sel)}" selected>(사라진 프로필 — 메인 연결로 대체)</option>` : '');
}

function renderSettings() {
    if (document.getElementById('op-settings')) return;
    const s = settings();
    const o = (k, v, label) => `<option value="${v}" ${s[k] === v ? 'selected' : ''}>${label}</option>`;
    const el = h(`<div id="op-settings" class="op-settings">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header"><b>원피스 시뮬봇 HUD</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div>
            <div class="inline-drawer-content">
                <label class="checkbox_label"><input type="checkbox" data-s="enabled" ${s.enabled ? 'checked' : ''}> 사용</label>
                <label class="checkbox_label"><input type="checkbox" data-s="allCharacters" ${s.allCharacters ? 'checked' : ''}> 모든 캐릭터에서 사용 (기본: 원피스 시뮬봇 카드에서만)</label>
                <label class="checkbox_label"><input type="checkbox" data-s="autoRegister" ${s.autoRegister ? 'checked' : ''}> 출항하지 않은 채팅을 열면 출항 창 자동 열기</label>
                <label class="checkbox_label"><input type="checkbox" data-s="ticker" ${s.ticker ? 'checked' : ''}> 상태창에 최신 뉴스 한 줄 표시</label>
                <label class="checkbox_label"><input type="checkbox" data-s="effects" ${s.effects ? 'checked' : ''}> 연출 효과 (현상금 갱신 번쩍임, 빈사·수감 화면 효과)</label>
                <details class="op-feats"><summary><b>기능 켜고 끄기</b> (부수 기능)</summary>
                    ${[['featAct', '🏝️ 오늘 뭐 하지? (활동)'], ['featLetter', '✉️ 편지 (뉴스 쿠 우편)'], ['featMemo', '📝 메모장'], ['featHex', '🌀 해프닝 (랜덤 저주)'], ['featBoard', '📋 의뢰 게시판'], ['featNews', '📰 세계경제신문'], ['featDates', '🎂 생일·기념일'], ['featRumor', '👂 섬 소문 (AI)'], ['featAlbum', '📷 앨범 (추억·발견)']].map(([k, n]) => `<label class="checkbox_label"><input type="checkbox" data-s="${k}" ${s[k] ? 'checked' : ''}> ${n}</label>`).join('')}
                    <label>해프닝 자동 발동<select class="text_pole" data-s="hexAuto">${o('hexAuto', 'off', '끔 (버튼으로만)')}${o('hexAuto', 'rare', '가끔')}${o('hexAuto', 'normal', '종종')}</select></label>
                </details>
                <label>랜덤 이벤트 (날짜가 넘어갈 때)<select class="text_pole" data-s="events">${o('events', 'off', '끔')}${o('events', 'low', '가끔')}${o('events', 'normal', '보통')}${o('events', 'high', '자주')}</select></label>
                <label>메시지 상태 카드<select class="text_pole" data-s="msgCard">${o('msgCard', 'compact', '간단 (변동 칩)')}${o('msgCard', 'full', '최신 응답은 게이지까지')}${o('msgCard', 'off', '숨기기')}</select></label>
                <label>선택지<select class="text_pole" data-s="choices">${o('choices', 'tense', '의뢰·전투·수감 중에만')}${o('choices', 'always', '항상')}${o('choices', 'off', '쓰지 않음')}</select></label>
                <label>선택지를 누르면<select class="text_pole" data-s="choiceClick">${o('choiceClick', 'fill', '입력창에 넣기')}${o('choiceClick', 'send', '바로 보내기')}</select></label>
                <label>확장 AI에 쓸 모델 (연결 프로필)
                    <div class="op-inline"><select class="text_pole" data-s="aiProfile">${profileOptions(s.aiProfile)}</select>
                    <button class="menu_button" data-s-act="profiles" title="목록 새로고침"><i class="fa-solid fa-rotate"></i></button></div>
                    <small>의뢰 게시판·신문·섬 소문·AI 캐릭터/열매 생성에만 쓰입니다. 롤플 본문은 메인 연결 그대로. 실리태번의 「연결 프로필(Connection Profiles)」에 저장한 프로필이 여기에 나옵니다. 싸고 빠른 모델을 골라 두면 좋아요.</small></label>
                <label>상태 주입 깊이 (0 = 맨 마지막)<input type="number" min="0" max="20" class="text_pole" data-s="injectDepth" value="${s.injectDepth}"></label>
                <div class="op-set-btns">
                    <button class="menu_button" data-s-act="sheet">상태창</button>
                    <button class="menu_button" data-s-act="register">출항 창</button>
                    <button class="menu_button" data-s-act="preview">주입 프롬프트 보기</button>
                </div>
            </div>
        </div></div>`);
    el.addEventListener('change', (e) => {
        const k = e.target.dataset.s;
        if (!k) return;
        const v = e.target.type === 'checkbox' ? e.target.checked : e.target.type === 'number' ? Number(e.target.value) : e.target.value;
        settings()[k] = v;
        saveSettings();
        refreshNow();
    });
    el.addEventListener('click', async (e) => {
        const a = e.target.closest('[data-s-act]')?.dataset.sAct;
        if (a === 'profiles') { el.querySelector('[data-s="aiProfile"]').innerHTML = profileOptions(settings().aiProfile); toastr.info(`연결 프로필 ${listProfiles().length}개`, TITLE); }
        if (a === 'sheet') openSheet();
        if (a === 'register') openRegister(!!getMeta()?.profile);
        if (a === 'preview') {
            const txt = current ? ctx().substituteParams(buildInjection(current.state)) : '(원피스 시뮬봇이 활성화된 채팅이 아닙니다)';
            const pre = document.createElement('pre');
            pre.className = 'op-pre';
            pre.textContent = txt;
            popup(pre);
        }
    });
    document.getElementById('extensions_settings2')?.appendChild(el);
}

// ───────────────────────────── 슬래시 커맨드 ─────────────────────────────

function registerCommands() {
    const { SlashCommandParser, SlashCommand, SlashCommandArgument, SlashCommandNamedArgument, ARGUMENT_TYPE } = ctx();
    if (!SlashCommandParser?.addCommandObject) return;
    const simple = (name, fn, help) => SlashCommandParser.addCommandObject(SlashCommand.fromProps({ name, callback: () => { fn(); return ''; }, helpString: help }));
    simple('op-sheet', openSheet, '원피스 시뮬봇 상태창을 연다.');
    simple('op-board', openBoard, '원피스 시뮬봇 의뢰 게시판을 연다.');
    simple('op-news', openNews, '세계경제신문을 연다.');
    simple('op-map', () => openSheetTab('map'), '지도를 연다.');
    simple('op-new', () => openRegister(!!getMeta()?.profile), '출항(캐릭터 생성) 창을 연다. 이미 출항했다면 수정 창.');
    simple('op-skip', openTimeskip, '타임스킵 창을 연다.');
    simple('op-act', () => openActivity(), '「오늘 뭐 하지?」 활동 창을 연다.');
    simple('op-letter', () => openLetters(), '편지(뉴스 쿠 우편) 창을 연다.');
    simple('op-memo', () => openMemo(), '메모장을 연다.');
    simple('op-hex', () => openHex(), '해프닝(랜덤 저주) 창을 연다.');
    simple('op-album', () => openSheetTab('album'), '앨범(추억·발견·상륙한 섬)을 연다.');
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'op-roll',
        callback: (_n, type) => {
            const t = ROLL_TYPES.find(x => x.name === String(type ?? '').trim() || x.id === String(type ?? '').trim());
            openRoll(t?.id);
            return '';
        },
        unnamedArgumentList: [SlashCommandArgument.fromProps({ description: '판정 종류 (힘/기술/민첩/견문/교섭/항해/은신/의지)', typeList: ARGUMENT_TYPE.STRING, isRequired: false })],
        helpString: '판정 창을 연다. 예: /op-roll 은신',
    }));
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'op-set',
        callback: async (named, text) => {
            if (!current?.state?.registered) return '';
            const key = String(named.key ?? '').trim();
            if (!key || !KEYMAP[key.toLowerCase()] || key.startsWith('_')) { toastr.warning('key가 올바르지 않습니다. 예: /op-set key=heat +30'); return ''; }
            await addAdjust([[key, String(text ?? '')]], `수동 조정 — ${key} ${text}`);
            return '';
        },
        namedArgumentList: [SlashCommandNamedArgument.fromProps({ name: 'key', description: 'hp, cash, bounty, heat, fame, tier, day, loc, mode, foe, wound, maim, item, crew, bond, ship, fruit, haki, prison…', typeList: ARGUMENT_TYPE.STRING, isRequired: true })],
        unnamedArgumentList: [SlashCommandArgument.fromProps({ description: '값 (+/- 부호는 증감, 없으면 그 값으로 설정)', typeList: ARGUMENT_TYPE.STRING, isRequired: true })],
        helpString: '상태를 직접 조정한다. 예: /op-set key=bounty 3000만',
    }));
}

// ───────────────────────────── 이벤트 ─────────────────────────────

const autoOpened = new Set();

function onChatChanged() {
    lastNotified = '';
    hudPrev = null;
    refreshNow();
    const id = ctx().getCurrentChatId?.();
    if (isActive() && settings().autoRegister && !getMeta()?.profile && id && !autoOpened.has(id)) {
        autoOpened.add(id);
        setTimeout(() => { if (isActive() && !getMeta()?.profile) openRegister(); }, 900);
    }
}

function onBeforeGenerate(type, _opts, dryRun) {
    if (dryRun || !isActive()) return;
    const chat = ctx().chat ?? [];
    let limit = chat.length;
    const last = chat[chat.length - 1];
    if ((type === 'swipe' || type === 'regenerate') && last && !last.is_user) limit = chat.length - 1;
    try {
        const r = compute(limit);
        setInjection(buildInjection(r.state));
    } catch (e) { console.error(LOG, e); }
}

function onRendered() {
    refreshNow();
    notifyLatest();
}

function init() {
    const { eventSource, event_types: E } = ctx();
    settings();
    renderSettings();
    registerCommands();
    const on = (name, fn) => { if (E[name]) eventSource.on(E[name], fn); };
    on('CHAT_CHANGED', onChatChanged);
    on('GENERATION_AFTER_COMMANDS', onBeforeGenerate);
    on('CHARACTER_MESSAGE_RENDERED', onRendered);
    on('USER_MESSAGE_RENDERED', refresh);
    on('MESSAGE_RECEIVED', refresh);
    on('MESSAGE_EDITED', refresh);
    on('MESSAGE_UPDATED', refresh);
    on('MESSAGE_DELETED', refresh);
    on('MESSAGE_SWIPED', refresh);
    on('MORE_MESSAGES_LOADED', refresh);
    on('GENERATION_ENDED', refresh);
    on('GENERATION_STOPPED', refresh);
    on('CHARACTER_EDITED', refresh);
    refreshNow();
    console.log(LOG, 'loaded');
}

const { eventSource: _es, event_types: _et } = SillyTavern.getContext();
_es.on(_et.APP_READY, init);

// test hook (Node harness only)
if (globalThis.__OP_TEST__) globalThis.__OP_TEST__.api = { openActivity, openBond, compute, extractOps, applyOp, freshState, buildInjection, parseNum, korNum, islandOf, rollMods, stepUp };
